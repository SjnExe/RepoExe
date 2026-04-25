# RepoExe

RepoExe is a modern, modular, Python-based package orchestrator designed to compile and distribute software across diverse environments.

It replaces legacy bash-based build infrastructures with a structured, AI-friendly CI/CD pipeline, natively supporting **APT (Debian)**, **Pacman**, and **Alpine (apk)** package formats.

## Architecture

* **Micro-Modular Python:** The core logic is built strictly with isolated Python modules utilizing `pydantic` for schema validation and `uv` for lightning-fast dependency management.
* **YAML Package Definitions:** Packages are defined using explicit, typed `build.yml` files, abandoning fragile shell scripts.
* **Hermetic Sandboxing:** Builds execute within strictly controlled, isolated environments (e.g., Docker, Bubblewrap) to guarantee reproducible artifacts and prevent host pollution.
* **Dynamic Dependency Resolution:** Implements hybrid dependency resolution, natively querying configured external repositories (Termux, TUR, Alpine) or resolving components locally.
* **CI Optimized:** Leverages GitHub Actions for Dynamic Matrix Sharding, routing jobs efficiently, caching securely via `sccache` and GitHub Container Registry, and deploying metadata entirely statically using TUF principles.

## Getting Started

This repository provides an automated Docker environment configured with all required toolchains and patches.

```bash
# Pull the latest builder image
docker pull ghcr.io/sjnexe/repoexe-builder:latest

# Start the builder container
# See AGENTS.md for full execution and patching commands
```

## AI Directives

This repository is maintained and refactored heavily by AI agents. If you are an AI agent, refer strictly to `AGENTS.md` and `plan.md` before making any modifications to the core architecture.
