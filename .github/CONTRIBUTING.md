# Contributing to RepoExe

Thank you for your interest in contributing to **RepoExe**! We welcome bug reports, package recipe additions, documentation improvements, and high-quality build infrastructure contributions.

RepoExe is a modular, high-performance package repository and build orchestration suite designed for Android Termux, providing native `.deb` (APT) packages.

---

## Table of Contents

- [Code Owner & PR Governance](#code-owner--pr-governance)
- [Ways to Contribute](#ways-to-contribute)
- [Reporting Bugs](#reporting-bugs)
- [Adding New Packages](#adding-new-packages)
- [Development Environment Setup](#development-environment-setup)
- [Contribution & Git Workflow](#contribution--git-workflow)
- [Architectural & Packaging Standards](#architectural--packaging-standards)
- [AI-Assisted Contributions Policy](#ai-assisted-contributions-policy)
- [Two-Stage Review Protocol](#two-stage-review-protocol)
- [Code of Conduct](#code-of-conduct)

---

## Code Owner & PR Governance

- **Repository Owner:** `@SjnExe` oversees the repository and final release approvals.
- **Merge Governance:** The `Main branch` ruleset enforces a linear commit history (`squash` or `rebase` merges only, no merge commits), passing status checks (`Matrix`, `Lint & Code Quality Audit`, `Bun Unit Test Suite`, `Build Status & Log Aggregator`), and resolution of all review threads.

---

## Ways to Contribute

- **Add System Packages:** Submit declarative recipes (`pkg/<name>/recipe.ts`) for standalone command-line tools, compilers, and utilities compiled for Termux.
- **Report Build Failures:** Open an issue with full build logs and architecture details.
- **Enhance Build Orchestration:** Optimize TypeScript builders in `scripts/builders/` and sanitizers in `scripts/sanitizer/`.
- **Improve Documentation:** Keep installation guides, CLI documentation, and package metadata accurate.

---

## Reporting Bugs

Before reporting a bug:

1. Search existing [GitHub Issues](https://github.com/SjnExe/RepoExe/issues) to avoid duplicates.
2. Verify if the issue reproduces on the latest package release.
3. Include your device architecture (`uname -m`), Termux version, and complete terminal error outputs.

---

## Adding New Packages

Packages in RepoExe are defined declaratively in `pkg/<name>/recipe.ts`.

### Recipe Invariants:

- **Strict System Packages Only:** RepoExe packages native system tools, compilers, and CLI utilities. Do **not** package Python wheels or npm modules; users install those via language-specific managers.
- **Native Bionic Compliance:** Binaries must link against Android Bionic libc (`/system/bin/linker64`), never glibc (`libc.so.6`).
- **Standard Prefix:** All binaries and assets must install into `${DESTDIR}${PREFIX}` (`/data/data/com.termux/files/usr`).
- **Strict Patch Numbering:** Patches under `pkg/<name>/patches/` must be regular files using 4-digit zero-padded `.patch` filenames (e.g., `0001-fix-build.patch`, `0002-cross-compile.patch`).

### `recipe.ts` Reference (`defineRecipe`)

Recipes use `defineRecipe({...})` from `@core/types.ts`:

| Field                                                                               | Description                                                                                                                                                                                                                   |
| :---------------------------------------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `name`, `version`, `epoch`, `revision`                                              | Package identity and Debian version components (`[epoch:]version[-revision]`).                                                                                                                                                |
| `arch` / `arches`                                                                   | Target architecture(s): `'aarch64'`, `'arm'`, `'x86_64'`, `'i686'`, or `'all'`.                                                                                                                                               |
| `description`, `license`, `homepage`, `component`                                   | Metadata for APT `control` and registry index (`main` by default).                                                                                                                                                            |
| `maintainer`, `uploaders`                                                           | Maintainer handle/email and optional co-uploaders.                                                                                                                                                                            |
| `build_system`                                                                      | Build backend (`'custom'`, `'cmake'`, `'meson'`, `'autotools'`, `'cargo'`, `'go'`, `'zig'`, etc.).                                                                                                                            |
| `source` / `sources` / `mirrors` / `sha256`                                         | Upstream tarball/git URL(s), fallback mirrors, and SHA-256 verification.                                                                                                                                                      |
| `formats`                                                                           | Target package formats (`['apt']`).                                                                                                                                                                                           |
| `build_deps`, `deps`                                                                | Build-time and runtime dependencies (supports version constraints and `:any` / `\|` alternatives).                                                                                                                            |
| `recommends`, `suggests`, `conflicts`, `provides`, `replaces`, `breaks`, `enhances` | Debian relationship fields.                                                                                                                                                                                                   |
| `multiarch`                                                                         | Multi-Arch mode (`'foreign'`, `'same'`, `'allowed'`, `'no'`).                                                                                                                                                                 |
| `subpackages`                                                                       | Split outputs into child `.deb`s (`'auto:dev'`, `'auto:doc'`, `'auto:static'`, or `SubpackageDefinition` objects with `include`/`files`, `arch`, `producer_arch`, `parent_dep`, `deps`, `provides`, `replaces`, `multiarch`). |
| `maintainer_scripts`                                                                | Inline Debian maintainer scripts (`preinst`, `postinst`, `prerm`, `postrm`, `config`) validated at pack time.                                                                                                                 |
| `resources`                                                                         | Runner resource hints: `{ zram, swap, free_space, tmpfs }`.                                                                                                                                                                   |
| `heavy_build`, `cache`                                                              | Isolate long/memory-heavy builds into dedicated CI shards and enable toolchain caching.                                                                                                                                       |
| `auto_update`, `update_strategy`, `custom_update_cmd`                               | Automated upstream checks (`'github_release'`, `'github_tag'`, `'git_tag'`, `'custom'`).                                                                                                                                      |
| `patches`, `cflags`, `cxxflags`, `ldflags`, `ndk`                                   | Patch list, compiler/linker flags, and NDK version (`'30'`, `'23c'`).                                                                                                                                                         |
| `phases`, `vars`, `env`, `toolchains`                                               | Shell phases (`prepare`, `configure`, `make`, `install`, `test`) and environment overrides.                                                                                                                                   |

---

## Development Environment Setup

RepoExe orchestrates builds and tests exclusively with **Bun** and TypeScript.

```bash
# Clone the repository
git clone https://github.com/SjnExe/RepoExe.git
cd RepoExe

# Install dependencies (strictly locked)
bun install --frozen-lockfile --silent
```

### Build & CLI Commands

| Command                                                  | Purpose                                                                           |
| :------------------------------------------------------- | :-------------------------------------------------------------------------------- |
| `bun run build pkg/<name> --arch <arch>`                 | Compile, pack `.deb` (including subpackages), and run smoke tests.                |
| `bun run build compile pkg/<name> --arch <arch>`         | Run source fetch, patches, and `prepare`/`configure`/`make`/`install` phases.     |
| `bun run build pack pkg/<name> --arch <arch>`            | Sanitize ELFs/shebangs, split subpackages, and emit reproducible `.deb` archives. |
| `bun run build test pkg/<name> --arch <arch>`            | Run container/local smoke test against staged `.deb` archives.                    |
| `bun run audit` (`bun run build check`)                  | Validate all recipes, DAG, and patch naming conventions.                          |
| `bun run shards`                                         | Generate dynamic build-time-aware CI matrix shards.                               |
| `bun run index`                                          | Publish GitHub Releases and generate APT repository + site metadata.              |
| `bun run prune`                                          | Prune stale release assets and keep APT index consistent.                         |
| `bun fmt --changed` / `bun check` / `bun run lint:check` | Format, typecheck, and lint (`oxlint`) TypeScript code.                           |
| `bun test --parallel`                                    | Run the Bun unit test suite.                                                      |

See [AGENTS.md](AGENTS.md) for full architectural guidelines and agent operational instructions.

---

## Contribution & Git Workflow

1. **Fork & Branch:** Create a feature branch off `main` with a descriptive name (e.g., `feat/add-ripgrep-recipe`, `fix/elf-rpath-patching`).
2. **Curated Atomic Commits:**
   - Every commit must be self-contained, compilable, and pass automated tests.
   - Do **NOT** push intermediate noise commits (`fix typo`, `lint`, `address comments`). Use `git commit --amend` or interactive rebase.
   - Follow Conventional Commits (`feat(pkg): ...`, `fix(builder): ...`, `refactor(core): ...`).
3. **Verify Locally:** Run the automated quality gate before opening a PR:
   ```bash
   bun check && bun run lint:check && bun test --parallel && bun run audit
   ```
4. **Submit PR:** Open a PR against `main` using the provided Pull Request Template.

---

## Architectural & Packaging Standards

- **Site Artifacts:** The root `site/` folder contains generated build artifacts and is ignored. All frontend source files reside in `scripts/site/`.
- **No `__init__.py` in Deb Roots:** When creating `.deb` packages, recipe source files and metadata must never leak into the root archive to prevent `dpkg` read-only errors on Termux.
- **Sanitization Pipeline:**
  - All compiled ELF binaries are stripped of version requirement symbols (`DT_VERNEED`, `DT_VERSYM`) and have their RPATH set to `$PREFIX/lib`.
  - Shebangs (`#!/usr/bin/...`, `#!/bin/...`) are rewritten to `$PREFIX/bin/...`.

---

## AI-Assisted Contributions Policy

We welcome contributions developed with the assistance of AI tools (e.g., Claude, Antigravity, Copilot, ChatGPT). Contributors must adhere to the following principles:

- **Full Human Authorship & Responsibility:** You are 100% accountable for every line of code or recipe configuration you submit. Blindly copying raw LLM output is strictly prohibited.
- **Mandatory Local Verification:** All recipes and scripts must be verified locally with `bun check && bun run lint:check && bun test --parallel && bun run audit` before submitting a PR.
- **Strict Bionic Enforcement:** Verify that newly packaged binaries compile with NDK Clang against Android API levels without unresolved glibc symbols.

---

## Two-Stage Review Protocol

Concluding any feature, refactor, or recipe addition requires **2 consecutive zero-issue passes**:

1. **Stage 1 (Automated Validation & Snapshot Coherence):**
   ```bash
   bun check && bun run lint:check && bun test --parallel && bun run audit
   ```
2. **Stage 2 (Expanded Context Semantic Diff Audit):**
   Inspect all committed, staged, and working-tree changes against the PR target branch:
   - Verify recipe syntax, source URLs, and checksums.
   - Audit ELF and shebang sanitizer compatibility.
   - Ensure linear commit history without merge commits.
3. **Reset Invariant:** Any code change during review resets the pass counter to 0.

---

## Code of Conduct

All contributors and community members are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
