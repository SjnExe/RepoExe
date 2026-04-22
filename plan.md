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
   - **Sample Folder:** A `sample/` folder must be created containing templates for various package types (standard packages, multi-architecture packages, packages with subpackages, and metapackages using advanced APT features like `Provides`).

3. **Variable Standardization & Branding Removal:**
   - **Generic Variables:** Strip `TERMUX_` branding from variables wherever possible to reduce bloat (e.g., `TERMUX_APP__PACKAGE_NAME` -> `APP_PACKAGE_NAME`, `TERMUX_PKG_*` -> `PKG_*`).
   - **Internal vs. External Paths:** In CI/CD workflows and local build scripts, standard Linux paths should be used. However, **inside the compiled `.deb` package**, standard Termux paths (e.g., `/data/data/com.termux/files/usr`) MUST be preserved perfectly so the package functions flawlessly when installed on the user's device alongside standard Termux apps.
   - Do not blindly replace "termux" with "RepoExe" in text. Use "RepoExe" (or "repoexe", "REPOEXE") for repo naming, but retain "termux" where contextually necessary for device compatibility.

4. **Modularity, Profiles & Subpackages:**
   - **Granular Dependency Splitting:** Bundled packages (like `android-tools`) must be split into specific, independent sub-packages (e.g., `libbase`, `libcutils`, `libutils`, `libziparchive`). These will be grouped under a single source directory for maintenance but output granular `.deb` files.
   - **Explicit Subpackages:** Replace Termux's regex-based automatic subpackage generation (e.g., automatically generating `-dev` or `-static` packages via bash scripts) with **explicit configuration**. The `package.yaml` must explicitly declare subpackages and the file patterns they include (e.g., `subpackages: dev: includes: ["include/*", "lib/*.so"]`). Subpackages like `-dev` are shipped in the `main` component.
   - **Package Profiles (Minimal/Headless vs. Full):** Instead of blindly deleting documentation (`man` pages, `info`) like Termux does, RepoExe will split these into distinct `-doc` subpackages. This ensures RepoExe is fully featured while allowing users to execute "headless" or minimal installations (only installing the CLI binary without the doc bloat).

5. **Cross-Compilation & Build Lifecycles:**
   - **Cross-Compilation:** The Python orchestrator will dynamically select the correct NDK toolchain based on the target architecture (`aarch64`, `arm`, `x86_64`, `i686`).
   - **Explicit Massaging:** Replace Termux's massive, implicit `step_massage.sh` with explicit exclude configurations in `package.yaml` (e.g., `exclude_files: ["var/log/*"]`). Universal cleanup (like stripping debug symbols) will remain hardcoded, but usable files will never be blindly deleted.
   - **Lifecycle Hook Migration:** Termux relies on ~34 implicit bash function overrides (e.g., `termux_step_pre_configure`, `termux_step_post_massage`). RepoExe will migrate these into structured, declarative lifecycle hooks inside the `package.yaml` (e.g., `phases: [pre_configure, configure, make, install, post_install]`). The Python orchestrator will execute the shell snippets defined in these YAML blocks in a strict, predictable order.

---

## 3. Docker Environment (`docker.yml` & `Dockerfile`)

Docker is the **only officially supported environment** for local building to prevent host pollution. It must be highly modular to ensure layers cache correctly and speed up CI init times.

**Features to Implement:**
1. **Base Image:** Utilize an optimized `Ubuntu 24.04` base (aligning seamlessly with GitHub Actions environments).
2. **Multi-Stage Builds & Modularity:** Use multi-stage builds to keep the final image lean. Avoid junks. Ensure the image is built in a way that maximizes Docker layer caching.
3. **Baked-in NDK Patches:** Apply NDK patches directly within the `Dockerfile` during the `docker build` phase. Baking patches into the image layer is drastically faster than applying them at runtime during CI initialization, and allows Docker to perfectly cache the patched toolchain.
4. **Non-Root User:** Run all builds under a non-root `builder` user (with passwordless sudo for specific setup tasks) to avoid host permission conflicts.
5. **Caching Integration:** Built-in `ccache` integration configured globally to dramatically speed up C/C++ recompilation.
6. **Linting Suite Built-In:** Pre-install modern Python and Shell linters (`ruff`, `mypy`, `shellcheck`, `prettier`) so the container can test itself autonomously.
7. **Debugging Tools:** Include lightweight commands/tools to check layer sizes and disk usage for debugging purposes, allowing us to easily identify and remove bloat.
8. **Performance Optimizations:** Ensure `zram` and `swap` setups are configured appropriately for heavy C++ builds within the container constraints.

---

## 4. CI/CD Workflows (GitHub Actions)

The CI/CD pipeline must be **strictly optimized for GitHub Actions** (4 Cores, 16GB RAM) and aggressively leverage parallelization to minimize workflow runtime.

1. **Dependency Management (`dependabot.yml`):**
   - Replace any existing `renovate.json` with native GitHub Dependabot.
   - Configure Dependabot to keep GitHub Actions workflows updated using major version tags (e.g., `@v4`) rather than pinned SHAs.
2. **Advanced CI Parallelization (Dynamic Matrix Sharding):**
   - Instead of looping through all packages on a single runner (which hits the 6-hour timeout) or using primitive sequential chaining, RepoExe will use a `prepare` job to analyze the Python dependency tree.
   - The `prepare` script will group independent packages into "Shards".
   - The `build` job will use a **Dynamic Matrix** (`[architectures] × [shards]`). This allows spawning dozens of concurrent runners instantly (e.g., 4 architectures × 10 shards = 40 parallel jobs) to build packages as fast as possible.
   - **Massive Packages:** Massive packages (like Chromium or heavy Rust binaries) that require intense resources will be assigned to their **own isolated shard** to give them a dedicated 16GB runner. The `prepare` script's dependency DAG (Directed Acyclic Graph) will guarantee that all prerequisites for these massive packages are built in earlier shards before the isolated shard is executed.
   - **State Tarball Deprecation:** The legacy Termux/TUR workaround of pausing builds, zstd-tarballing the entire `~/.termux-build` directory, and resuming the build on a new runner is officially deprecated. The isolated DAG Sharding strategy completely replaces the need for transferring gigabytes of raw build state between runners.
3. **Dual-Mode Workflow with Strict Release Boundaries (`build.yml` & `publish.yml`):**
   - **Manual Dispatch Features:**
     - **Test Mode:** Manual dispatches can include a `test_only` flag. When enabled, the workflow builds packages but strictly skips publishing to the repository.
     - **Package Exclusion Syntax:** The workflow package input must support a negative exclusion syntax like `!{package_name}`. This allows building "everything except X". The `prepare` script MUST enforce strict validation: if the syntax is malformed, or if a user attempts to exclude a package that is a strict dependency of another package being built, the workflow must abort immediately before spawning runners.
   - **PR Mode:** Compiles packages purely as a test. Restores caches to speed up builds but strictly DOES NOT save them, preventing cache pollution.
   - **Strict Release Separation:** The package compilation (`build.yml`) and APT repository publishing (`publish.yml`) must be strictly separated. The publish step (`needs: build`) will only download the `.deb` artifacts and push to the live repository **if and only if** all architectures and shards in the matrix passed successfully. This completely prevents a partially-built matrix from breaking the live repository.
4. **Package Updates (`package_updates.yml`):**
   - Auto-update logic must be disabled by default and explicitly enabled per package via the new YAML definitions. Updates trigger auto-PRs via `gh pr create`.
5. **Host Space Optimization (`free-space.sh`):**
   - Integrate hyper-fast `rm -rf` logic for massive unused toolchains on the GitHub Host VM before build steps to free up disk space.
6. **Parallelization Enforcement:** Globally standardize `MAKEFLAGS="-j4"` / `ninja -j4` across the build system to maximize the 4-core runners.
7. **Security Analysis (`codeql.yml`):** Integrate CodeQL for static analysis.

---

## 5. Dependency Management & Advanced APT Features

RepoExe will leverage the full capabilities of Debian's APT package manager to ensure fast, intelligent dependency resolution, while securely managing cross-repository dependencies.

1. **Strict Dependency Fields:**
   - **Depends:** Absolutely required dependencies.
   - **Recommends:** Installed by default but can be opted-out.
   - **Suggests:** Optional enhancements.
   - **Provides & OR Dependencies:** Utilize logical OR dependencies to prevent bloat. For example, if a package requires Java 17+, it should declare `Depends: openjdk-17 | java-runtime-headless`. If a user already has Java 21 installed, APT will correctly satisfy the dependency without pulling down Java 17 unnecessarily.
   - **Breaks / Replaces:** Vital for seamless upgrades when we split legacy monolithic packages into granular sub-packages.
2. **Hybrid Dependency Resolution Strategy:**
   - **Local Resolution First:** The build system must prioritize downloading compiled `.deb` dependencies directly from the active RepoExe repository if they are built and up to date.
   - **Upstream Fallback:** For dependencies that are out of scope or not yet built in RepoExe, the build system MUST cleanly fallback and download them directly from the official Termux upstream repository via standard APT sources configured inside the Docker container.
   - **No Fragile `curl` Scrapes:** Unlike Termux, which scrapes its own GitHub repo via `curl` to find toolchain versions (e.g., host Python), RepoExe will strictly define external toolchain versions in its own configuration files (e.g., `toolchains.yaml`) to prevent breaking if upstream Termux pushes an unexpected change.

---

## 6. Execution & Agent Directives

1. **Continuous Clarification:** The Agent (Jules) MUST proactively ask the user questions and request confirmation whenever making ambiguous refactoring decisions, to ensure zero issues.
2. **Reference Retention:** The `backup/` and `termux-packages/` directories MUST be preserved throughout the refactoring process for reference. They will only be deleted at the very end. If any legacy mechanisms need investigation, the agent can reference them directly.
3. **Strict NDK Versioning:** Standardize all build scripts and patches strictly for **NDK 29**. All legacy NDK 23c infrastructure must be removed. If a new NDK version is released by Google, the orchestrator and `Dockerfile` must be updated to explicitly target the new version.
4. **Scope Limiting:** We will only maintain standard packages. Root packages (`root-packages`) and X11 packages (`x11-packages`) are entirely removed and out of scope.
5. **Task Batching & Independent Sessions:** To prevent AI context overload, tasks MUST be batched logically. Independent sections should not affect each other.
   - **Phase 1 (Environment):** Implement the `Dockerfile` and foundational GitHub Actions (e.g. `dependabot.yml`, `codeql.yml`, `lint.yml`).
   - **Phase 2 (Orchestrator):** Write the core Python orchestrator (e.g., `build.py`, YAML parsers) and define the `package.yaml` schema.
   - **Phase 3 (Workflows):** Implement the Dynamic Matrix Sharding CI workflows (`build.yml`, `publish.yml`) that hook into the Python orchestrator.
   - **Phase 4 (Package Migration):** Migrate individual packages from bash to the new YAML schema. Group migrations logically (e.g., migrate all `libandroid-tools` components in one session).
