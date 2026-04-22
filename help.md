# RepoExe Refactoring Checklist & Session Handover

This file tracks the execution of the massive refactoring effort outlined in `plan.md`.
**Agent Directive:** At the start of a session, review this checklist. At the end of a session, check off the completed items and write a brief summary of what to do next for the following agent.

## Phase 1: Environment & Foundation Setup
- [ ] Initialize repository structure (dotfiles, `.github/` folder, `site/install`).
- [ ] Create `SECURITY.md`, `CONTRIBUTING.md`, `FUNDING.yml`, `stale.yml`, and `dependabot.yml`.
- [ ] Set up the `.prettierrc` (strict format for AI) and `.prettierignore`.
- [ ] Write the `Dockerfile` (Ubuntu 24.04, non-root `builder`, built-in ccache).
- [ ] Download NDK 29 and bake standard NDK patches directly into a Docker layer.
- [ ] Install formatting/linting stack inside Docker (`ruff`, `mypy`, `shellcheck`, `actionlint`).

## Phase 2: Python Orchestrator (`scripts/core/`)
- [ ] Establish the `scripts/requirements.txt`.
- [ ] Implement `parser.py`: Parse `package.yml`, validate strict generic fields, validate Licenses against allowlist. Enforce Advanced Metadata Schema (`conffiles`, `essential`, `service_script`, `revision`, `anti_build_depends`, `groups`, `optdepends`).
- [ ] Implement `dag.py`: Resolve dependencies, handle massive isolated packages (Chromium), generate matrix shards.
- [ ] Implement `toolchains.py`: Select NDK 29 compilers based on architecture, set `CFLAGS`/`LDFLAGS`.
- [ ] Implement native build wrappers (CMake, Meson, Autotools) in `toolchains.py`.
- [ ] Implement `docker.py`: Wrap execution commands to run purely inside the `builder` container.
- [ ] Implement `debian.py`: Handle `.deb` file generation, metadata signing, and APT repo synchronization.
- [ ] Implement `pacman.py`: Handle `.pkg.tar.xz` file generation and Pacman database (`.db`) generation.
- [ ] Implement `sysroot.py`: Extract downloaded dependencies into an isolated `$PREFIX` mock directory for compilation sandboxing.
- [ ] Implement Android Patching: Automatic `config.guess` updates, Linux hardcoded path fixing, and `termux-elf-cleaner`.
- [ ] Implement `health.py`: Cron job logic for version matching, missing artifacts, and zombie pruning.
- [ ] Implement `upstream_check.py`: Automated pinging for new upstream releases.
- [ ] Wire everything together in the CLI entrypoint `scripts/build.py`.

## Phase 3: CI/CD Workflows (`.github/workflows/`)
- [ ] Write `build.yml`: Dynamic Matrix Sharding (`architectures x shards`), PR Test Mode, and the `!{package}` exclusion syntax.
- [ ] Write `lint.yml`: Implement Self-Healing CI that auto-runs `ruff` and `prettier` and pushes fix commits.
- [ ] Write `publish.yml`: Strictly separated from `build.yml`. Downloads artifacts, verifies them, generates SLSA Provenance, and publishes ONLY if the whole matrix passes.
- [ ] Write `health.yml`: Cron job executing `health.py`.
- [ ] Write `package_updates.yml`: Auto-PR workflow triggered by `upstream_check.py`.
- [ ] Implement `free-space.sh` fast-deletion logic at the start of workflows.

## Phase 4: Package Migration
- [ ] Create the `sample/` folder with templates (`standard.yml`, `metapackage.yml`, `multi-architecture.yml`).
- [ ] Migrate `libandroid-tools` (split into granular sub-packages).
- [ ] Migrate `aapt` (Implement "Local Source Building").
- [ ] Migrate `aapt2`, `aidl`, and `zipalign`.
- [ ] Ensure `-doc` package profiles are used instead of blinding deleting `man` pages.
- [ ] Ensure test phases are converted to declarative YAML testing hooks.

---

## Current Session Notes / Handover
*Write a short summary below when ending a session so the next AI agent knows exactly where to pick up.*

**Status:** Ready to begin Phase 1. `plan.md` has been fully written and approved.
**Next Action:** Begin creating the foundational repository structure, dotfiles, and GitHub templates.
