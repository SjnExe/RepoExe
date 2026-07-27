import json
import os
from pathlib import Path

from core.parser import parse_recipe


def main() -> None:
    pkgs_dir = Path("../packages")
    raw_input = os.environ.get("TARGET_INPUT", "").strip()
    if not raw_input:
        print(json.dumps([]))
        return
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
            return list(recipe.channels.keys()) if recipe.channels else ["latest"]
        except Exception:  # noqa: BLE001
            return ["latest"]

    incl_tokens, excl_tokens = [], []
    for token in raw_input.split():
        if token.startswith("!"):
            excl_tokens.append(token[1:])
        else:
            incl_tokens.append(token)

    if not incl_tokens:
        incl_tokens = ["all"]

    candidates = set()
    for token in incl_tokens:
        pkg, ch = token.split("@", 1) if "@" in token else (token, "latest")
        target_pkgs = all_pkg_dirs if pkg == "all" else [pkg]
        for p in target_pkgs:
            if not (pkgs_dir / p).exists():
                continue
            target_chs = get_channels(p) if ch == "all" else [ch]
            for c in target_chs:
                candidates.add((p, c))

    excluded = set()
    for token in excl_tokens:
        pkg, ch = token.split("@", 1) if "@" in token else (token, None)
        target_pkgs = all_pkg_dirs if pkg == "all" else [pkg]
        for p, c in list(candidates):
            if p in target_pkgs and (ch is None or ch == "all" or c == ch):
                excluded.add((p, c))

    final_targets = [f"{p}:{c}" for (p, c) in sorted(candidates - excluded)]
    shards: list[list[str]] = [[] for _ in range(4)]
    for i, target in enumerate(final_targets):
        shards[i % 4].append(target)

    result = [{"shard": i, "packages": " ".join(s)} for i, s in enumerate(shards) if s]
    print(json.dumps(result))


if __name__ == "__main__":
    main()
