from pathlib import Path

from builders.debian import generate_control_file
from utils.health import audit_repository_health
from utils.parser import parse_recipe

REPO_ROOT = Path(__file__).resolve().parents[1].parent


def test_all_package_formats_valid():
    """Validates that every package recipe targets supported distribution formats."""
    pkg_dir = REPO_ROOT / "pkg"
    supported_formats = {"apt", "pacman", "apk"}

    for p_dir in sorted(pkg_dir.iterdir()):
        recipe_file = p_dir / "pkg.yml"
        if p_dir.is_dir() and recipe_file.exists():
            recipe = parse_recipe(recipe_file)
            assert len(recipe.formats) > 0, (
                f"Package {recipe.name} has no formats defined."
            )
            for fmt in recipe.formats:
                assert fmt in supported_formats, (
                    f"Package {recipe.name} uses unsupported format '{fmt}'."
                )


def test_debian_control_installed_size():
    """Tests that generate_control_file includes Installed-Size field."""
    recipe_file = REPO_ROOT / "pkg" / "ruff" / "pkg.yml"
    recipe = parse_recipe(recipe_file)
    control = generate_control_file(recipe, installed_size_kib=1024)
    assert "Installed-Size: 1024" in control


def test_repository_recipe_consistency():
    """Ensures all recipes maintain valid metadata structures and unique names."""
    pkg_dir = REPO_ROOT / "pkg"
    report = audit_repository_health(pkg_dir)

    assert report["total_packages"] == report["valid_packages"]
    assert len(report["invalid_packages"]) == 0


def test_all_recipes_pinned_to_version():
    """Ensures every remote recipe explicitly pins its source to {version} or a tag/ref."""
    pkg_dir = REPO_ROOT / "pkg"
    for p_dir in sorted(pkg_dir.iterdir()):
        recipe_file = p_dir / "pkg.yml"
        if p_dir.is_dir() and recipe_file.exists():
            raw_text = recipe_file.read_text(encoding="utf-8")
            recipe = parse_recipe(recipe_file)
            src = recipe.source or ""
            if src and src != "local":
                assert (
                    "{version}" in raw_text or "#" in src or "releases/download" in src
                ), (
                    f"Package {recipe.name} has unpinned source '{src}' which"
                    " could pull unreleased HEAD."
                )
