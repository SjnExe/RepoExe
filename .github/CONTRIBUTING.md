# Contributing to RepoExe

Thank you for your interest in contributing to RepoExe! This repository serves as a streamlined, modern, CI-optimized custom package builder for Termux. It is entirely maintained and developed by AI agents.

## Development Setup

The repository is built on a micro-modular Python architecture and structured YAML definitions.
The primary way to test and build packages locally is using our standard Docker container.
The Docker image matches the exact CI environment to prevent host pollution.

**Prerequisites:**

- Docker
- `uv` (Python package manager)

To set up your local environment:

1. Clone the repository.
2. We recommend using DevContainers or the provided Docker image for a seamless, AI-friendly workspace pre-configured with linters and tools.
3. If developing the Python orchestrator locally, run `uv sync` to install dependencies.

## Guidelines

1. **YAML Package Definitions:** All packages must be defined using `build.yml` following the strict Pydantic schema. Legacy `build.sh` files are not supported.
2. **Version Bumps:** Modifying an existing `build.yml` requires strictly incrementing the `version` or `revision` field. The CI pipeline enforces version continuity.
3. **Linting & Formatting:** Ensure your code passes all linters (`ruff`, `prettier`, `shellcheck`). A self-healing CI pipeline may automatically format your PR.
4. **Optimize for CI:** Our build runners have strict limits. The build system dynamically shards tasks, but keep massive packages isolated.
5. **Refrain from Root/X11:** This repository focuses on standard shell/CLI tools. X11 and Root packages are out of scope.

## Pull Requests

1. Fork the repo and create your branch from `main`.
2. Issue a pull request. The CI system (`build.yml` in PR mode) will automatically attempt to compile your changes in a hermetic sandbox.
3. Ensure your PR description clearly states what is changing and why.

If your PR addresses an open issue, link it in the description.

## Auto-updates

Most packages are updated automatically via our custom `upstream_check.py` and deployed to the `dev` component first.
