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

- **Repository Owner:** `@SjnExe` is the sole repository code owner (per `.github/CODEOWNERS`).
- **PR Approval:** All pull requests from contributors are reviewed and approved directly by `@SjnExe`.
- **Merge Governance:** The repository strictly enforces **Rebase & Merge** (`gh pr merge <pr> --rebase`) to preserve a clean linear commit history with curated atomic commits. Merge commits are forbidden. Squash merges are reserved strictly for single isolated atomic changes or explicit owner direction.

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

---

## Development Environment Setup

RepoExe orchestrates builds and tests exclusively with **Bun** and TypeScript.

```bash
# Clone the repository
git clone https://github.com/SjnExe/RepoExe.git
cd RepoExe

# Install dependencies (strictly locked)
bun install --silent
```

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
   bun run check && bun test
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
- **Mandatory Local Verification:** All recipes and scripts must be verified locally with `bun run check && bun test` before submitting a PR.
- **Strict Bionic Enforcement:** Verify that newly packaged binaries compile with NDK Clang against Android API levels without unresolved glibc symbols.

---

## Two-Stage Review Protocol

Concluding any feature, refactor, or recipe addition requires **2 consecutive zero-issue passes**:

1. **Stage 1 (Automated Validation & Snapshot Coherence):**
   ```bash
   bun run check && bun test
   ```
2. **Stage 2 (Expanded Context Semantic Diff Audit):**
   Inspect all committed, staged, and working-tree changes against the PR target branch:
   - Verify recipe YAML syntax, source URLs, checksums, and channel configurations.
   - Audit ELF and shebang sanitizer compatibility.
   - Ensure linear commit history without merge commits.
3. **Reset Invariant:** Any code change during review resets the pass counter to 0.

---

## Code of Conduct

All contributors and community members are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md).
