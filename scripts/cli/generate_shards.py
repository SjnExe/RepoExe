import json
import os
import subprocess
from pathlib import Path

from utils.dag import DependencyGraph
from utils.parser import parse_recipe


def get_git_diff_files(repo_root: Path) -> set[str]:
    base_ref = os.environ.get("GITHUB_BASE_REF", "").strip()
    diff_cmd = ["git", "diff", "--name-only", f"origin/{base_ref}...HEAD"] if base_ref else ["git", "diff", "--name-only", "HEAD~1", "HEAD"]
    try:
        res = subprocess.run(diff_cmd, cwd=repo_root, capture_output=True, text=True, check=False)
        if res.returncode != 0 or not res.stdout.strip():
            res = subprocess.run(["git", "diff", "--name-only", "HEAD"], cwd=repo_root, capture_output=True, text=True, check=False)
        if res.returncode == 0 and res.stdout.strip():
            return set(res.stdout.splitlines())
    except Exception:
        pass
    return set()


def get_changed_packages(repo_root: Path) -> set[str]:
    files = get_git_diff_files(repo_root)
    return {Path(f.strip()).parts[1] for f in files if len(Path(f.strip()).parts) >= 2 and Path(f.strip()).parts[0] == "pkg"}


def parse_target_tokens(raw_input: str, dag: DependencyGraph, pkgs_dir: Path) -> list[str]:
    all_pkgs = set(dag.recipes.keys())
    tokens = raw_input.split()
    
    selected = set()
    excluded = set()

    for token in tokens:
        if token.startswith("!"):
            ex_name = token[1:].split("@")[0]
            if ex_name == "all":
                excluded.update(all_pkgs)
            elif ex_name in all_pkgs:
                excluded.add(ex_name)
        else:
            inc_name = token.split("@")[0]
            if inc_name == "all":
                selected.update(all_pkgs)
            elif inc_name in all_pkgs:
                selected.add(inc_name)

    if not selected:
        selected = all_pkgs

    final_requested = selected - excluded

    # Expand transitive dependencies automatically
    expanded_targets = set(final_requested)
    for pkg in list(final_requested):
        recipe = dag.recipes.get(pkg)
        if recipe:
            deps = set((recipe.deps or []) + (recipe.build_deps or []))
            for dep in deps:
                if dep in all_pkgs:
                    expanded_targets.add(dep)

    return list(expanded_targets)


def build_matrix_layer(pkgs_list: list[str], pkgs_dir: Path) -> list[dict]:
    matrix = []
    for p in pkgs_list:
        recipe_path = pkgs_dir / p / "build.yml"
        if not recipe_path.exists():
            continue
        try:
            r = parse_recipe(recipe_path, channel="latest")
            matrix.append({
                "package": p,
                "channel": "latest",
                "heavy": r.heavy_build,
                "build_system": r.build_system,
                "zram": getattr(r.resources, "zram", 0),
                "swap": getattr(r.resources, "swap", 0),
                "free_space": getattr(r.resources, "free_space", False),
            })
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
            target_pkgs = list(parse_target_tokens(" ".join(changed_pkgs), dag, pkgs_dir))
        else:
            target_pkgs = list(dag.recipes.keys())
    else:
        target_pkgs = parse_target_tokens(raw_input, dag, pkgs_dir)

    layers = dag.get_layers(target_pkgs)

    output = {
        "layer_0": build_matrix_layer(layers[0] if len(layers) > 0 else [], pkgs_dir),
        "layer_1": build_matrix_layer(layers[1] if len(layers) > 1 else [], pkgs_dir),
        "layer_2": build_matrix_layer(layers[2] if len(layers) > 2 else [], pkgs_dir),
        "layer_3": build_matrix_layer(layers[3] if len(layers) > 3 else [], pkgs_dir),
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
