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
        target_pkgs = changed_pkgs if changed_pkgs else list(dag.recipes.keys())
    else:
        target_pkgs = list(dag.recipes.keys())

    layers = dag.get_layers(target_pkgs)

    layer_0_pkgs = layers[0] if len(layers) > 0 else []
    layer_1_pkgs = layers[1] if len(layers) > 1 else []

    output = {
        "layer_0": build_matrix_layer(layer_0_pkgs, pkgs_dir),
        "layer_1": build_matrix_layer(layer_1_pkgs, pkgs_dir),
    }

    print(json.dumps(output))


if __name__ == "__main__":
    main()
