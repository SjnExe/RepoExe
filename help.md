# RepoExe Refactoring Checklist & Session Handover

This file tracks the execution of the massive refactoring effort outlined in `plan.md`.
**Agent Directive:** At the start of a session, review this checklist. At the end of a session, check off the completed items and write a brief summary of what to do next for the following agent.

## Phase 1: Environment & Foundation Setup
- [ ] Initialize repository structure (dotfiles, `.github/` folder, `site/install`).
- [ ] Configure Local Pre-commit Hooks (`.pre-commit-config.yaml`) for automated formatting checks.
- [ ] Create `SECURITY.md`, `CONTRIBUTING.md`, `FUNDING.yml`, `stale.yml`, and `dependabot.yml`.
- [ ] Set up the `.prettierrc` (strict format for AI) and `.prettierignore`.
- [ ] Write the `Dockerfile` (Ubuntu 24.04, non-root `builder`, built-in `sccache`).
- [ ] Implement DevContainers (`.devcontainer/devcontainer.json`) for web-based IDEs with pre-configured linters.
- [ ] Download NDK 29 and bake standard NDK patches directly into a Docker layer.
- [ ] Install formatting/linting stack inside Docker (`uv`, `ruff`, `mypy`, `shellcheck`, `actionlint`). Configure `--ai-mode` JSON formatting support.

## Phase 2: Python Orchestrator (`scripts/core/`)
- [ ] Establish the `scripts/pyproject.toml` and lock dependencies via `uv` (must include `pydantic`). Set up the local mock server for `upstream_check.py` to facilitate AI testing.
- [ ] Implement `parser.py`: Parse `build.yml` using strict Pydantic data models. Replicate legacy `lint-packages.sh` checks by validating Licenses against an allowlist, standardizing `source_url` formatting, and enforcing Version Continuity via Git history lookups. Enforce Advanced Metadata Schema (`conffiles`, `essential`, `service_script`, `alternatives`, `revision`, `anti_build_depends`, `no_shebang_fix_files`, `no_staticsplit`, `excluded_arches`, `build_in_src`, `pre_depends`, `build_multilib`, `no_elf_cleaner`, `host_build`, `lto`, `pgo`, `auto_update`, `platform_independent`, `inherits`, `isolated_shard`, `cmake_args`, `groups`, `optdepends`). Strip all "on-device" build logic. Validate GPG signatures of source tarballs where applicable.
- [ ] Implement `properties.py`: Define explicit internal `PREFIX` bounds for the device layout (enforcing `/data/data/com.termux/files/usr`).
- [ ] Implement `dag.py`: Resolve dependencies, read `isolated_shard` boolean tags, generate matrix shards, and output lightweight Dependency Graphs (JSON/Mermaid) for debugging. Implement Telemetry-Driven Dynamic Sharding to balance execution times.
- [ ] Implement Content-Addressable Hashing Engine: Incorporate strict SHA256 "state hash" evaluation across package inputs (YAML, patches, source, downstream deps) to aggressively skip redundant builds.
- [ ] Implement Auto-Revision Management: Enable the orchestrator to automatically calculate revision bumps down the DAG when upstream dependencies trigger rebuilds.
- [ ] Implement `toolchains` submodules (`toolchains/rust.py`, `toolchains/python.py`, etc.): Handle language-specific environment logic and legacy Termux patches natively in Python.
- [ ] Implement `toolchains/native.py`: Select NDK 29 compilers based on architecture. Inject `PREFIX` dynamically into `CFLAGS`, `CPPFLAGS`, and `LDFLAGS`. Includes native build wrappers (CMake, Meson, Autotools).
- [ ] Implement `docker.py`: Wrap execution commands to run purely inside the `builder` container. Ensure Hermetic Sandboxing by disabling network access during compilation. Natively mount `binfmt_misc` and `qemu-user-static` for transparent emulation of compiled Android binaries. Handle mapped volume permissions deterministically, and securely propagate cancellation signals.
- [ ] Implement `debian.py`: Handle `.deb` file generation using `zstd` compression, automatically merge `sbin` into `bin`, dynamically apply `-glibc` suffixes based on `libc` environment, automatically generate `-doc` and `-locale` Smart Subpackages (linked via `Recommends`), natively implement custom Python-based static APT metadata generation (`Packages`, `Release`), and automate SBOM (SPDX/CycloneDX) generation.
- [ ] Implement `pacman.py`: Handle `.pkg.tar.zst` file generation using `zstd` and Pacman database (`.db`) generation. Implement the same Smart Subpackaging, dynamic `-glibc` suffixing, and SBOM generation as Debian.
- [ ] Implement `apk.py`: Handle `.apk` file generation and Alpine index (`APKINDEX.tar.gz`) generation. Implement the same Smart Subpackaging, dynamic `-glibc` suffixing, and SBOM generation as Debian.
- [ ] Implement `sysroot.py`: Implement a **Symlink Farm Sysroot** to rapidly generate links into the `$PREFIX` from a read-only cache, avoiding slow I/O. Integrate upstream GPG signature validation for downloads.
- [ ] Implement Android Patching & Validation: Automatic `config.guess` updates, Linux hardcoded path fixing, `termux-elf-cleaner`, `-dbg` symbol extraction via `llvm-objcopy`, and strict Bionic Undefined Symbols validation using `readelf`.
- [ ] Implement Ghost Dependency Detection: Cross-reference `dpkg-shlibdeps` output against the YAML `Depends` array after `make_install` and throw strict linting errors for unused dependencies.
- [ ] Implement Automated ABI Breakage Detection: Integrate `libabigail` validation to automatically trigger DAG revision bumps when library interfaces change.
- [ ] Implement Hybrid Build execution in `build.py`: Support both strict declarative targets and wrapper-based executions. Ensure the `pre_fetch` lifecycle hook runs *before* the network is disabled for Hermetic Sandboxing. Include the `crash_report.json` generation handler for optimized debugging. Implement generation of the `telemetry.json` file for performance profiling.
- [ ] Implement `test.py`: Execute tests inside a Dual-Environment setup (native Android Termux simulation and PRoot Distro simulation) to catch edge-case bugs.
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
- [ ] Write `publish.yml`: Strictly separated from `build.yml`. Downloads artifacts, verifies them, generates SLSA Provenance using GitHub Actions native `actions/attest-build-provenance`, and publishes ONLY if the whole matrix passes.
- [ ] Write `health.yml`: Cron job executing `health.py`.
- [ ] Write `package_updates.yml`: Auto-PR workflow triggered by `upstream_check.py`.
- [ ] Write `reproducible.yml`: Manual workflow leveraging `diffoscope` to verify bit-for-bit build determinism.
- [ ] Implement `free-space.sh` fast-deletion logic at the start of workflows.

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

**Status:** Ready to begin Phase 1. The validation session has been completed, and `plan.md` has been updated with Smart Rebuilds, Dependency Graph Visualizers, automated revisions, `apk` format support, Hermetic `pre_fetch` phases, telemetry generation, binary signing, and interactive scaffolding.
**Next Action:** Begin creating the foundational repository structure, dotfiles, and GitHub templates.
