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
- [x] [Complexity: 20/100] **Migrate: repoexe-keyring & repoexe-dev**: Base component opt-in packages.
- [x] [Complexity: 25/100] **Docker NDK & Caching**: Download NDK 29, bake standard NDK patches directly into a Docker layer, and configure `sccache` with GitHub Actions Cache API chunking.
- [x] [Complexity: 25/100] **Properties Module (`properties.py`)**: Define explicit internal `PREFIX` bounds for the device layout (`/data/data/com.termux/files/usr`).
- [x] [Complexity: 25/100] **Repository Configurations (`repo.yml`)**: Implement `scripts/repo.yml` to define external repository endpoints (Termux/TUR), their GPG keys, and their component layouts for dynamic fallback dependency resolution.
- [x] [Complexity: 30/100] **YAML Pydantic Parser (`parser.py` - Core)**: Implement basic Pydantic parsing of `build.yml` schema, License allowlist validation, and standardized `source_url` formatting.
- [x] [Complexity: 30/100] **CI Workflow: lint.yml**: Implement Self-Healing CI that auto-runs `ruff` and `prettier` and pushes fix commits.
- [x] [Complexity: 30/100] **CI Workflow: python-tests.yml**: CI workflow executing the `pytest` test suite for the orchestrator, integrating `pytest-cov` and rendering GitHub Step Summaries.
- [x] [Complexity: 30/100] **CI Workflow: cache-prune.yml**: Handled. GitHub natively manages action caches via LRU. GHCR pruning logic should be integrated into the upcoming `docker.yml` workflow as a specific step instead of creating a separate workflow.
- [x] [Complexity: 35/100] **CI Workflow: security-scan.yml**: Integrate `osv-scanner` or `pip-audit` to proactively scan dependencies for known vulnerabilities.
- [x] [Complexity: 35/100] **CI Workflow: free-space.sh**: Implement hyper-fast `rm -rf` logic for massive unused toolchains on GitHub Host VMs.
- [ ] [Complexity: 40/100] **Version Normalization (`parser.py` - Versions)**: Strictly strip `v` prefixes, and translate upstream revisions into PM-specific dialects (`+r4` for Debian, `.r4` for Pacman, `_p4` for Alpine).
- [ ] [Complexity: 40/100] **CLI Subcommands (`build.py` - CLI)**: Wire basic subcommands `info`, `list`, `clean`, `init` for interactive scaffolding, and `--dry-run` flag.
- [x] [Complexity: 40/100] **Test Execution Sandbox (`test.py`)**: Execute tests inside PRoot / PRoot Distro isolation, implementing Flaky Test Isolation.
- [x] [Complexity: 40/100] **Migrate: libandroid-tools**: Split into granular sub-packages (`libbase`, `libcutils`, etc.).
- [ ] [Complexity: 45/100] **Native Toolchains (`toolchains/native.py`)**: Select NDK compilers based on arch, inject `PREFIX` into `CFLAGS`/`LDFLAGS`, implement CMake/Meson/Autotools wrappers, and generate `android.toolchain.cmake`.
- [ ] [Complexity: 45/100] **Docker Wrapper (`docker.py`)**: Wrap execution commands in `builder` container, handle mapped volume permissions deterministically, and propagate cancellation signals.
- [ ] [Complexity: 45/100] **Language Toolchains (`toolchains/*.py`)**: Handle Rust, Python, Go environment logic natively in Python submodules.
- [ ] [Complexity: 50/100] **Sysroot Symlink Farm (`sysroot.py`)**: Implement Content-Addressable Store caching for the `$PREFIX` to rapidly generate links without I/O disk copies.
- [ ] [Complexity: 50/100] **Debian Packager (`debian.py` - Base)**: Handle `.deb` generation (`zstd`), `sbin` merging, PIE enforcement, gzip docs, and libtool `.la` removal.
- [ ] [Complexity: 50/100] **Pacman Packager (`pacman.py`)**: Handle `.pkg.tar.zst` and database (`.db`) generation using `zstd`.
- [ ] [Complexity: 50/100] **Alpine Packager (`apk.py`)**: Handle `.apk` and `APKINDEX.tar.gz` generation.
- [ ] [Complexity: 55/100] **Advanced Metadata Schema (`parser.py` - Metadata)**: Enforce advanced flags (`conffiles`, `essential`, `anti_build_depends`, `no_shebang_fix_files`, `no_staticsplit`, `excluded_arches`, `build_in_src`, `pre_depends`, `build_multilib`, `no_elf_cleaner`, `host_build`, `lto`, `pgo`).
- [ ] [Complexity: 55/100] **CI Workflow: build.yml (Base)**: Dynamic Matrix Sharding (`architectures x shards`), strictly triggered on `push`/`PR` to `main`.
- [ ] [Complexity: 55/100] **CI Workflow: publish.yml**: Publish workflow separated from `build.yml`. Verify artifacts, inject signing keys, publish metadata to Pages.
- [ ] [Complexity: 60/100] **Git History Version Validation (`parser.py` - Continuity)**: Implement Git history lookups (`git show origin/main...`) to strictly enforce version/revision incrementation.
- [ ] [Complexity: 60/100] **DAG Core Resolver (`dag.py` - Core)**: Resolve dependencies, read `isolated_shard` boolean tags, and generate matrix shards.
- [ ] [Complexity: 60/100] **Implicit Cleanup Standards (`debian.py` - Cleanup)**: Auto-cache trimming, permissions normalization, ghost directory pruning, `-glibc` dynamic suffixing, and auto `-doc`/`-locale` Smart Subpackages.
- [x] [Complexity: 60/100] **Migrate: aapt & aapt2**: Implement "Local Source Building".
- [ ] [Complexity: 65/100] **Android Patching & Validation**: Auto `config.guess` updates, Linux hardcoded path fixes, `termux-elf-cleaner`, `-dbg` symbol extraction, strict Bionic Undefined Symbols validation, strict SONAME enforcement.
- [ ] [Complexity: 65/100] **CI Workflow: package_updates.yml**: Auto-PR workflow triggered by scheduled `upstream_check.py`.
- [ ] [Complexity: 65/100] **CI Workflow: promote.yml**: Automated cron job to promote staged updates from `dev` component to `main` component based on dynamic `promote_days`.
- [ ] [Complexity: 70/100] **Source Mirroring & Git Submodules (`sysroot.py` - Advanced)**: Validate GPG signatures, auto-mirror fetched tarballs to GitHub Releases, natively clone upstream Git branches, and handle recursive submodules.
- [ ] [Complexity: 70/100] **Repository Health Core (`health.py`)**: Cron job logic validating sync between YAML and Pages, flagging zombie packages, and Release Asset Pruning (keep last 5 versions).
- [ ] [Complexity: 75/100] **Hermetic Docker Sandbox (`docker.py` - Strict)**: Disable network access during compilation. Integrate strict Bubblewrap (`bwrap`) jail boundaries, natively mount `binfmt_misc` / `qemu-user-static` for transparent emulation.
- [ ] [Complexity: 75/100] **Hybrid Build Engine (`build.py` - Runner)**: Execute structured declarative targets vs wrappers. Ensure `pre_fetch` hook runs _before_ Hermetic sandboxing. Instrument OpenTelemetry and generate `crash_report.json`.
- [ ] [Complexity: 80/100] **DAG Telemetry & Anti-Deps (`dag.py` - Advanced)**: Telemetry-driven dynamic sharding to balance execution times. Natively handle `anti_build_depends` to strictly uninstall conflicting dependencies on runners. Output Dependency Graphs.
- [ ] [Complexity: 80/100] **Ghost Dependency & ABI Detection**: Run `dpkg-shlibdeps` against `Depends` array to lint unused dependencies. Integrate `libabigail` validation for ABI breakage.
- [ ] [Complexity: 85/100] **Static APT Generator (`debian.py` - APT)**: Natively implement Python-based custom static APT metadata generation (`Packages`, `Release`, `InRelease`) entirely replacing `aptly`.
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
- Migrated `repoexe-keyring` and `repoexe-dev` to the new Pydantic YAML schema under `packages/`.
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

- Updated `Dockerfile` to include `proot` in the standard build environment.
- Updated `plan.md` to scope tests strictly to `proot` instead of flaky Android Emulators, per user input.
- Implemented `scripts/core/test.py` Test Execution Sandbox which uses Python `subprocess` to launch a simulated Termux Rootfs environment via `proot` and injects standard legacy test assertions. Wrote unit tests for it.
- Migrated `libandroid-tools` to the new Pydantic schema structure (`packages/libandroid-tools/build.yml`). Replaced multiple custom git checkouts with a script in `phases: pre_fetch`. Preserved all compilation custom flags and patches in the declarative `make` phases.
- Updated `scripts/core/parser.py` schema with a `subpackages` property that expects a dictionary of includes (e.g. `libbase: { includes: ["lib/*"] }`) to support the libandroid-tools migration.
- **Next Action (Session 10):** Start with **Native Toolchains (`toolchains/native.py`)** (Complexity 45/100) and **Docker Wrapper (`docker.py`)** (Complexity 45/100).
