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

**Target Repository Structure:**
```text
RepoExe/
├── .github/
│   ├── workflows/             # CI/CD: build.yml, publish.yml, lint.yml, health.yml, codeql.yml, etc.
│   ├── actions/               # Reusable local actions (e.g., zram action)
│   ├── ISSUE_TEMPLATE/        # Templates for bug reports, package requests
│   ├── pull_request_template.md # Clean, minimal PR template
│   ├── dependabot.yml         # Native GitHub Dependency updates
│   ├── stale.yml              # Auto-close stale issues
│   ├── FUNDING.yml            # Sponsorship links
│   ├── CONTRIBUTING.md        # Contribution guidelines
│   └── SECURITY.md            # Security policy
├── docker/                    # Docker security profiles and configurations
│   ├── profile.json           # Custom Seccomp profile (enables required syscalls)
│   └── profile-relaxed.apparmor # Relaxed AppArmor profile
├── scripts/                   # The strictly micro-modular Python orchestrator
│   ├── build.py               # CLI Entrypoint for building
│   ├── core/                  # Broken down, independent core logic modules
│   │   ├── dag.py             # Dependency graph resolver
│   │   ├── parser.py          # YAML package definition parser
│   │   ├── properties.py      # Core PREFIX boundaries and device layout
│   │   ├── toolchains.py      # NDK environment and compiler setups
│   │   ├── docker.py          # Docker execution wrappers
│   │   ├── debian.py          # dpkg/deb file generation logic
│   │   ├── pacman.py          # pacman/.pkg.tar.xz file generation logic
│   │   ├── health.py          # Repository sync validation
│   │   └── sysroot.py         # Extracts dependencies into $PREFIX for compilation
│   ├── ndk-patches/           # Global NDK 29 patches baked into Docker
│   └── requirements.txt       # Python dependencies
├── packages/                  # YAML package definitions
│   ├── libandroid-tools/      # Contains package.yml and any custom patches
│   └── aapt2/
├── sample/                    # Templates/Examples for different package profiles
│   ├── standard.yml
│   ├── metapackage.yml
│   └── multi-architecture.yml
├── site/                      # GitHub Pages hosting
│   └── install                # Universal curl installation script (auto-detects APT vs Pacman)
├── Dockerfile                 # The multi-stage Ubuntu 24.04 builder image
├── AGENTS.md                  # Directives for AI maintainers
├── README.md                  # Project documentation
├── LICENSE
├── plan.md                    # This architectural blueprint
└── .gitignore, .dockerignore, .editorconfig, .gitattributes, .prettierrc, .prettierignore
```

---

## 2. Architectural Guidelines & AI Friendliness

**Our repository is being built strictly for AI agents (Jules) to maintain.**

1. **Language Migration (Bash to Micro-Modular Python):**
   - The core build logic (currently housed in hundreds of Bash scripts under `scripts/build/`) must be entirely rewritten into a **strictly micro-modular** Python build system.
   - **No Massive Monoliths:** There must be NO single massive script. The orchestrator must be split into logical, focused modules (e.g. `parser.py`, `dag.py`, `debian.py`) to prevent context window overload and maintainability issues for the AI.
   - Python enables superior linting (Ruff/Flake8), type hinting (MyPy), centralized error handling, and logical flow control.
   - Shell commands required for compilation (e.g., `make`, `configure`, `patch`) will be executed safely via Python's `subprocess` or a wrapper library.

2. **Structured Package Definitions (YAML over Bash):**
   - Traditional `build.sh` package definitions are being deprecated.
   - Packages must be defined using structured **YAML** files (e.g., `package.yml`). This format is vastly easier for an AI to parse, update, and validate. *(Note: All YAML files must use the `.yml` extension).*
   - **Pydantic Schema Validation:** The `parser.py` module MUST use **Pydantic** to define strict data models for the `package.yml`. This ensures that field types (e.g. `revision` as integer, `essential` as boolean) are strictly validated before execution, providing precise, AI-friendly error messages if a YAML file is malformed.
   - **Advanced Metadata Schema:** The `parser.py` must support advanced Termux features natively in the YAML schema:
     - `libc`: Multi-libc support (allowing developers to specify `bionic` vs `glibc` environments).
     - `revision`: To trigger APT repository updates when patches change but upstream versions don't.
     - `conffiles`: To mark configuration files so APT does not overwrite user modifications upon upgrade.
     - `essential`: Boolean to prevent users from accidentally uninstalling critical packages.
     - `pre_depends`: Advanced APT directive to force a dependency to fully install *before* the package unpacks.
     - `service_script`: Arrays to automatically inject daemon logic into `/var/service/daemon/run` for `runit`.
     - `alternatives`: Mapping array replacing legacy `.alternatives` text files. The orchestrator (`debian.py` / `pacman.py`) must parse this and automatically generate the necessary `postinst`/`prerm` hook scripts for priority-based command symlinking (e.g. `neovim` claiming the `vi` command).
     - `anti_build_depends`: To explicitly uninstall conflicting dependencies from the Docker builder prior to compilation.
     - `host_build`: Boolean to trigger a native Linux compilation phase *before* cross-compiling the Android target (required for code generators in packages like Python or LLVM).
     - `auto_update`: Boolean to explicitly opt-in to `upstream_check.py` automated PR updates. This strictly defaults to `false` (to protect heavily patched AOSP packages like `aapt2`), and must be explicitly set to `true` inside `package.yml` to enable cron updates.
     - `platform_independent`: Boolean indicating the package contains no compiled binaries (e.g., pure Python scripts or fonts). This sets the `.deb` Architecture to `all` and completely bypasses multi-architecture matrix redundancies.
     - `inherits`: String/List to support YAML "Mixins". This replaces `mixins/build-python.sh`, allowing a package to inherit default dependencies and lifecycle hooks from a master template (e.g., `inherits: python-module`) to drastically reduce boilerplate.
     - `cmake_args` / `meson_args` / `make_args`: Arrays to allow package-specific compiler configurations to be safely injected *through* the orchestrator's generic NDK wrappers.
   - **Multi-Format Packaging (APT & Pacman):** RepoExe provides maximum flexibility to users by natively supporting both APT and Pacman package managers simultaneously.
     - The `package.yml` will support cross-format generic fields (e.g., `groups` and `optdepends` for Pacman, mapped alongside Debian standards).
     - The Python orchestrator will include distinct generator modules: `debian.py` (building `.deb` files) and `pacman.py` (building `.pkg.tar.xz` files, alongside `.db` and `.files` repository databases).
     - **Custom Static Metadata Generation:** To host entirely on GitHub Pages without a backend, the orchestrator must natively implement a custom Python-based APT metadata generator. It must statically build the Debian `Packages`, `Release`, and signed `InRelease` index files directly within `debian.py`, completely avoiding dependency on external bash binaries like `apt-ftparchive` or `termux-apt-repo`.
     - The CI/CD pipelines will deploy the dual repositories directly to GitHub Pages using the native Actions integration (`actions/deploy-pages`), entirely avoiding legacy `gh-pages` branch tracking.
   - **CLI Developer Experience (DX) Tools:** The `build.py` orchestrator entrypoint must feature a robust CLI (e.g., using `argparse` or `click`) with subcommands to replace legacy Termux DX bash scripts:
     - `revbump <pkg> [--dependencies]`: Automatically increments the `revision` integer in a package's YAML. If `--dependencies` is passed, it uses the DAG to cascade the bump to all packages that depend on the target (crucial for core library updates like `openssl`).
     - `update-checksum <pkg>`: Automatically fetches the `source_url` and replaces the `sha256` field in the YAML definition with the new hash.
   - **Universal Install Script & Hosted UI:** The `site/install` script hosted on GitHub Pages will be a universal entrypoint. When a user runs `curl ... | bash`, the script will automatically probe the host system (checking for the presence of `pkg`, `apt`, or `pacman`). If both `pkg` and `apt` are present, `pkg` MUST be preferred as the primary wrapper. It will dynamically install the `repoexe.pub` GPG key into the correct keystores and inject the correct RepoExe repository source list for their active package manager. The existing `site/index.html` frontend UI must be preserved alongside this script.
   - **Strict License Validation:** The `parser.py` module must enforce a strict open-source License allowlist (e.g., `Apache-2.0`, `GPL-3.0`) against the YAML definition, replacing the legacy `lint-packages.sh` script.
   - **Local Source Building:** The orchestrator must support local, bundled source code (e.g., `source: local`). For deprecated or highly modified software (like `aapt`), the source code and pre-applied patches will live directly within the repository structure rather than downloading/patching at runtime.
   - **Sample Folder:** A `sample/` folder must be created containing templates for various package types (standard packages, multi-architecture packages, packages with subpackages, and metapackages using advanced APT features like `Provides`).

3. **Strict Linting & Formatting Stack (AI-Optimized):**
   - **Python:** Use **Ruff** exclusively for both linting and formatting the Python orchestrator. It is extremely fast and replaces multiple legacy tools (flake8, black, isort). Use `mypy` for strict type hinting to catch AI hallucinations early.
   - **YAML, JSON, Markdown:** Use **Prettier** as the standard formatter. The `.prettierrc` must be configured strictly (e.g., trailing commas, consistent quoting) to minimize noisy diffs, ensuring the AI only sees meaningful logic changes.
   - **GitHub Actions:** Use `actionlint` in the CI to validate `.github/workflows/*.yml` syntax before execution.
   - **Shell Snippets:** Use `shellcheck` for any inline bash scripts embedded inside the `package.yml` files.
   - **Self-Healing CI:** The `lint.yml` workflow must auto-execute `ruff format` and `prettier --write`. If it detects unformatted code pushed by a user (or AI), it must automatically commit and push the fix directly to the PR branch, eliminating manual formatting busywork.

4. **Variable Standardization & Branding Removal:**
   - **Generic Variables:** Strip `TERMUX_` branding from variables wherever possible to reduce bloat (e.g., `TERMUX_APP__PACKAGE_NAME` -> `APP_PACKAGE_NAME`, `TERMUX_PKG_*` -> `PKG_*`).
   - **Internal vs. External Paths:** In CI/CD workflows and local build scripts, standard Linux paths should be used. However, **inside the compiled `.deb` package**, standard Termux paths (e.g., `/data/data/com.termux/files/usr`) MUST be preserved perfectly so the package functions flawlessly when installed on the user's device alongside standard Termux apps.
   - Do not blindly replace "termux" with "RepoExe" in text. Use "RepoExe" (or "repoexe", "REPOEXE") for repo naming, but retain "termux" where contextually necessary for device compatibility.

5. **Modularity, Profiles & Subpackages:**
   - **Granular Dependency Splitting:** Bundled packages (like `android-tools`) must be split into specific, independent sub-packages (e.g., `libbase`, `libcutils`, `libutils`, `libziparchive`). These will be grouped under a single source directory for maintenance but output granular `.deb` files.
   - **Explicit Subpackages:** Replace Termux's regex-based automatic subpackage generation (e.g., automatically generating `-dev` or `-static` packages via bash scripts) with **explicit configuration**. The `package.yml` must explicitly declare subpackages and the file patterns they include (e.g., `subpackages: dev: includes: ["include/*", "lib/*.so"]`). Subpackages like `-dev` are shipped in the `main` component.
   - **Package Profiles (Minimal/Headless vs. Full):** Instead of blindly deleting documentation (`man` pages, `info`) like Termux does, RepoExe will split these into distinct `-doc` subpackages. This ensures RepoExe is fully featured while allowing users to execute "headless" or minimal installations (only installing the CLI binary without the doc bloat).

6. **Cross-Compilation & Build Lifecycles:**
   - **Cross-Compilation & Toolchains:** The Python orchestrator will dynamically select the correct NDK toolchain based on the target architecture (`aarch64`, `arm`, `x86_64`, `i686`). It must also explicitly support the **Flang (Fortran)** compiler toolchain for scientific packages, matching Termux's advanced NDK toolchain capabilities. The YAML schema must also support `build_multilib` to compile 32-bit (`arm`/`i686`) packages explicitly for 64-bit target environments.
   - **Automated Debug Symbol Extraction (`-dbg` packages):** Instead of stripping binaries destructively (or bloating them via `no_strip`), the orchestrator must automatically use `llvm-objcopy` during the `make_install` phase to extract debug symbols into distinct `package-name-dbg` subpackages. This keeps primary installations minimal while offering debug tooling (`gdb`/`lldb` support) when needed.
   - **Specialized Language Toolchains & Wrapper Injection:** Beyond C/C++, `toolchains.py` must support dynamic environment bootstrapping for specific languages:
     - **Rust:** Automate `rustup` fetching and inject `CARGO_TARGET_NAME` for Android architectures.
     - **Golang:** Fetch standard `go-linux-amd64` release binaries and configure `$GOROOT` and `$GOCACHE`.
     - **Python (Crossenv):** Implement Termux's advanced `crossenv` patches to force pip wheels to respect Android API targets during cross-compilation.
     - **Config Overrides:** Dynamically inject explicit cross-compilation wrapper scripts (e.g. `llvm-config`, `pg_config`) into the `PATH` during compilation so packages don't accidentally execute the host's Linux configurations.
   - **PREFIX Boundary Injection (`properties.py`):** The orchestrator must globally define the internal device layout (e.g., `PREFIX=/data/data/com.repoexe/files/usr`). The `toolchains.py` module MUST actively inject this `PREFIX` into `CFLAGS`, `CPPFLAGS`, and `LDFLAGS` during the build lifecycle. This ensures compiled C/C++ binaries search for configs and libraries in the Android data directory, rather than breaking by looking in standard Linux paths like `/usr/bin`.
   - **Explicit Sysroot Management:** Prior to compiling a package, the orchestrator (`sysroot.py`) must extract all fetched `.deb`/`.pkg.tar.xz` dependencies into an isolated `$PREFIX` mock directory. This guarantees the cross-compiler has strict, sandboxed access to the exact C/C++ headers and shared libraries required by the dependency graph without polling the live host environment.
   - **Native Build System Integrations:** The Python orchestrator must include native wrappers for standard build systems (CMake, Meson, Autotools, Ninja). This allows `package.yml` files to simply declare `build_system: cmake` without forcing developers (or AI) to manually inject massive NDK cross-compilation shell flags (`-DCMAKE_TOOLCHAIN_FILE`, etc.) into every package.
   - **Full Android Compatibility Patching:** The orchestrator must fully implement all standard Termux mechanisms required to make upstream binaries run on Android devices. This includes dynamically updating `config.guess` and `config.sub` scripts inside package source trees, resolving hardcoded Linux paths (`/bin/sh`, `/usr/bin/env`, `/etc`), and executing `termux-elf-cleaner` on all compiled `.so` and executable files to strip unsupported ELF tags. The orchestrator must provide YAML escape hatches (`no_elf_cleaner`, `no_shebang_fix`, `no_strip`) for edge-case packages that break under these automated mechanisms.
   - **Explicit Massaging:** Replace Termux's massive, implicit `step_massage.sh` with explicit exclude configurations in `package.yml` (e.g., `exclude_files: ["var/log/*"]`). Universal cleanup (like stripping debug symbols) will remain hardcoded, but usable files will never be blindly deleted.
   - **Lifecycle Hook Migration:** Termux relies on ~34 implicit bash function overrides (e.g., `termux_step_pre_configure`, `termux_step_post_massage`). RepoExe will migrate these into structured, declarative lifecycle hooks inside the `package.yml` (e.g., `phases: [host_build, pre_configure, configure, make, install, post_install, test]`). The Python orchestrator will execute the shell snippets defined in these YAML blocks in a strict, predictable order.
   - **Declarative Testing Hooks:** The old `test-runner.sh` script is deprecated. Packages can optionally define a `test` phase inside the YAML lifecycle hooks to run integration assertions post-compilation.

---

## 3. Docker Environment (`docker.yml` & `Dockerfile`)

Docker is the **only officially supported environment** for local building to prevent host pollution. It must be highly modular to ensure layers cache correctly and speed up CI init times.

**Features to Implement:**
1. **Base Image:** Utilize an optimized `Ubuntu 24.04` base (aligning seamlessly with GitHub Actions environments).
2. **Multi-Stage Builds & Modularity:** Use multi-stage builds to keep the final image lean. Avoid junks. Ensure the image is built in a way that maximizes Docker layer caching.
3. **Baked-in NDK Patches & Host Tools:** Apply NDK patches directly within the `Dockerfile` during the `docker build` phase. Baking patches into the image layer is drastically faster than applying them at runtime. Furthermore, the Dockerfile must natively build and include essential Termux host tools (like `termux-elf-cleaner`) within the image.
4. **Non-Root User:** Run all builds under a non-root `builder` user (with passwordless sudo for specific setup tasks) to avoid host permission conflicts.
5. **Security Profiles (Seccomp & AppArmor):** The orchestrator (`docker.py`) must launch the container using the custom `docker/profile.json` (Seccomp) and `profile-relaxed.apparmor` profiles. These are critical to allow system calls (like `personality`, `mount`, `umount2`) required by complex compilers (e.g., Rust, QEMU) which would otherwise crash under default Docker constraints.
6. **Caching Integration:** Replace legacy `ccache` with Mozilla's **`sccache`**. Configure it globally inside the container. `sccache` natively integrates with the GitHub Actions Cache API, preventing the need to manually tar and transfer gigabytes of local cache directories between workflow jobs.
7. **Linting Suite Built-In:** Pre-install modern Python and Shell linters (`ruff`, `mypy`, `shellcheck`, `prettier`) so the container can test itself autonomously.
8. **Debugging Tools:** Include lightweight commands/tools to check layer sizes and disk usage for debugging purposes, allowing us to easily identify and remove bloat.
9. **Performance Optimizations:** Ensure `zram` and `swap` setups are configured appropriately for heavy C++ builds within the container constraints.

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
   - **Strict Release Separation & SLSA Provenance:** The package compilation (`build.yml`) and repository publishing (`publish.yml`) must be strictly separated. The publish step (`needs: build`) will only push to the live repository **if and only if** all shards in the matrix passed successfully. Furthermore, the `publish.yml` step must use GitHub Actions native Sigstore integration to generate cryptographic **SLSA Provenance** for the repository metadata, verifying supply chain security.
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
   - **No Fragile `curl` Scrapes:** Unlike Termux, which scrapes its own GitHub repo via `curl` to find toolchain versions (e.g., host Python), RepoExe will strictly define external toolchain versions in its own configuration files (e.g., `toolchains.yml`) to prevent breaking if upstream Termux pushes an unexpected change.
3. **Repository Health Validation (`health.yml`):**
   - The orchestrator must include a `health.py` module replacing legacy JS/Python scripts (`check-repository-health.js`).
   - It will run on a scheduled cron job to validate the sync between the `packages/` YAML definitions and the live `sjnexe.github.io/RepoExe` repositories (both APT and Pacman formats).
   - It must ensure versions match perfectly, alert if missing `.deb` or `.pkg.tar.xz` artifacts exist, and flag "zombie packages" (e.g., orphaned `-static` subpackages or deleted packages) for automated pruning.
4. **Upstream Version Checking:**
   - The orchestrator must include an `upstream_check.py` module replacing the manual bash script (`check-versions.sh`).
   - It will automate pinging upstream APIs (explicitly scraping GitHub and GitLab release tags) to detect if a newer version of a package is available, streamlining the cron-based auto-update PRs.

---

## 6. Execution & Agent Directives

1. **Continuous Clarification:** The Agent (Jules) MUST proactively ask the user questions and request confirmation whenever making ambiguous refactoring decisions, to ensure zero issues.
2. **Reference Retention:** The `backup/` and `termux-packages/` directories MUST be preserved throughout the refactoring process for reference. They will only be deleted at the very end. If any legacy mechanisms need investigation, the agent can reference them directly.
3. **Strict NDK Versioning:** Standardize all build scripts and patches strictly for **NDK 29**. All legacy NDK 23c infrastructure must be removed. If a new NDK version is released by Google, the orchestrator and `Dockerfile` must be updated to explicitly target the new version.
4. **Scope Limiting:** We will only maintain standard packages. Root packages (`root-packages`) and X11 packages (`x11-packages`) are entirely removed and out of scope.
5. **On-Device Build Deprecation:** Termux's legacy `$TERMUX_ON_DEVICE_BUILD` variables and complex bash workarounds for compiling directly on Android devices are officially deprecated. RepoExe relies strictly on Docker and GitHub Actions. All on-device compilation logic must be stripped from the new Python orchestrator to reduce bloat.
6. **Task Batching & Independent Sessions:** To prevent AI context overload, tasks MUST be batched logically. Independent sections should not affect each other. **Agents must use the `help.md` file to track checklist progress and write session handovers.**
   - **Phase 1 (Environment):** Implement the `Dockerfile` and foundational GitHub Actions (e.g. `dependabot.yml`, `codeql.yml`, `lint.yml`).
   - **Phase 2 (Orchestrator):** Write the core Python orchestrator (e.g., `build.py`, YAML parsers) and define the `package.yml` schema.
   - **Phase 3 (Workflows):** Implement the Dynamic Matrix Sharding CI workflows (`build.yml`, `publish.yml`) that hook into the Python orchestrator.
   - **Phase 4 (Package Migration):** Migrate individual packages from bash to the new YAML schema. Group migrations logically (e.g., migrate all `libandroid-tools` components in one session).
