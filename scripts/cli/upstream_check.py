import contextlib
import re
import subprocess
import sys
from pathlib import Path

_scripts_dir = str(Path(__file__).resolve().parents[1])
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)
from typing import Any

import requests
import yaml
from packaging.version import InvalidVersion, Version
from utils.parser import parse_recipe


def extract_semver(tag_name: str) -> Version | None:
    clean_tag = tag_name.strip()
    match = re.search(r"v?(\d+\.\d+(?:\.\d+)?(?:-[\w.]+)?)$", clean_tag)
    if match:
        with contextlib.suppress(InvalidVersion):
            return Version(match.group(1))
    return None


def fetch_github_release(owner: str, repo: str) -> str | None:
    headers = {"User-Agent": "RepoExe-Orchestrator"}
    url = f"https://api.github.com/repos/{owner}/{repo}/releases/latest"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            raw_tag = res.json().get("tag_name", "")
            parsed = extract_semver(raw_tag)
            if parsed:
                return str(parsed)
    return None


def fetch_crates_version(crate_name: str) -> str | None:
    """Queries crates.io API for the latest published crate version."""
    headers = {"User-Agent": "RepoExe-Orchestrator (https://github.com/SjnExe/RepoExe)"}
    url = f"https://crates.io/api/v1/crates/{crate_name}"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            raw_ver = res.json().get("crate", {}).get("max_version", "")
            parsed = extract_semver(raw_ver)
            if parsed:
                return str(parsed)
    return None


def fetch_github_tag(owner: str, repo: str) -> str | None:
    headers = {"User-Agent": "RepoExe-Orchestrator"}
    url = f"https://api.github.com/repos/{owner}/{repo}/tags?per_page=100"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, headers=headers, timeout=10)
        if res.status_code == 200:
            data = res.json()
            if isinstance(data, list):
                valid_versions: list[Version] = []
                for item in data:
                    raw_name = item.get("name", "")
                    if re.search(r"(alpha|beta|rc|dev|test)", raw_name, re.IGNORECASE):
                        continue
                    parsed = extract_semver(raw_name)
                    if parsed:
                        valid_versions.append(parsed)

                if valid_versions:
                    return str(max(valid_versions))
    return None


def fetch_pypi_version(package_name: str) -> str | None:
    url = f"https://pypi.org/pypi/{package_name}/json"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            raw_ver = res.json().get("info", {}).get("version", "")
            parsed = extract_semver(raw_ver)
            if parsed:
                return str(parsed)
    return None


def fetch_npm_version(package_name: str) -> str | None:
    """Queries NPM registry for the latest published package version."""
    url = f"https://registry.npmjs.org/{package_name}/latest"
    with contextlib.suppress(
        requests.RequestException, ValueError, KeyError, TypeError
    ):
        res = requests.get(url, timeout=10)
        if res.status_code == 200:
            raw_ver = res.json().get("version", "")
            parsed = extract_semver(raw_ver)
            if parsed:
                return str(parsed)
    return None


def fetch_custom_update(recipe: Any) -> str | None:
    custom_cmd = getattr(recipe, "custom_update_cmd", None)
    if custom_cmd:
        with contextlib.suppress(subprocess.SubprocessError, OSError):
            res = subprocess.run(
                custom_cmd,
                shell=True,
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()

    updaters_dir = Path(__file__).parent.parent / "updaters"
    custom_script = updaters_dir / f"{recipe.name}.py"
    if custom_script.exists():
        with contextlib.suppress(subprocess.SubprocessError, OSError):
            res = subprocess.run(
                [sys.executable, str(custom_script)],
                capture_output=True,
                text=True,
                timeout=15,
                check=False,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()

    return None


def resolve_latest_version(recipe: Any) -> str | None:
    strategy = getattr(recipe, "update_strategy", None)
    src_url = getattr(recipe, "source", "") or ""

    if not strategy or strategy == "auto":
        return None

    if strategy in ("github_release", "github_tag"):
        if "github.com" not in src_url:
            return None
        parts = src_url.split("/")
        idx = parts.index("github.com")
        if len(parts) > idx + 2:
            owner, repo = parts[idx + 1], parts[idx + 2]
            if strategy == "github_release":
                return fetch_github_release(owner, repo)
            if strategy == "github_tag":
                return fetch_github_tag(owner, repo)

    if strategy == "pypi":
        return fetch_pypi_version(recipe.name)

    if strategy == "npm":
        return fetch_npm_version(recipe.name)

    if strategy == "crates":
        return fetch_crates_version(recipe.name)

    if strategy == "custom":
        return fetch_custom_update(recipe)

    return None


def check_package_channel_updates(pkg_dir: Path) -> None:
    for p_dir in sorted(pkg_dir.iterdir()):
        recipe_file = p_dir / "pkg.yml"
        if not (p_dir.is_dir() and recipe_file.exists()):
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
                    continue

                latest_ver = resolve_latest_version(recipe)
                if not latest_ver:
                    continue

                current_parsed = extract_semver(recipe.version)
                latest_parsed = extract_semver(latest_ver)

                if current_parsed and latest_parsed:
                    if latest_parsed > current_parsed:
                        print(
                            f"Update available for {recipe.name}@{ch}: {recipe.version} -> {latest_ver}"
                        )
                elif latest_ver != recipe.version:
                    print(
                        f"Update available for {recipe.name}@{ch}: {recipe.version} -> {latest_ver}"
                    )


if __name__ == "__main__":
    pkg_dir = Path(__file__).parent.parent.parent / "pkg"
    check_package_channel_updates(pkg_dir)
