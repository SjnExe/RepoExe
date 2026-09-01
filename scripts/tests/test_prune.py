import json
from unittest.mock import MagicMock, patch

from cli.index_gen import fetch_existing_release_assets_to_artifacts
from cli.prune import get_expected_asset_filenames, identify_outdated_assets


def test_get_expected_asset_filenames():
    recipe = MagicMock()
    recipe.name = "ruff"
    recipe.version = "0.16.0"
    recipe.revision = 0
    recipe.formats = ["apt", "pacman", "apk", "pip"]

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
    assert "ruff-0.16.0-1-aarch64.pkg.tar.zst" not in outdated_names


def test_fetch_existing_release_assets_filters_outdated(tmp_path):
    art_dir = tmp_path / "artifacts"

    mock_releases = [
        {
            "tag_name": "bun@latest",
            "assets": [
                {
                    "name": "bun_1.4.0-1_arm64.deb",
                    "browser_download_url": "https://example.com/bun_1.4.0-1_arm64.deb",
                },
                {
                    "name": "bun_1.4.0_arm64.deb",
                    "browser_download_url": "https://example.com/bun_1.4.0_arm64.deb",
                },
            ],
        }
    ]

    def mock_subprocess_run(cmd, capture_output=True, text=True, check=False):
        res = MagicMock()
        res.returncode = 0
        if "view" in cmd:
            res.stdout = json.dumps({"owner": {"login": "SjnExe"}, "name": "RepoExe"})
        elif "api" in cmd:
            res.stdout = json.dumps(mock_releases)
        return res

    downloaded = []

    def mock_urlopen(url):
        downloaded.append(url)
        mock_resp = MagicMock()
        mock_resp.__enter__.return_value = mock_resp
        mock_resp.read.return_value = b"mock payload"
        return mock_resp

    recipe_bun = MagicMock()
    recipe_bun.name = "bun"
    recipe_bun.version = "1.4.0"
    recipe_bun.revision = 1
    recipe_bun.formats = ["apt"]

    with (
        patch("shutil.which", return_value="/usr/bin/gh"),
        patch("subprocess.run", side_effect=mock_subprocess_run),
        patch("urllib.request.urlopen", side_effect=mock_urlopen),
        patch("cli.index_gen.parse_recipe", return_value=recipe_bun),
        patch("shutil.copyfileobj", side_effect=lambda src, dst: dst.write(b"mock payload")),
    ):
        fetch_existing_release_assets_to_artifacts(art_dir)

    assert "https://example.com/bun_1.4.0-1_arm64.deb" in downloaded
    assert "https://example.com/bun_1.4.0_arm64.deb" not in downloaded
