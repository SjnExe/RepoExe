# RepoExe Refactoring Checklist & Session Handover

This file tracks the execution of the massive refactoring effort outlined in `plan.md`.
**Agent Directive:** At the start of a session, review this checklist. At the end of a session, check off the completed items and write a brief summary of what to do next for the following agent. Furthermore, when implementing CI/CD workflows, any GitHub Action that can be replaced by the `gh` CLI command or standard shell commands should be preferred over using third-party actions. All CI workflows MUST utilize `runs-on: ubuntu-latest`.

## Execution Order

The tasks are sorted below strictly by their complexity score (easiest to hardest). Execute them in order. Focus on low-complexity infrastructure tasks first, then move on to core Python modules, and finally the most complex logic.

### Checklist

- [x] [Complexity: 0/100] **Phase 1 Audit**: Perform a comprehensive audit of `plan.md` to identify logical inconsistencies, review obscure features in `backup/`, and propose final DevOps modernization strategies.
- [x] [Complexity: 0/100] **Dual-Key Architecture Setup**: GPG (for APT/Pacman) and RSA (for Alpine) keys have been generated. `GPG_PRIVATE_KEY` and `ALPINE_PRIVATE_KEY` are configured in GitHub Secrets. Public keys are already inside `scripts/` folder.
- [x] [Complexity: 5/100] **Initialize Repository Structure**: Create dotfiles, initialize the `.github/` folder structure (by creating initial workflow files), and create the actual `scripts/site/install` file.
- [x] [Complexity: 5/100] **Create GitHub Community Files**: Create `SECURITY.md`, `CONTRIBUTING.md`, `FUNDING.yml`, `stale.yml`, and `dependabot.yml`.
- [x] [Complexity: 10/100] **Configure Ignore Files**: Create initial `.gitignore` and `.dockerignore` crafted explicitly for the RepoExe structure, and note that these files may need iterative updates as new components are added.
- [x] [Complexity: 10/100] **Configure Prettier**: Set up `.prettierrc` (strict format for AI) and `.prettierignore`.
- [x] [Complexity: 10/100] **Setup Python Project**: Establish `scripts/pyproject.toml` and lock dependencies via `uv` (must include `pydantic`).
- [x] [Complexity: 10/100] **Configure IDE Integration**: Implement DevContainers (`.devcontainer/devcontainer.json`) and `.vscode/settings.json` for YAML IDE Intellisense.
- [x] [Complexity: 15/100] **Configure Local Pre-commit Hooks**: Create `.pre-commit-config.yaml` for automated formatting checks (`ruff`, `prettier`, `shellcheck`).
- [x] [Complexity: 20/100] **Docker Base Image**: Write the base `Dockerfile` (Ubuntu 24.04, non-root `builder`, integrate `uv`, `ruff`, `mypy`, `shellcheck`).
- [x] [Complexity: 20/100] **Migrate: repoexe-keyring**: Base component opt-in packages.
- [x] [Complexity: 25/100] **Docker NDK & Caching**: Download NDK 29, bake standard NDK patches directly into a Docker layer, and configure `sccache` with GitHub Actions Cache API chunking.
- [x] [Complexity: 25/100] **Properties Module (`properties.py`)**: Define explicit internal `PREFIX` bounds for the device layout (`/data/data/com.termux/files/usr`).
- [x] [Complexity: 25/100] **Repository Configurations (`repo.yml`)**: Implement `scripts/repo.yml` to define external repository endpoints (Termux/TUR), their GPG keys, and their component layouts for dynamic fallback dependency resolution.
- [x] [Complexity: 30/100] **YAML Pydantic Parser (`parser.py` - Core)**: Implement basic Pydantic parsing of `build.yml` schema, License allowlist validation, and standardized `source_url` formatting.
- [x] [Complexity: 30/100] **CI Workflow: lint.yml**: Implement Self-Healing CI that auto-runs `ruff` and `prettier` and pushes fix commits.
- [x] [Complexity: 30/100] **CI Workflow: python-tests.yml**: CI workflow executing the `pytest` test suite for the orchestrator, integrating `pytest-cov` and rendering GitHub Step Summaries.
- [x] [Complexity: 30/100] **CI Workflow: cache-prune.yml**: Handled. GitHub natively manages action caches via LRU. GHCR pruning logic should be integrated into the upcoming `docker.yml` workflow as a specific step instead of creating a separate workflow.
- [x] [Complexity: 35/100] **CI Workflow: security-scan.yml**: Integrate `osv-scanner` or `pip-audit` to proactively scan dependencies for known vulnerabilities.
- [x] [Complexity: 35/100] **CI Workflow: free-space.sh**: Implement hyper-fast `rm -rf` logic for massive unused toolchains on GitHub Host VMs.
- [ ] [Complexity: 40/100] **Version Normalization (`parser.py` - Versions)**: Strictly strip `v` prefixes, parse Epochs (`1:`), and translate upstream revisions/tags into PM-specific dialects (`+r4` for Debian, `.r4` for Pacman, `_p4` for Alpine).
- [ ] [Complexity: 40/100] **CLI Subcommands (`build.py` - CLI)**: Wire basic subcommands `info`, `list`, `clean`, `init` for interactive scaffolding, and `--dry-run` flag.
- [x] [Complexity: 40/100] **Test Execution Sandbox (`test.py`)**: Execute tests strictly inside PRoot (downloaded and set up natively by Docker) to simulate Android Termux, implementing Flaky Test Isolation.
- [x] [Complexity: 40/100] **Migrate: libandroid-tools**: Split into granular sub-packages (`libbase`, `libcutils`, etc.) using logic from `backup/` directory. Embed legacy `source.sh` logic natively into `build.yml` lifecycle hooks.
- [x] [Complexity: 45/100] **Native Toolchains (`toolchains/native.py`)**: Select NDK compilers based on arch, inject `PREFIX` into `CFLAGS`/`LDFLAGS`, implement CMake/Meson/Autotools wrappers, and generate `android.toolchain.cmake`.
- [x] [Complexity: 45/100] **Docker Wrapper (`docker.py`)**: Wrap execution commands in `builder` container, handle mapped volume permissions deterministically, and propagate cancellation signals.
- [x] [Complexity: 45/100] **Language Toolchains (`toolchains/*.py`)**: Handle Rust, Python, Go environment logic natively in Python submodules.
- [x] [Complexity: 50/100] **Sysroot Symlink Farm (`sysroot.py`)**: Implement Content-Addressable Store caching for the `$PREFIX` to rapidly generate links without I/O disk copies.
- [x] [Complexity: 50/100] **Debian Packager (`debian.py` - Base)**: Handle `.deb` generation (`zstd`), `sbin` merging, PIE enforcement, gzip docs, and libtool `.la` removal.
- [x] [Complexity: 50/100] **Pacman Packager (`pacman.py`)**: Handle `.pkg.tar.zst` and database (`.db`) generation using `zstd`.
- [x] [Complexity: 50/100] **Alpine Packager (`apk.py`)**: Handle `.apk` and `APKINDEX.tar.gz` generation.
- [x] [Complexity: 55/100] **Advanced Metadata Schema (`parser.py` - Metadata)**: Enforce advanced flags (`conffiles`, `essential`, `anti_build_depends`, `no_shebang_fix_files`, `no_staticsplit`, `excluded_arches`, `build_in_src`, `pre_depends`, `build_multilib`, `no_elf_cleaner`, `host_build`, `lto`, `pgo`).
- [x] [Complexity: 55/100] **CI Workflow: build.yml (Base)**: Dynamic Matrix Sharding (`architectures x shards`), strictly triggered on `push`/`PR` to `main`.
- [x] [Complexity: 55/100] **CI Workflow: publish.yml**: Publish workflow separated from `build.yml`. Verify artifacts, inject signing keys, publish metadata to Pages.
- [x] [Complexity: 60/100] **Git History Version Validation (`parser.py` - Continuity)**: Implement Git history lookups (`git show origin/main...`) to strictly enforce version/revision incrementation.
- [x] [Complexity: 60/100] **DAG Core Resolver (`dag.py` - Core)**: Resolve dependencies, read `isolated_shard` boolean tags, and generate matrix shards.
- [x] [Complexity: 60/100] **Implicit Cleanup Standards (`debian.py` - Cleanup)**: Auto-cache trimming, permissions normalization, ghost directory pruning, `-glibc` dynamic suffixing, and auto `-doc`/`-locale` Smart Subpackages.
- [x] [Complexity: 60/100] **Migrate: aapt, aapt2, zipalign, aidl**: Implement "Local Source Building" for deprecated `aapt` (in `packages/aapt/src/`) applying standard bloat-free patches directly. Use upstream sources and native `build.yml` hooks for actively maintained `aapt2`, `zipalign`, and `aidl`.
- [x] [Complexity: 65/100] **Android Patching & Validation**: Auto `config.guess` updates, Linux hardcoded path fixes, `termux-elf-cleaner`, `-dbg` symbol extraction, strict Bionic Undefined Symbols validation, strict SONAME enforcement.
- [ ] [Complexity: 65/100] **CI Workflow: package_updates.yml**: Auto-PR workflow triggered by scheduled `upstream_check.py`.
- [ ] [Complexity: 70/100] **Source Mirroring & Git Submodules (`sysroot.py` - Advanced)**: Validate GPG signatures, auto-mirror fetched tarballs to GitHub Releases, natively clone upstream Git branches, and handle recursive submodules.
- [ ] [Complexity: 70/100] **Repository Health Core (`health.py`)**: Cron job logic validating sync between YAML and Pages, flagging zombie packages, and Release Asset Pruning (keep last 5 versions).
- [ ] [Complexity: 75/100] **Hermetic Docker Sandbox (`docker.py` - Strict)**: Disable network access during compilation. Integrate strict Bubblewrap (`bwrap`) jail boundaries, natively mount `binfmt_misc` / `qemu-user-static` for transparent emulation.
- [ ] [Complexity: 75/100] **Hybrid Build Engine (`build.py` - Runner)**: Execute structured declarative targets vs wrappers. Ensure `pre_fetch` hook runs _before_ Hermetic sandboxing. Instrument OpenTelemetry and generate `crash_report.json`.
- [ ] [Complexity: 80/100] **DAG Telemetry & Anti-Deps (`dag.py` - Advanced)**: Telemetry-driven dynamic sharding to balance execution times. Natively handle `anti_build_depends` to strictly uninstall conflicting dependencies on runners. Output Dependency Graphs.
- [ ] [Complexity: 80/100] **Ghost Dependency & ABI Detection**: Run `dpkg-shlibdeps` against `Depends` array to lint unused dependencies. Integrate `libabigail` validation for ABI breakage.
- [ ] [Complexity: 85/100] **Static APT Generator (`debian.py` - APT)**: Natively implement Python-based custom static APT metadata generation (`Packages`, `Release`, `InRelease`) entirely replacing `aptly`. Also implement `APT pdiff` incremental generation and automated `.pdiff` pruning directly in the generator with a max limit of 256 diffs.
- [ ] [Complexity: 85/100] **CI Workflow: build.yml (Exclusions & PR Mode)**: Implement `!{package}` exclusion syntax, PR Test Mode (no save caches), and automated downstream testing queue logic.
- [ ] [Complexity: 85/100] **CI Workflow: publish.yml (TUF & SLSA)**: Generate SLSA Provenance using `actions/attest-build-provenance`, and enforce TUF principles for static hosting.
- [ ] [Complexity: 90/100] **Multi-Runner Consensus (CI)**: Update workflows so that "essential" packages dynamically spawn two independent runners and require bit-for-bit identical hashes before publishing.
- [ ] [Complexity: 90/100] **Alpine RSA Signature Appending (`apk.py` - Signing)**: Natively implement the complex logic to mathematically append Alpine RSA signatures to compiled `.apk` files and `APKINDEX.tar.gz`.
- [ ] [Complexity: 95/100] **Auto-Revision & Downstream DAG Bumping (`dag.py` - Smart)**: Enable the orchestrator to automatically calculate revision bumps down the DAG when core upstream dependencies trigger rebuilds or ABI breaks.
- [ ] [Complexity: 100/100] **Content-Addressable Hashing Engine**: Incorporate strict SHA256 "state hash" evaluation across package inputs (YAML, patches, source hash, downstream DAG state hashes) to aggressively skip redundant builds globally.
- [ ] [Complexity: 30/100] **Documentation: SCHEMA.md**: Write comprehensive schema documentation for all YAML fields, flags, and hooks.
- [ ] [Complexity: 30/100] **Documentation: Sample Templates**: Create `docs/standard/build.yml` and others.
- [ ] [Complexity: 40/100] **Documentation: mkdocs Site**: Set up `mkdocs-material` for a searchable docs site on `/docs`.

---

## Current Session Notes / Handover

_Write a short summary below when ending a session so the next AI agent knows exactly where to pick up._

**Status:** Phase 1 scaffolding complete. Ready for Docker environment implementation.

**Session 1 Handover (Completed)**

- Completed tasks 0-15/100 (Initialize Repository Structure, Create GitHub Community Files, Configure Ignore Files, Configure Prettier, Setup Python Project, Configure IDE Integration, Configure Local Pre-commit Hooks).
- Configured python tools (Ruff, Mypy, UV) to target absolute latest Python 3.13.
- Setup Dependabot for GitHub Actions and pip packages, configured to run daily.
- Created `scripts/site/install` to support concurrent Apt, Pacman, and Apk installations without `pkg`.
- All line lengths tuned to `120` to aid AI agents.

**Session 2 Handover (Completed)**

- Performed a comprehensive Phase 1 Audit on the `plan.md` architectural blueprint.
- Integrated modernization strategies such as Bubblewrap `DESTDIR` tmpfs fallbacks, `scripts/repo.yml` external repository routing, dynamic `libc` suffixing logic for internal dependency trees, Repology API lookups, and PM-specific override blocks in the YAML schema.

**Session 3 Handover (Completed)**

- Created the modern `Dockerfile` utilizing Ubuntu 24.04, non-root builder user, caching overlays, and astral-sh/uv for python tools.
- Migrated `repoexe-keyring` to the new Pydantic YAML schema under `packages/`.
- **Next Action (Session 4):** Start with **Docker NDK & Caching** (Complexity 25/100), bake standard NDK patches directly into a Docker layer, and configure `sccache`. Then move on to the **Properties Module (`properties.py`)**.

**Session 4 Handover (Completed)**

- Downloaded Android NDK 29 and baked standard NDK patches directly into a Docker layer.
- Configured `sccache` with GitHub Actions Cache API support.
- Created `scripts/core/properties.py` to define explicit internal `PREFIX` bounds for the device layout.
- **Next Action (Session 5):** Start with **Repository Configurations (`repo.yml`)** (Complexity 25/100) and **YAML Pydantic Parser (`parser.py` - Core)** (Complexity 30/100).

**Session 5 Handover (Completed)**

- Implemented `scripts/repo.yml` documenting comprehensive external repository endpoints, including `termux-main`, `termux-root`, `termux-x11`, `tur`, Alpine Edge and all `termux-pacman` equivalents for robust fallback dependency resolution.
- Implemented `scripts/core/parser.py` utilizing Pydantic to enforce strict schema validation for `build.yml` fields.
- Integrated the `repositories` field in the parser schema to allow explicit configuration of necessary external dependencies per-package.
- Upgraded Python dependencies in `pyproject.toml` to dynamically track the absolute latest versions via `uv`.
- **Next Action (Session 6):** Start with **CI Workflow: lint.yml** (Complexity 30/100), **CI Workflow: python-tests.yml** (Complexity 30/100), and **CI Workflow: cache-prune.yml** (Complexity 30/100).

**Session 6 Handover (Completed)**

- Updated `plan.md` and `help.md` to document the preference for using `gh` CLI or shell commands over third-party GitHub Actions.
- Implemented `lint.yml` to automatically run `ruff` and `prettier` formatting and commit fixes back to the PR directly using git shell commands.
- Implemented `python-tests.yml` to run unit tests via `pytest`, including `pytest-cov` reporting printed to GitHub Step Summaries.
- Added basic foundational unit tests (`test_parser.py`, `test_properties.py`) for existing Python modules so `pytest` has coverage metrics to report.
- Marked `cache-prune.yml` as handled, redirecting GHCR pruning logic to the upcoming Docker workflow since GitHub natively manages Actions cache via LRU.
- **Next Action (Session 7):** Start with **CI Workflow: security-scan.yml** (Complexity 35/100) and **CI Workflow: free-space.sh** (Complexity 35/100).

**Session 7 Handover (Completed)**

- Merged `codeql` and `osv-scanner` jobs into a single `.github/workflows/security-scan.yml` workflow, utilizing standard bash shell downloads for the `osv-scanner` binary to avoid third-party Action dependencies.
- Implemented `free-space.sh` strictly as an embedded GitHub Composite Action at `.github/actions/free-space/action.yml` to cleanly optimize disk space on the runners.
- Moved Documentation checklist items (`SCHEMA.md`, `Sample Templates`, `mkdocs Site`) to the bottom of the execution order as they belong to the final Phase 5 Handover step.
- **Next Action (Session 8):** Start with **Version Normalization (`parser.py` - Versions)** (Complexity 40/100) and **CLI Subcommands (`build.py` - CLI)** (Complexity 40/100).

**Session 8 Handover (Completed)**

- Implemented version string normalization directly via Pydantic validators on the `BuildYml` schema in `parser.py`.
- Added computed properties (`deb_version`, `pacman_version`, `apk_version`) to the Pydantic parser to seamlessly translate version dialects (`-rc`, `-r`) for distinct package managers without breaking sorting.
- Implemented `build.py` orchestrator CLI entrypoint utilizing `argparse`. Includes functional implementations for subcommands `info`, `list`, `clean`, `init` (interactive scaffolding wizard), and `build --dry-run`.
- Addressed code review feedback: properly mocked `pytest`, restored integration tests that were accidentally cleared out, fixed `subprocess` standard list passing for docker commands instead of shell execution.
- Added support for `phases` dict and `maintainer` field inside `parser.py` needed for `repoexe-keyring`.
- **Next Action (Session 9):** Start with **Test Execution Sandbox (`test.py`)** (Complexity 40/100) and **Migrate: libandroid-tools** (Complexity 40/100).

**Session 9 Handover (Completed)**

- Integrated PRoot natively into the `Dockerfile` with the `com.termux` layout to support sandboxed testing seamlessly via Docker without external downloads at runtime.
- Implemented `scripts/core/test.py` with the `ProotTestRunner` to execute test commands safely inside PRoot with Flaky Test Isolation retries. Added unit tests for the runner.
- Migrated `libandroid-tools` to the new Pydantic YAML schema under `packages/libandroid-tools/build.yml`. Embedded the legacy `sources.sh` logic completely into the `make` hook, and brought over required patches and `include/` directory.
- **Next Action (Session 10):** Start with **Native Toolchains (`toolchains/native.py`)** (Complexity 45/100) and **Docker Wrapper (`docker.py`)** (Complexity 45/100).

**Session 10 Handover (Completed)**

- Updated `Dockerfile` to allow `TERMUX_NDK_VERSION` and `ANDROID_NDK_SHA256` to be dynamic variables, instead of hardcoded strings. NDK patch looping correctly references `${TERMUX_NDK_VERSION}`.
- Refactored `parser.py` schema for strict dependency resolution. The `depends` and `pre_depends` arrays are now dictionaries explicitly mapping target repositories (e.g., `termux-main` or `local`) to dependencies. Removed generic `repositories` field.
- Implemented `vars` dictionary dynamic string interpolation in `build.yml` parsing. Properties like `name` and `version` can be used as `{version}`, or complex values like `{tag_version}` can be defined and reused across `git_branch` and `phases`.
- Migrated `packages/libandroid-tools/build.yml` to utilize the `{version}` substitution and the strict `depends` dictionary.
- Standardized python linting and formatting configuration to single quotes via `prettier` and `ruff`.

- **Next Action (Session 11):** Start with **Native Toolchains (`toolchains/native.py`)** (Complexity 45/100) and **Docker Wrapper (`docker.py`)** (Complexity 45/100).

**Session 11 Handover (Completed)**

- Implemented `scripts/core/toolchains/native.py` bridging architecture mappings (aarch64 to arm64-v8a etc.) to dynamically construct `android.toolchain.cmake` inside the build directory.
- Configured 32-bit `build_multilib` fallbacks and successfully merged Fortran (Flang) support into base environment setup directly, injecting `PREFIX` constraints to `CFLAGS` and `LDFLAGS`. Enforced `Ninja` backend.
- Created `scripts/core/docker.py` handling deterministic hermetic constraints (`--user 1000:1000`, `--network=none`, seccomp injection).
- Included hybrid docker execution modes providing the `DockerRunner` for ephemeral commands and the `DockerBackgroundExec` utilizing `atexit.register(self.stop)` to retain high performance via a daemon container.
- **Next Action (Session 12):** Start with **Language Toolchains (`toolchains/*.py`)** (Complexity 45/100) and **Sysroot Symlink Farm (`sysroot.py`)** (Complexity 50/100).

**Session 12 Handover (Completed)**

- Implemented `scripts/core/toolchains/rust.py`, `golang.py`, `python.py`, `swift.py`, and `zig.py` to handle cross-compilation environment variables and arguments for Android.
- Implemented `scripts/core/sysroot.py` to manage the Content-Addressable Store (CAS) cache and generate fast symlink farms into the active `$PREFIX`.
- Added strict `fetch_source()` logic with tarball extraction and SHA256 validation to prepare for hermetic builds.
- Wrote and passed comprehensive unit tests via `pytest` for all newly added logic components.
- **Next Action (Session 13):** Start with **Debian Packager (`debian.py` - Base)** (Complexity 50/100), **Pacman Packager (`pacman.py`)** (Complexity 50/100), and **Alpine Packager (`apk.py`)** (Complexity 50/100).

**Session 13 Handover (Completed)**

- Implemented `scripts/core/packagers/debian.py` utilizing standard `zstd` compression.
- Implemented `scripts/core/packagers/pacman.py` handling `.pkg.tar.zst` format and `.PKGINFO` files natively.
- Implemented `scripts/core/packagers/apk.py` handling Alpine specific concatenated `gzip` archive generation (.apk).
- Implemented `scripts/core/packagers/cleanup.py` combining PIE enforcement, sbin merging, and ghost directory pruning into reusable functions for all three packagers.
- Refactored `scripts/build.py` orchestrator to natively import the new packaging methods.
- Addressed previous code review feedback by rewriting the Alpine generator to use valid concatenated streams and ensuring test files throw exceptions instead of skipping over code faults.
- **Next Action (Session 14):** Start with **Advanced Metadata Schema (`parser.py` - Metadata)** (Complexity 55/100) and **CI Workflow: build.yml (Base)** (Complexity 55/100).

**Session 14 Handover (Completed)**

- Updated `build.yml` workflow triggers to strictly execute on the `main` branch.
- Implemented Pydantic validators in `scripts/core/parser.py` to enforce strict architecture naming for `excluded_arches` and relative paths for `conffiles` and `no_shebang_fix_files`.
- Updated `test_repo.py` to accurately resolve the `repo.yml` location independent of execution context.
- **Next Action (Session 15):** Start with **CI Workflow: publish.yml** (Complexity 55/100) and **Git History Version Validation (`parser.py` - Continuity)** (Complexity 60/100).

**Session 15 Handover (Completed)**

- Implemented `.github/workflows/publish.yml` to download all generated artifacts from GitHub Releases, inject dual keys (`GPG_PRIVATE_KEY` and `ALPINE_PRIVATE_KEY`) into `scripts/keys/`, attest build provenance via `actions/attest-build-provenance`, and deploy metadata to GitHub Pages.
- Addressed `scripts/site/install` TODOs, adding complete functional configuration code to add RepoExe repositories, fetch keys, and run updates for APT, Pacman, and APK.
- Updated `parser.py` to enforce version bumps by validating via `git ls-remote` if the specific release tag already exists upstream, failing the build if it does.
- Cleaned up temp scripts and formatted with Ruff and Prettier.
- **Next Action (Session 16):** Start with **DAG Core Resolver (`dag.py` - Core)** (Complexity 60/100) and **Implicit Cleanup Standards (`debian.py` - Cleanup)** (Complexity 60/100).

**Session 16 Handover (Completed)**

- Updated `DAG.get_shards` logic in `scripts/core/dag.py` to place isolated components into their own dedicated runners, correctly handling `isolated_shard` boolean tags.
- Added implicit cleanup standard support: `debian.py` now implements Smart Subpackages by splitting off `doc` and `locale` data into isolated `.deb` archives (e.g. `hello-doc`).
- Verified `cleanup.py` components, cache trimming, ghost pruning, and proper `-glibc` suffix application via `deb_version` across base and subpackages.
- Fixed an issue with `ar` archive generation where member paths were absolute. All `.deb` artifacts are now created correctly.
- Addressed pytest failures, creating comprehensive tests for the sharding logic and subpackage extraction routines.
- Noted in `plan.md` that a `publish.yml` failure following a successful `build.yml` can be safely retried manually, since release tags are created during the build phase and `publish.yml` is stateless.
- **Next Action (Session 17):** Start with **Migrate: aapt, aapt2, zipalign, aidl** (Complexity 60/100) and **Android Patching & Validation** (Complexity 65/100).

**Session 17 Handover (Completed)**

- Implemented "Local Source Building" structural layout for deprecated `aapt` (in `packages/aapt/src/`) applying standard bloat-free patches.
- Recreated `build.yml` files for `aapt2`, `zipalign`, and `aidl` directly embedding `sources.sh` logic to natively map legacy variables, dynamically fetching the latest source code from git tags in `pre_fetch` phases.
- Integrated comprehensive Android Patching & Validation routines inside `scripts/core/packagers/cleanup.py` encompassing `termux-elf-cleaner`, PIE compliance checking, Linux hardcoded paths replacements, `llvm-strip` debug symbol extraction, SONAME enforcement, and strict Bionic symbol validation checks.
- Addressed `config.guess` and `config.sub` auto-updating inside `scripts/core/sysroot.py`.
- Formatted newly added python scripts through strict pre-commit linters using `uv` and `ruff`.

- **Next Action (Session 18):** Start with **CI Workflow: package_updates.yml** (Complexity 65/100) and **Source Mirroring & Git Submodules (`sysroot.py` - Advanced)** (Complexity 70/100).
