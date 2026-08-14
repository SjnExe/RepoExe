import json
import os
import subprocess
import sys
import urllib.request
from pathlib import Path

from utils.dag import DependencyGraph
from utils.parser import parse_recipe


def check_remote_release_exists(pkg_name: str, channel: str = "latest") -> bool:
    tag = f"{pkg_name}@{channel}"
    api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"
    try:
        req = urllib.request.Request(
            api_url, headers={"User-Agent": "RepoExe-Orchestrator"}
        )
        with urllib.request.urlopen(req, timeout=5) as resp:
            return resp.status == 200
    except Exception:
        return False


def get_git_diff_files(repo_root: Path) -> set[str]:
    base_ref = os.environ.get("GITHUB_BASE_REF", "").strip()
    diff_cmd = (
        ["git", "diff", "--name-only", f"origin/{base_ref}...HEAD"]
        if base_ref
        else ["git", "diff", "--name-only", "HEAD~1", "HEAD"]
    )
    try:
        res = subprocess.run(
            diff_cmd, cwd=repo_root, capture_output=True, text=True, check=False
        )
        if res.returncode != 0 or not res.stdout.strip():
            res = subprocess.run(
                ["git", "diff", "--name-only", "HEAD"],
                cwd=repo_root,
                capture_output=True,
                text=True,
                check=False,
            )
        if res.returncode == 0 and res.stdout.strip():
            return set(res.stdout.splitlines())
    except Exception:
        pass
    return set()


def get_changed_packages(repo_root: Path) -> set[str]:
    files = get_git_diff_files(repo_root)
    return {
        Path(f.strip()).parts[1]
        for f in files
        if len(Path(f.strip()).parts) >= 2 and Path(f.strip()).parts[0] == "pkg"
    }


def parse_target_tokens(
    raw_input: str, dag: DependencyGraph, pkgs_dir: Path
) -> list[str]:
    all_pkgs = set(dag.recipes.keys())
    tokens = raw_input.split()

    selected = set()
    excluded = set()

    for token in tokens:
        if token.startswith("!"):
            ex_name = token[1:].split("@")[0]
            if ex_name.startswith(("type:", "format:")):
                target_fmt = ex_name.split(":", 1)[1]
                for p, r in dag.recipes.items():
                    if target_fmt in getattr(r, "formats", []):
                        excluded.add(p)
            elif ex_name == "all":
                excluded.update(all_pkgs)
            elif ex_name in all_pkgs:
                excluded.add(ex_name)
        else:
            inc_name = token.split("@")[0]
            if inc_name.startswith(("type:", "format:")):
                target_fmt = inc_name.split(":", 1)[1]
                for p, r in dag.recipes.items():
                    if target_fmt in getattr(r, "formats", []):
                        selected.add(p)
            elif inc_name == "all":
                selected.update(all_pkgs)
            elif inc_name in all_pkgs:
                selected.add(inc_name)

    if not selected:
        selected = all_pkgs

    final_requested = selected - excluded

    for pkg in list(final_requested):
        recipe = dag.recipes.get(pkg)
        if recipe:
            deps = set((recipe.deps or []) + (recipe.build_deps or []))
            for dep in deps:
                if dep in excluded and not check_remote_release_exists(dep):
                    print(
                        f"::error:: Target '{pkg}' requires '{dep}', but '{dep}' was explicitly excluded (!{dep}) and no remote release exists."
                    )
                    sys.exit(1)

    expanded_targets = set(final_requested)
    for pkg in list(final_requested):
        recipe = dag.recipes.get(pkg)
        if recipe:
            deps = set((recipe.deps or []) + (recipe.build_deps or []))
            for dep in deps:
                if dep in all_pkgs:
                    expanded_targets.add(dep)

    return list(expanded_targets)


def build_matrix_layer(
    pkgs_list: list[str], pkgs_dir: Path, dag: DependencyGraph
) -> list[dict]:
    matrix = []
    for p in sorted(pkgs_list):
        recipe_path = pkgs_dir / p / "pkg.yml"
        if not recipe_path.exists():
            continue
        try:
            r = parse_recipe(recipe_path, channel="latest")

            max_zram = getattr(r.resources, "zram", 0)
            max_swap = getattr(r.resources, "swap", 0)
            max_free_space = getattr(r.resources, "free_space", False)

            for dep_name in r.build_deps or []:
                dep_recipe_path = pkgs_dir / dep_name / "pkg.yml"
                if dep_recipe_path.exists():
                    dr = parse_recipe(dep_recipe_path, channel="latest")
                    max_zram = max(max_zram, getattr(dr.resources, "zram", 0))
                    max_swap = max(max_swap, getattr(dr.resources, "swap", 0))
                    max_free_space = max_free_space or getattr(
                        dr.resources, "free_space", False
                    )

            matrix.append(
                {
                    "package": p,
                    "channel": "latest",
                    "heavy": r.heavy_build or (max_swap > 0 or max_zram > 0),
                    "build_system": r.build_system,
                    "zram": max_zram,
                    "swap": max_swap,
                    "free_space": max_free_space,
                }
            )
        except Exception:
            pass
    return matrix


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    pkgs_dir = repo_root / "pkg"
    raw_input = os.environ.get("TARGET_INPUT", "").strip()

    dag = DependencyGraph(pkgs_dir)

    if not raw_input or raw_input == "auto":
        changed_pkgs = list(get_changed_packages(repo_root))
        if changed_pkgs:
            target_pkgs = list(
                parse_target_tokens(" ".join(changed_pkgs), dag, pkgs_dir)
            )
        else:
            target_pkgs = list(dag.recipes.keys())
    else:
        target_pkgs = parse_target_tokens(raw_input, dag, pkgs_dir)

    matrix = build_matrix_layer(target_pkgs, pkgs_dir, dag)
    print(json.dumps({"matrix": matrix}))


if __name__ == "__main__":
    main()
