from unittest.mock import MagicMock

from core.prune import identify_outdated_assets


def test_prune_assets():
    mock_assets = [
        {"id": 1, "name": "tsc_0.0.9_aarch64.deb"},
        {"id": 2, "name": "tsc_0.1.0_arm64.deb"},
    ]

    recipe = MagicMock()
    recipe.name = "tsc"
    recipe.version = "0.1.0"
    recipe.revision = 0
    recipe.formats = ["apt"]

    outdated = identify_outdated_assets(mock_assets, recipe=recipe, pkg_name="tsc")
    outdated_ids = [a["id"] for a in outdated]

    assert 1 in outdated_ids
    assert 2 not in outdated_ids
