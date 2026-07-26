import sys
from pathlib import Path

import requests
import yaml

from core.parser import parse_recipe


def get_latest_upstream_version(owner: str, repo: str) -> str | None:
    headers = {"User-Agent": "RepoExe-Orchestrator"}

    # 1. Try Releases API
    rel_url = f"https://api.github.com/repos/{owner}/{repo}/releases/latest"
    try:
        res = requests.get(rel_url, headers=headers, timeout=10)
        if res.status_code == 200:
            tag = res.json().get("tag_name", "").lstrip("v")
            if tag:
                return tag
    except Exception:  # noqa: BLE001
        pass

    # 2. Fallback to Tags API
    tags_url = f"https://api.github.com/repos/{owner}/{repo}/tags?per_page=1"
    try:
        res = requests.get(tags_url, headers=headers, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list) and len(data) > 0:
                tag = data[0].get("name", "").lstrip("v")
                if tag:
                    return tag
    except Exception:  # noqa: BLE001
        pass

    return None


def check_package_channel_updates(packages_dir: Path) -> None:
    for pkg_dir in sorted(packages_dir.iterdir()):
        recipe_file = pkg_dir / "build.yml"
        if not (pkg_dir.is_dir() and recipe_file.exists()):
            continue

        try:
            raw = yaml.safe_load(recipe_file.read_text(encoding="utf-8"))
            channels = raw.get("channels", {})
            channel_names = list(channels.keys()) if channels else ["latest"]
            if "latest" not in channel_names:
                channel_names.append("latest")

            for ch in channel_names:
                recipe = parse_recipe(recipe_file, channel=ch)

                if not recipe.auto_update:
                    print(f"[{recipe.name}@{ch}] Auto-update disabled. Skipping.")
                    continue

                if not recipe.source_url or "github.com" not in recipe.source_url:
                    continue

                parts = recipe.source_url.split("/")
                if "github.com" in parts:
                    idx = parts.index("github.com")
                    owner, repo = parts[idx + 1], parts[idx + 2]

                    latest_ver = get_latest_upstream_version(owner, repo)
                    if latest_ver and latest_ver != recipe.version:
                        print(
                            f"Update available for {recipe.name}@{ch}: {recipe.version} -> {latest_ver}"
                        )

        except Exception as e:  # noqa: BLE001
            print(f"[{pkg_dir.name}] Error checking updates: {e}", file=sys.stderr)


if __name__ == "__main__":
    pkgs_dir = Path(__file__).parent.parent.parent / "packages"
    check_package_channel_updates(pkgs_dir)
