import shutil
import subprocess
from pathlib import Path
from typing import Any

from utils.parser import parse_recipe


def audit_repository_health(packages_dir: Path) -> dict[str, Any]:
    """Audits packages directory for validity, shell syntax, and computes ecosystem metrics."""
    total_packages = 0
    valid_packages = 0
    invalid_packages = []
    build_systems = {}

    sh_bin = shutil.which("bash") or shutil.which("sh")

    for pkg_dir in sorted(packages_dir.iterdir()):
        recipe_file = pkg_dir / "pkg.yml"
        if pkg_dir.is_dir() and recipe_file.exists():
            total_packages += 1
            try:
                recipe = parse_recipe(recipe_file)

                # Validate shell syntax across all defined phase blocks
                if sh_bin and hasattr(recipe, "phases") and recipe.phases:
                    for phase_name, script_text in recipe.phases.items():
                        if script_text and isinstance(script_text, str):
                            res = subprocess.run(
                                [sh_bin, "-n"],
                                input=script_text.encode("utf-8"),
                                capture_output=True,
                                check=False,
                            )
                            if res.returncode != 0:
                                err = res.stderr.decode(
                                    "utf-8", errors="replace"
                                ).strip()
                                raise ValueError(
                                    f"Shell syntax error in phase '{phase_name}': {err}"
                                )

                valid_packages += 1
                build_systems[recipe.build_system] = (
                    build_systems.get(recipe.build_system, 0) + 1
                )
            except (ValueError, KeyError, RuntimeError, TypeError, OSError) as e:
                invalid_packages.append({"package": pkg_dir.name, "error": str(e)})

    if invalid_packages:
        for inv in invalid_packages:
            print(f"❌ [Health Error] {inv['package']}: {inv['error']}")
        raise RuntimeError(
            f"Repository health check failed with {len(invalid_packages)} error(s)."
        )

    return {
        "total_packages": total_packages,
        "valid_packages": valid_packages,
        "invalid_packages": invalid_packages,
        "build_systems": build_systems,
    }
