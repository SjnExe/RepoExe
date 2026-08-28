from unittest.mock import MagicMock, patch

from cli.jules_autofix import trigger_jules_autofix


@patch("cli.jules_autofix.requests.post")
@patch("cli.jules_autofix.requests.get")
def test_trigger_jules_autofix(mock_get, mock_post, monkeypatch):
    monkeypatch.setenv("JULES_API_KEY", "test-key-123")
    monkeypatch.setenv("GITHUB_REPOSITORY", "SjnExe/RepoExe")

    mock_get_resp = MagicMock()
    mock_get_resp.status_code = 200
    mock_get_resp.json.return_value = {
        "sources": [
            {
                "name": "sources/github/SjnExe/RepoExe",
                "id": "github/SjnExe/RepoExe",
                "githubRepo": {"owner": "SjnExe", "repo": "RepoExe"},
            }
        ]
    }
    mock_get.return_value = mock_get_resp

    mock_post_resp = MagicMock()
    mock_post_resp.status_code = 200
    mock_post_resp.json.return_value = {"id": "session-xyz-123"}
    mock_post.return_value = mock_post_resp

    res = trigger_jules_autofix(
        "aisleriot", "latest", "3.4.0.1", "4.0.1", "update/aisleriot@latest/4.0.1"
    )

    assert res is True
    mock_post.assert_called_once()
    _args, kwargs = mock_post.call_args
    assert kwargs["headers"]["X-Goog-Api-Key"] == "test-key-123"
    assert (
        kwargs["json"]["sourceContext"]["source"] == "sources/github/SjnExe/RepoExe"
    )
