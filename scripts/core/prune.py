from typing import Any


def identify_outdated_assets(
    assets: list[dict[str, Any]], target_version: str, target_state_hash: str = ""
) -> list[dict[str, Any]]:
    """
    Identifies older package build assets on a channel release tag
    that do not match the exact target version or state_hash.
    """
    to_delete = []
    for asset in assets:
        name = asset.get("name", "")
        if name == "metadata.json":
            continue

        # Extract version component between underscores: <pkg>_<version>_<arch>.<ext>
        parts = name.split("_")
        if len(parts) >= 3:
            asset_version = parts[1]
            if asset_version != target_version:
                to_delete.append(asset)
                continue

        if f"_{target_version}_" not in name:
            to_delete.append(asset)
            continue

        if target_state_hash and target_state_hash not in name and ".hash." in name:
            to_delete.append(asset)

    return to_delete
