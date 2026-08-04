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


def main() -> None:
    repo_root = Path(__file__).resolve().parents[2]
    pkgs_dir = repo_root / "pkg"
    raw_input = os.environ.get("TARGET_INPUT", "").strip()

    dag = DependencyGraph(pkgs_dir)
    ordered_all_pkgs = dag.resolve_build_order()

    if not raw_input or raw_input == "auto":
        changed_pkgs = get_changed_packages(repo_root)
        candidates = [p for p in ordered_all_pkgs if p in changed_pkgs]
    else:
        candidates = [p for p in ordered_all_pkgs if (pkgs_dir / p).exists()]

    matrix = []
    for p in candidates:
        recipe_path = pkgs_dir / p / "build.yml"
        if not recipe_path.exists():
            continue
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

    print(json.dumps(matrix))


if __name__ == "__main__":
    main()
