import sys
from pathlib import Path
import yaml

def update_recipe(pkg: str, channel: str, new_version: str) -> None:
    recipe_path = Path("pkg") / pkg / "build.yml"
    if not recipe_path.exists():
        print(f"Error: {recipe_path} does not exist.", file=sys.stderr)
        sys.exit(1)

    with open(recipe_path, "r", encoding="utf-8") as f:
        d = yaml.safe_load(f)

    d["version"] = new_version
    d["revision"] = 0

    if "channels" in d and channel in d["channels"]:
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
