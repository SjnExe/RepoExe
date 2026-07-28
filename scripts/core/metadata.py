import contextlib
import json
from pathlib import Path

from core.parser import parse_recipe


def generate_packages_json(
    packages_dir: str | Path | None = None, output_file: str | Path | None = None
) -> None:
    repo_root = Path(__file__).resolve().parents[2]
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
                    if recipe.build_system in ["python", "custom"]:
                        formats.append("pip")
                    if recipe.build_system in ["go", "cargo", "custom"]:
                        formats.append("npm")

                    for fmt in sorted(set(formats)):
                        items.append(
                            {
                                "name": recipe.name,
                                "version": recipe.version,
                                "revision": recipe.revision,
                                "description": recipe.description
                                or f"{recipe.name} binary package",
                                "architecture": recipe.architecture or "aarch64",
                                "format": fmt,
                                "license": recipe.license or "MIT",
                                "homepage": recipe.homepage
                                or "https://github.com/SjnExe/RepoExe",
                            }
                        )

    out_path.write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"✓ Generated {out_path} with {len(items)} package entries.")


if __name__ == "__main__":
    generate_packages_json()
