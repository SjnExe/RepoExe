# RepoExe Refactoring Checklist & Session Handover

This file tracks the execution of the massive refactoring effort outlined in `plan.md`.
**Agent Directive:** At the start of a session, review this checklist. At the end of a session, check off the completed items and write a brief summary of what to do next for the following agent.

## Phase 1: Environment & Foundation Setup
- [ ] **Dual-Key Architecture Setup**: Provide the repository owner with clear Termux terminal commands to generate fresh GPG (for APT/Pacman) and RSA (for Alpine) keys. Explicitly instruct them which private keys to upload as GitHub Secrets (`GPG_PRIVATE_KEY`, `ALPINE_PRIVATE_KEY`), which public keys to commit to the repository, and advise them to securely backup their private keys before deleting local `.key` files, as GitHub Secrets are write-only.
- [ ] Initialize repository structure (dotfiles, `.github/` folder, `site/install`).
- [ ] Configure Local Pre-commit Hooks (`.pre-commit-config.yaml`) for automated formatting checks.
- [ ] Create `SECURITY.md`, `CONTRIBUTING.md`, `FUNDING.yml`, `stale.yml`, and `dependabot.yml`.
- [ ] Set up the `.prettierrc` (strict format for AI) and `.prettierignore`.
- [ ] Write the `Dockerfile` (Ubuntu 24.04, non-root `builder`, built-in `sccache` configured with GitHub Actions Cache API chunking).
- [ ] Implement DevContainers (`.devcontainer/devcontainer.json`) for web-based IDEs with pre-configured linters.
- [ ] Download NDK 29 and bake standard NDK patches directly into a Docker layer.
- [ ] Install formatting/linting stack inside Docker (`uv`, `ruff`, `mypy`, `shellcheck`, `actionlint`). Configure `--ai-mode` JSON formatting support.

## Phase 2: Python Orchestrator (`scripts/core/`)
- [ ] Establish the `scripts/pyproject.toml` and lock dependencies via `uv` (must include `pydantic`). Set up the local mock server for `upstream_check.py` to facilitate AI testing.
- [ ] Implement `parser.py`: Parse `build.yml` using strict Pydantic data models. Replicate legacy `lint-packages.sh` checks by validating Licenses against an allowlist, standardizing `source_url` formatting, and enforcing Version Continuity via Git history lookups. Enforce Advanced Metadata Schema (`conffiles`, `essential`, `service_script`, `alternatives`, `revision`, `anti_build_depends`, `no_shebang_fix_files`, `no_staticsplit`, `excluded_arches`, `build_in_src`, `pre_depends`, `build_multilib`, `no_elf_cleaner`, `host_build`, `lto`, `pgo`, `auto_update`, `platform_independent`, `inherits`, `isolated_shard`, `cmake_args`, `groups`, `optdepends`). Strip all "on-device" build logic. Validate GPG signatures of source tarballs where applicable.
- [ ] Implement `properties.py`: Define explicit internal `PREFIX` bounds for the device layout (enforcing `/data/data/com.termux/files/usr`).
- [ ] Implement `dag.py`: Resolve dependencies, read `isolated_shard` boolean tags, generate matrix shards, natively handle `anti_build_depends` to strictly uninstall conflicting dependencies on CI runners, and output lightweight Dependency Graphs (JSON/Mermaid) for debugging. Implement Telemetry-Driven Dynamic Sharding to balance execution times.
- [ ] Implement Content-Addressable Hashing Engine: Incorporate strict SHA256 "state hash" evaluation across package inputs (YAML, patches, source, downstream deps) to aggressively skip redundant builds.
- [ ] Implement Auto-Revision Management: Enable the orchestrator to automatically calculate revision bumps down the DAG when upstream dependencies trigger rebuilds.
- [ ] Implement `toolchains` submodules (`toolchains/rust.py`, `toolchains/python.py`, etc.): Handle language-specific environment logic and legacy Termux patches natively in Python.
- [ ] Implement `toolchains/native.py`: Select NDK 29 compilers based on architecture. Inject `PREFIX` dynamically into `CFLAGS`, `CPPFLAGS`, and `LDFLAGS`. Includes native build wrappers (CMake, Meson, Autotools) and dynamically generates `android.toolchain.cmake` overrides.
- [ ] Implement `docker.py`: Wrap execution commands to run purely inside the `builder` container. Ensure Hermetic Sandboxing by disabling network access during compilation. Integrate strict Bubblewrap (`bwrap`) jail boundaries for compilation steps (`make`, `configure`), selectively mounting only the sysroot, source directory, and `$DESTDIR`. Natively mount `binfmt_misc` and `qemu-user-static` for transparent emulation of compiled Android binaries. Handle mapped volume permissions deterministically, and securely propagate cancellation signals.
- [ ] Implement `debian.py`: Handle `.deb` file generation using `zstd` compression. Implement Implicit Cleanup Standardization (Automated Cache Trimming, Permissions Normalization, Ghost Directory Pruning, `sbin` merging, Strict PIE Enforcement, Documentation Compression via `gzip`, Strict Stripping via `llvm-strip`, and Libtool `.la` File Removal). Add Post-Processing Determinism by running `strip-nondeterminism` across generated archives. Dynamically apply `-glibc` suffixes based on `libc` environment, automatically generate `-doc` and `-locale` Smart Subpackages (linked via `Recommends`), natively implement custom Python-based static APT metadata generation (`Packages`, `Release`), and automate SBOM (SPDX/CycloneDX) generation.
- [ ] Implement `pacman.py`: Handle `.pkg.tar.zst` file generation using `zstd` and Pacman database (`.db`) generation. Implement the same Smart Subpackaging, dynamic `-glibc` suffixing, Post-Processing Determinism via `strip-nondeterminism`, and SBOM generation as Debian.
- [ ] Implement `apk.py`: Handle `.apk` file generation and Alpine index (`APKINDEX.tar.gz`) generation. Natively support appending Alpine RSA signatures to `.apk` files and signing the index using the securely injected `.rsa` private key. Implement the same Smart Subpackaging, dynamic `-glibc` suffixing, and SBOM generation as Debian.
- [ ] Implement `sysroot.py`: Implement a **Symlink Farm Sysroot** acting as a strict **Content-Addressable Store** to rapidly generate links into the `$PREFIX` from a read-only cache and avoid collisions. Integrate upstream GPG signature validation for downloads, support recursive Git submodule initialization, and implement Upstream Source Mirroring to automatically cache fetched tarballs to a GitHub Releases repository to prevent link rot.
- [ ] Implement Android Patching & Validation: Automatic `config.guess` updates, Linux hardcoded path fixing, `termux-elf-cleaner`, `-dbg` symbol extraction via `llvm-objcopy`, strict Bionic Undefined Symbols validation, strict SONAME enforcement using `readelf`, and strict Patch Application enforcement (no fuzzy matching).
- [ ] Implement Ghost Dependency Detection: Cross-reference `dpkg-shlibdeps` output against the YAML `Depends` array after `make_install` and throw strict linting errors for unused dependencies.
- [ ] Implement Automated ABI Breakage Detection: Integrate `libabigail` validation to automatically trigger DAG revision bumps when library interfaces change.
- [ ] Implement Hybrid Build execution in `build.py`: Support both strict declarative targets and wrapper-based executions. Ensure the `pre_fetch` lifecycle hook runs *before* the network is disabled for Hermetic Sandboxing. Include the `crash_report.json` generation handler for optimized debugging. Instrument **OpenTelemetry (OTel)** tracing to stream build phase execution durations to an observability backend. Handle the 3-stage PGO instrumentation automatically.
- [ ] Implement `test.py`: Execute tests inside a Multi-Environment setup (native Android Termux simulation via nested PRoot, PRoot Distro simulation, and explicit support for running tests over `adb` on a real Android emulator).
- [ ] Implement `health.py`: Cron job logic for version matching, missing artifacts, and zombie pruning (replacing `check-repository-health.js` and `check-built-packages.py`).
- [ ] Setup `pytest` test suite (`scripts/tests/`) to unit test the Python orchestrator.
- [ ] Configure Pydantic to export JSON Schema for `build.yml` and integrate with `.vscode/settings.json` for YAML IDE Intellisense.
- [ ] Implement `upstream_check.py`: Automated pinging for new upstream releases, including fallback mechanisms for strict GitLab HTTP 403 blocks.
- [ ] Wire everything together in the CLI entrypoint `scripts/build.py` (include subcommands `info`, `list`, `clean`, `init` for interactive scaffolding, and `--dry-run` flag). Include Sigstore/Cosign keyless binary and metadata signing capabilities.

## Phase 3: CI/CD Workflows (`.github/workflows/`)
- [ ] Implement strict `uv` caching across all Python CI/CD workflows.
- [ ] Write `build.yml`: Dynamic Matrix Sharding (`architectures x shards`), PR Test Mode, and the `!{package}` exclusion syntax.
- [ ] Write `python-tests.yml`: CI workflow executing the `pytest` test suite for the orchestrator, integrating `pytest-cov` and rendering GitHub Step Summaries.
- [ ] Write `cache-prune.yml`: Strict GitHub Actions and GHCR cache eviction workflow leveraging LRU logic.
- [ ] Write `lint.yml`: Implement Self-Healing CI that auto-runs `ruff` and `prettier` and pushes fix commits.
- [ ] Write `publish.yml`: Strictly separated from `build.yml`. Downloads artifacts, verifies them, securely injects `GPG_PRIVATE_KEY` and `ALPINE_PRIVATE_KEY` for artifact/metadata signing, generates SLSA Provenance using GitHub Actions native `actions/attest-build-provenance`, and publishes ONLY if the whole matrix passes. Ensure the static APT/Pacman/Alpine metadata hosting enforces **TUF (The Update Framework)** principles.
- [ ] Write `health.yml`: Cron job executing `health.py`.
- [ ] Write `package_updates.yml`: Auto-PR workflow triggered by `upstream_check.py`.
- [ ] Setup `release-please` or `semantic-release`: Implement automated changelog generation and version bumping based on Conventional Commits.
- [ ] Write `reproducible.yml`: Manual workflow leveraging `diffoscope` to verify bit-for-bit build determinism.
- [ ] Implement Multi-Runner Consensus: Update CI workflows so that "essential" or cryptographic packages dynamically spawn two independent runners and require bit-for-bit identical hashes before publishing.
- [ ] Implement `free-space.sh` fast-deletion logic at the start of workflows.
- [ ] Write `emulator-test.yml`: A nightly/release CI workflow to spin up `reactivecircus/android-emulator-runner` on a Linux KVM runner, install the Termux APK via `adb`, and run integration tests directly inside a real Android environment.
- [ ] Write `security-scan.yml`: Integrate `osv-scanner` or `pip-audit` to proactively scan dependencies for known vulnerabilities.

## Phase 4: Package Migration
- [ ] Migrate `repoexe-keyring` and `repoexe-dev` (foundational metadata and component opt-in packages).
- [ ] Migrate `libandroid-tools` (split into granular sub-packages).
- [ ] Migrate `aapt` (Implement "Local Source Building").
- [ ] Migrate `aapt2`, `aidl`, and `zipalign`.
- [ ] Ensure Smart Subpackaging correctly intercepts and isolates `man` pages and `locale` data without requiring manual YAML definitions.
- [ ] Ensure test phases are converted to declarative YAML testing hooks.

## Phase 5: Documentation & Final Handover
- [ ] Create the `docs/` folder with sample `build.yml` templates for standard packages, metapackages, and multi-architecture setups.
- [ ] Write a comprehensive `docs/SCHEMA.md` documenting every YAML field, flag, and lifecycle hook to prevent user confusion.
- [ ] Setup `mkdocs-material` to generate a searchable documentation site hosted under the `/docs` subpath on GitHub Pages.

---

## Current Session Notes / Handover
*Write a short summary below when ending a session so the next AI agent knows exactly where to pick up.*

**Status:** Ready to begin Phase 1. The validation session has been completed, and `plan.md` has been updated with Smart Rebuilds, Dependency Graph Visualizers, automated revisions, `apk` format support, Hermetic `pre_fetch` phases, telemetry generation, binary signing, interactive scaffolding, strict `bwrap` sandboxing, GitHub Releases source mirroring, and Multi-Runner Consensus.
**Next Action:** Begin creating the foundational repository structure, dotfiles, and GitHub templates.
