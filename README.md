# RepoExe

A highly scalable, custom Termux APT repository with a split hosting strategy utilizing GitHub Releases for `.deb` package storage and GitHub Pages for repository metadata and an advanced frontend UI store.

## Features

- **Split Hosting Strategy**: Packages are hosted on rolling per-package GitHub Release tags to avoid UI clutter, while repository indices and metadata are served via GitHub Pages.
- **Modern APT Features**:
  - **PDiffs**: Incremental metadata updates.
  - **Acquire-By-Hash**: Secure, concurrent repository updates preventing hash-sum mismatches.
  - **Phased Updates**: Staged rollouts of high-risk package updates.
  - **AppStream Metadata**: Rich application data used by the frontend UI.
- **Advanced Store UI**: A GitHub Pages frontend providing a modern app store experience with search, dynamic routing, and installation command blocks.
- **Termux Hardware Optimizations**: Incorporates Termux's ZRAM GitHub Action configuration.
- **Modular Build System**: DRY package scripts powered by `mixins`.

## Contributing

See `.github/renovate.json` for dependency management.
