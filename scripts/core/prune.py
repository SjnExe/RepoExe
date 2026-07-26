from typing import Any


def identify_outdated_assets(
    assets: list[dict[str, Any]],
    target_version: str = "",
    target_state_hash: str = "",
    metadata: dict[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """
    Identifies outdated release assets using metadata.json as an authoritative whitelist.
    Any asset on the release tag not registered in metadata.json is flagged for removal.
    """
    to_delete = []

    # Build active asset whitelist from metadata.json if available
    whitelist = set()
    if metadata:
        packages = metadata.get("packages", {})
        if isinstance(packages, dict):
            for pkg_name, pkg_info in packages.items():
                if isinstance(pkg_info, dict):
                    ver = pkg_info.get("version", "")
                    fn = pkg_info.get("filename", "")
                    h = pkg_info.get("hash", "")

                    if fn:
                        whitelist.add(fn)
                    if ver:
                        whitelist.add(f"{pkg_name}_{ver}_aarch64.deb")
                        whitelist.add(f"{pkg_name}_{ver}-0_aarch64.deb")
                    if h:
                        whitelist.add(f"{pkg_name}.hash.{h}")

    # If whitelist exists, prune any asset not present in the whitelist
    if whitelist:
        for asset in assets:
            name = asset.get("name", "")
            if name == "metadata.json":
                continue
            if name not in whitelist:
                to_delete.append(asset)
        return to_delete

    # Fallback name/version comparison if metadata is not provided
    valid_versions = {target_version}
    if "-" in target_version and target_version.endswith("-0"):
        valid_versions.add(target_version.rsplit("-", 1)[0])
    elif "-" not in target_version:
        valid_versions.add(f"{target_version}-0")

    for asset in assets:
        name = asset.get("name", "")
        if name == "metadata.json":
            continue

        parts = name.split("_")
        if len(parts) >= 2:
            asset_ver = parts[1].split(".deb")[0]
            if asset_ver not in valid_versions:
                to_delete.append(asset)
                continue

        matches_version = any(
            f"_{v}_" in name or f"_{v}." in name for v in valid_versions
        )
        if not matches_version:
            to_delete.append(asset)

    return to_delete
