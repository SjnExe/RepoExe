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
    repo_slug = (
        os.environ.get("GITHUB_REPOSITORY")
        or f"{os.environ.get('REPO_OWNER', 'SjnExe')}/RepoExe"
    )
    api_url = f"https://api.github.com/repos/{repo_slug}/releases/tags/{tag}"
    try:
        token = os.environ.get("GH_TOKEN") or os.environ.get("GITHUB_TOKEN")
        headers = {"User-Agent": "RepoExe-Orchestrator"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        req = urllib.request.Request(api_url, headers=headers)
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


def get_changed_packages(repo_root: Path, dag: DependencyGraph | None = None) -> set[str]:
    files = get_git_diff_files(repo_root)
    changed = {
        Path(f.strip()).parts[1]
        for f in files
        if len(Path(f.strip()).parts) >= 2 and Path(f.strip()).parts[0] == "pkg"
    }

    if dag:
        builder_format_map = {
            "debian.py": "apt",
            "pacman.py": "pacman",
            "alpine.py": "apk",
            "npm.py": "npm",
            "pip.py": "pip",
        }
        for f in files:
            p_parts = Path(f.strip()).parts
            if len(p_parts) >= 3 and p_parts[0] == "scripts" and p_parts[1] == "builders":
                builder_filename = p_parts[2]
                target_fmt = builder_format_map.get(builder_filename)
                if target_fmt:
                    for pkg_name, recipe in dag.recipes.items():
                        fmts = getattr(recipe, "formats", ["apt", "pacman", "apk"])
                        if target_fmt in fmts:
                            changed.add(pkg_name)

    return changed


def get_available_channels(pkg: str, dag: DependencyGraph) -> set[str]:
    recipe = dag.recipes.get(pkg)
    if not recipe:
        return {"latest"}
    ch_set = {"latest"}
    if hasattr(recipe, "channels") and recipe.channels:
        ch_set.update(recipe.channels.keys())
    return ch_set


def parse_target_tokens(
    raw_input: str, dag: DependencyGraph, pkgs_dir: Path
) -> list[tuple[str, str]]:
    all_pkgs = set(dag.recipes.keys())
    tokens = raw_input.split()

    selected_pairs: set[tuple[str, str]] = set()
    excluded_pairs: set[tuple[str, str]] = set()
    excluded_pkgs: set[str] = set()

    has_positive_selection = False

    for token in tokens:
        is_exclude = token.startswith("!")
        if is_exclude:
            token = token[1:]

        if "@" in token:
            target_part, channel_part = token.split("@", 1)
        else:
            target_part = token
            channel_part = "latest"

        matched_pkgs: set[str] = set()
        if target_part.startswith(("type:", "format:")):
            target_fmt = target_part.split(":", 1)[1]
            for p, r in dag.recipes.items():
                if target_fmt in getattr(r, "formats", []):
                    matched_pkgs.add(p)
        elif target_part == "all":
            matched_pkgs.update(all_pkgs)
        elif target_part in all_pkgs:
            matched_pkgs.add(target_part)

        pairs: set[tuple[str, str]] = set()
        for p in matched_pkgs:
            avail = get_available_channels(p, dag)
            if channel_part == "all":
                for ch in avail:
                    pairs.add((p, ch))
            else:
                pairs.add((p, channel_part))

        if is_exclude:
            excluded_pairs.update(pairs)
            if channel_part == "all":
                excluded_pkgs.update(matched_pkgs)
        else:
            has_positive_selection = True
            selected_pairs.update(pairs)

    if not has_positive_selection:
        for p in all_pkgs:
            selected_pairs.add((p, "latest"))

    final_requested = selected_pairs - excluded_pairs

    for pkg, ch in list(final_requested):
        recipe = dag.recipes.get(pkg)
        if recipe:
            deps = set((recipe.deps or []) + (recipe.build_deps or []))
            for dep in deps:
                if (dep in excluded_pkgs or (dep, "latest") in excluded_pairs) and not check_remote_release_exists(dep, "latest"):
                    print(
                        f"::error:: Target '{pkg}@{ch}' requires '{dep}', but '{dep}' was explicitly excluded and no remote release exists."
                    )
                    sys.exit(1)

    expanded_pairs = set(final_requested)
    for pkg, ch in list(final_requested):
        recipe = dag.recipes.get(pkg)
        if recipe:
            deps = set((recipe.deps or []) + (recipe.build_deps or []))
            for dep in deps:
                if dep in all_pkgs and not any(p == dep for p, _ in expanded_pairs):
                    expanded_pairs.add((dep, "latest"))

    return list(expanded_pairs)


def build_matrix_layer(
    pkgs_list: list[tuple[str, str]], pkgs_dir: Path, dag: DependencyGraph
) -> list[dict]:
    matrix = []
    for p, ch in sorted(pkgs_list):
        recipe_path = pkgs_dir / p / "pkg.yml"
        if not recipe_path.exists():
            continue
        try:
            r = parse_recipe(recipe_path, channel=ch)

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
                    "channel": ch,
                    "heavy": r.heavy_build or (max_swap > 0 or max_zram > 0),
                    "build_system": r.build_system,
                    "zram": max_zram,
                    "swap": max_swap,
                    "free_space": max_free_space,
                    "tmpfs": getattr(r.resources, "tmpfs", 12),
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
        diff_files = get_git_diff_files(repo_root)
        changed_pkgs = list(get_changed_packages(repo_root, dag=dag))
        if changed_pkgs:
            target_pkgs = parse_target_tokens(" ".join(changed_pkgs), dag, pkgs_dir)
        elif diff_files:
            target_pkgs = []
        else:
            target_pkgs = parse_target_tokens("all@latest", dag, pkgs_dir)
    else:
        target_pkgs = parse_target_tokens(raw_input, dag, pkgs_dir)

    matrix = build_matrix_layer(target_pkgs, pkgs_dir, dag)
    print(json.dumps({"matrix": matrix}))


if __name__ == "__main__":
    main()
