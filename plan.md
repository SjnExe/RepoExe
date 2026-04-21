# Refactoring Plan for RepoExe

## Project Context & Goals

**Goal:** To migrate and extensively refactor the Termux build environment into a highly customized, CI-optimized repository called **RepoExe**. The refactoring process will utilize files from the upstream `termux-packages` repository and the previous `backup` directory, merging the best configurations while aggressively stripping out unnecessary legacy components (like X11/root packages and base app bootstrappers).

## Repository Configurations

- **Repository Name:** RepoExe
- **GitHub Repository:** https://github.com/SjnExe/RepoExe
- **GitHub Pages:** https://sjnexe.github.io/RepoExe/ (Used for hosting APT repository metadata)
- **GitHub Releases:** Used to store `.deb` package files.
- **Architectures Supported:** `aarch64`, `arm`, `i686`, `x86_64`, `all`
- **Main Component:** `main` (Default component for stable, public packages)
- **Dev Component:** `dev` (Enabled by installing the `repoexe-dev` package, which adds the component source list. Uninstalling `repoexe-dev` disables the component. Hosted in the `main` branch under a different folder similar to standard packages.)

## Environment & CI/CD Specs

- **CI-First Optimization:** The core codebase (`Dockerfile`, workflows, build scripts) must be **strictly optimized for GitHub Actions**.
- **GitHub Runner Specs:** 4 Cores, 16GB RAM. _Note: There are two environments: the GitHub runner and Jules (the agent) environment. Everything in the repository should be tailored for the GitHub runner, which has 4 cores, 16GB RAM, and DOES support swap and zram unlike Jules environment._
- **Custom Docker Image (`docker.yml`):** Built and uploaded to GHCR. Docker is the **only officially supported environment** for local building to prevent host pollution.
- **Dual-Mode Build Workflow (`build.yml`):** PR Mode (compiles as a test) and Release Mode (compiles and pushes to GitHub Releases on `main`).
- **Strict Caching Strategy:** Caching (e.g., `ccache` for C/C++ compilation, Docker layers, etc.) must be integrated to speed up workflows. However, **caches must only be saved when workflows run manually on `main` or are pushed to `main`**. PR workflows must strictly _restore_ caches only, to prevent cache pollution and invalidation issues.
- **Publish & Signing (`publish.yml`):** Retain the existing `backup` publishing workflow and `metadata.py` script that handles the RepoExe APT metadata generation and secure GPG signing.
- **ZRAM Action (`.github/actions/zram`):** Use the streamlined version from `backup` that skips fragile Linux kernel GPG verifications.
- **Package Updates (`package_updates.yml`):** Retain auto-PRs via `gh pr create`. Auto update is only enabled if necessary configuration in build.sh is set to true(sub packages should also support it), it should be false as default.
- **Security Analysis (`codeql.yml`):** Integrate CodeQL for static analysis.
- **Host Cleanup (`free-space.sh`):** Use extremely fast `rm -rf` logic for massive toolchains on the GitHub Host VM.

## Architectural Guidelines

1. **Agent Directive - Continuous Clarification:** The Agent (Jules) MUST proactively ask the user questions and request confirmation whenever making ambiguous refactoring decisions, to ensure zero issues.
2. **Independent Packages:** Bundled packages (like `android-tools`) will be replaced with independent packages that pull specific upstream sources.
3. **Granular Dependency Splitting:** `libandroid-tools` must be split into specific, independent upstream libraries (e.g., `libbase`, `libcutils`, `libutils`, `libziparchive`, `libandroidfw`). These will be implemented as subpackages within the `libandroid-tools` package to maintain them easily from a single source directory, while allowing granular dependencies. Suffixes will only be used if explicit conflicts with Termux are found.
4. **Preserve Sub-packages:** Termux's sub-package functionality (e.g., generating `-static` or `-dev` packages) must be retained in the build system.
5. **Standardize on NDK 29:** Remove all NDK 23c infrastructure and standardize build scripts for NDK 29.
6. **Parallelization Enforcement:** Globally standardize `MAKEFLAGS="-j4"` / `ninja -j4` to maximize the 4-core runners.
7. **Preserve Cross-Compilation Logic:** Refactor setup scripts (`scripts/build/setup/`) by replacing Termux paths, but DO NOT arbitrarily strip out vital cross-compilation engineering.
8. **Reference Retention:** The `backup/` and `termux-packages/` directories MUST be preserved throughout the refactoring process for reference. They will only be deleted at the very end.

## Refactoring Guidelines (Session Handover Context)

_Note to future agents: We are refactoring Termux to RepoExe. A strict rule has been established concerning variable modification across the codebase._

1. **Branding Removal (Variables):** Strip out `TERMUX_` branding from variables wherever possible to make the codebase standard and reduce bloat.
   - e.g., `TERMUX_APP__PACKAGE_NAME` becomes `APP__PACKAGE_NAME`. `TERMUX_PKG_*` becomes `PKG_*`.
   - **Collision Fallback Strategy:** Attempt to use generic variables directly (e.g., `PREFIX`, `ARCH`). If collisions occur during cross-compilation (e.g., standard `make` conflicting with generic names), fall back to `PKG_ARCH` or generic equivalents rather than immediately restoring the `TERMUX_` brand.
   - **Value Retention:** The actual string values inside these variables (like `/data/data/com.termux/files/usr` or `com.termux`) MUST NOT be changed, as this would break execution on the host device.
2. **Branding Removal (Text):** Strip out "termux" branding from text/URLs wherever possible to make the codebase standard. Do _not_ blindly replace "termux" with "RepoExe". Only use the "termux" brand name where the context strictly dictates it (e.g., specific Termux app interactions).
3. **Brand Usage:** When appropriate, use the brand as "RepoExe", "repoexe", or "REPOEXE" depending on the context.
4. **Comment Cleanup:** Remove useless or overly verbose comments found in the original Termux repository scripts. Keep only necessary, informative comments.
5. **Base Selection Strategy:** Some files should be copied from `backup` and refactored using `termux-packages` as a reference, or vice-versa. The choice must be dynamically made based on which file is structurally closer to the end goal.
6. **Packages Scope:** We will only maintain standard packages. Root packages (`root-packages`) and X11 packages (`x11-packages`) are entirely removed and out of scope.

## Ignored/Removed Components

- `golang_validation.yml` and `zig_validation.yml` (RepoExe will not maintain custom-patched compiler standard libraries).
- `bootstrap_archives.yml` and `scripts/bootstrap/` (Specific to base Termux app bootstrapping).
- Termux's complex `packages.yml`.
- `scripts/buildorder.py` (Restored from termux-packages and modified for RepoExe).
