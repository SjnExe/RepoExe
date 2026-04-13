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

- **CI-First Optimization:** The core codebase (`Dockerfile`, workflows, build scripts) must be **strictly optimized for GitHub Actions**. Any configurations required for local/Agent environments (like `fuse-overlayfs` or background daemons) must remain isolated in `AGENTS.md` and *never* compromise or pollute the CI pipeline's performance.
- **GitHub Runner Specs:** 4 Cores, 16GB RAM. *Note: The environment does NOT support swap or zram. Memory usage must be tightly controlled to prevent OOM errors, while maximizing parallelization.*
- **Custom Docker Image (`docker.yml`):** Built and uploaded to GHCR. Will be adapted from the `backup` directory, focusing on layer optimization.
- **Dual-Mode Build Workflow (`build.yml`):** Replaces Termux's overly complex `packages.yml`. Adapted from `backup`, refined using beneficial features from Termux.
  - **PR Mode:** Compiles the packages as a test in PR workflow runs to ensure they build correctly.
  - **Release Mode:** When merged to `main`, compiles and releases the packages via GitHub Releases.
- **ZRAM Action (`.github/actions/zram`):** Use the streamlined version from `backup` that skips fragile Linux kernel GPG verifications to ensure stable, reliable memory management on GitHub runners.
- **Package Updates (`package_updates.yml`):** Use the version from `backup` that automatically creates PRs using `gh pr create` when upstream package versions change. Needs further refinement for reliability.
- **Security Analysis (`codeql.yml`):** Integrate CodeQL from Termux to run static code analysis on PRs and merges to `main`.
- **Host Cleanup (`free-space.sh`):** Use an extremely fast `rm -rf` approach targeting massive, isolated toolchains (like .NET, Android SDK, and Haskell) on the GitHub Host VM. This instantly frees ~40GB of disk space required for our Docker builder, bypassing the slow `apt purge` mechanisms.
- **Ignored/Removed Workflows:**
  - `golang_validation.yml` and `zig_validation.yml` (RepoExe will not maintain custom-patched compiler standard libraries).
  - `bootstrap_archives.yml` (Specific to Termux app bootstrapping).
  - Termux's complex `packages.yml`.

## Architectural Guidelines

1. **Independent Packages & Maintenance Strategy:** Unlike Termux, which bundles tools into monolithic packages (e.g., `android-tools`), RepoExe will treat packages independently to avoid conflicts and simplify updates.
   - `aapt` is deprecated upstream and will be built once and kept static.
   - Modern tools like `aapt2`, `zipalign`, and `aidl` will be actively maintained, utilizing independent `build.sh` scripts pulling source directly from upstream.
2. **Granular Dependency Splitting:** Do not use monolithic shared library packages. The existing `libandroid-tools-shared` package from the backup must be split into its individual upstream libraries (e.g., `liblog`, `libziparchive`, `libbase`, `libcutils`). These exact names will be used since they currently do not conflict with Termux. If a conflict arises in the future, a `-repoexe` suffix will be applied.
3. **Preserve Core Features (Sub-packages):** While we are shifting to an independent package structure, the build system's core capabilities, including Termux's **sub-package support**, will be fully preserved so they can be utilized if a package naturally generates useful sub-components (like `-static` or `-dev` packages).
4. **Standardize on NDK 29:** Remove all legacy NDK 23c infrastructure. The build system will exclusively use NDK 29. Any package compilation issues will be resolved by patching the package itself to support NDK 29.
5. **Parallelization Enforcement:** Ensure variables like `MAKEFLAGS="-j4"` or `ninja -j4` are globally standardized across the build scripts to fully utilize the 4-core runners without triggering memory exhaustion.
6. **Preserve Cross-Compilation Logic:** Scripts inside `scripts/build/setup/` (e.g., Python, CMake, Rust setups) contain vital cross-compilation engineering. Do *not* strip them out blindly. Instead, refactor them to remove external dependencies on Termux repositories and standardize their path variables.
7. **Reference Retention:** The `backup/` and `termux-packages/` directories MUST be preserved throughout the refactoring process for reference. They will only be deleted at the very end.

## Refactoring Guidelines

1. **Branding Removal:** Strip out "termux" branding wherever possible to make the codebase standard. Do *not* blindly replace "termux" with "RepoExe". Only use the "termux" brand name where the context strictly dictates it (e.g., specific Termux app interactions or terminal references).
2. **Brand Usage:** When appropriate, use the brand as "RepoExe", "repoexe", or "REPOEXE" depending on the context.
3. **Comment Cleanup:** Remove useless or overly verbose comments found in the original Termux repository scripts; keep only necessary comments.
4. **Base Selection Strategy:** Some files should be copied from the `backup` folder and refactored using `termux-packages` as a reference. Others should be copied from `termux-packages` and refactored using `backup` as a reference. The choice depends on which file is closer to the end goal.
5. **Packages Scope:** We will only maintain standard packages. Root packages (`root-packages`) and X11 packages (`x11-packages`) are entirely removed and out of scope.
6. **APT Features:** Utilize all possible APT features suitable for our setup.

## Refactor Checklist

The following is a layout of directories and files to be refactored, sorted generally from easiest (lowest severity) to hardest (highest severity).

### 1. NDK Patches & Versions (Severity: 10/100)
*Standardize on NDK 29 and clear legacy.*
- [ ] `ndk-patches/29/` (Copy from `backup` or `termux-packages` as needed)
- [ ] Delete `ndk-patches/23c/` completely.

### 2. Basic Configuration Files (Severity: 20/100)
*Simple updates to standard repo configs, removing Termux-specific tracking or metadata.*
- [ ] `.gitignore`
- [ ] `.gitattributes`
- [ ] `.editorconfig`
- [ ] `README.md` (Rewrite for RepoExe context)
- [ ] `LICENSE`

### 3. Utility Scripts & Host Cleanup (Severity: 30/100)
*Scripts that need minor standardization. Implement fast rm-rf logic for free-space.*
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

### 5. Package Definitions (Severity: 50/100)
*Adapt packages as fully independent entities. Granularize dependencies.*
- [ ] Split `libandroid-tools-shared` into independent packages (`liblog`, `libziparchive`, `libbase`, `libcutils`).
- [ ] `packages/aapt/` (Build once, deprecate upstream tracking)
- [ ] `packages/aapt2/`, `packages/zipalign/`, `packages/aidl/` (Setup for active upstream tracking)
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
- [ ] `.github/workflows/docker.yml` (From `backup` referencing RepoExe registry)

### 8. Core Build Scripts & Setup Logic (Severity: 80/100)
*Core compilation logic. Enforce parallelization (-j4). Preserve setup scripts but rename paths.*
- [ ] `build-package.sh`
- [ ] `build-all.sh`
- [ ] `clean.sh`
- [ ] `scripts/build/setup/` (Refactor variables, do not remove vital compilation steps)
- [ ] `scripts/build/` general scripts
- [ ] `scripts/buildorder.py`
- [ ] `scripts/check-built-packages.py`

### 9. GitHub Actions Core Workflows (Severity: 90/100)
*Crucial for the dual-mode compilation and automated update processes.*
- [ ] `.github/workflows/build.yml` (Use `backup` as base for dual PR/Release mode, enforce parallelization limits)
- [ ] `.github/workflows/package_updates.yml` (Refine the automated update and PR logic from `backup`)

### 10. Final Cleanup (Severity: 0/100)
*Execute only after everything is verified to work.*
- [ ] Delete `backup/` directory (Requires explicit user confirmation).
- [ ] Delete `termux-packages/` directory (Requires explicit user confirmation).
