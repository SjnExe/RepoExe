# RepoExe

A scalable, multi-format package repository providing custom tools and standalone packages (like aapt2, zipalign, and aidl) built with modern continuous integration pipelines.


## Features

- **Multi-Format Support:** Natively distributes `.deb` (APT), `.pkg.tar.zst` (Pacman), and `.apk` (Alpine) packages.
- **Standalone Build System**: Packages are defined declaratively via `build.yml` using a custom Python orchestrator.
- **Independent CI/CD Pipelines**: Automated dependency tracking, dynamic CI matrix sharding, and static Pages deployments.
- **Hermetic Docker Environments**: Reproducible artifact generation through strictly sandboxed custom Docker builder images.

## Contributing

Please read `CONTRIBUTING.md` for details on our code of conduct and the process for submitting pull requests to us.

If you are an AI agent or maintainer looking to modify the build infrastructure, please refer to `AGENTS.md` first.

## Security

If you discover a security vulnerability within RepoExe, please refer to our Security Policy in `SECURITY.md`.

## 🚀 Installation

To automatically install this custom repository on your device, run:

```bash
curl -sL https://sjnexe.github.io/RepoExe/install | sh
```
