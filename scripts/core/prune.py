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
    """
    Identifies outdated release assets on a tag by whitelisting active package versions.
    Any asset not matching the current version/revision or state_hash is flagged for deletion.
    """
    to_delete = []
    whitelist = set()

    # Extract target metadata fields
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
    """Iterates through GitHub release tags and prunes outdated build assets."""
    # Locate repository paths
    scripts_dir = Path(__file__).parent.parent
    repo_root = (
        scripts_dir.parent if (scripts_dir.parent / "packages").exists() else Path.cwd()
    )
    pkgs_dir = repo_root / "packages"
    artifacts_dir = repo_root / "artifacts"

    # Fetch release tags using GitHub CLI
    res = subprocess.run(
        ["gh", "release", "list", "--limit", "1000", "--json", "tagName"],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0 or not res.stdout.strip():
        print("No release tags found or gh CLI unauthenticated.")
        return

    try:
        tags_data = json.loads(res.stdout)
        tags = [t["tagName"] for t in tags_data if "tagName" in t]
    except Exception as e:
        print(f"Failed to parse release tags: {e}")
        return

    for tag in tags:
        print(f"\n🔍 [PRUNE] Inspecting tag: {tag}")
        if "@" not in tag:
            continue

        pkg, channel = tag.split("@", 1)
        recipe_path = pkgs_dir / pkg / "build.yml"

        # Fetch current assets on the tag
        view_res = subprocess.run(
            ["gh", "release", "view", tag, "--json", "assets"],
            capture_output=True,
            text=True,
            check=False,
        )
        if view_res.returncode != 0:
            continue

        try:
            assets = json.loads(view_res.stdout).get("assets", [])
        except Exception:
            assets = []

        if not assets:
            print(f"Tag {tag} has no assets.")
            continue

        # Load metadata from recipe or tag artifact
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
            except Exception as e:
                print(f"Could not parse recipe for {pkg}: {e}")

        meta_file = artifacts_dir / f"{tag}_metadata.json"
        if not metadata and meta_file.exists():
            try:
                metadata = json.loads(meta_file.read_text(encoding="utf-8"))
            except Exception:
                pass

        outdated = identify_outdated_assets(assets, metadata=metadata, pkg_name=pkg)

        if not outdated:
            print(f"✓ All assets on tag '{tag}' are up to date.")
            continue

        for asset in outdated:
            asset_name = asset.get("name")
            if not asset_name:
                continue
            print(
                f"🗑️ Deleting outdated asset '{asset_name}' from release tag '{tag}'..."
            )
            del_res = subprocess.run(
                ["gh", "release", "delete-asset", tag, asset_name, "-y"],
                check=False,
            )
            if del_res.returncode == 0:
                print(f"✓ Successfully deleted {asset_name}")
            else:
                print(f"⚠️ Failed to delete {asset_name}")


if __name__ == "__main__":
    prune_release_tags()
