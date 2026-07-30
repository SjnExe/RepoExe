from unittest.mock import MagicMock
from core.prune import get_expected_asset_filenames, identify_outdated_assets


def test_get_expected_asset_filenames():
    recipe = MagicMock()
    recipe.name = "ruff"
    recipe.version = "0.16.0"
    recipe.revision = 0
    recipe.formats = ["apt", "pacman", "alpine", "pip"]

    expected = get_expected_asset_filenames(recipe)

    assert "ruff_0.16.0_arm64.deb" in expected
    assert "ruff-0.16.0-1-aarch64.pkg.tar.zst" in expected
    assert "ruff-0.16.0-r0.apk" in expected
    assert "ruff-0.16.0-py3-none-any.whl" in expected
    assert "metadata.json" in expected


def test_identify_outdated_assets():
    recipe = MagicMock()
    recipe.name = "ruff"
    recipe.version = "0.16.0"
    recipe.revision = 0
    recipe.formats = ["apt", "pacman"]

    assets = [
        {"id": 1, "name": "ruff_0.16.0_arm64.deb"},
        {"id": 2, "name": "ruff-0.16.0-1-aarch64.pkg.tar.zst"},
        {"id": 3, "name": "ruff_old_0.15.0_arm64.deb"},
    ]

    outdated = identify_outdated_assets(assets, recipe=recipe, pkg_name="ruff")
    outdated_names = [a["name"] for a in outdated]

    assert "ruff_old_0.15.0_arm64.deb" in outdated_names
    assert "ruff_0.16.0_arm64.deb" not in outdated_names
