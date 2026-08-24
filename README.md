# RepoExe

A scalable, multi-format package repository providing custom tools and standalone packages (like aapt2, zipalign, and aidl) built with modern continuous integration pipelines.

## Quick Install

To automatically install this custom repository on your device, run:

```bash
curl -sL https://SjnExe.github.io/RepoExe/install | sh
```

This universal script will automatically detect your active package manager (APT, Pacman, or Alpine apk), securely download the required keys, and inject the RepoExe repository into your system.

## Features

- **Multi-Format Support:** Natively distributes `.deb` (APT), `.pkg.tar.zst` (Pacman), and `.apk` (Alpine) packages.
- **Standalone Build System**: Packages are defined declaratively via `pkg.yml` using a custom Python orchestrator.
- **Independent CI/CD Pipelines**: Automated dependency tracking, dynamic CI matrix sharding, and static Pages deployments.
- **Hermetic Docker Environments**: Reproducible artifact generation through strictly sandboxed custom Docker builder images.

## Contributing

Please read `CONTRIBUTING.md` for details on our code of conduct and the process for submitting pull requests to us.

If you are an AI agent or maintainer looking to modify the build infrastructure, please refer to `AGENTS.md` first.

## Security

If you discover a security vulnerability within RepoExe, please refer to our Security Policy in `SECURITY.md`.

## 🚀 Installation

RepoExe provides native binaries for Android terminal environments across multiple package managers and ecosystems.

### 1. Termux / APT (Default)
```bash
curl -sL https://SjnExe.github.io/RepoExe/install | sh
```
### 2. NPM Scope (@repoexe)
```bash
curl -sL https://SjnExe.github.io/RepoExe/install | sh -s -- --npm
```
### 3. Python Wheels / Pip
```bash
curl -sL https://SjnExe.github.io/RepoExe/install | sh -s -- --pip
```
### 4. All Package Repositories
```bash
curl -sL https://SjnExe.github.io/RepoExe/install | sh -s -- --all
``` 
