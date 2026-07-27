import contextlib
import json
from pathlib import Path

from core.parser import parse_recipe


def generate_packages_json(
    packages_dir: str | Path | None = None, output_file: str | Path | None = None
):
    scripts_dir = Path(__file__).resolve().parent.parent
    repo_root = (
        scripts_dir.parent if (scripts_dir.parent / "packages").exists() else Path.cwd()
    )

    pkgs_path = Path(packages_dir) if packages_dir else repo_root / "packages"
    out_path = (
        Path(output_file) if output_file else repo_root / "site" / "packages.json"
    )
    out_path.parent.mkdir(parents=True, exist_ok=True)

    items = []
    if pkgs_path.exists():
        for pkg_dir in sorted(pkgs_path.iterdir()):
            recipe_file = pkg_dir / "build.yml"
            if pkg_dir.is_dir() and recipe_file.exists():
                with contextlib.suppress(Exception):
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

    out_path.write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"✓ Generated {out_path} with {len(items)} package entries.")


if __name__ == "__main__":
    generate_packages_json()
