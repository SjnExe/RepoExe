from pathlib import Path
from typing import Any

from utils.parser import parse_recipe


def audit_repository_health(packages_dir: Path) -> dict[str, Any]:
    """Audits packages directory for validity and computes ecosystem metrics."""
    total_packages = 0
    valid_packages = 0
    invalid_packages = []
    build_systems = {}

    for pkg_dir in sorted(packages_dir.iterdir()):
        recipe_file = pkg_dir / "build.yml"
        if pkg_dir.is_dir() and recipe_file.exists():
            total_packages += 1
            try:
                recipe = parse_recipe(recipe_file)
                valid_packages += 1
                build_systems[recipe.build_system] = (
                    build_systems.get(recipe.build_system, 0) + 1
                )
            except Exception as e:
                invalid_packages.append({"package": pkg_dir.name, "error": str(e)})

    return {
        "total_packages": total_packages,
        "valid_packages": valid_packages,
        "invalid_packages": invalid_packages,
        "build_systems": build_systems,
    }
