import sys
from pathlib import Path

import yaml
from packaging.version import InvalidVersion, Version


def get_major_minor(version_str: str) -> str | None:
    try:
        v = Version(version_str)
        return f"{v.major}.{v.minor}"
    except InvalidVersion:
        parts = version_str.split(".")
        if len(parts) >= 2:
            return f"{parts[0]}.{parts[1]}"
    return None


def update_recipe(pkg: str, channel: str, new_version: str) -> None:
    recipe_path = Path("pkg") / pkg / "pkg.yml"
    if not recipe_path.exists():
        print(f"Error: {recipe_path} does not exist.", file=sys.stderr)
        sys.exit(1)

    with open(recipe_path, "r", encoding="utf-8") as f:
        d = yaml.safe_load(f) or {}

    old_version = str(d.get("version", ""))
    formats = d.get("formats", [])

    # Automated channel creation for npm/pip ecosystem when updating 'latest' across minor/major version boundaries
    if channel == "latest" and old_version and old_version != new_version:
        old_mm = get_major_minor(old_version)
        new_mm = get_major_minor(new_version)

        # Check if package targets npm or pip ecosystem and minor/major changed
        if (any(fmt in formats for fmt in ("npm", "pip")) or "channels" in d) and old_mm and new_mm and old_mm != new_mm:
            if "channels" not in d or not isinstance(d["channels"], dict):
                d["channels"] = {}

            # Preserve old major.minor as an explicit pinned channel if not already present
            if old_mm not in d["channels"]:
                old_channel_data = {
                    "version": old_version,
                    "revision": 0,
                    "auto_update": False,
                }
                if "source" in d:
                    old_channel_data["source"] = d["source"]
                d["channels"][old_mm] = old_channel_data
                print(f"⚡ Automated channel created: {pkg}@{old_mm} (pinned to {old_version})")

    d["version"] = new_version
    d["revision"] = 0

    if (
        "channels" in d
        and isinstance(d["channels"], dict)
        and channel in d["channels"]
        and isinstance(d["channels"][channel], dict)
    ):
        d["channels"][channel]["version"] = new_version
        d["channels"][channel]["revision"] = 0

    with open(recipe_path, "w", encoding="utf-8") as f:
        yaml.dump(d, f, sort_keys=False)

    print(f"✓ Successfully updated {pkg} ({channel}) to {new_version}")


if __name__ == "__main__":
    if len(sys.argv) < 4:
        print("Usage: python3 update_recipe.py <pkg> <channel> <new_version>")
        sys.exit(1)
    update_recipe(sys.argv[1], sys.argv[2], sys.argv[3])
