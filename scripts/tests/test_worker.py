from pathlib import Path

def test_worker_script_structure():
    worker_js_path = Path("scripts/worker/index.js")
    assert worker_js_path.exists(), "scripts/worker/index.js does not exist"

    content = worker_js_path.read_text(encoding="utf-8")

    # Check non-GET / non-HEAD HTTP method forwarding
    assert "request.method !== 'GET' && request.method !== 'HEAD'" in content
    assert "method: request.method" in content

    # Check system endpoint forwarding (/-/...)
    assert "parts[0].startsWith('-')" in content

    # Check upstream fallback and local store endpoints
    assert "https://registry.npmjs.org" in content
    assert "https://sjnexe.github.io/RepoExe/npm" in content
