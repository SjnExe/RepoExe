# RepoExe

A completely independent and scalable Termux APT repository providing custom tools and standalone packages (like aapt2, zipalign, and aidl) built with modern continuous integration pipelines.

[![Build Docker Image](https://github.com/SjnExe/RepoExe/actions/workflows/docker.yml/badge.svg)](https://github.com/SjnExe/RepoExe/actions/workflows/docker.yml)
[![Build Packages](https://github.com/SjnExe/RepoExe/actions/workflows/build.yml/badge.svg)](https://github.com/SjnExe/RepoExe/actions/workflows/build.yml)

## Features

- **Standalone Package Build System**: Self-contained configurations for `aapt2`, `zipalign`, and `aidl`.
- **Independent CI/CD pipelines**: Full CI integration allowing automated package building and docker container generation without relying dynamically on the official `termux-packages`.
- **Custom Docker Build Container**: Built locally using a customized Ubuntu base to match the official Termux environment closely, with optimized pre-configurations.
- **Split Hosting Strategy**: Packages are hosted on rolling per-package GitHub Release tags to avoid UI clutter, while repository indices and metadata are served via GitHub Pages.

## Quick Install

To automatically install this custom repository in Termux, run:

```
curl -sL https://SjnExe.github.io/RepoExe/install | bash
```

## Contributing

See `.github/renovate.json` for dependency management.
