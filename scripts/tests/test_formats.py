from pathlib import Path

from builders.npm import generate_npm_index
from builders.pip import generate_pip_index
from utils.health import audit_repository_health
from utils.parser import parse_recipe

REPO_ROOT = Path(__file__).resolve().parents[1].parent


def test_all_package_formats_valid():
    """Validates that every package recipe targets supported distribution formats."""
    pkg_dir = REPO_ROOT / "pkg"
    supported_formats = {"apt", "pacman", "apk", "pip", "npm"}

    for p_dir in sorted(pkg_dir.iterdir()):
        recipe_file = p_dir / "build.yml"
        if p_dir.is_dir() and recipe_file.exists():
            recipe = parse_recipe(recipe_file)
            assert len(recipe.formats) > 0, (
                f"Package {recipe.name} has no formats defined."
            )
            for fmt in recipe.formats:
                assert fmt in supported_formats, (
                    f"Package {recipe.name} uses unsupported format '{fmt}'."
                )


def test_pip_index_generation(tmp_path):
    """Tests PEP 503 compliant PyPI index and hash generation."""
    fake_whl = tmp_path / "pydantic-2.13.4-py3-none-any.whl"
    fake_whl.write_bytes(b"mock wheel payload content")

    generate_pip_index(tmp_path)

    # Verify simple index HTML files are correctly structured
    assert (tmp_path / "pip" / "index.html").exists()
    assert (tmp_path / "pip" / "pydantic" / "index.html").exists()

    pkg_page = (tmp_path / "pip" / "pydantic" / "index.html").read_text(
        encoding="utf-8"
    )
    assert "pydantic-2.13.4-py3-none-any.whl" in pkg_page
    assert "#sha256=" in pkg_page


def test_npm_index_generation(tmp_path):
    """Tests standard NPM registry manifest generation."""
    fake_tgz = tmp_path / "tsc-7.0.2.tgz"
    fake_tgz.write_bytes(b"mock tgz payload content")

    generate_npm_index(tmp_path)

    # Verify NPM package directory and package.json manifest exist
    assert (tmp_path / "npm" / "tsc" / "package.json").exists()
    assert (tmp_path / "npm" / "tsc" / "tsc-7.0.2.tgz").exists()

    manifest = (tmp_path / "npm" / "tsc" / "package.json").read_text(encoding="utf-8")
    assert '"name": "tsc"' in manifest
    assert '"latest": "7.0.2"' in manifest


def test_repository_recipe_consistency():
    """Ensures all recipes maintain valid metadata structures and unique names."""
    pkg_dir = REPO_ROOT / "pkg"
    report = audit_repository_health(pkg_dir)

    assert report["total_packages"] == report["valid_packages"]
    assert len(report["invalid_packages"]) == 0


def test_all_recipes_pinned_to_version():
    """Ensures every remote recipe explicitly pins its source_url to {version} or a tag/ref."""
    pkg_dir = REPO_ROOT / "pkg"
    for p_dir in sorted(pkg_dir.iterdir()):
        recipe_file = p_dir / "build.yml"
        if p_dir.is_dir() and recipe_file.exists():
            raw_text = recipe_file.read_text(encoding="utf-8")
            recipe = parse_recipe(recipe_file)
            src = recipe.source_url or ""
            if src and src != "local":
                assert (
                    "{version}" in raw_text or "#" in src or "releases/download" in src
                ), (
                    f"Package {recipe.name} has unpinned source_url '{src}' which could pull unreleased HEAD."
                )
