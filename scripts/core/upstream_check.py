import sys
from pathlib import Path

import requests

from core.parser import parse_recipe


def check_package_channel_updates(packages_dir: Path) -> None:
    for pkg_dir in sorted(packages_dir.iterdir()):
        recipe_file = pkg_dir / "build.yml"
        if not (pkg_dir.is_dir() and recipe_file.exists()):
            continue

        try:
            # Parse base recipe to read defined channels
            import yaml

            raw = yaml.safe_load(recipe_file.read_text(encoding="utf-8"))
            channels = raw.get("channels", {})
            channel_names = list(channels.keys()) if channels else ["latest"]
            if "latest" not in channel_names:
                channel_names.append("latest")

            for ch in channel_names:
                recipe = parse_recipe(recipe_file, channel=ch)

                # Per-Channel Toggle Check!
                if not recipe.auto_update:
                    print(f"[{recipe.name}@{ch}] Auto-update disabled. Skipping.")
                    continue

                if not recipe.source_url or "github.com" not in recipe.source_url:
                    continue

                # Query GitHub API for releases
                # Example source_url: https://github.com/owner/repo/archive/refs/tags/v0.1.0.tar.gz
                parts = recipe.source_url.split("/")
                if "github.com" in parts:
                    idx = parts.index("github.com")
                    owner, repo = parts[idx + 1], parts[idx + 2]

                    api_url = (
                        f"https://api.github.com/repos/{owner}/{repo}/releases/latest"
                    )
                    res = requests.get(
                        api_url,
                        headers={"User-Agent": "RepoExe-Orchestrator"},
                        timeout=10,
                    )
                    if res.status_code == 200:
                        data = res.json()
                        tag_name = data.get("tag_name", "").lstrip("v")
                        if tag_name and tag_name != recipe.version:
                            print(
                                f"Update available for {recipe.name}@{ch}: {recipe.version} -> {tag_name}"
                            )

        except Exception as e:  # noqa: BLE001  # noqa: BLE001
            print(f"[{pkg_dir.name}] Error checking updates: {e}", file=sys.stderr)


if __name__ == "__main__":
    pkgs_dir = Path(__file__).parent.parent.parent / "packages"
    check_package_channel_updates(pkgs_dir)
