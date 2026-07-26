import contextlib
import re
from pathlib import Path
from typing import Any

import requests
import yaml

from core.parser import parse_recipe


def fetch_github_release(owner: str, repo: str) -> str | None:
    """Queries GitHub Releases API for the latest published release tag."""
    headers = {"User-Agent": "RepoExe-Orchestrator"}
    url = f"https://api.github.com/repos/{owner}/{repo}/releases/latest"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            tag = res.json().get("tag_name", "").lstrip("v")
            if tag:
                return tag
    return None


def fetch_github_tag(owner: str, repo: str) -> str | None:
    """Queries GitHub Tags API for projects that publish via git tags instead of releases."""
    headers = {"User-Agent": "RepoExe-Orchestrator"}
    url = f"https://api.github.com/repos/{owner}/{repo}/tags?per_page=10"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list):
                for item in data:
                    tag = item.get("name", "").lstrip("v")
                    # Ignore alpha, beta, rc tags unless explicitly desired
                    if tag and not re.search(r"(alpha|beta|rc|dev)", tag, re.IGNORECASE):
                        return tag
    return None


def fetch_pypi_version(package_name: str) -> str | None:
    """Queries PyPI JSON API for the latest published wheel/sdist release version."""
    url = f"https://pypi.org/pypi/{package_name}/json"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            return res.json().get("info", {}).get("version")
    return None


def resolve_latest_version(recipe: Any) -> str | None:
    """Dynamically routes update detection based on package source and strategy."""
    strategy = getattr(recipe, "update_strategy", "auto")
    src_url = getattr(recipe, "source_url", "") or ""

    if "github.com" in src_url:
        parts = src_url.split("/")
        idx = parts.index("github.com")
        if len(parts) > idx + 2:
            owner, repo = parts[idx + 1], parts[idx + 2]

            if strategy == "github_release":
                return fetch_github_release(owner, repo)
            if strategy == "github_tag":
                return fetch_github_tag(owner, repo)

            # Default 'auto' strategy: check release first, fallback to tags
            rel_ver = fetch_github_release(owner, repo)
            return rel_ver if rel_ver else fetch_github_tag(owner, repo)

    if strategy == "pypi" or "pypi.org" in src_url or "pythonhosted.org" in src_url:
        return fetch_pypi_version(recipe.name)

    return None


def check_package_channel_updates(packages_dir: Path) -> None:
    """Audits all defined packages and channels for available upstream updates."""
    for pkg_dir in sorted(packages_dir.iterdir()):
        recipe_file = pkg_dir / "build.yml"
        if not (pkg_dir.is_dir() and recipe_file.exists()):
            continue

        with contextlib.suppress(Exception):
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

                latest_ver = resolve_latest_version(recipe)
                if latest_ver and latest_ver != recipe.version:
                    print(
                        f"Update available for {recipe.name}@{ch}: {recipe.version} -> {latest_ver}"
                    )


if __name__ == "__main__":
    pkgs_dir = Path(__file__).parent.parent.parent / "packages"
    check_package_channel_updates(pkgs_dir)
