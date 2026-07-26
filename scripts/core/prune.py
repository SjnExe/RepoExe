from typing import Any


def identify_outdated_assets(
    assets: list[dict[str, Any]], target_version: str, target_state_hash: str = ""
) -> list[dict[str, Any]]:
    """
    Identifies older package build assets on a channel release tag
    that do not match the target version or state_hash.
    """
    to_delete = []

    # Normalize valid target versions (e.g., both '5.0.12' and '5.0.12-0')
    valid_versions = {target_version}
    if "-" in target_version and target_version.endswith("-0"):
        valid_versions.add(target_version.rsplit("-", 1)[0])
    elif "-" not in target_version:
        valid_versions.add(f"{target_version}-0")

    for asset in assets:
        name = asset.get("name", "")
        if name == "metadata.json":
            continue

        # Extract version component: <pkg>_<version>_<arch>.<ext>
        parts = name.split("_")
        if len(parts) >= 2:
            asset_ver = parts[1].split(".deb")[0]
            if asset_ver not in valid_versions:
                to_delete.append(asset)
                continue

        # Fallback boundary checks
        matches_version = any(
            f"_{v}_" in name or f"_{v}." in name for v in valid_versions
        )
        if not matches_version:
            to_delete.append(asset)
            continue

        # Check hash files
        if target_state_hash and ".hash." in name and target_state_hash not in name:
            to_delete.append(asset)

    return to_delete
