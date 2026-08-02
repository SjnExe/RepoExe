# RepoExe

A scalable, multi-format package repository providing custom tools, ecosystem integrations, and standalone packages natively optimized for Termux.

## 🚀 Quick Install

To automatically install the RepoExe package repository and CLI onto your device, run:

```bash
curl -sL https://sjnexe.github.io/RepoExe/install | sh -s -- --bootstrap
```

This will automatically configure APT, download security keys, and inject the `repoexe` CLI globally.
Base packages (like `jscpd`, `tsc`, `aisleriot`) can now be directly installed via:

```bash
pkg install jscpd
```

## 🛠️ Exploring the CLI

RepoExe natively integrates with multiple ecosystems (NPM, Bun, PIP, X11). The CLI lets you enable overrides to automatically route missing unscoped ecosystem packages back to the Termux native repository.

```bash
repoexe enable all    # Enables NPM, Bun, and Pip integrations
repoexe enable x11    # Enables the GUI / Wayland component repository
repoexe status        # Verify your repository health
repoexe help          # Show available commands
```

## Architecture

- **Multi-Format Support:** Natively distributes `.deb` (APT), `.pkg.tar.zst` (Pacman), `.apk` (Alpine), `.whl` (Pip), and `.tgz` (NPM).
- **Standalone Build System**: Packages are defined declaratively via `build.yml` with support for isolated ZRAM generation and filesystem shrinking for heavy GUI builds.
- **Independent CI/CD Pipelines**: Automated dependency tracking via Python orchestrators with modular dynamic GitHub Matrix targets.
- **Robust Symlink Resolution**: Wrappers for Node ecosystems natively use pure-bash recursive resolution to survive nested `node_modules/.bin` limits.

## Contributing

Please read `CONTRIBUTING.md` for details on our code of conduct and the process for submitting pull requests to us.

If you are an AI agent or maintainer looking to modify the build infrastructure, please refer to `AGENTS.md` first.
