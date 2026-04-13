# Refactoring Plan for RepoExe

## Repository Configurations

- **Repository Name:** RepoExe
- **GitHub Repository:** https://github.com/SjnExe/RepoExe
- **GitHub Pages:** https://sjnexe.github.io/RepoExe/ (Used for hosting APT repository metadata)
- **GitHub Releases:** Used to store `.deb` package files.
- **Architectures Supported:** `aarch64`, `arm`, `i686`, `x86_64`, `all`
- **Main Component:** `main` (Default component for stable, public packages)
- **Dev Component:** `dev` (Enabled by installing the `repoexe-dev` package, which adds the component source list. Uninstalling `repoexe-dev` disables the component.)

## Workflows and CI/CD Guidelines

- **Custom Docker Image (`docker.yml`):** Built and uploaded to GHCR. Will be adapted from the `backup` directory.
- **Dual-Mode Build Workflow (`build.yml`):** Replaces Termux's overly complex `packages.yml`. Adapted from `backup`, but refined using beneficial features from Termux.
  - **PR Mode:** Compiles the packages as a test in PR workflow runs to ensure they build correctly.
  - **Release Mode:** When merged to `main`, compiles and releases the packages via GitHub Releases.
- **ZRAM Action (`.github/actions/zram`):** Use the streamlined version from `backup` that skips fragile Linux kernel GPG verifications to ensure stable, reliable memory management on GitHub runners.
- **Package Updates (`package_updates.yml`):** Use the version from `backup` that automatically creates PRs using `gh pr create` when upstream package versions change. Needs further refinement for reliability.
- **Security Analysis (`codeql.yml`):** Integrate CodeQL from Termux to run static code analysis on PRs and merges to `main`.
- **Ignored/Removed Workflows:**
  - `golang_validation.yml` and `zig_validation.yml` (RepoExe will not maintain custom-patched compiler standard libraries).
  - `bootstrap_archives.yml` (Specific to Termux app bootstrapping).
  - Termux's complex `packages.yml`.

## Refactoring Guidelines

1. **Branding Removal:** Strip out "termux" branding wherever possible to make the codebase standard. Do *not* blindly replace "termux" with "RepoExe". Only use the "termux" brand name where the context strictly dictates it (e.g., specific Termux app interactions or terminal references).
2. **Brand Usage:** When appropriate, use the brand as "RepoExe", "repoexe", or "REPOEXE" depending on the context.
3. **Comment Cleanup:** Remove useless or overly verbose comments found in the original Termux repository scripts; keep only necessary comments.
4. **Base Selection Strategy:** Some files should be copied from the `backup` folder and refactored using `termux-packages` as a reference. Others should be copied from `termux-packages` and refactored using `backup` as a reference. The choice depends on which file is closer to the end goal.
5. **Packages Scope:** We will only maintain standard packages. Currently, only the `aapt` package is in focus. Root packages (`root-packages`) and X11 packages (`x11-packages`) are entirely removed and out of scope.
6. **APT Features:** Utilize all possible APT features suitable for our setup.

## Refactor Checklist

The following is a layout of directories and files to be refactored, sorted generally from easiest (lowest severity) to hardest (highest severity).

### 1. NDK Patches (Severity: 10/100)
*Can be largely copied directly with minimal modifications.*
- [ ] `ndk-patches/` (Copy from `backup` or `termux-packages` as needed)

### 2. Basic Configuration Files (Severity: 20/100)
*Simple updates to standard repo configs, removing Termux-specific tracking or metadata.*
- [ ] `.gitignore`
- [ ] `.gitattributes`
- [ ] `.editorconfig`
- [ ] `README.md` (Rewrite for RepoExe context)
- [ ] `LICENSE`

### 3. Utility Scripts (Severity: 30/100)
*Scripts that need some useless comments removed and minor standardization.*
- [ ] `scripts/properties.sh`
- [ ] `scripts/utils/` directory scripts
- [ ] `scripts/get_hash_from_file.py`
- [ ] `scripts/check-versions.sh`
- [ ] `scripts/lint-packages.sh`

### 4. Site and GitHub Pages Metadata (Severity: 40/100)
*Migrate site directory from `backup`, tailor to RepoExe APT repository hosted on GitHub Pages.*
- [ ] `site/` (Index, CSS, JS from `backup`)
- [ ] `scripts/generate-apt-packages-list.sh` (or equivalent aptly scripts)
- [ ] `scripts/aptly_api.sh`

### 5. Package Definitions (Severity: 50/100)
*Adapt the packages keeping RepoExe branding rules in mind. Currently starting with `aapt` and `repoexe-dev`.*
- [ ] `packages/aapt/`
- [ ] `packages/repoexe-dev/` (Ensure this correctly provisions the `dev` component list)

### 6. Action Modules & Security Checks (Severity: 60/100)
*Setup the essential GitHub Actions modules and security checks.*
- [ ] `.github/actions/zram/action.yml` (Use backup version to avoid GPG fragility)
- [ ] `.github/workflows/codeql.yml` (Configure to run on PRs and push to main)
- [ ] `.github/workflows/check_repository_health.yml` (Clean up for RepoExe)

### 7. Docker Configuration (Severity: 70/100)
*Modify Docker setup to be tailored for RepoExe and GHCR.*
- [ ] `Dockerfile` / `Dockerfile.cgct`
- [ ] `scripts/run-docker.sh`
- [ ] `scripts/update-docker.sh`
- [ ] `.github/workflows/docker.yml` (From `backup` referencing RepoExe registry)

### 8. Core Build Scripts (Severity: 80/100)
*Core compilation logic. Needs branding cleanup, unused comment removal, and ensuring standard compilation works.*
- [ ] `build-package.sh`
- [ ] `build-all.sh`
- [ ] `clean.sh`
- [ ] `scripts/build/` directory scripts
- [ ] `scripts/buildorder.py`
- [ ] `scripts/check-built-packages.py`

### 9. GitHub Actions Core Workflows (Severity: 90/100)
*Crucial for the dual-mode compilation and automated update processes.*
- [ ] `.github/workflows/build.yml` (Use `backup` as base for dual PR/Release mode, refine using features from `termux-packages`)
- [ ] `.github/workflows/package_updates.yml` (Refine the automated update and PR logic from `backup`)
