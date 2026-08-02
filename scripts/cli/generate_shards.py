import json
import os
import subprocess
from pathlib import Path

from builders.parser import parse_recipe


def get_git_diff_files(repo_root: Path) -> set[str]:
    """Inspects git diff to find modified files."""
    base_ref = os.environ.get("GITHUB_BASE_REF", "").strip()
    if base_ref:
        diff_cmd = ["git", "diff", "--name-only", f"origin/{base_ref}...HEAD"]
    else:
        diff_cmd = ["git", "diff", "--name-only", "HEAD~1", "HEAD"]

    try:
        res = subprocess.run(
            diff_cmd,
            cwd=repo_root,
            capture_output=True,
            text=True,
            check=False,
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
    """Finds packages under pkg/ that have explicit file modifications."""
    files = get_git_diff_files(repo_root)
    changed_pkgs = set()

    for file in files:
        parts = Path(file.strip()).parts
        if len(parts) >= 2 and parts[0] == "pkg":
            changed_pkgs.add(parts[1])

    return changed_pkgs


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

    # Standard PR/Push auto-mode: ONLY build packages modified under pkg/
    if not raw_input or raw_input == "auto":
        changed_pkgs = get_changed_packages(repo_root)
        candidates = {(p, "latest") for p in changed_pkgs if (pkgs_dir / p).exists()}
    else:
        # Manual workflow_dispatch mode (e.g., "all@all", "tsc@latest")
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
            if token.startswith("type:"):
                sys_types = {"sys", "system", "apt"}
                q_type = token.split(":")[1]
                for p in all_pkg_dirs:
                    recipe_path = pkgs_dir / p / "build.yml"
                    try:
                        r = parse_recipe(recipe_path, channel="latest")
                        is_sys = r.build_system not in ["npm", "pip", "bun", "uv"]
                        if (q_type in sys_types and is_sys) or (q_type == r.build_system):
                            for c in get_channels(p):
                                candidates.add((p, c))
                    except Exception:
                        pass
                continue

            pkg, ch = token.split("@", 1) if "@" in token else (token, "latest")

            target_pkgs = all_pkg_dirs if pkg == "all" else pkg.split(",")

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

    final_targets = sorted(candidates)

    matrix = []

    for i, (p, c) in enumerate(final_targets):
        free_space = False
        zram = 0
        recipe_path = pkgs_dir / p / "build.yml"
        if recipe_path.exists():
            try:
                r = parse_recipe(recipe_path, channel=c)
                if r.heavy_build or r.free_space:
                    free_space = True
                if r.zram and r.zram > 0:
                    zram = r.zram
            except Exception:
                pass

        tag = f"{p}@{c}"
        if free_space:
            tag += ",free_space:true"
        if zram > 0:
            tag += f",zram:{zram}"

        matrix.append({"shard": i+1, "shards": len(final_targets), "targets": tag})

    if not matrix:
        print('{"include": []}')
    else:
        print(f"matrix={json.dumps({'include': matrix})}")

    github_output = os.environ.get("GITHUB_OUTPUT")
    if github_output:
        with open(github_output, "a") as f:
            if not matrix:
                f.write('matrix={"include": []}\n')
            else:
                f.write(f'matrix={json.dumps({"include": matrix})}\n')


if __name__ == "__main__":
    main()
