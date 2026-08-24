# RepoExe Agent Guidelines

## 🛠️ Environment Setup

To properly interact with and test the `RepoExe` repository, execute the following setup commands to install required dependencies.

```bash
# Update and install system utilities
sudo apt-get update
sudo apt-get install -y dpkg-dev libarchive-tools zip unzip jq gh gpg

# Install 'uv' for fast Python dependency management
curl -LsSf https://astral.sh/uv/install.sh | bash
source $HOME/.cargo/env

# Install actionlint for GitHub Actions validation
bash <(curl -s https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash)
sudo mv actionlint /usr/local/bin/

# Sync dependencies
uv sync
```

## 🧪 Testing Commands

*   **Format & Lint (Ruff):** `uv run ruff check --fix scripts/`
    *   *Warning:* Do not use `--unsafe-fixes` on `scripts/`, as it destroys dynamic imports (like `sys.path.insert`) required by the orchestrator.
*   **Unit Tests (Pytest):** `uv run pytest scripts/tests/`
*   **Health Checks:** `uv run scripts/cli/build.py check`
*   **Actionlint:** `actionlint .github/workflows/*.yml`

## 🏗️ Architectural Constraints

1.  **Site Directory:** The root `site/` folder is strictly for generated build artifacts (like `packages.json` and registry index HTML files) and is ignored in `.gitignore`. **All source files for the frontend (HTML/JS/CSS) and installation scripts must go in `scripts/site/`.** `index_gen.py` copies them over during CI.
2.  **Staging Directories:** Any temporary directories created during generation (like `apt_staging` or `npm_staging`) must be added to `.gitignore`.
3.  **Docker Builders:** All Docker configurations (e.g., `Dockerfile`, `runner.py`) must remain in `scripts/docker/` and are triggered by `docker.yml`.
4.  **No `__init__.py` in Deb Roots:** When building `.deb` packages via `scripts/builders/debian.py`, ensure source recipe metadata (`pkg.yml`, `__init__.py`) are excluded from the archive root to prevent `dpkg` read-only errors on Termux.
5.  **GitHub Releases:** When using `gh release create` programmatically, do not pass `--clobber`. It is invalid for creation operations and causes silent failures.

## 🚀 Workflows & Runners

*   The `build.yml` matrix jobs (building cross-compiled packages) and the `publish-site` job (E2E deployments) use the native `ubuntu-24.04-arm` runner.
*   Emulation (QEMU) is heavily discouraged unless explicitly needed for legacy AMD64 fallback testing.
