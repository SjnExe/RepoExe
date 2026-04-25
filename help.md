# RepoExe Refactoring Checklist & Session Handover

This file tracks the execution of the massive refactoring effort outlined in `plan.md`.
**Agent Directive:** At the start of a session, review this checklist. At the end of a session, check off the completed items and write a brief summary of what to do next for the following agent.

## Execution Order
The tasks are sorted below strictly by their complexity score (easiest to hardest). Execute them in order. Focus on low-complexity infrastructure tasks first, then move on to core Python modules, and finally the most complex logic.

### Checklist
- [x] [Complexity: 0/100] **Phase 1 Audit**: Perform a comprehensive audit of `plan.md` to identify logical inconsistencies, review obscure features in `backup/`, and propose final DevOps modernization strategies.
- [x] [Complexity: 0/100] **Dual-Key Architecture Setup**: GPG (for APT/Pacman) and RSA (for Alpine) keys have been generated. `GPG_PRIVATE_KEY` and `ALPINE_PRIVATE_KEY` are configured in GitHub Secrets. Public keys are already inside `site/` folder.
- [x] [Complexity: 5/100] **Initialize Repository Structure**: Create dotfiles, initialize the `.github/` folder structure (by creating initial workflow files), and create the actual `site/install` file.
- [x] [Complexity: 5/100] **Create GitHub Community Files**: Create `SECURITY.md`, `CONTRIBUTING.md`, `FUNDING.yml`, `stale.yml`, and `dependabot.yml`.
- [x] [Complexity: 10/100] **Configure Ignore Files**: Create initial `.gitignore` and `.dockerignore` crafted explicitly for the RepoExe structure, and note that these files may need iterative updates as new components are added.
- [x] [Complexity: 10/100] **Configure Prettier**: Set up `.prettierrc` (strict format for AI) and `.prettierignore`.
- [x] [Complexity: 10/100] **Setup Python Project**: Establish `scripts/pyproject.toml` and lock dependencies via `uv` (must include `pydantic`).
- [x] [Complexity: 10/100] **Configure IDE Integration**: Implement DevContainers (`.devcontainer/devcontainer.json`) and `.vscode/settings.json` for YAML IDE Intellisense.
- [x] [Complexity: 15/100] **Configure Local Pre-commit Hooks**: Create `.pre-commit-config.yaml` for automated formatting checks (`ruff`, `prettier`, `shellcheck`).
- [ ] [Complexity: 20/100] **Docker Base Image**: Write the base `Dockerfile` (Ubuntu 24.04, non-root `builder`, integrate `uv`, `ruff`, `mypy`, `shellcheck`).
- [ ] [Complexity: 20/100] **Migrate: repoexe-keyring & repoexe-dev**: Base component opt-in packages.
- [ ] [Complexity: 25/100] **Docker NDK & Caching**: Download NDK 29, bake standard NDK patches directly into a Docker layer, and configure `sccache` with GitHub Actions Cache API chunking.
- [ ] [Complexity: 25/100] **Properties Module (`properties.py`)**: Define explicit internal `PREFIX` bounds for the device layout (`/data/data/com.termux/files/usr`).
- [ ] [Complexity: 25/100] **Repository Configurations (`repo.yml`)**: Implement `scripts/repo.yml` to define external repository endpoints (Termux/TUR), their GPG keys, and their component layouts for dynamic fallback dependency resolution.
- [ ] [Complexity: 30/100] **YAML Pydantic Parser (`parser.py` - Core)**: Implement basic Pydantic parsing of `build.yml` schema, License allowlist validation, and standardized `source_url` formatting.
- [ ] [Complexity: 30/100] **CI Workflow: lint.yml**: Implement Self-Healing CI that auto-runs `ruff` and `prettier` and pushes fix commits.
- [ ] [Complexity: 30/100] **CI Workflow: python-tests.yml**: CI workflow executing the `pytest` test suite for the orchestrator, integrating `pytest-cov` and rendering GitHub Step Summaries.
- [ ] [Complexity: 30/100] **CI Workflow: cache-prune.yml**: Strict GitHub Actions and GHCR cache eviction workflow leveraging LRU logic.
- [ ] [Complexity: 30/100] **Documentation: SCHEMA.md**: Write comprehensive schema documentation for all YAML fields, flags, and hooks.
- [ ] [Complexity: 30/100] **Documentation: Sample Templates**: Create `docs/standard/build.yml` and others.
- [ ] [Complexity: 35/100] **CI Workflow: security-scan.yml**: Integrate `osv-scanner` or `pip-audit` to proactively scan dependencies for known vulnerabilities.
- [ ] [Complexity: 35/100] **CI Workflow: free-space.sh**: Implement hyper-fast `rm -rf` logic for massive unused toolchains on GitHub Host VMs.
- [ ] [Complexity: 40/100] **Version Normalization (`parser.py` - Versions)**: Strictly strip `v` prefixes, and translate upstream revisions into PM-specific dialects (`+r4` for Debian, `.r4` for Pacman, `_p4` for Alpine).
- [ ] [Complexity: 40/100] **CLI Subcommands (`build.py` - CLI)**: Wire basic subcommands `info`, `list`, `clean`, `init` for interactive scaffolding, and `--dry-run` flag.
- [ ] [Complexity: 40/100] **Test Execution Sandbox (`test.py`)**: Execute tests inside PRoot / PRoot Distro isolation, implementing Flaky Test Isolation.
- [ ] [Complexity: 40/100] **Migrate: libandroid-tools**: Split into granular sub-packages (`libbase`, `libcutils`, etc.).
- [ ] [Complexity: 40/100] **Documentation: mkdocs Site**: Set up `mkdocs-material` for a searchable docs site on `/docs`.
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
- [ ] [Complexity: 60/100] **Migrate: aapt & aapt2**: Implement "Local Source Building".
- [ ] [Complexity: 65/100] **Android Patching & Validation**: Auto `config.guess` updates, Linux hardcoded path fixes, `termux-elf-cleaner`, `-dbg` symbol extraction, strict Bionic Undefined Symbols validation, strict SONAME enforcement.
- [ ] [Complexity: 65/100] **CI Workflow: package_updates.yml**: Auto-PR workflow triggered by scheduled `upstream_check.py`.
- [ ] [Complexity: 65/100] **CI Workflow: promote.yml**: Automated cron job to promote staged updates from `dev` component to `main` component based on dynamic `promote_days`.
- [ ] [Complexity: 70/100] **Source Mirroring & Git Submodules (`sysroot.py` - Advanced)**: Validate GPG signatures, auto-mirror fetched tarballs to GitHub Releases, natively clone upstream Git branches, and handle recursive submodules.
- [ ] [Complexity: 70/100] **Repository Health Core (`health.py`)**: Cron job logic validating sync between YAML and Pages, flagging zombie packages, and Release Asset Pruning (keep last 5 versions).
- [ ] [Complexity: 75/100] **Hermetic Docker Sandbox (`docker.py` - Strict)**: Disable network access during compilation. Integrate strict Bubblewrap (`bwrap`) jail boundaries, natively mount `binfmt_misc` / `qemu-user-static` for transparent emulation.
- [ ] [Complexity: 75/100] **Hybrid Build Engine (`build.py` - Runner)**: Execute structured declarative targets vs wrappers. Ensure `pre_fetch` hook runs *before* Hermetic sandboxing. Instrument OpenTelemetry and generate `crash_report.json`.
- [ ] [Complexity: 80/100] **DAG Telemetry & Anti-Deps (`dag.py` - Advanced)**: Telemetry-driven dynamic sharding to balance execution times. Natively handle `anti_build_depends` to strictly uninstall conflicting dependencies on runners. Output Dependency Graphs.
- [ ] [Complexity: 80/100] **Ghost Dependency & ABI Detection**: Run `dpkg-shlibdeps` against `Depends` array to lint unused dependencies. Integrate `libabigail` validation for ABI breakage.
- [ ] [Complexity: 85/100] **Static APT Generator (`debian.py` - APT)**: Natively implement Python-based custom static APT metadata generation (`Packages`, `Release`, `InRelease`) entirely replacing `aptly`.
- [ ] [Complexity: 85/100] **CI Workflow: build.yml (Exclusions & PR Mode)**: Implement `!{package}` exclusion syntax, PR Test Mode (no save caches), and automated downstream testing queue logic.
- [ ] [Complexity: 85/100] **CI Workflow: publish.yml (TUF & SLSA)**: Generate SLSA Provenance using `actions/attest-build-provenance`, and enforce TUF principles for static hosting.
- [ ] [Complexity: 90/100] **Multi-Runner Consensus (CI)**: Update workflows so that "essential" packages dynamically spawn two independent runners and require bit-for-bit identical hashes before publishing.
- [ ] [Complexity: 90/100] **Alpine RSA Signature Appending (`apk.py` - Signing)**: Natively implement the complex logic to mathematically append Alpine RSA signatures to compiled `.apk` files and `APKINDEX.tar.gz`.
- [ ] [Complexity: 95/100] **Auto-Revision & Downstream DAG Bumping (`dag.py` - Smart)**: Enable the orchestrator to automatically calculate revision bumps down the DAG when core upstream dependencies trigger rebuilds or ABI breaks.
- [ ] [Complexity: 100/100] **Content-Addressable Hashing Engine**: Incorporate strict SHA256 "state hash" evaluation across package inputs (YAML, patches, source hash, downstream DAG state hashes) to aggressively skip redundant builds globally.

---

## Current Session Notes / Handover
*Write a short summary below when ending a session so the next AI agent knows exactly where to pick up.*

**Status:** Phase 1 scaffolding complete. Ready for Docker environment implementation.


**Session 1 Handover (Completed)**
*   Completed tasks 0-15/100 (Initialize Repository Structure, Create GitHub Community Files, Configure Ignore Files, Configure Prettier, Setup Python Project, Configure IDE Integration, Configure Local Pre-commit Hooks).
*   Configured python tools (Ruff, Mypy, UV) to target absolute latest Python 3.13.
*   Setup Dependabot for GitHub Actions and pip packages, configured to run daily.
*   Created `site/install` to support concurrent Apt, Pacman, and Apk installations without `pkg`.
*   All line lengths tuned to `120` to aid AI agents.

**Session 2 Handover (Completed)**
*   Performed a comprehensive Phase 1 Audit on the `plan.md` architectural blueprint.
*   Integrated modernization strategies such as Bubblewrap `DESTDIR` tmpfs fallbacks, `scripts/repo.yml` external repository routing, dynamic `libc` suffixing logic for internal dependency trees, Repology API lookups, and PM-specific override blocks in the YAML schema.
*   **Next Action (Session 3):** Start with **Docker Base Image** (Complexity 20/100), write the `Dockerfile` with Ubuntu 24.04, non-root builder, and pre-installed `uv`/linters. Then migrate `repoexe-keyring` & `repoexe-dev`.
