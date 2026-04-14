# Contributing to RepoExe

Thank you for your interest in contributing to RepoExe! This repository serves
as a streamlined, CI-optimized custom package builder for Termux.

## Development Setup

The primary way to test and build packages locally is using our standard Docker
container. The Docker image matches the exact CI environment to prevent host
pollution.

See the root `README.md` and standard build scripts (`build-package.sh`) for how
to invoke the Docker builder locally.

## Guidelines

1. **Keep it Independent:** Packages should not rely on dynamic monolith build
   orders. Ensure your package cleanly fetches dependencies.
2. **Optimize for CI:** Our build runners have strict memory and core limits (4
   cores, 16GB RAM, no swap). Ensure compilation steps use appropriate
   parallelization (`-j4`) without exceeding limits.
3. **Refrain from Root/X11:** This repository focuses on standard shell/CLI
   tools. X11 and Root packages are out of scope.

## Pull Requests

1. Fork the repo and create your branch from `main`.
2. Make sure your code is tested inside the Docker container.
3. Issue a pull request. The CI system (`build.yml` in PR mode) will
   automatically attempt to compile your changes.
4. Ensure your PR description clearly states what is changing and why.

If your PR addresses an open issue, link it in the description.

## Auto-updates

Most packages are updated automatically via Renovate/CI workflows. If you are
submitting a manual update for a package like `aapt2` or `zipalign`, please
specify the revision changes in your PR.
