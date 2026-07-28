import concurrent.futures
import json
import subprocess
from pathlib import Path
from typing import Any

from core.parser import parse_recipe


def identify_outdated_assets(
    assets: list[dict[str, Any]],
    target_version: str = "",
    target_revision: int = 0,
    target_state_hash: str = "",
    metadata: dict[str, Any] | None = None,
    pkg_name: str = "",
) -> list[dict[str, Any]]:
    to_delete = []
    whitelist = set()

    if metadata:
        pkg_name = metadata.get("name", pkg_name)
        ver = metadata.get("version", "")
        rev = metadata.get("revision", 0)
        h = metadata.get("state_hash", "")
    else:
        ver = target_version
        rev = target_revision
        h = target_state_hash

    if pkg_name and ver:
        full_ver = f"{ver}-{rev}" if rev and rev > 0 else ver
        whitelist.add(f"{pkg_name}_{full_ver}_aarch64.deb")
        whitelist.add(f"{pkg_name}_{full_ver}_all.deb")
        if h:
            whitelist.add(f"{pkg_name}.hash.{h}")

    if not whitelist:
        return to_delete

    for asset in assets:
        name = asset.get("name", "")
        if name == "metadata.json":
            continue
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
    except Exception as e:  # noqa: BLE001
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
    except Exception as e:  # noqa: BLE001
        print(f"Failed to parse releases JSON: {e}")
        return

    deletion_tasks = []

    for release in releases:
        tag = release.get("tag_name", "")
        assets = release.get("assets", [])
        if "@" not in tag or not assets:
            continue

        pkg, channel = tag.split("@", 1)
        recipe_path = pkgs_dir / pkg / "build.yml"

        metadata = None
        if recipe_path.exists():
            try:
                recipe = parse_recipe(recipe_path, channel=channel)
                metadata = {
                    "name": recipe.name,
                    "version": recipe.version,
                    "revision": recipe.revision,
                    "state_hash": recipe.state_hash,
                }
            except Exception as e:  # noqa: BLE001
                print(f"Could not parse recipe for {pkg}: {e}")

        outdated = identify_outdated_assets(assets, metadata=metadata, pkg_name=pkg)

        for asset in outdated:
            asset_id = asset.get("id")
            asset_name = asset.get("name")
            if asset_id and asset_name:
                deletion_tasks.append((tag, asset_name, asset_id, owner, repo_name))

    if not deletion_tasks:
        print("✓ All release assets are up to date! Nothing to prune.")
        return

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
