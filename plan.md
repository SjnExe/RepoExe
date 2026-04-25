### **Validation & Future Handover:** Before beginning Phase 1, the next AI agent session MUST perform a comprehensive audit of this `plan.md` blueprint. The agent must:

- Check the blueprint for any AI hallucinations or logical inconsistencies (e.g., conflicting dependency resolution strategies).
- Review any unexplored files in the `termux-packages` or `backup` directories to discover if any other obscure features or improvements should be integrated into this plan.
- Propose any final DevOps modernization strategies before committing to the implementation phase.

# Refactoring Plan for RepoExe

## 1. Project Context & Goals

**Goal:** To migrate, comprehensively refactor, and modernize the Termux build environment into a highly customized, modular, CI-optimized, and AI-friendly repository called **RepoExe**. The refactoring process will utilize files from the upstream `termux-packages` repository and the previous `backup/` directory.

The ultimate aim is to rip out the convoluted, legacy Bash-based build infrastructure and replace it with a modern, maintainable Python-based orchestrator utilizing structured configuration files (YAML) for package definitions.

**Repository Configurations:**

- **Repository Name:** RepoExe
- **GitHub Repository:** https://github.com/SjnExe/RepoExe
- **GitHub Pages:** https://sjnexe.github.io/RepoExe/ (Hosts APT repository metadata)
- **GitHub Releases:** Stores the compiled `.deb`, `.pkg.tar.zst`, and `.apk` package files. **Architecture:** Every source package (e.g., `libandroid-tools`) gets exactly _one_ GitHub Release tag. All compiled architectures, formats, and auto-generated subpackages for every version are uploaded to this single tag.
- **Architectures Supported:** `aarch64`, `arm`, `i686`, `x86_64`, `riscv64`, `wasm32-wasi`, `all`
- **Package Formats Supported:** `APT` (.deb), `Pacman` (.pkg.tar.zst), `Alpine` (.apk)
- **Main Component:** `main` (Default component for stable, public packages)
- **Dev Component:** `dev` (Acts as a staging/canary component. Enabled by installing the `repoexe-dev` package. Hosted in the `main` branch under a distinct folder structure.)

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
│   │   ├── apk.py             # Alpine/.apk file generation logic
│   │   ├── health.py          # Repository sync validation
│   │   └── sysroot.py         # Extracts dependencies into $PREFIX for compilation
│   ├── ndk-patches/           # Global NDK 29 patches baked into Docker
│   ├── pyproject.toml         # Python dependencies (managed by uv)
│   └── uv.lock                # Deterministic dependency lockfile
├── packages/                  # YAML package definitions
│   ├── libandroid-tools/      # Contains build.yml and any custom patches
│   └── aapt2/
├── docs/                      # Documentation and sample templates
│   ├── SCHEMA.md              # Comprehensive YAML schema documentation
│   ├── standard/build.yml     # Sample templates
│   ├── metapackage/build.yml
│   └── multi-architecture/build.yml
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

   - **AI-First Developer Experience (DevEx):**
     - **`--ai-mode` JSON Outputs:** The orchestrator (`build.py`) and linters must support an `--ai-mode` flag. When enabled, all terminal output (errors, stack traces, DAG structures) must be strictly formatted as JSON. This eliminates the need for AI agents to parse human-readable terminal colors and unstructured text.
     - **Dockerized AI Workspace:** Instead of running local setup scripts, AI agents will use the Docker builder environment directly for development. The container will come pre-installed with `uv`, linters, and all necessary tools, providing an instant, deterministic workspace.
     - **Local API Mocking:** The orchestrator must include local mock servers for `upstream_check.py` to allow AI agents to rapidly test auto-update logic without hitting real GitHub/GitLab API rate limits during development cycles.

2. **Structured Package Definitions (YAML over Bash):**
   - Traditional `build.sh` package definitions are being deprecated.
   - Packages must be defined using structured **YAML** files named `build.yml` (e.g., `packages/rust/build.yml`). This format is vastly easier for an AI to parse, update, and validate. _(Note: All YAML files must use the standard `build.yml` nomenclature)._
   - **Pydantic Schema Validation:** The `parser.py` module MUST use **Pydantic** to define strict data models for the `build.yml`. This ensures that field types (e.g. `revision` as integer, `essential` as boolean) are strictly validated before execution, providing precise, AI-friendly error messages if a YAML file is malformed. Furthermore, Pydantic validators must enforce URL standardization (e.g. ensuring GitHub `source_url` paths use standard release archives), porting logic from the deprecated `lint-packages.sh`.
   - **Strict Version Continuity:** `parser.py` must replicate Termux's strict version validation. When a developer modifies a `build.yml` in a PR, the parser must actively query the Git history (`git show origin/main...`) to evaluate the previous YAML state and verify that either the `version` or `revision` field was strictly incremented. If the version is not bumped, the parser must instantly fail the build.
   - **Version Normalization & Dialect Translation:** The `version` field in `build.yml` must strictly reflect the true upstream version (e.g., `16.0.0-r4`) and **MUST NOT** contain a `v` prefix. If an upstream tarball requires a `v` prefix, developers must use string interpolation in the `source_url` (e.g., `v${version}`). To ensure cross-compatibility without breaking package manager sorting algorithms, `parser.py` will automatically translate upstream revisions (like `-r4`) into PM-specific "dialects" before packaging: `+r4` for Debian (`16.0.0+r4-2`), `.r4` for Pacman (`16.0.0.r4-2`), and `_p4` for Alpine (`16.0.0_p4-r2`).
   - **Advanced Metadata Schema:** The `parser.py` must support advanced Termux features natively in the YAML schema. The schema format should be standardized, clean, and typed via Pydantic:
     - **Core & Compatibility:**
       - `libc` _(string)_: `bionic` (default) vs `glibc`. Requires parallel dependency trees for `glibc`.
       - `excluded_arches` _(list[str])_: Arches to skip building (e.g., `['i686', 'x86_64']`).
       - `platform_independent` _(bool)_: Bypasses multi-arch matrix, sets `.deb` to `all` architecture.
       - `essential` _(bool)_: Prevents users from uninstalling critical packages.
     - **Versioning & Updates:**
       - `revision` _(int)_: Bumps APT repository versions without upstream version changes.
       - `auto_update` _(bool)_: Opt-in to `upstream_check.py` (defaults to `false`).
       - `bypass_dev` _(bool)_: Bypasses the 3-day `dev` component staging area, deploying updates instantly to `main` (defaults to `false`).
       - **Native "Nightly" (Git Master) Support:** While static `source_url` tarballs are standard, `parser.py` natively supports building from live upstream repositories. Developers can specify `source: git` and `git_branch: main` (or any target branch) instead of a tarball. During the build, the orchestrator will pull the latest commit and automatically generate a dynamic, rolling version string (e.g., `20241025.1a2b3c4-1`) for the packaging metadata.
     - **Build Environment & Execution:**
       - `build_in_src` _(bool)_: Forces CMake/Meson/Autotools to execute inside the source tree.
       - `host_build` _(bool)_: Triggers native Linux compilation before cross-compilation.
       - `isolated_shard` _(bool)_: Routes massive packages to dedicated, high-resource CI runners.
       - `inherits` _(str | list[str])_: Advanced YAML Mixins to inject lifecycle blocks (e.g., `python-module`).
       - `cmake_args` / `meson_args` / `make_args` _(list[str])_: Injects package-specific compiler flags.
       - `anti_build_depends` _(list[str])_: Uninstalls conflicting dependencies from the Docker builder.
     - **Optimizations:**
       - `optimize` _(str)_: `size` (default `-Oz`), `speed` (`-O3`), or `none` (`-O0`).
       - `lto` _(bool)_ / `pgo` _(bool)_: Enable Link-Time or Profile-Guided Optimization (both default `false`).
     - **Packaging Output & Modifiers:**
       - `pre_depends` _(list[str])_: APT directive to force dependency installation before unpacking.
       - `conffiles` _(list[str])_: Marks config files to prevent APT from overwriting user modifications.
       - `recommends_doc` / `recommends_locale` _(bool)_: Disables automatic generation of `-doc`/`-locale` subpackages.
       - `no_staticsplit` _(bool)_: Disables automatic splitting of static `.a` libraries.
       - `no_shebang_fix` _(bool)_ / `no_shebang_fix_files` _(list[str])_: Controls automated `/bin/sh` replacements.
       - `service_script` _(list[str])_: Automatically injects daemon logic for `runit`.
       - `alternatives` _(dict[str, str])_: Generates priority-based command symlinking (e.g., `vi` to `neovim`).
   - **Multi-Format Packaging (APT, Pacman & Alpine):** RepoExe provides maximum flexibility to users by natively supporting APT, Pacman, and Alpine package managers simultaneously.
     - The `build.yml` will support cross-format generic fields (e.g., `groups` and `optdepends` for Pacman/Alpine, mapped alongside Debian standards).
     - The Python orchestrator will include distinct generator modules: `debian.py` (building `.deb` files), `pacman.py` (building `.pkg.tar.zst` files alongside `.db` databases), and `apk.py` (building `.apk` files alongside `APKINDEX.tar.gz` indexes).
     - **Deterministic `DESTDIR` Packaging:** Termux's legacy "timestamp hack" (installing directly into the live `$PREFIX` and tar-diffing files newer than a timestamp) is explicitly deprecated. The orchestrator must enforce the modern **`DESTDIR`** pattern, forcing native build wrappers (`make_install`) to strictly install artifacts into an isolated staging directory, eliminating race conditions and host contamination.
     - **Custom Static Metadata Generation & `aptly` Deprecation:** To host entirely on GitHub Pages without a backend database, the orchestrator must natively implement a custom Python-based APT metadata generator. It must statically build the Debian `Packages`, `Release`, and signed `InRelease` index files directly within `debian.py`. This completely replaces the legacy `aptly_api.sh` and bash binaries like `apt-ftparchive`.
     - **Dynamic LIBC Suffixing:** When a package is defined with `libc: glibc` in its YAML, the packagers (`debian.py` / `pacman.py`) must dynamically append the `-glibc` suffix to the compiled output package name and automatically rewrite the dependencies to expect the `-glibc` variants of their required libraries. This replicates the advanced logic previously hidden in `backup/scripts/utils/repoexe/package/package.sh`.
     - **Dual-Key Signing Architecture:** The orchestrator must natively support a strict dual-key approach for artifact signing:
       - **GPG (OpenPGP):** Used strictly for signing APT (`Release`/`InRelease`) and Pacman (`.db`) metadata. (Key already generated; `GPG_PRIVATE_KEY` configured in GitHub Secrets).
       - **Plain RSA:** Used strictly for Alpine Linux package signing. Alpine requires appending an RSA signature to `.apk` files and signing the `APKINDEX.tar.gz` with an `.rsa.pub` key. (Key already generated; `ALPINE_PRIVATE_KEY` configured in GitHub Secrets).
     - **ZSTD Standardisation:** Both the Debian (`.deb`) and Pacman (`.pkg.tar.zst`) package generation steps must standardise on **`zstd`** compression. This replaces the legacy `xz` defaults to dramatically speed up artifact generation and extraction on GitHub Action runners.
     - The CI/CD pipelines will deploy the dual repositories directly to GitHub Pages using the native Actions integration (`actions/deploy-pages`), entirely avoiding legacy `gh-pages` branch tracking.
     - **Automated SBOM Generation:** The orchestrator must natively generate Software Bill of Materials (SBOM) JSON files (using standard SPDX or CycloneDX formats) alongside every compiled package. This allows GitHub's native security features to automatically audit the repository for supply chain vulnerabilities.

- **Smart Rebuilds & Content-Addressable Hashing:** The orchestrator must aggressively leverage caching to skip unnecessary builds. To achieve this, it must compute a holistic SHA256 "state hash" for every package based on its inputs: the source URL SHA256, applied patches, the `build.yml` file itself, and the state hashes of all its dependencies. If the computed state hash matches the compiled artifact available in the repository, the build is instantly skipped. Changing any dependency upstream must implicitly alter this state hash, forcing a correct rebuild downstream without manual intervention.
- **Automated Revision Management:** While developers can still bump the `revision` manually, the orchestrator should automatically handle revision bumps for downstream packages when a core dependency is updated and triggers a rebuild, ensuring APT users correctly pull the newly compiled binaries.
- **Antidependencies Execution:** The matrix sharding and execution logic within `dag.py` must natively support `anti_build_depends` (replacing `PKG_ANTI_BUILD_DEPENDS`). Before executing a build in the hermetic sandbox, the runner must strictly uninstall any packages listed in the antidependencies array to prevent compilation collisions, ensuring clean build environments.
- **CLI Developer Experience (DX) Tools:** The `build.py` orchestrator entrypoint must feature a robust CLI (e.g., using `argparse` or `click`) with subcommands to replace legacy Termux DX bash scripts:
  - `revbump <pkg> [--dependencies]`: Automatically increments the `revision` integer in a package's YAML. If `--dependencies` is passed, it uses the DAG to cascade the bump to all packages that depend on the target (crucial for core library updates like `openssl`).
  - `update-checksum <pkg>`: Automatically fetches the `source_url` and replaces the `sha256` field in the YAML definition with the new hash. It must also optionally attempt to fetch and verify GPG signatures of source tarballs using integrated upstream keys.
  - `info <pkg>` / `list`: Subcommands to quickly query package metadata, replacing legacy bash utilities like `list-packages.sh` and `generate-apt-packages-list.sh`.
  - `clean`: Subcommand to clean up the Docker environment, removing dangling images, containers, and cached artifacts, replacing the legacy `clean.sh`.
  - `build <pkg> [--dry-run]`: The core build command must support a `--dry-run` flag. This flag uses `parser.py` and `dag.py` to evaluate exclusions (`excluded_arches`) and package state hashes to quickly determine if a build is necessary, returning a success code without actually invoking the Docker environment. This replaces `build-package-dry-run-simulation.sh` and is crucial for CI optimization.
  - `init <pkg>`: Subcommand to launch an interactive scaffolding wizard. It will ask developers questions about the new package (e.g., language, PREFIX requirements) and instantly generate a standardized, lint-free `build.yml` template.
  - `tui`: An advanced local development command utilizing libraries like `Textual` or `Rich`. It launches a live Terminal User Interface displaying a visual DAG, dynamic progress bars for parallel package builds, and scrollable compilation logs in isolated panes, drastically improving the human Developer Experience without breaking the `--ai-mode` JSON handlers.
- **AI-Optimized Crash Reporting:** To drastically improve the ability for AI agents to debug failing builds without grepping through gigabytes of raw logs, the orchestrator MUST implement a crash handler. If a compilation fails, the orchestrator will intercept the failure and dump a condensed, AI-readable `crash_report.json` file. This file will contain the exact environment variables, the final 50 lines of the compiler `stderr`, and a snapshot of the container's disk space and memory usage at the time of failure.
- **Universal Install Script & Hosted UI:** The `site/install` script hosted on GitHub Pages will be a universal entrypoint. When a user runs `curl ... | bash`, the script will automatically probe the host system (checking for the presence of `pkg`, `apt`, `pacman`, or `apk`). The script logic must be highly robust, properly resolving the primary package manager. If both `pkg` and `apt` are present, `pkg` MUST be preferred as the primary wrapper. It will securely download the required keys (e.g., `repoexe.gpg` into `/etc/apt/trusted.gpg.d/` or the equivalent paths for pacman/apk) and inject the RepoExe repository source list using strict repository-level signature validation, explicitly removing legacy insecure `[trusted=yes]` flags. The `repoexe-dev` package will remain the standard method for users to subsequently opt-in to the `dev` repository component. The existing `site/index.html` frontend UI must be preserved alongside this script.
- **Strict License Validation:** The `parser.py` module must use Pydantic to enforce a strict open-source License allowlist (e.g., `Apache-2.0`, `GPL-3.0`, `MIT`, `ISC`) against the YAML definition, entirely replacing the legacy `lint-packages.sh` bash regex logic. If an unknown license is provided, the YAML parsing must instantly fail the build.
- **GPG Signature Verification for Sources:** The system must incorporate a strict mechanism to verify downloaded source tarballs against trusted upstream GPG keys (e.g., `linux-kernel-signing-keys.gpg`, `llvm-snapshot.gpg.key`). This drastically improves supply chain security beyond simple SHA256 verification.
- **Upstream Source Mirroring (Anti-Link Rot):** The orchestrator must automatically mirror all fetched upstream source tarballs to a dedicated GitHub Releases repository. If an upstream author deletes a release or their server goes down, the build system automatically falls back to our immutable mirror. This guarantees that older `build.yml` revisions can always be rebuilt reproducibly, preventing supply chain disruptions due to missing sources.
- **Local Source Building:** The orchestrator must support local, bundled source code (e.g., `source: local`). For deprecated or highly modified software (like `aapt`), the source code and pre-applied patches will live directly within the repository structure rather than downloading/patching at runtime.
- **Documentation & Sample Folder:** A `docs/` folder must be created at the very end of the refactoring process. It will contain explicit, well-commented sample `build.yml` templates for various package types (standard, multi-architecture, subpackages, metapackages). Crucially, this folder MUST also contain a comprehensive `SCHEMA.md` documentation file that details every single supported YAML field, macro, and lifecycle hook so future developers (and AI agents) have zero confusion when using advanced features.

3. **Strict Linting & Formatting Stack (AI-Optimized):**

   - **Python:** Use **uv** as the primary Python package manager for its extreme speed and deterministic lockfiles (`uv.lock`). Use **Ruff** exclusively for both linting and formatting the Python orchestrator. It is extremely fast and replaces multiple legacy tools (flake8, black, isort). Use `mypy` for strict type hinting to catch AI hallucinations early.
   - **YAML, JSON, Markdown:** Use **Prettier** as the standard formatter. The `.prettierrc` must be configured strictly (e.g., trailing commas, consistent quoting) to minimize noisy diffs, ensuring the AI only sees meaningful logic changes.
   - **GitHub Actions:** Use `actionlint` in the CI to validate `.github/workflows/*.yml` syntax before execution.
   - **Shell Snippets:** Use `shellcheck` for any inline bash scripts embedded inside the `build.yml` files.
   - **Self-Healing CI:** The `lint.yml` workflow must auto-execute `ruff format` and `prettier --write`. If it detects unformatted code pushed by a user (or AI), it must automatically commit and push the fix directly to the PR branch, eliminating manual formatting busywork.
   - **Local Pre-commit Hooks:** The repository must include a `.pre-commit-config.yaml` to enforce that all `ruff`, `prettier`, and `shellcheck` validations run locally before a developer can commit, preventing noisy automated formatting commits in PRs.
   - **Orchestrator Unit Testing (`pytest`):** A comprehensive `pytest` test suite (`scripts/tests/`) must be written for the Python build system itself to prevent regressions, with a dedicated `python-tests.yml` CI workflow. It must enforce code coverage tracking via `pytest-cov`, rendering coverage reports directly into GitHub Actions Step Summaries.
   - **DevContainers & IDE Integrations:** The repository must include a `.devcontainer/devcontainer.json` for web-based IDEs and a `.vscode/settings.json` that hooks into a Pydantic-exported JSON Schema for `build.yml` to provide real-time YAML Intellisense.

4. **Variable Standardization & Branding Removal:**

   - **Generic Variables:** Strip `TERMUX_` branding from variables wherever possible to reduce bloat (e.g., `TERMUX_APP__PACKAGE_NAME` -> `APP_PACKAGE_NAME`, `TERMUX_PKG_*` -> `PKG_*`).
   - **Strict Device Path Compatibility:** While the repository is branded "RepoExe", the internal device paths MUST remain strictly **`PREFIX=/data/data/com.termux/files/usr`**. Do NOT replace this internal path with `com.repoexe`. Preserving the original Termux PREFIX guarantees that compiled binaries function flawlessly and integrate perfectly when installed on the user's live Termux application.

5. **Modularity, Profiles & Subpackages:**

   - **Granular Dependency Splitting:** Bundled packages (like `android-tools`) must be split into specific, independent sub-packages (e.g., `libbase`, `libcutils`, `libutils`, `libziparchive`). These will be grouped under a single source directory for maintenance but output granular `.deb` files.
   - **Explicit Subpackages:** Replace Termux's regex-based automatic subpackage generation (e.g., automatically generating `-dev` or `-static` packages via bash scripts) with **explicit configuration**. The `build.yml` must explicitly declare core subpackages and the file patterns they include (e.g., `subpackages: dev: includes: ["include/*", "lib/*.so"]`).
   - **Smart Subpackaging & Headless Profiles:** Instead of blindly deleting documentation (`man` pages, `info`) or translations like Termux does, RepoExe will natively support Headless/CLI configuration preferences. The Python packagers (`debian.py` / `pacman.py`) will automatically intercept documentation directories (e.g., `share/man`, `share/info`) and localization directories (e.g., `share/locale`) and dynamically split them into `-doc` and `-locale` subpackages without the developer having to explicitly define them in the YAML.
   - **Recommends Linking:** These auto-generated subpackages will be linked to the main package via APT's `Recommends` field rather than `Depends`. This allows users to control exactly what they download: a standard `apt install <pkg>` will include the docs, while `apt install --no-install-recommends <pkg>` will execute a pure, headless CLI installation, preventing unnecessary bloat.

6. **Cross-Compilation & Build Lifecycles:**
   - **Cross-Compilation & Toolchains:** The Python orchestrator will dynamically select the correct NDK toolchain based on the target architecture (`aarch64`, `arm`, `x86_64`, `i686`). It must also explicitly support the **Flang (Fortran)** compiler toolchain for scientific packages, matching Termux's advanced NDK toolchain capabilities. The YAML schema must also support `build_multilib` to compile 32-bit (`arm`/`i686`) packages explicitly for 64-bit target environments.
     - **Dynamic CMake Toolchain Generation:** For packages utilizing CMake, the `toolchains/native.py` module must dynamically generate a strict, architecture-specific `android.toolchain.cmake` file and securely inject it via `CMAKE_TOOLCHAIN_FILE`, overriding any flawed host configurations.
   - **Automated Debug Symbol Extraction (`-dbg` packages):** Instead of stripping binaries destructively (or bloating them via `no_strip`), the orchestrator must automatically use `llvm-objcopy` during the `make_install` phase to extract debug symbols into distinct `package-name-dbg` subpackages. This keeps primary installations minimal while offering debug tooling (`gdb`/`lldb` support) when needed.
   - **Specialized Language Toolchains & Wrapper Injection:** Beyond C/C++, `toolchains.py` must support dynamic environment bootstrapping for specific languages:
     - The monolithic logic will be split into isolated submodules (`scripts/core/toolchains/rust.py`, `scripts/core/toolchains/python.py`, etc.).
     - **Rust:** `toolchains/rust.py` automates `rustup` fetching and injects `CARGO_TARGET_NAME`.
     - **Golang:** `toolchains/golang.py` fetches releases and natively implements required compatibility patches.
     - **Python (Crossenv):** `toolchains/python.py` integrates legacy Termux `crossenv` patches (e.g., `PYTHONPATH`, `shebang` fixes) to securely cross-compile wheels.
     - **Zig & Swift:** Isolated submodules implement specific environment variables.
     - **Config Overrides:** Dynamically inject explicit cross-compilation wrapper scripts (e.g. `llvm-config`, `pg_config`) into the `PATH` during compilation so packages don't accidentally execute the host's Linux configurations.
   - **PREFIX Boundary Injection (`properties.py`):** The orchestrator must globally define the internal device layout (enforcing `PREFIX=/data/data/com.termux/files/usr`). The `toolchains.py` module MUST actively inject this `PREFIX` into `CFLAGS`, `CPPFLAGS`, and `LDFLAGS` during the build lifecycle. This ensures compiled C/C++ binaries search for configs and libraries in the Android data directory, rather than breaking by looking in standard Linux paths like `/usr/bin`.
   - **Hermetic Sandboxing & Symlink Farm Sysroot:** Prior to compiling a package, the orchestrator (`sysroot.py`) must prepare an isolated `$PREFIX`. Instead of executing slow I/O disk copies of gigabytes of `.deb` dependencies, `sysroot.py` must implement a **Nix-style Symlink Farm**. This sysroot must operate as a strict **Content-Addressable Store** (similar to `/nix/store`), hashing directories based on their inputs (e.g., `/sysroot/sha256-.../`). Dependencies are unzipped once into this read-only global cache, and fast symlinks are generated into the active `$PREFIX`, guaranteeing zero file collisions. To guarantee a fully Hermetic Build, the Docker container's network access MUST be strictly disabled during the compilation phase, forcing the package to rely purely on declared inputs. Furthermore, the actual compilation steps (`make`, `configure`) must be wrapped in a strict **Bubblewrap (`bwrap`) jail** within the container. This jail selectively mounts only the read-only sysroot, the specific source directory, and the `$DESTDIR`, entirely preventing poorly written or malicious Makefiles from writing outside their designated boundaries.
   - **Strict `SOURCE_DATE_EPOCH` Enforcement:** To guarantee reproducible builds, the orchestrator must explicitly inject the `SOURCE_DATE_EPOCH` environment variable globally during the build lifecycle to eliminate timestamp non-determinism.
   - **Hybrid Build Approach:**
     - _Declarative Targets:_ For simple, AI-native packages, the YAML schema will support strict Bazel-style declarative targets outlining exactly what source files compile into what outputs.
     - _Native System Wrappers:_ For complex C/C++ upstream software, the orchestrator will wrap standard build systems (`build_system: cmake`). Combined with Hermetic Sandboxing and Content-Addressable Hashing, this hybrid method achieves industrial-grade caching while allowing standard upstream `Makefiles` to function seamlessly, ensuring extreme maintainability. The orchestrator must actively override CMake and Meson defaults to enforce the **`Ninja`** build backend to maximize compilation speed.
   - **Full Android Compatibility Patching:** The orchestrator must fully implement all standard Termux mechanisms required to make upstream binaries run on Android devices. This includes dynamically updating `config.guess` and `config.sub` scripts inside package source trees, resolving hardcoded Linux paths (`/bin/sh`, `/usr/bin/env`, `/etc`), and executing `termux-elf-cleaner` on all compiled `.so` and executable files to strip unsupported ELF tags. The orchestrator must provide YAML escape hatches (`no_elf_cleaner`, `no_shebang_fix`, `no_strip`) for edge-case packages that break under these automated mechanisms.
     - **Strict Patch Enforcement:** When applying `.patch` files, the orchestrator must enforce strict application (e.g., `patch --no-backup-if-mismatch --forward --reject-file=-`) and reject "fuzzy" patching to prevent silent upstream breaks during version bumps.
   - **Transparent QEMU Emulation Fallback:** Cross-compiling often breaks when an upstream `Makefile` accidentally executes a newly compiled Android binary to generate code. To prevent the need for complex `host_build` hacks for 90% of packages, the Docker container must natively configure `binfmt_misc` and `qemu-user-static`. This allows the host x86_64 runner to transparently and seamlessly execute `aarch64` binaries during the build process if required.
   - **Bionic Undefined Symbols Validation:** Because Android's Bionic libc is missing standard Linux glibc functions, packages can sometimes compile successfully but immediately crash at runtime. The orchestrator MUST run `readelf` against every compiled `.so` and executable, verifying their symbol tables against the strictly allowed Android maps (e.g., `libc.map.txt`, `libm.map.txt`, `libdl.map.txt`). Any binary linking to an undefined Linux function must immediately fail the CI build.
   - **Strict SONAME Enforcement:** Android's dynamic linker strictly requires shared libraries to declare their `SONAME`. The orchestrator must run `readelf` to verify that every `.so` file generated has a properly assigned `SONAME`. If missing, the build must fail immediately to prevent broken libraries from reaching the repository.
   - **Ghost Dependency Detection:** Following the `make_install` phase, the orchestrator MUST natively run `dpkg-shlibdeps` and `readelf` against the final `.so` objects and executables. It must cross-reference the actual linked libraries against the `Depends` listed in the `build.yml`. If a developer or AI declared a dependency that was never actually utilized by the binary, the orchestrator must strictly throw a CI linting error, enforcing perfectly lean mobile packages.
   - **Automated ABI Breakage Detection:** Integrate tools like `libabigail`. After a C/C++ library compiles, the system will automatically compare the new `.so` file against the previous release. If an ABI breakage is detected, the `dag.py` will automatically flag all dependent packages for a mandatory `revision` bump and rebuild, guaranteeing absolute ecosystem stability.
   - **Explicit Massaging & Implicit Cleanup Standardization:** Replace Termux's massive, implicit `step_massage.sh` with explicit exclude configurations in `build.yml` (e.g., `exclude_files: ["var/log/*"]`). However, universal structural cleanup will remain hardcoded into the orchestrator's `debian.py`/`pacman.py` packagers to enforce repository consistency without requiring manual developer intervention. This includes:
     - **Automated Cache Trimming:** Automatically deleting generated caches (`__pycache__`, `mimeinfo.cache`, `gschemas.compiled`). This is crucial to prevent package installation conflicts (when multiple packages try to own the same global cache file) and reduces package bloat.
     - **Automated Permissions Normalization:** Stripping "world" permissions (`chmod -R o-rwx`) from all packaged files to prevent Android filesystem security and extraction issues.
     - **Ghost Directory Pruning:** Automatically deleting all empty directories right before compression.
     - **sbin Merging:** The forced moving of all `/sbin` and `/usr/sbin` binaries into `/bin` (since Android does not differentiate them).
     - **Post-Processing Determinism:** Automatically run `strip-nondeterminism` across all generated archives (`.a`, `.zip`, `.jar`) before packaging to scrub leaked metadata that `SOURCE_DATE_EPOCH` misses.
     - **Strict PIE Enforcement:** Android strictly requires executables to be compiled as Position Independent Executables (PIE). The cleanup phase must run `readelf` on all executables and immediately fail the build if they are not PIE-compliant to prevent runtime crashes.
     - **Documentation Compression:** Automatically find all documentation (`share/man`, `share/info`) and compress them using `gzip` to drastically reduce package size.
     - **Strict Stripping:** After extracting debug symbols into `-dbg` subpackages, the orchestrator must enforce running `llvm-strip` against the main `.so` files and executables to reduce package bloat.
     - **Libtool `.la` File Removal:** Automatically delete `*.la` libtool files, which often contain hardcoded host paths that break cross-compilation for downstream packages.
   - **Lifecycle Hook Migration & Hermetic Pre-fetch:** Termux relies on ~34 implicit bash function overrides (e.g., `termux_step_pre_configure`, `termux_step_post_massage`). RepoExe will migrate these into structured, declarative lifecycle hooks inside the `build.yml` (e.g., `phases: [host_build, pre_fetch, pre_configure, configure, make, install, post_install, test]`). The Python orchestrator will execute the shell snippets defined in these YAML blocks in a strict, predictable order. The `pre_fetch` phase is explicitly introduced to execute _before_ the Docker container's network is disabled, allowing modern language tools (like `cargo`, `npm`, or `go`) to dynamically download dependencies before entering the strict Hermetic Sandbox compilation phases.
     - **Recursive Git Submodule Support:** If a package defines a Git repository as its source instead of a tarball, the orchestrator's fetcher (`sysroot.py`) must seamlessly and natively support deep, recursive Git submodule initialization, resolving inconsistencies found in legacy Bash scripts.
   - **Strict Test Environment Sandboxing:** The old `test-runner.sh` script is deprecated. The Python orchestrator will include a robust `test.py` module to execute integration assertions (defined in the `test` phase of the YAML). To prevent "it works on my machine" false positives, `test.py` MUST execute these tests inside isolated environments:
     1. A nested **PRoot container** to strictly simulate a standard Android Termux app environment (no root access, strict `$PREFIX` paths, no access to the builder's source tree).
     2. A simulated **PRoot Distro** environment to catch edge-case filesystem bugs that occur when Termux users run packages inside Linux chroots.
     3. A nightly/release **Real Android Emulator** environment via CI workflows (e.g., using `reactivecircus/android-emulator-runner`). The CI will boot an Android emulator on a Linux runner with KVM support, securely install the Termux APK via `adb`, push the compiled packages, and execute `pkg install` inside the Termux shell via `adb shell` to natively verify behavior.
     4. **Flaky Test Isolation:** To prevent CI stalling due to transient emulator/PRoot quirks, `test.py` must integrate an automatic retry mechanism. Tests that fail initially but pass on retry are quarantined as "flaky", generating warnings without hard-blocking the release pipeline.

---

## 3. Docker Environment (`docker.yml` & `Dockerfile`)

Docker is the **only officially supported environment** for local building to prevent host pollution. It must be highly modular to ensure layers cache correctly and speed up CI init times.

**Features to Implement:**

1. **Base Image:** Utilize an optimized `Ubuntu 24.04` base (aligning seamlessly with GitHub Actions environments).
2. **Multi-Stage Builds & Modularity:** Use multi-stage builds to keep the final image lean. Avoid junks. Ensure the image is built in a way that maximizes Docker layer caching.
3. **Baked-in NDK Patches & Host Tools:** Apply NDK patches directly within the `Dockerfile` during the `docker build` phase. Baking patches into the image layer is drastically faster than applying them at runtime. Furthermore, the Dockerfile must natively build and include essential Termux host tools (like `termux-elf-cleaner`) within the image.
4. **Non-Root User & `fuse-overlayfs`:** Run all builds under a non-root `builder` user. To avoid host permission conflicts on mapped volumes, the orchestrator (`docker.py`) must manage permissions deterministically (e.g., standardizing on UID 1000 across the container and host runners). This completely eliminates the fragile, legacy `run-docker.sh` interactive `sudo chown` and `usermod` hacks. Passwordless sudo is strictly limited to isolated container bootstrapping if necessary. The Docker daemon and container MUST be configured to use `fuse-overlayfs` as the storage driver. This is a critical optimization required to dramatically improve compilation speeds and file I/O operations inside the builder environment.
5. **Security Profiles (Seccomp & AppArmor):** The orchestrator (`docker.py`) must launch the container using the custom `docker/profile.json` (Seccomp) and `profile-relaxed.apparmor` profiles. These are critical to allow system calls (like `personality`, `mount`, `umount2`) required by complex compilers (e.g., Rust, QEMU) which would otherwise crash under default Docker constraints. Furthermore, `docker.py` must use Python's `subprocess` management to securely propagate cancellation signals (SIGTERM/SIGINT) to the Docker container. This ensures that if a CI workflow is cancelled or times out, the container gracefully terminates and cleans up, entirely replacing the legacy bash trap hacks (`docker-exec-pid-file`) that attempted to prevent zombie processes.
6. **Advanced Caching Strategy & Bloat Prevention:** Replace legacy `ccache` with Mozilla's **`sccache`**.
   - **Architecture-Isolated Caching:** `sccache` storage must be strictly isolated by architecture (e.g., `sccache-aarch64`, `sccache-x86_64`) to prevent cache thrashing. Configure `sccache` to natively utilize the GitHub Actions Cache API, chunking large cache archives efficiently to stay within GitHub's repository limits. Cross-architecture shared objects (like downloaded sources or host tools) will use a shared common cache.
   - **LRU Eviction (Least Recently Used):** Configure GitHub Actions cache eviction to purge based on access time (LRU) rather than strict age limits (like 7 days), ensuring frequently used caches remain active. Ensure PRs do not save caches to prevent main branch cache pollution.
   - **GHCR for Docker Layers:** Utilize the GitHub Container Registry (GHCR) as an OCI-backed cache specifically for `Dockerfile` layers. This ensures the builder image initializes in seconds. A `cache-prune.yml` workflow will automatically purge untagged or unused GHCR layers to manage storage.
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
   - The `prepare` script will group independent packages into "Shards". **Telemetry-Driven Dynamic Sharding:** The `dag.py` must consume historical `telemetry.json` execution times to balance shards dynamically, ensuring all parallel runners finish at roughly the same time to absolutely minimize total CI duration.
     - **Dependency Graph Output:** The `dag.py` script must support generating a lightweight visual output (like a JSON map or a Mermaid graph) of the dependency tree. This will act as a critical debugging feature to trace why a package is being built in a specific shard without slowing down the CI pipeline. While implementing `dag.py`, logic from the legacy `backup/scripts/buildorder.py` should be analyzed, but it must be heavily adapted to handle our hybrid resolution strategy.
     - **Automated Downstream Testing (Reverse Dependencies):** When a developer opens a PR modifying a core library (e.g., `openssl` or `libbase`), the `dag.py` script must automatically identify all downstream "reverse dependencies" that rely on the modified library. The orchestrator will implicitly queue these downstream packages into the CI test matrix to guarantee the library update does not introduce breaking API/ABI changes to other software in the ecosystem.
   - The `build` job will use a **Dynamic Matrix** (`[architectures] × [shards]`). This allows spawning dozens of concurrent runners instantly (e.g., 4 architectures × 10 shards = 40 parallel jobs) to build packages as fast as possible.
     - **Massive Packages:** Massive packages that require intense resources (as tagged by `isolated_shard: true` in their `build.yml`) will be automatically routed to their **own isolated shard** on a dedicated 16GB runner. The DAG will guarantee prerequisites are built beforehand.
   - **State Tarball Deprecation:** The legacy Termux/TUR workaround of pausing builds, zstd-tarballing the entire `~/.termux-build` directory, and resuming the build on a new runner is officially deprecated. The isolated DAG Sharding strategy completely replaces the need for transferring gigabytes of raw build state between runners.
   - **Local CI Emulation:** The orchestrator and repository must explicitly document and support running these complex Matrix Sharding workflows locally using `nektos/act`. This allows developers to test artifact generation and dynamic CI routing without pushing commits to GitHub.
3. **Dual-Mode Workflow with Strict Release Boundaries (`build.yml` & `publish.yml`):**

   - **Semantic Release Integration:** Implement automated release note generation and version bumping (e.g., using `Release Please` or `Semantic Release`) based on Conventional Commits for the Python orchestrator and core releases.
   - **Manual Dispatch Features:**
     - **Test Mode:** Manual dispatches can include a `test_only` flag. When enabled, the workflow builds packages but strictly skips publishing to the repository.
     - **Package Exclusion Syntax:** The workflow package input must support a negative exclusion syntax like `!{package_name}`. This allows building "everything except X". The `prepare` script MUST enforce strict validation: if the syntax is malformed, or if a user attempts to exclude a package that is a strict dependency of another package being built, the workflow must abort immediately before spawning runners.
   - **Automated Rollback (`yank.yml`):** If a deployed package is broken, developers can trigger this manual workflow. It will automatically delete the broken version's assets from the GitHub Release tag and update the static APT/Pacman/Alpine index to point back to the previous stable version still stored in the release.
   - **PR Mode:** Compiles packages purely as a test. Restores caches to speed up builds but strictly DOES NOT save them, preventing cache pollution.
   - **Strict Release Separation & SLSA Provenance:** The package compilation (`build.yml`) and repository publishing (`publish.yml`) must be strictly separated. The publish step (`needs: build`) will only push to the live repository **if and only if** all shards in the matrix passed successfully. The static repository hosting (APT/Pacman/Alpine) must implement **TUF (The Update Framework)** principles for metadata signing to protect against rollback attacks.
     - **Dual-Key Injection:** The `publish.yml` workflow must securely inject the `GPG_PRIVATE_KEY` and `ALPINE_PRIVATE_KEY` GitHub Secrets to allow the orchestrator to sign metadata and `.apk` files natively.
     - **Provenance:** Furthermore, the `publish.yml` step must use GitHub Actions native **`actions/attest-build-provenance`** integration to generate cryptographic SLSA Provenance for the repository metadata, verifying supply chain security.
   - **Individual Binary Signing:** Beyond repository-level metadata signing, the Python orchestrator must optionally support cryptographically signing individual binaries (`.so` files and executables) using a secure key before they are packaged into the `.deb`, `.pkg.tar.zst`, or `.apk` files, preventing runtime tampering.

   - **Build-Time Telemetry & Profiling:** The Python orchestrator (`build.py`) must instrument **OpenTelemetry (OTel)** tracing. It will stream phase execution durations (e.g., `configure`, `make`, `install`), layer sizes, and peak memory usage directly to an observability backend, replacing static JSON telemetry and allowing real-time visualization of CI bottlenecks.

4. **Package Updates & Dev Component Promotion (`package_updates.yml` & `promote.yml`):**
   - Auto-update logic must be disabled by default and explicitly enabled per package via the new YAML definitions. Updates trigger auto-PRs via `gh pr create`.
   - **Dev Component Staging:** To protect users from upstream regressions, all standard package updates (including auto-updates) are strictly deployed to the `dev` repository component first.
   - **Automated Promotion:** A `promote.yml` cron job will run daily to scan the `dev` component. If a package has resided in `dev` for 3 days without a matching regression issue being opened on GitHub, the workflow automatically promotes the package to the `main` component.
   - Packages explicitly configured with `bypass_dev: true` in their `build.yml` are exempt from staging and deploy directly to `main`.
5. **Reproducible Builds Verification & Multi-Runner Consensus:**
   - **`reproducible.yml`:** Implement a manual `workflow_dispatch` workflow that accepts a package name as input. It will explicitly build the package twice (manipulating timestamps, runner paths, and environments) and use `diffoscope` to compare the resulting `.deb` files. If they are not bit-for-bit identical, the workflow fails, identifying non-deterministic metadata leaks within the Hermetic Sandbox.
   - **Multi-Runner Consensus:** For "essential" or core cryptographic packages (e.g., `openssl`, `apt`), the CI must dynamically spawn two independent runners. Both runners build the package concurrently, and the publish step only succeeds if both runners produce bit-for-bit identical artifact hashes. This defends against compromised GitHub runners, localized hardware memory flips, or cache poisoning.
6. **Host Space Optimization (`free-space.sh`):**
   - Integrate hyper-fast `rm -rf` logic for massive unused toolchains on the GitHub Host VM before build steps to free up disk space.
7. **Parallelization Enforcement:** Globally standardize `MAKEFLAGS="-j4"` / `ninja -j4` across the build system to maximize the 4-core runners.
8. **Security Analysis (`codeql.yml` & `osv-scanner`):** Integrate CodeQL for static analysis. Add `osv-scanner` or `pip-audit` to the CI to proactively scan dependencies for known vulnerabilities.
9. **`uv` CI Caching:** All Python-based workflows must explicitly implement `uv` cache restoration to ensure the orchestrator environment initializes near-instantaneously on GitHub runners.

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
   - **Upstream Fallback:** For dependencies that are out of scope or not yet built in RepoExe, the build system MUST cleanly fallback and download them directly from the official Termux upstream repository via standard APT sources configured inside the Docker container. Crucially, the Docker builder environment must explicitly import and trust Termux's official upstream GPG keys to securely verify these downloaded fallback dependencies during the build process. The dependency resolution must strictly adhere to the defined `libc` context in `build.yml` (e.g., pulling bionic packages vs explicitly falling back to TUR's glibc packages when `glibc` is required).
   - **No Fragile `curl` Scrapes:** Unlike Termux, which scrapes its own GitHub repo via `curl` to find toolchain versions (e.g., host Python), RepoExe will strictly define external toolchain versions in its own configuration files (e.g., `toolchains.yml`) to prevent breaking if upstream Termux pushes an unexpected change.
3. **Repository Health Validation (`health.yml`):**
   - The orchestrator must include a `health.py` module replacing legacy JS/Python scripts (`check-repository-health.js` and `check-built-packages.py`).
   - It will run on a scheduled cron job to validate the sync between the `packages/` YAML definitions and the live `sjnexe.github.io/RepoExe` repositories (both APT, Pacman, and Alpine formats).
   - It must ensure versions match perfectly, alert if missing artifacts exist, and flag "zombie packages" (e.g., orphaned subpackages or deleted packages) for automated pruning.
   - **Release Asset Pruning:** To prevent infinite storage growth, `health.py` will automatically prune old assets from GitHub Releases. Because all subpackages and variants share a single release tag, the CI `publish.yml` will attach a GitHub Release Asset metadata label (e.g., `version: 33.0.3-1`) to every uploaded file. The pruning script uses these labels to group assets by version and safely deletes any files belonging to the 6th oldest version and beyond.
   - **Reproducibility Dashboard:** `health.py` will continuously aggregate reproducibility verification states and dynamically render a "Reproducibility Status" dashboard on the GitHub Pages site. This dashboard provides a per-version, public track record of which packages have achieved bit-for-bit deterministic builds.
4. **Upstream Version Checking:**
   - The orchestrator must include an `upstream_check.py` module replacing the manual bash script (`check-versions.sh`) and the legacy auto-update scripts.
   - It will automate pinging upstream APIs (explicitly scraping GitHub and GitLab release tags) to detect if a newer version of a package is available, streamlining the cron-based auto-update PRs. Crucially, the module must gracefully handle HTTP 403 blocks from strict GitLab instances (e.g., `gitlab.gnome.org` blocking GitHub Actions runners) by implementing fallback mechanisms like Repology API lookups or direct HTML scraping.

---

## 6. Execution & Agent Directives

1. **Continuous Clarification:** The Agent (Jules) MUST proactively ask the user questions and request confirmation whenever making ambiguous refactoring decisions, to ensure zero issues.
2. **Reference Retention:** The `backup/` and `termux-packages/` directories MUST be preserved throughout the refactoring process for reference. They will only be deleted at the very end. If any legacy mechanisms need investigation, the agent can reference them directly.
3. **Strict NDK Versioning:** Standardize all build scripts and patches strictly for **NDK 29**. All legacy NDK 23c infrastructure must be removed. If a new NDK version is released by Google, the orchestrator and `Dockerfile` must be updated to explicitly target the new version.
4. **Scope Limiting:** We will only maintain standard packages. Root packages (`root-packages`), X11 packages (`x11-packages`), and the `disabled-packages/` directory are entirely removed and out of scope.
5. **Pruning Legacy Bloat:** The following legacy tools and scripts have been completely deleted as they are fully obsoleted by the new architecture and hold zero reference value for Python migration:
   - `scripts/updates/api/` & `scripts/updates/internal/`: Obsoleted by the modern Python REST APIs in `upstream_check.py`.
   - `scripts/check-repository-health.js` & `check-built-packages.py`: Bash-centric data extraction logic obsoleted by structured Pydantic YAML parsing in `health.py`.
   - `scripts/utils/repoexe_reuse_pr_build_artifacts.sh`: The massive GraphQL hack to transfer tarballs between CI runners is obsoleted by the `dag.py` Matrix Sharding.
   - PowerShell Wrappers (`run-docker.ps1`): Obsoleted by strict Linux/GitHub Actions environment enforcement.
   - Alternative OS Bootstrappers (`setup-archlinux.sh`, `setup-offline-bundle.sh`): Obsoleted by the deterministic Ubuntu 24.04 Dockerfile.
6. **On-Device Build Deprecation:** Termux's legacy `$TERMUX_ON_DEVICE_BUILD` variables and complex bash workarounds for compiling directly on Android devices are officially deprecated. RepoExe relies strictly on Docker and GitHub Actions. All on-device compilation logic must be stripped from the new Python orchestrator to reduce bloat.
7. **Task Batching & Independent Sessions:** To prevent AI context overload, tasks MUST be batched logically. Independent sections should not affect each other. **Agents must use the `help.md` file to track checklist progress and write session handovers.**
   - **Phase 1 (Environment):** Implement the `Dockerfile` and foundational GitHub Actions (e.g. `dependabot.yml`, `codeql.yml`, `lint.yml`).
   - **Phase 2 (Orchestrator):** Write the core Python orchestrator (e.g., `build.py`, YAML parsers) and define the `build.yml` schema.
   - **Phase 3 (Workflows):** Implement the Dynamic Matrix Sharding CI workflows (`build.yml`, `publish.yml`) that hook into the Python orchestrator.
   - **Phase 4 (Package Migration):** Migrate individual packages from bash to the new YAML schema. Group migrations logically (e.g., migrate all `libandroid-tools` components in one session).
   - **Phase 5 (Documentation & Handover):** Once all foundational code and migrations are complete, create the `docs/` folder, generate the sample templates, and write the comprehensive `SCHEMA.md` user documentation. Use **`mkdocs-material`** to generate a searchable documentation site hosted under the `/docs` subpath on GitHub Pages, ensuring the main root remains the APT repository index.
