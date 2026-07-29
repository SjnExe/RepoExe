import json
import os
import subprocess
from pathlib import Path

from core.parser import parse_recipe


def get_changed_packages(repo_root: Path) -> set[str]:
    """Inspects git diff to find modified packages in pkg/."""
    try:
        res = subprocess.run(
            ["git", "diff", "--name-only", "HEAD~1", "HEAD"],
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode != 0 or not res.stdout.strip():
            return set()

        changed = set()
        for line in res.stdout.splitlines():
            parts = Path(line.strip()).parts
            if len(parts) >= 2 and parts[0] == "pkg":
                changed.add(parts[1])
        return changed
    except Exception:
        return set()


def main() -> None:
    repo_root = Path(__file__).resolve().parents[1]
    pkgs_dir = repo_root / "pkg"

    raw_input = os.environ.get("TARGET_INPUT", "").strip()
    all_pkg_dirs = sorted(
        [
            d.name
            for d in pkgs_dir.iterdir()
            if d.is_dir() and (d / "build.yml").exists()
        ]
    )

    def get_channels(pkg_name: str) -> list[str]:
        recipe_path = pkgs_dir / pkg_name / "build.yml"
        if not recipe_path.exists():
            return ["latest"]
        try:
            recipe = parse_recipe(recipe_path, channel="latest")
            ch_keys = list(recipe.channels.keys()) if recipe.channels else []
            if "latest" not in ch_keys:
                ch_keys.insert(0, "latest")
            return ch_keys
        except Exception:
            return ["latest"]

    # Fallback to git diff if triggered by push or empty target input
    if not raw_input or raw_input == "auto":
        changed = get_changed_packages(repo_root)
        if changed:
            candidates = {(p, "latest") for p in changed if (pkgs_dir / p).exists()}
        else:
            candidates = {(p, "latest") for p in all_pkg_dirs}
    else:
        incl_tokens, excl_tokens = [], []
        for token in raw_input.split():
            if token.startswith("!"):
                excl_tokens.append(token[1:])
            else:
                incl_tokens.append(token)

        if not incl_tokens:
            incl_tokens = ["all@latest"]

        candidates = set()
        for token in incl_tokens:
            pkg, ch = token.split("@", 1) if "@" in token else (token, "latest")
            target_pkgs = all_pkg_dirs if pkg == "all" else [pkg]
            for p in target_pkgs:
                if not (pkgs_dir / p).exists():
                    continue
                available_chs = get_channels(p)
                target_chs = available_chs if ch == "all" else [ch]
                for c in target_chs:
                    candidates.add((p, c))

        excluded = set()
        for token in excl_tokens:
            pkg, ch = token.split("@", 1) if "@" in token else (token, None)
            target_pkgs = all_pkg_dirs if pkg == "all" else [pkg]
            for p, c in list(candidates):
                if p in target_pkgs and (ch is None or ch == "all" or c == ch):
                    excluded.add((p, c))

        candidates -= excluded

    final_targets = sorted(list(candidates))

    matrix = []
    for p, c in final_targets:
        heavy = False
        recipe_path = pkgs_dir / p / "build.yml"
        if recipe_path.exists():
            try:
                r = parse_recipe(recipe_path, channel=c)
                heavy = r.heavy_build
            except Exception:
                pass
        matrix.append({"package": p, "channel": c, "heavy": heavy})

    print(json.dumps(matrix))


if __name__ == "__main__":
    main()
