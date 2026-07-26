from typing import Any, Dict, List


def identify_outdated_assets(
    assets: List[Dict[str, Any]], 
    target_version: str, 
    target_state_hash: str = ""
) -> List[Dict[str, Any]]:
    """
    Identifies older package build assets on a channel release tag
    that do not match the target version or state_hash.
    """
    to_delete = []
    for asset in assets:
        name = asset.get("name", "")
        # Keep metadata.json or assets matching active version
        if name == "metadata.json":
            continue
            
        if target_version not in name:
            to_delete.append(asset)
        elif target_state_hash and target_state_hash not in name and ".hash." in name:
            to_delete.append(asset)

    return to_delete
