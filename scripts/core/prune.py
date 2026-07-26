from typing import List, Dict, Any


def identify_outdated_assets(assets: List[Dict[str, Any]], target_version: str) -> List[Dict[str, Any]]:
    """Identifies older package build assets that do not match the target version."""
    to_delete = []
    for asset in assets:
        name = asset.get("name", "")
        # If asset belongs to a package but doesn't match the active version string, mark for deletion
        if name.endswith(".deb") and target_version not in name:
            to_delete.append(asset)
    return to_delete
