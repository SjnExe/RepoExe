# RepoExe

A high-performance Termux package repository distributing custom tools and standalone packages built with modern continuous integration pipelines.

## Quick Install

To install the RepoExe repository on your Termux device, run:

```bash
curl -sL https://sjnexe.github.io/RepoExe/install | sh
```

This script configures the RepoExe APT repository and imports the repository signing key.

## Features

- **Native APT Repository:** Distributes `.deb` packages directly compatible with Termux `apt` and `pkg`.
- **Standalone Build System:** Packages are defined declaratively via TypeScript recipes (`recipe.ts`) using a high-performance Bun orchestrator.
- **Independent CI/CD Pipelines:** Automated dependency tracking, dynamic CI matrix sharding, and static Pages deployments.
- **Hermetic Docker Environments:** Reproducible artifact generation through strictly sandboxed Android NDK r30 Docker builder images.

## Contributing

Please read `CONTRIBUTING.md` for details on our code of conduct and the process for submitting pull requests to us.

If you are an AI agent or maintainer looking to modify the build infrastructure, please refer to `AGENTS.md` first.

## Security

If you discover a security vulnerability within RepoExe, please refer to our Security Policy in `SECURITY.md`.

## 🚀 Installation & Management

Install or re-sync the repository integration:

```bash
curl -sL https://sjnexe.github.io/RepoExe/install | sh
```

Use the `repoexe` management CLI:

```bash
# Check repository status
repoexe status

# Run diagnostic health check
repoexe doctor

# Sync repository lists
repoexe sync
```
