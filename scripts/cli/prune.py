import concurrent.futures
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

_scripts_dir = str(Path(__file__).resolve().parents[1])
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)

from utils.parser import PackageRecipe, parse_recipe  # noqa: E402


def get_expected_asset_filenames(recipe: PackageRecipe) -> set[str]:
    """Dynamically generates all valid asset filenames based on enabled formats in the recipe."""
    ver = recipe.version
    rev = recipe.revision
    pkg = recipe.name

    version_str_deb = f"{ver}-{rev}" if rev > 0 else ver
    version_str_pacman = f"{ver}-{rev}" if rev > 0 else f"{ver}-1"
    version_str_apk = f"{ver}-r{rev}" if rev > 0 else f"{ver}-r0"

    expected = {
        "metadata.json",
        f"{pkg}_metadata.json",
    }

    formats = (
        set(recipe.formats)
        if hasattr(recipe, "formats") and recipe.formats
        else {"apt"}
    )

    if "apt" in formats:
        expected.add(f"{pkg}_{version_str_deb}_arm64.deb")
        expected.add(f"{pkg}_{version_str_deb}_aarch64.deb")
        expected.add(f"{pkg}_{version_str_deb}_all.deb")

    if "pacman" in formats:
        expected.add(f"{pkg}-{version_str_pacman}-aarch64.pkg.tar.zst")
        expected.add(f"{pkg}-{version_str_pacman}-aarch64.pkg.tar.gz")

    if "apk" in formats or "alpine" in formats:
        expected.add(f"{pkg}-{version_str_apk}.apk")

    if "npm" in formats:
        expected.add(f"{pkg}-{ver}.tgz")

    if "pip" in formats:
        clean_name = pkg.replace("-", "_")
        expected.add(f"{clean_name}-{ver}-py3-none-any.whl")

    return expected


def identify_outdated_assets(
    assets: list[dict[str, Any]],
    recipe: PackageRecipe | None = None,
    pkg_name: str = "",
) -> list[dict[str, Any]]:
    to_delete = []

    if not recipe:
        return to_delete

    whitelist = get_expected_asset_filenames(recipe)

    for asset in assets:
        name = asset.get("name", "")
        if name not in whitelist:
            to_delete.append(asset)

    return to_delete


def prune_release_tags() -> None:
    scripts_dir = Path(__file__).parent.parent
    repo_root = (
        scripts_dir.parent if (scripts_dir.parent / "pkg").exists() else Path.cwd()
    )
    pkgs_dir = repo_root / "pkg"

    repo_res = subprocess.run(
        ["gh", "repo", "view", "--json", "name,owner"],
        capture_output=True,
        text=True,
        check=False,
    )
    if repo_res.returncode != 0:
        print("⚠️ gh CLI unauthenticated or not inside git repository.")
        return

    try:
        repo_info = json.loads(repo_res.stdout)
        owner = repo_info["owner"]["login"]
        repo_name = repo_info["name"]
    except (json.JSONDecodeError, KeyError) as e:
        print(f"Failed to parse repo info: {e}")
        return

    releases_res = subprocess.run(
        ["gh", "api", f"repos/{owner}/{repo_name}/releases?per_page=100"],
        capture_output=True,
        text=True,
        check=False,
    )
    if releases_res.returncode != 0:
        print(f"Failed to fetch releases: {releases_res.stderr}")
        return

    try:
        releases = json.loads(releases_res.stdout)
    except json.JSONDecodeError as e:
        print(f"Failed to parse releases JSON: {e}")
        return

    deletion_tasks = []
    orphaned_releases = []

    for release in releases:
        tag = release.get("tag_name", "")
        assets = release.get("assets", [])
        if "@" not in tag:
            continue

        pkg, channel = tag.split("@", 1)
        recipe_path = pkgs_dir / pkg / "pkg.yml"

        if recipe_path.exists():
            try:
                recipe = parse_recipe(recipe_path, channel=channel)
                outdated = identify_outdated_assets(assets, recipe=recipe, pkg_name=pkg)

                for asset in outdated:
                    asset_id = asset.get("id")
                    asset_name = asset.get("name")
                    if asset_id and asset_name:
                        deletion_tasks.append(
                            (tag, asset_name, asset_id, owner, repo_name)
                        )
            except (ValueError, KeyError, RuntimeError, OSError) as e:
                print(f"Could not parse recipe for {pkg}: {e}")
        else:
            # Package recipe folder no longer exists in pkg/ -> mark entire release and tag for deletion
            orphaned_releases.append(tag)

    # 1. Prune orphaned releases (deleted packages)
    for tag in orphaned_releases:
        print(f"🗑️ Pruning deleted package release and tag: {tag}")
        subprocess.run(
            ["gh", "release", "delete", tag, "--cleanup-tag", "-y"],
            capture_output=True,
            text=True,
            check=False,
        )

    # 2. Prune outdated assets from existing packages
    if not deletion_tasks and not orphaned_releases:
        print("✓ All release assets and tags are up to date! Nothing to prune.")
        return

    if deletion_tasks:
        print(f"🗑️ Found {len(deletion_tasks)} outdated asset(s) to prune...")

        def delete_asset(
            task: tuple[str, str, int, str, str],
        ) -> tuple[str, bool, str]:
            tag, name, asset_id, repo_owner, repo = task
            res = subprocess.run(
                [
                    "gh",
                    "api",
                    "--method",
                    "DELETE",
                    f"repos/{repo_owner}/{repo}/releases/assets/{asset_id}",
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if res.returncode == 0:
                return (f"✓ [{tag}] Deleted {name}", True, "")
            return (f"❌ [{tag}] Failed to delete {name}", False, res.stderr)

        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as executor:
            results = list(executor.map(delete_asset, deletion_tasks))

        for msg, success, err in results:
            print(msg)
            if not success and err:
                print(f"   Error detail: {err.strip()}")


if __name__ == "__main__":
    prune_release_tags()
