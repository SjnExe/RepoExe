# Refactoring Plan for RepoExe

## Repository Configurations

- **Repository Name:** RepoExe
- **GitHub Repository:** https://github.com/SjnExe/RepoExe
- **GitHub Pages:** https://sjnexe.github.io/RepoExe/ (Used for hosting APT repository metadata)
- **GitHub Releases:** Used to store `.deb` package files.
- **Architectures Supported:** `aarch64`, `arm`, `i686`, `x86_64`, `all`
- **Main Component:** `main` (Default component for stable, public packages)
- **Dev Component:** `dev` (Enabled by installing the `repoexe-dev` package, which adds the component source list. Uninstalling `repoexe-dev` disables the component.)

## Environment & CI/CD Specs

- **CI-First Optimization:** The core codebase (`Dockerfile`, workflows, build scripts) must be **strictly optimized for GitHub Actions**.
- **GitHub Runner Specs:** 4 Cores, 16GB RAM. *Note: The environment does NOT support swap or zram. Memory usage must be tightly controlled to prevent OOM errors, while maximizing parallelization.*
- **Custom Docker Image (`docker.yml`):** Built and uploaded to GHCR. Docker is the **only officially supported environment** for local building to prevent host pollution.
- **Dual-Mode Build Workflow (`build.yml`):** PR Mode (compiles as a test) and Release Mode (compiles and pushes to GitHub Releases on `main`).
- **Strict Caching Strategy:** Caching (e.g., `ccache` for C/C++ compilation, Docker layers, etc.) must be integrated to speed up workflows. However, **caches must only be saved when workflows run manually on `main` or are pushed to `main`**. PR workflows must strictly *restore* caches only, to prevent cache pollution and invalidation issues.
- **Publish & Signing (`publish.yml`):** Retain the existing `backup` publishing workflow and `metadata.py` script that handles the RepoExe APT metadata generation and secure GPG signing.
- **ZRAM Action (`.github/actions/zram`):** Use the streamlined version from `backup` that skips fragile Linux kernel GPG verifications.
- **Package Updates (`package_updates.yml`):** Retain auto-PRs via `gh pr create`. **Exception:** AOSP-derived tools like `aapt2`, `zipalign`, and `aidl` must be excluded from auto-updating since they require manual patch/revision alignment.
- **Security Analysis (`codeql.yml`):** Integrate CodeQL for static analysis.
- **Host Cleanup (`free-space.sh`):** Use extremely fast `rm -rf` logic for massive toolchains on the GitHub Host VM.

## Architectural Guidelines

1. **Agent Directive - Continuous Clarification:** The Agent (Jules) MUST proactively ask the user questions and request confirmation whenever making ambiguous refactoring decisions, to ensure zero issues.
2. **Independent Packages:** Bundled packages (like `android-tools`) will be replaced with independent packages that pull specific upstream sources.
3. **Granular Dependency Splitting:** `libandroid-tools-shared` must be split into specific, independent upstream libraries (e.g., `liblog`, `libziparchive`, `libbase`, `libcutils`). Suffixes will only be used if explicit conflicts with Termux are found.
4. **Preserve Sub-packages:** Termux's sub-package functionality (e.g., generating `-static` or `-dev` packages) must be retained in the build system.
5. **Standardize on NDK 29:** Remove all NDK 23c infrastructure and standardize build scripts for NDK 29.
6. **Parallelization Enforcement:** Globally standardize `MAKEFLAGS="-j4"` / `ninja -j4` to maximize the 4-core runners.
7. **Preserve Cross-Compilation Logic:** Refactor setup scripts (`scripts/build/setup/`) by replacing Termux paths, but DO NOT arbitrarily strip out vital cross-compilation engineering.
8. **Reference Retention:** The `backup/` and `termux-packages/` directories MUST be preserved throughout the refactoring process for reference. They will only be deleted at the very end.

## Ignored/Removed Components

- `golang_validation.yml` and `zig_validation.yml` (RepoExe will not maintain custom-patched compiler standard libraries).
- `bootstrap_archives.yml` and `scripts/bootstrap/` (Specific to base Termux app bootstrapping).
- Termux's complex `packages.yml`.
- `scripts/buildorder.py` (RepoExe fetches missing dependencies directly from Termux rather than dictating a local monolithic build order).

## Refactor Checklist

The following is a layout of directories and files to be refactored, sorted generally from easiest (lowest severity) to hardest (highest severity).

### 1. NDK Patches & Versions (Severity: 10/100)
*Standardize on NDK 29 and clear legacy.*
- [ ] `ndk-patches/29/` (Copy from `backup` or `termux-packages` as needed)
- [ ] Delete `ndk-patches/23c/` completely.

### 2. Basic Configuration & Community Files (Severity: 20/100)
*Updates to standard repo configs and community docs. (Action version bumps handled automatically by Renovate).*
- [ ] `.gitignore`, `.gitattributes`, `.editorconfig`
- [ ] `LICENSE`
- [ ] `README.md` (Rewrite for RepoExe, but retain useful Termux structural features like status badges)
- [ ] `CONTRIBUTING.md`, `SECURITY.md`, `.github/ISSUE_TEMPLATE/`, `.github/PULL_REQUEST_TEMPLATE.md` (Clean up and adapt for RepoExe)
- [ ] `.github/stale.yml` (Ensure it ignores Renovate tags)

### 3. Utility Scripts & Host Cleanup (Severity: 30/100)
*Scripts that need minor standardization.*
- [ ] `scripts/properties.sh`
- [ ] `scripts/utils/` directory scripts
- [ ] `scripts/get_hash_from_file.py`
- [ ] `scripts/check-versions.sh`
- [ ] `scripts/lint-packages.sh`
- [ ] `scripts/free-space.sh` (Refine using fast `rm -rf` logic for host cleanup)

### 4. Site and GitHub Pages Metadata (Severity: 40/100)
*Migrate site directory from `backup`, tailor to RepoExe APT repository hosted on GitHub Pages.*
- [ ] `site/` (Index, CSS, JS from `backup`)
- [ ] `scripts/generate-apt-packages-list.sh` (or equivalent aptly scripts)
- [ ] `scripts/aptly_api.sh`
- [ ] `scripts/repoexe/metadata.py` (Verify GPG logic)

### 5. Package Definitions (Severity: 50/100)
*Adapt packages as fully independent entities. Granularize dependencies.*
- [ ] Split `libandroid-tools-shared` into independent packages (`liblog`, `libziparchive`, `libbase`, `libcutils`).
- [ ] `packages/aapt/` (Build once, deprecate upstream tracking)
- [ ] `packages/aapt2/`, `packages/zipalign/`, `packages/aidl/` (Setup for manual active tracking, exclude from auto-updates)
- [ ] `packages/repoexe-dev/` (Ensure this correctly provisions the `dev` component list)

### 6. Action Modules & Security Checks (Severity: 60/100)
*Setup the essential GitHub Actions modules and security checks.*
- [ ] `.github/actions/zram/action.yml` (Use backup version to avoid GPG fragility)
- [ ] `.github/workflows/codeql.yml` (Configure to run on PRs and push to main)
- [ ] `.github/workflows/check_repository_health.yml` (Clean up for RepoExe)

### 7. Docker Configuration (Severity: 70/100)
*Optimize Docker builder. Remove legacy cloning and `cgct`.*
- [ ] `Dockerfile` (Drop hardcoded termux-packages clones; configure to mount RepoExe code directly. Optimize RUN layers.)
- [ ] Delete `Dockerfile.cgct`.
- [ ] `scripts/run-docker.sh`
- [ ] `scripts/update-docker.sh`
- [ ] `scripts/profile-restricted.apparmor`, `scripts/profile-relaxed.apparmor`, `scripts/profile.json` (Verify container security profiles)
- [ ] `.github/workflows/docker.yml` (From `backup` referencing RepoExe registry)

### 8. Core Build Scripts & Setup Logic (Severity: 80/100)
*Core compilation logic. Enforce parallelization (-j4).*
- [ ] `build-package.sh`
- [ ] `build-all.sh`
- [ ] `clean.sh`
- [ ] `scripts/build/setup/` (Refactor variables, do not remove vital compilation steps)
- [ ] `scripts/build/` general scripts
- [ ] `scripts/check-built-packages.py` (Retain for metadata validation)
- [ ] `scripts/test-runner.sh` (Adapt for RepoExe local package testing)

### 9. GitHub Actions Core Workflows (Severity: 90/100)
*Crucial for the dual-mode compilation and automated update processes.*
- [ ] `.github/workflows/build.yml` (Use `backup` as base for dual PR/Release mode, enforce parallelization limits, implement strict `Restore-Only` caching for PRs)
- [ ] `.github/workflows/package_updates.yml` (Refine the automated update and PR logic from `backup`. Implement exclusions.)
- [ ] `.github/workflows/publish.yml` (Review and integrate metadata GPG signing)

### 10. Final Cleanup (Severity: 0/100)
*Execute only after everything is verified to work.*
- [ ] Delete `backup/` directory (Requires explicit user confirmation).
- [ ] Delete `termux-packages/` directory (Requires explicit user confirmation).
