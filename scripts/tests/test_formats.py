from pathlib import Path

from builders.debian import generate_control_file
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


def test_pip_index_generation(tmp_path):
    """Tests PEP 503 compliant PyPI index and hash generation."""
    fake_whl = tmp_path / "pydantic-2.13.4-py3-none-any.whl"
    fake_whl.write_bytes(b"mock wheel payload content")

    generate_pip_index(tmp_path)

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

    assert (tmp_path / "npm" / "tsc" / "package.json").exists()
    assert (tmp_path / "npm" / "tsc" / "tsc-7.0.2.tgz").exists()

    manifest = (tmp_path / "npm" / "tsc" / "package.json").read_text(encoding="utf-8")
    assert '"name": "tsc"' in manifest
    assert '"latest": "7.0.2"' in manifest


def test_scoped_npm_index_generation(tmp_path):
    """Tests scoped NPM package registry manifest generation."""
    import json
    import tarfile

    pkg_dir = tmp_path / "pkg"
    pkg_dir.mkdir(parents=True, exist_ok=True)
    (pkg_dir / "package.json").write_text(
        json.dumps(
            {
                "name": "@typescript/typescript-android-arm64",
                "version": "7.0.2",
                "bin": {"tsc": "lib/tsc"},
            }
        ),
        encoding="utf-8",
    )

    fake_tgz = tmp_path / "tsc-7.0.2.tgz"
    with tarfile.open(fake_tgz, "w:gz") as tar:
        tar.add(pkg_dir, arcname="package")

    generate_npm_index(tmp_path)

    scoped_manifest = (
        tmp_path / "npm" / "@typescript" / "typescript-android-arm64" / "package.json"
    )
    assert scoped_manifest.exists()
    content = scoped_manifest.read_text(encoding="utf-8")
    assert '"name": "@typescript/typescript-android-arm64"' in content


def test_npm_multiple_binaries(tmp_path):
    """Tests build_npm generates wrappers and package.json bin map for multiple binaries."""
    import json
    import tarfile

    from builders.npm import build_npm
    from utils.parser import PackageRecipe

    destdir = tmp_path / "build"
    usr_bin = (
        destdir / "stage" / "data" / "data" / "com.termux" / "files" / "usr" / "bin"
    )
    usr_bin.mkdir(parents=True, exist_ok=True)

    (usr_bin / "bun").write_text("#!/bin/sh\necho bun", encoding="utf-8")
    (usr_bin / "bunx").symlink_to("bun")

    output_dir = tmp_path / "dist"
    recipe = PackageRecipe(
        name="bun",
        version="1.4.0",
        revision=0,
        arch="aarch64",
        description="JavaScript runtime",
        license="MIT",
        maintainer="SjnExe",
        formats=["npm"],
    )

    tgz_path = build_npm(recipe, str(destdir), str(output_dir))
    assert tgz_path.exists()

    with tarfile.open(tgz_path, "r:gz") as tar:
        pkg_json_file = tar.extractfile("package/package.json")
        assert pkg_json_file is not None
        meta = json.loads(pkg_json_file.read().decode("utf-8"))
        assert meta["bin"] == {"bun": "bin/bun", "bunx": "bin/bunx"}

        bun_wrapper = tar.extractfile("package/bin/bun")
        assert bun_wrapper is not None
        assert "usr/bin/bun" in bun_wrapper.read().decode("utf-8")

        bunx_wrapper = tar.extractfile("package/bin/bunx")
        assert bunx_wrapper is not None
        assert "usr/bin/bunx" in bunx_wrapper.read().decode("utf-8")


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
