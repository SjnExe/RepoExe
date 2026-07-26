# RepoExe

A scalable, multi-format package repository providing custom tools and standalone packages (like aapt2, zipalign, and aidl) built with modern continuous integration pipelines.

## Quick Install

To automatically install this custom repository on your device, run:

```shell
curl -sL https://SjnExe.github.io/RepoExe/install | sh
```

This universal script will automatically detect your active package manager (APT, Pacman, or Alpine apk), securely download the required keys, and inject the RepoExe repository into your system.

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
## ğŸš€ Installation

RepoExe provides native binaries for Android terminal environments across multiple package managers and ecosystems.

#&0Ä¸Q•ÉµÕà€¼AP€¡•™…Õ±Ğ¤)‰…Í )ÕÉ°€µÍ0¡ÑÑÁÌè¼½M©¹á”¹¥Ñ¡Õˆ¹¥¼½I•Á½á”½¥¹ÍÑ…±°ğÍ ) ((ŒŒŒ€È¸9A4M½Á”€¡É•Á½•á•€¤)‰…Í )ÕÉ°€µÍ0¡ÑÑÁÌè¼½M©¹á”¹¥Ñ¡Õˆ¹¥¼½I•Á½á”½¥¹ÍÑ…±°ğÍ €µÌ€´´€´µ¹Á´) ((ŒŒŒ€Ì¸AåÑ¡½¸]¡••±Ì€¼A¥À)‰…Í )ÕÉ°€µÍ0¡ÑÑÁÌè¼½M©¹á”¹¥Ñ¡Õˆ¹¥¼½I•Á½á”½¥¹ÍÑ…±°ğÍ €µÌ€´´€´µÁ¥À) ((ŒŒŒ€Ğ¸±°A…­…”I•Á½Í¥Ñ½É¥•Ì)‰…Í )ÕÉ°€µÍ0¡ÑÑÁÌè¼½M©¹á”¹¥Ñ¡Õˆ¹¥¼½I•Á½á”½¥¹ÍÑ…±°ğÍ €µÌ€´´€´µ…±°)€(