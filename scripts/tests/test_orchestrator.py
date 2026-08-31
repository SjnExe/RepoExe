import json
import os
import urllib.error
from pathlib import Path
from unittest.mock import MagicMock, patch

from cli.generate_shards import get_changed_packages
from cli.prune import identify_outdated_assets
from core.fetcher import _get_auth_headers, check_existing_release_hash


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


def test_get_changed_packages_ignores_non_pkg_files():
    mock_diff = {
        "scripts/docker/Dockerfile.builder",
        "scripts/docker/Dockerfile.tester",
        "AGENTS.md",
        "pkg/bun/pkg.yml",
    }
    with patch("cli.generate_shards.get_git_diff_files", return_value=mock_diff):
        changed = get_changed_packages(Path("."))
        assert changed == {"bun"}


def test_auth_headers_includes_token():
    with patch.dict(os.environ, {"GH_TOKEN": "test-token-123"}, clear=True):
        headers = _get_auth_headers()
        assert headers.get("Authorization") == "Bearer test-token-123"

    with patch.dict(os.environ, {"GITHUB_TOKEN": "gh-token-456"}, clear=True):
        headers = _get_auth_headers()
        assert headers.get("Authorization") == "Bearer gh-token-456"

    with patch.dict(os.environ, {}, clear=True):
        headers = _get_auth_headers()
        assert "Authorization" not in headers


def test_check_existing_release_hash_authenticated_request():
    mock_response = MagicMock()
    mock_response.read.return_value = json.dumps(
        {"body": json.dumps({"state_hash": "matching-hash-123"})}
    ).encode("utf-8")
    mock_response.__enter__.return_value = mock_response

    captured_requests = []

    def mock_urlopen(req, timeout=10):
        captured_requests.append(req)
        return mock_response

    with (
        patch.dict(
            os.environ,
            {"GH_TOKEN": "my-secret-token", "GITHUB_REPOSITORY": "testorg/testrepo"},
        ),
        patch("urllib.request.urlopen", side_effect=mock_urlopen),
    ):
        result = check_existing_release_hash("tsc", "latest", "matching-hash-123")
        assert result is True
        assert len(captured_requests) == 1
        assert (
            captured_requests[0].get_header("Authorization")
            == "Bearer my-secret-token"
        )
        assert (
            "https://api.github.com/repos/testorg/testrepo/releases/tags/tsc@latest"
            in captured_requests[0].full_url
        )


def test_check_existing_release_hash_http_error_handling():
    with (
        patch.dict(os.environ, {"GH_TOKEN": "token"}),
        patch(
            "urllib.request.urlopen",
            side_effect=urllib.error.HTTPError("url", 404, "Not Found", {}, None),
        ),
    ):
        assert check_existing_release_hash("tsc", "latest", "hash") is False


def test_parse_target_tokens_channels():
    from cli.generate_shards import parse_target_tokens
    from utils.dag import DependencyGraph

    dag = DependencyGraph(Path("pkg"))

    # Test explicit channel specifier e.g. jscpd@5.0
    pairs = parse_target_tokens("jscpd@5.0", dag, Path("pkg"))
    assert ("jscpd", "5.0") in pairs

    # Test channel wildcard for package e.g. jscpd@all
    pairs_all = parse_target_tokens("jscpd@all", dag, Path("pkg"))
    assert ("jscpd", "latest") in pairs_all
    assert ("jscpd", "5.0") in pairs_all

    # Test all@all
    pairs_all_all = set(parse_target_tokens("all@all", dag, Path("pkg")))
    assert ("jscpd", "latest") in pairs_all_all
    assert ("jscpd", "5.0") in pairs_all_all


def test_build_cli_pack_runs_when_stage_exists(tmp_path):
    pkg_dir = tmp_path / "pkg" / "dummy"
    pkg_dir.mkdir(parents=True)
    (pkg_dir / "pkg.yml").write_text("name: dummy\nversion: '1.0.0'\n")

    build_dir = tmp_path / "build" / "build_dummy"
    stage_dir = build_dir / "stage"
    stage_dir.mkdir(parents=True)

    with (
        patch("pathlib.Path.cwd", return_value=tmp_path),
        patch("cli.build.execute_pack") as mock_pack,
        patch("cli.build.check_existing_release_hash") as mock_check,
    ):
        from cli.build import main

        with patch("sys.argv", ["build.py", "pack", str(pkg_dir)]):
            main()

        mock_check.assert_not_called()
        mock_pack.assert_called_once()
