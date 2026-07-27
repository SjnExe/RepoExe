import json
from pathlib import Path

from core.parser import parse_recipe


def generate_packages_json(
    packages_dir: str = "packages", output_file: str = "site/packages.json"
):
    pkgs_path = Path(packages_dir)
    out_path = Path(output_file)
    out_path.parent.mkdir(parents=True, exist_ok=True)

    items = []
    if pkgs_path.exists():
        for pkg_dir in sorted(pkgs_path.iterdir()):
            recipe_file = pkg_dir / "build.yml"
            if pkg_dir.is_dir() and recipe_file.exists():
                try:
                    recipe = parse_recipe(recipe_file)
                    formats = ["apt", "pacman", "apk"]
                    if recipe.name in ["uv", "ruff", "pydantic", "pyyaml"]:
                        formats.append("pip")
                    if recipe.name in ["tsc", "jscpd"]:
                        formats.append("npm")

                    for fmt in formats:
                        items.append(
                            {
                                "name": recipe.name,
                                "version": recipe.version,
                                "description": recipe.description
                                or f"{recipe.name} binary package",
                                "architecture": recipe.architecture or "aarch64",
                                "format": fmt,
                                "license": recipe.license or "MIT",
                            }
                        )
                except Exception:
                    pass

    out_path.write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"✓ Successfully generated {output_file} with {len(items)} package entries.")


if __name__ == "__main__":
    generate_packages_json()
