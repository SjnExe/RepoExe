import contextlib
import json
from pathlib import Path

from core.parser import parse_recipe


def generate_packages_json(
    pkg_dir: str | Path | None = None,
    output_file: str | Path | None = None,
    artifacts_dir: str | Path | None = None,
) -> None:
    """Generates site/packages.json by inspecting built artifacts and recipe specs."""
    repo_root = Path(__file__).resolve().parents[2]
    pkgs_path = Path(pkg_dir) if pkg_dir else repo_root / "pkg"
    out_path = (
        Path(output_file) if output_file else repo_root / "site" / "packages.json"
    )
    art_path = Path(artifacts_dir) if artifacts_dir else repo_root / "artifacts"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    items = []
    available_files = (
        {f.name for f in art_path.rglob("*") if f.is_file()}
        if art_path.exists()
        else set()
    )

    if pkgs_path.exists():
        for p_dir in sorted(pkgs_path.iterdir()):
            recipe_file = p_dir / "build.yml"
            if p_dir.is_dir() and recipe_file.exists():
                with contextlib.suppress(Exception):
                    recipe = parse_recipe(recipe_file)
                    formats = getattr(recipe, "formats", ["apt", "pacman", "apk"])

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
                                "verified_built": any(
                                    recipe.name in f for f in available_files
                                ),
                            }
                        )

    out_path.write_text(json.dumps(items, indent=2), encoding="utf-8")
    print(f"✓ Generated {out_path} with {len(items)} package entries.")


if __name__ == "__main__":
    generate_packages_json()
