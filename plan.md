# Refactoring Plan for RepoExe

## 1. Project Context & Goals

**Goal:** To migrate, comprehensively refactor, and modernize the Termux build environment into a highly customized, modular, CI-optimized, and AI-friendly repository called **RepoExe**. The refactoring process will utilize files from the upstream `termux-packages` repository and the previous `backup/` directory.

The ultimate aim is to rip out the convoluted, legacy Bash-based build infrastructure and replace it with a modern, maintainable Python-based orchestrator utilizing structured configuration files (YAML) for package definitions.

**Repository Configurations:**
- **Repository Name:** RepoExe
- **GitHub Repository:** https://github.com/SjnExe/RepoExe
- **GitHub Pages:** https://sjnexe.github.io/RepoExe/ (Hosts APT repository metadata)
- **GitHub Releases:** Stores the compiled `.deb` package files.
- **Architectures Supported:** `aarch64`, `arm`, `i686`, `x86_64`, `all`
- **Main Component:** `main` (Default component for stable, public packages)
- **Dev Component:** `dev` (Enabled by installing the `repoexe-dev` package. Hosted in the `main` branch under a distinct folder structure.)

---

## 2. Architectural Guidelines & AI Friendliness

**Our repository is being built strictly for AI agents (Jules) to maintain.**

1. **Language Migration (Bash to Python):**
   - The core build logic (currently housed in hundreds of Bash scripts under `scripts/build/`) must be entirely rewritten into a modular **Python-based build system**.
   - Python enables superior linting (Ruff/Flake8), type hinting (MyPy), centralized error handling, and logical flow control that AI can easily parse and modify.
   - Shell commands required for compilation (e.g., `make`, `configure`, `patch`) will be executed safely via Python's `subprocess` or a wrapper library.

2. **Structured Package Definitions (YAML over Bash):**
   - Traditional `build.sh` package definitions are being deprecated.
   - Packages must be defined using structured **YAML** files (e.g., `package.yaml`). This format is vastly easier for an AI to parse, update, and validate.
   - YAML files will include: metadata, version, source URL, SHA256 sums, dependencies (using Debian apt standards), and build/install scripts (which can be embedded or linked).

3. **Variable Standardization & Branding Removal:**
   - **Generic Variables:** Strip `TERMUX_` branding from variables wherever possible to reduce bloat (e.g., `TERMUX_APP__PACKAGE_NAME` -> `APP_PACKAGE_NAME`, `TERMUX_PKG_*` -> `PKG_*`).
   - **Internal vs. External Paths:** In CI/CD workflows and local build scripts, standard Linux paths should be used. However, **inside the compiled `.deb` package**, standard Termux paths (e.g., `/data/data/com.termux/files/usr`) MUST be preserved perfectly so the package functions flawlessly when installed on the user's device alongside standard Termux apps.
   - Do not blindly replace "termux" with "RepoExe" in text. Use "RepoExe" (or "repoexe", "REPOEXE") for repo naming, but retain "termux" where contextually necessary for device compatibility.

4. **Modularity & Independent Packages:**
   - Granular Dependency Splitting: Bundled packages (like `android-tools`) must be split into specific, independent sub-packages (e.g., `libbase`, `libcutils`, `libutils`, `libziparchive`). These will be grouped under a single source directory for maintenance but output granular `.deb` files.

---

## 3. Docker Environment (`docker.yml` & `Dockerfile`)

Docker is the **only officially supported environment** for local building to prevent host pollution.

**Features to Implement:**
1. **Base Image:** Utilize an optimized `Ubuntu 24.04` base (aligning seamlessly with GitHub Actions environments).
2. **Multi-Stage Builds:** Keep the final image size manageable while installing massive NDKs and toolchains.
3. **Non-Root User:** Run all builds under a non-root `builder` user (with passwordless sudo for specific setup tasks) to avoid host permission conflicts.
4. **Caching Integration:** Built-in `ccache` integration configured globally to dramatically speed up C/C++ recompilation.
5. **Linting Suite Built-In:** Pre-install modern Python and Shell linters (`ruff`, `mypy`, `shellcheck`, `prettier`) so the container can test itself autonomously.
6. **Performance Optimizations:** Ensure `zram` and `swap` setups are configured appropriately for heavy C++ builds within the container constraints.

---

## 4. CI/CD Workflows (GitHub Actions)

The CI/CD pipeline must be **strictly optimized for GitHub Actions** (4 Cores, 16GB RAM).

1. **Dependency Management (`dependabot.yml`):**
   - Replace any existing `renovate.json` with native GitHub Dependabot.
   - Configure Dependabot to keep GitHub Actions workflows updated using major version tags (e.g., `@v4`) rather than pinned SHAs.
2. **Dual-Mode Build Workflow (`build.yml`):**
   - **PR Mode:** Compiles packages purely as a test. Restores caches to speed up builds but strictly DOES NOT save them, preventing cache pollution.
   - **Release Mode:** Runs on `main` branch pushes. Compiles, saves caches globally, and pushes artifacts to GitHub Releases.
3. **Publish & Signing (`publish.yml`):**
   - Retain the metadata generation and secure GPG signing logic from the `backup` directory's `metadata.py`.
4. **Package Updates (`package_updates.yml`):**
   - Auto-update logic must be disabled by default and explicitly enabled per package via the new YAML definitions. Updates trigger auto-PRs via `gh pr create`.
5. **Host Space Optimization (`free-space.sh`):**
   - Integrate hyper-fast `rm -rf` logic for massive unused toolchains on the GitHub Host VM before build steps to free up disk space.
6. **Parallelization Enforcement:** Globally standardize `MAKEFLAGS="-j4"` / `ninja -j4` across the build system to maximize the 4-core runners.
7. **Security Analysis (`codeql.yml`):** Integrate CodeQL for static analysis.

---

## 5. Advanced APT Feature Support

RepoExe will leverage the full capabilities of Debian's APT package manager to ensure fast, intelligent dependency resolution.

1. **Strict Dependency Fields:**
   - **Depends:** Absolutely required dependencies for the package to function.
   - **Recommends:** Packages that would be found together with this one in all but unusual installations (installed by default but can be skipped).
   - **Suggests:** Optional enhancements.
   - **Breaks / Replaces:** Vital for seamless upgrades when we split legacy monolithic packages into granular sub-packages.
2. **Validation Enforcement:**
   - The new Python build orchestrator MUST validate these fields in the `package.yaml` before building the `.deb` to ensure strict compliance with Debian standards.

---

## 6. Execution & Agent Directives

1. **Continuous Clarification:** The Agent (Jules) MUST proactively ask the user questions and request confirmation whenever making ambiguous refactoring decisions, to ensure zero issues.
2. **Reference Retention:** The `backup/` and `termux-packages/` directories MUST be preserved throughout the refactoring process for reference. They will only be deleted at the very end.
3. **Standardize NDK:** Standardize all build scripts and patches for NDK 29. Remove legacy NDK 23c infrastructure.
4. **Scope Limiting:** We will only maintain standard packages. Root packages (`root-packages`) and X11 packages (`x11-packages`) are entirely removed and out of scope.
