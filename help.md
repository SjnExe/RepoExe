# RepoExe Refactoring Checklist & Session Handover

This file tracks the execution of the massive refactoring effort outlined in `plan.md`.
**Agent Directive:** At the start of a session, review this checklist. At the end of a session, check off the completed items and write a brief summary of what to do next for the following agent.

## Phase 1: Environment & Foundation Setup
- [ ] Initialize repository structure (dotfiles, `.github/` folder, `site/install`).
- [ ] Create `SECURITY.md`, `CONTRIBUTING.md`, `FUNDING.yml`, `stale.yml`, and `dependabot.yml`.
- [ ] Set up the `.prettierrc` (strict format for AI) and `.prettierignore`.
- [ ] Write the `Dockerfile` (Ubuntu 24.04, non-root `builder`, built-in `sccache`).
- [ ] Download NDK 29 and bake standard NDK patches directly into a Docker layer.
- [ ] Install formatting/linting stack inside Docker (`ruff`, `mypy`, `shellcheck`, `actionlint`).

## Phase 2: Python Orchestrator (`scripts/core/`)
- [ ] Establish the `scripts/requirements.txt` (must include `pydantic`).
- [ ] Implement `parser.py`: Parse `package.yml` using strict Pydantic data models, validate Licenses against allowlist (replacing `lint-packages.sh`). Enforce Advanced Metadata Schema (`conffiles`, `essential`, `service_script`, `alternatives`, `revision`, `anti_build_depends`, `no_shebang_fix_files`, `no_staticsplit`, `excluded_arches`, `build_in_src`, `pre_depends`, `build_multilib`, `no_elf_cleaner`, `host_build`, `auto_update`, `platform_independent`, `inherits`, `cmake_args`, `groups`, `optdepends`). Strip all "on-device" build logic.
- [ ] Implement `properties.py`: Define explicit internal `PREFIX` bounds for the device layout.
- [ ] Implement `dag.py`: Resolve dependencies, handle massive isolated packages (Chromium), generate matrix shards, and output lightweight Dependency Graphs (JSON/Mermaid) for debugging. (Reference `backup/scripts/buildorder.py` for legacy logic, but heavily adapt for hybrid upstream/local resolution).
- [ ] Implement Smart Hashing Engine: Incorporate strict SHA256 "state hash" evaluation across package inputs (YAML, patches, source, downstream deps) to aggressively skip redundant builds.
- [ ] Implement Auto-Revision Management: Enable the orchestrator to automatically calculate revision bumps down the DAG when upstream dependencies trigger rebuilds.
- [ ] Implement `toolchains.py`: Select NDK 29 compilers based on architecture. Inject `PREFIX` dynamically into `CFLAGS`, `CPPFLAGS`, and `LDFLAGS`.
- [ ] Implement native build wrappers (CMake, Meson, Autotools) in `toolchains.py`.
- [ ] Implement specialized language environments (Rust/Cargo, Golang, Python/Crossenv, Zig, Swift) and config wrappers (llvm-config, pg_config) in `toolchains.py`.
- [ ] Implement `docker.py`: Wrap execution commands to run purely inside the `builder` container, ensuring the custom Seccomp/AppArmor profiles are mounted.
- [ ] Implement `debian.py`: Handle `.deb` file generation using `zstd` compression, automatically merge `sbin` into `bin`, automatically generate `-doc` and `-locale` Smart Subpackages (linked via `Recommends`), and natively implement custom Python-based static APT metadata generation (`Packages`, `Release`) for GitHub Pages to replace `aptly_api.sh` / `apt-ftparchive`.
- [ ] Implement `pacman.py`: Handle `.pkg.tar.zst` file generation using `zstd` and Pacman database (`.db`) generation. Implement the same Smart Subpackaging defaults for documentation/locales as Debian.
- [ ] Implement `sysroot.py`: Extract downloaded dependencies into an isolated `$PREFIX` mock directory for compilation sandboxing.
- [ ] Implement Android Patching: Automatic `config.guess` updates, Linux hardcoded path fixing, `termux-elf-cleaner`, `-dbg` symbol extraction via `llvm-objcopy`, and strict Bionic Undefined Symbols validation using `readelf`.
- [ ] Implement `test.py`: Parse and execute assertions inside the Docker environment for packages defining a `test` phase.
- [ ] Implement `health.py`: Cron job logic for version matching, missing artifacts, and zombie pruning (replacing `check-repository-health.js` and `check-built-packages.py`).
- [ ] Implement `upstream_check.py`: Automated pinging for new upstream releases.
- [ ] Wire everything together in the CLI entrypoint `scripts/build.py` (include subcommands `info`, `list`, and `clean`).

## Phase 3: CI/CD Workflows (`.github/workflows/`)
- [ ] Write `build.yml`: Dynamic Matrix Sharding (`architectures x shards`), PR Test Mode, and the `!{package}` exclusion syntax.
- [ ] Write `lint.yml`: Implement Self-Healing CI that auto-runs `ruff` and `prettier` and pushes fix commits.
- [ ] Write `publish.yml`: Strictly separated from `build.yml`. Downloads artifacts, verifies them, generates SLSA Provenance, and publishes ONLY if the whole matrix passes.
- [ ] Write `health.yml`: Cron job executing `health.py`.
- [ ] Write `package_updates.yml`: Auto-PR workflow triggered by `upstream_check.py`.
- [ ] Implement `free-space.sh` fast-deletion logic at the start of workflows.

## Phase 4: Package Migration
- [ ] Migrate `libandroid-tools` (split into granular sub-packages).
- [ ] Migrate `aapt` (Implement "Local Source Building").
- [ ] Migrate `aapt2`, `aidl`, and `zipalign`.
- [ ] Ensure Smart Subpackaging correctly intercepts and isolates `man` pages and `locale` data without requiring manual YAML definitions.
- [ ] Ensure test phases are converted to declarative YAML testing hooks.

## Phase 5: Documentation & Final Handover
- [ ] Create the `docs/` folder with templates (`standard.yml`, `metapackage.yml`, `multi-architecture.yml`).
- [ ] Write a comprehensive `docs/SCHEMA.md` documenting every YAML field, flag, and lifecycle hook to prevent user confusion.

---

## Current Session Notes / Handover
*Write a short summary below when ending a session so the next AI agent knows exactly where to pick up.*

**Status:** Ready to begin Phase 1. The validation session has been completed, and `plan.md` has been updated with Smart Rebuilds, Dependency Graph Visualizers, and automated revisions.
**Next Action:** Begin creating the foundational repository structure, dotfiles, and GitHub templates.
