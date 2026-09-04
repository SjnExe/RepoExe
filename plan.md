# RepoExe Migration & Refactoring Plan

## 📝 Objective
Migrate the RepoExe orchestrator from Python (`scripts/`) to a natively executed TypeScript architecture (via Bun in `src/`), focusing on Termux portability, single-binary distribution (`bun build --compile`), 1:1 functional parity, and AI-maintainability.

---

## 🤝 Session Handover Context
*   **Current State**: The repository is currently in Python. No implementation code in `src/` has been created yet.
*   **Next Immediate Action**: Initialize the Node/Bun project (`package.json`, `tsconfig.json` with path aliases), write `bunfig.toml`, update `AGENTS.md` with the mandated Bun setup script, and implement the recipe parsing schema in `src/core/parser.ts`.

---

## 🔁 1:1 Functional Parity & Subcommand Mapping

> **Note on Naming & Structure**: 1:1 refactoring strictly guarantees 1:1 functional behavior, CLI subcommands/arguments, build pipeline stages, and package output formats. File names, internal code structure, and module organization can evolve to leverage modern TypeScript paradigms, clean module boundaries, and path aliases (`@core/*`, `@cli/*`, etc.).

| Existing Python Module / Script (`scripts/`) | Refactored TypeScript Module Target (`src/`) | Domain Responsibility & Parity Scope |
| :--- | :--- | :--- |
| `cli/build.py` | `src/cli/build.ts` | Main orchestration entrypoint (`compile`, `pack`, `test`, `check`, `all`). Preserves staging checks and skip-rebuild hashes. |
| `cli/generate_shards.py` | `src/cli/generateShards.ts` | CI matrix shard generator with `@channel` support, diff-based DAG filtering, and state hash validation. |
| `cli/index_gen.py` | `src/cli/indexGen.ts` | Repository index & `packages.json` generator. Constructs index directly from GitHub Release notes body JSON without downloading full asset binaries. |
| `cli/prune.py` | `src/cli/prune.ts` | Release asset & tag cleanup tool executed post-deploy. |
| `cli/upstream_check.py` | `src/cli/upstreamCheck.ts` | Upstream version checker supporting `crates`, `github_release`, `github_tag`, `pypi`, `npm`, and `git_tag`. |
| `cli/update_recipe.py` | `src/cli/updateRecipe.ts` | Automatic recipe updater with pinned channel preservation for major/minor series. |
| `cli/jules_autofix.py` | `src/cli/julesAutofix.ts` | AI error handling & autofix helper. |
| `core/parser.py` | `src/core/parser.ts` | Recipe parser supporting YAML (`pkg.yml`) and TS (`pkg.ts`) validation via Zod schemas. |
| `core/resolver.py` | `src/core/resolver.ts` | Dependency resolution & state hash calculation (`compute_state_hash` including `pkg/<name>/` recipe & patch files). |
| `core/pipeline.py` | `src/core/pipeline.ts` | Phase execution engine (`prepare`, `make`, `install`, `test`) & `auto_patch_bionic_sources`. |
| `core/fetcher.py` | `src/core/fetcher.ts` | Source archive & git repository fetcher with GitHub token authorization. |
| `core/subpkg.py` | `src/core/subpkg.ts` | Subpackage splitting logic. |
| `core/compat.py` | `src/core/compat.ts` | Bionic stub/compat injection management (`/tmp/bionic_compat.o`). |
| `builders/debian.py` | `src/builders/debian.ts` | Debian `.deb` package builder using high compression (`dpkg-deb -Zxz -z9`). |
| `builders/pacman.py` | `src/builders/pacman.ts` | Pacman `.pkg.tar.zst` package builder using high compression (`tar -I 'zstd -9'`). |
| `builders/alpine.py` | `src/builders/alpine.ts` | Alpine `.apk` package builder using high compression (`tar -I 'gzip -9'`). |
| `sanitizer/elf.py` | `src/sanitizer/elf.ts` | ELF binary header, rpath, and dynamic symbol validator. |
| `sanitizer/shebang.py` | `src/sanitizer/shebang.ts` | Shebang path rewriter for Termux (`$PREFIX/bin/...`). |
| `docker/runner.py` | `src/docker/runner.ts` | Synchronous and background Docker container runner wrappers. |
| `utils/dag.py` | `src/utils/dag.ts` | Directed Acyclic Graph calculation for incremental rebuilds. |
| `utils/health.py` | `src/utils/health.ts` | Health and audit checks for package recipes (quoting rules, schema validation). |
| `utils/elf_linter.py` | `src/utils/elfLinter.ts` | Binary architecture and Bionic linking verification. |
| `utils/properties.py` | `src/utils/properties.ts` | Package recipe property inspector. |
| `utils/sysroot.py` | `src/utils/sysroot.ts` | Staging sysroot manager. |
| `utils/test.py` | `src/utils/test.ts` | Test harness executor. |
| `utils/log_aggregator.py` | `src/utils/logAggregator.ts` | Structured CI diagnostic log formatter. |
| `utils/toolchains/*` | `src/toolchains/*` | Environment setup for Native, Go, Python, Rust, Swift, and Zig. |

---

## 🐳 Docker Image & Container Runner Modifications

### 1. `Dockerfile.builder` (`scripts/docker/Dockerfile.builder`)
- **System Bun Installation**: Install Bun globally for both `root` and non-root `builder` user (UID 1000):
  ```dockerfile
  RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash \
   && ln -sf /usr/local/bin/bun /usr/bin/bun
  ```
- **Global Linters**: Install `oxlint` and `prettier` globally via Bun:
  ```dockerfile
  RUN bun install -g oxlint prettier
  ```
- **Python Dependency Cleanup**: Remove Python orchestration tools (`uv`, `ruff`, `mypy`, `python3-pydantic`, `pyyaml`, `pytest`) once the cutover to TypeScript is complete. Retain `python3`, `make`, `ninja`, `cmake`, `gperf`, `bison`, `flex`, `pkg-config`, and LLVM/NDK cross-compilation toolchains required by native build scripts (e.g. node-gyp / Python build scripts).
- **Workdir & User Permissions**: Keep `/home/builder/RepoExe` workspace and permissions assigned to `builder:builder`.

### 2. `Dockerfile.tester` (`scripts/docker/Dockerfile.tester`)
- Continues targeting official Termux Bionic libc (`termux/termux-docker:aarch64`).
- Used strictly for post-build verification of produced `.deb`, `.pkg.tar.zst`, and `.apk` package artifacts inside a real Termux environment.

### 3. Docker Runner (`src/docker/runner.ts`)
- Implements `DockerRunner` and `DockerBackgroundExec` classes in TS.
- Mounts repository root into `/home/builder/RepoExe`.
- Executes orchestrator commands via Bun (`bun run src/cli/index.ts ...` or `./repoexe ...`).

---

## 🏗️ Architecture & Tools Specification

### 1. `AGENTS.md` Target Setup
When the environment is ready for Bun, `AGENTS.md` must be updated to use this exact setup script for the environment:
```bash
sudo curl -fsSL https://bun.sh/install | sudo BUN_INSTALL=/usr/local bash
sudo ln -sf /usr/local/bin/bun /usr/bin/bun
bun install --frozen-lockfile --no-progress --no-summary
```

### 2. `bunfig.toml` Target State
```toml
[install]
cache = true
minimumReleaseAge = 0
peer = true

[test]
isolate = true
parallel = true
smol = false
coverage = true
timeout = 5000
onlyFailures = true

[run]
bun = true
shell = "bun"
logLevel = "warn"
telemetry = false
noOrphans = true
linker = "isolated"
```

### 3. `tsconfig.json` & Import Path Aliases
`tsconfig.json` must configure path aliases (`@core/*`, `@cli/*`, `@builders/*`, `@utils/*`, `@sanitizer/*`, `@docker/*`, `@toolchains/*`) to eliminate relative path clutter (`../../..`):
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "baseUrl": ".",
    "paths": {
      "@cli/*": ["src/cli/*"],
      "@core/*": ["src/core/*"],
      "@builders/*": ["src/builders/*"],
      "@execution/*": ["src/execution/*"],
      "@sanitizer/*": ["src/sanitizer/*"],
      "@docker/*": ["src/docker/*"],
      "@toolchains/*": ["src/toolchains/*"],
      "@utils/*": ["src/utils/*"]
    }
  },
  "include": ["src/**/*"]
}
```

### 4. Gitignore and Lockfiles
*   **`.gitignore`**: Must include `node_modules` and `.prettiercache` to prevent committing build artifacts and caches.
*   **Version Control**: The `bun.lock` file **must** be explicitly added and committed to version control to guarantee deterministic builds.

### 5. `package.json` Specification
The `package.json` must strictly enforce immutability in CI and leverage native tools:
- **Scripts**: Include `lint` (`oxlint`), `format` (`prettier`), `test` (`bun test`), and `build` (`bun build ./src/cli/index.ts --compile --outfile repoexe`).
- **Hooks**: Use a `prepare` or `postinstall` script to ensure Husky/git-hooks are configured if needed.
- **Dependency Management**: Use **only Bun** (`bun install`, `bun add`, etc.) – do not use npm.
- **Dependency Versions**: Use the **latest** version tag for *every* dependency specified in `package.json` (e.g., `"oxlint": "latest"`). CI workflows must use `bun install --frozen-lockfile` to guarantee deterministic builds based on the committed `bun.lock`.

### 6. File Formats & Linting
*   **Linter**: Use **Oxlint** (maintained natively by Termux repositories) for ultra-fast linting, falling back to ESLint only if necessary. Use **Prettier** for formatting.
*   **Recipe Format**: Transition from `pkg.yml` to **`pkg.ts`** *only* if the TS format looks good and is easy for maintaining. Otherwise, retain the YAML format (`pkg.yml`).

#### Example: Current YAML vs Refactored TS Recipe
```yaml
# === CURRENT YAML RECIPE (pkg/bun/pkg.yml) ===
name: bun
version: 1.4.0
epoch: 1
revision: 0
arch: aarch64
description: Incredibly fast JavaScript runtime, bundler, test runner, and package manager
homepage: https://bun.sh
license: MIT
maintainer: SjnExe
build_system: custom
auto_update: true
update_strategy: github_release
source: https://github.com/oven-sh/bun.git#bun-v{version}

formats:
  - apt
  - pacman
  - apk

channels:
  latest: {}
```

```typescript
// === REFACTORED TYPESCRIPT RECIPE (pkg/bun/pkg.ts) ===
import { PackageRecipe } from "@core/types";

const recipe: PackageRecipe = {
  name: "bun",
  version: "1.4.0",
  epoch: 1,
  revision: 0,
  arch: "aarch64",
  description: "Incredibly fast JavaScript runtime",
  homepage: "https://bun.sh",
  license: "MIT",
  maintainer: "SjnExe",
  build_system: "custom",
  auto_update: true,
  update_strategy: "github_release",
  source: "https://github.com/oven-sh/bun.git#bun-v{version}",
  formats: ["apt", "pacman", "apk"],
  channels: {
    latest: {}
  },
  phases: {
    prepare: `...`,
    make: `...`,
    install: `...`,
    test: `...`
  }
};

export default recipe;
```

---

## 📂 Project Directory Structure

```text
src/
├── cli/          # Entrypoints: build.ts, generateShards.ts, indexGen.ts, prune.ts, upstreamCheck.ts, updateRecipe.ts, julesAutofix.ts, index.ts
├── core/         # Core logic: config.ts, parser.ts, resolver.ts, pipeline.ts, fetcher.ts, subpkg.ts, compat.ts, graph.ts, types.ts
├── builders/     # Format packers: debian.ts, pacman.ts, alpine.ts
├── execution/    # Subprocess execution wrappers (Bun.spawnSync / Bun.spawn)
├── sanitizer/    # ELF linters (elf.ts) and shebang fixing (shebang.ts)
├── docker/       # Docker runner (runner.ts)
├── toolchains/   # Toolchain setup wrappers (native.ts, golang.ts, python.ts, rust.ts, swift.ts, zig.ts)
└── utils/        # Helpers: dag.ts, health.ts, elfLinter.ts, properties.ts, sysroot.ts, test.ts, logAggregator.ts
```

---

## ⚙️ Incremental Builds & Cross-Compilation Boundaries

### 1. Incremental Build DAG
The matrix generator (`src/cli/generateShards.ts`) constructs a Directed Acyclic Graph (DAG) of packages to evaluate affected matrix shards based on git diffs:
- If a file in `src/builders/` changes, only packaging phases are re-evaluated.
- If `pkg/<pkg>/patches/` or any non-recipe file in `pkg/<pkg>/` changes, `compute_state_hash` updates, triggering a full rebuild of `<pkg>` and dependent packages.

### 2. Cross-Compilation Boundaries (Host vs. Termux Target)
- **Host**: Ubuntu x86_64 / ARM64 runner executing Bun (`src/cli/index.ts`).
- **Target**: Termux binaries compiled against Bionic libc and staging prefix (`/data/data/com.termux/files/usr`). The orchestrator configures `CFLAGS`, `LDFLAGS`, and injects `/tmp/bionic_compat.o` prior to spawning build tools.

---

## 🚀 Migration Roadmap Checklists

### Phase 0: Environment & Foundation
- [ ] Initialize `package.json` (`bun init -y`). Add scripts (`lint`, `format`, `test`, `build`) and enforce `--frozen-lockfile` in CI. Ensure dependency tags are set to `latest`.
- [ ] Ensure `.gitignore` explicitly ignores `node_modules` and `.prettiercache`.
- [ ] Ensure `bun.lock` is tracked and committed to version control.
- [ ] Create `bunfig.toml` using the specification above.
- [ ] Add `tsconfig.json` (`"target": "esnext"`, `"moduleResolution": "bundler"`) with `@core/*`, `@cli/*`, etc. import path aliases.
- [ ] Install `oxlint` and `prettier` using **only Bun** (no npm).
- [ ] Update `AGENTS.md` with the new Bun setup script.
- [ ] Create `src/cli/index.ts` with CLI argument parsing (`util.parseArgs`).

### Phase 1: Schemas & Type Contracts
- [ ] Design Zod schema and TypeScript interface for `PackageRecipe` (`src/core/types.ts`).
- [ ] Port `parser.py` -> `src/core/parser.ts` with YAML and TS recipe parsing support.
- [ ] Evaluate recipe formatting strategy: compare `.yml` vs `.ts`. Retain YAML parsing fallback if `.ts` isn't easy enough to maintain.

### Phase 2: Core Domain Logic & Utilities
- [ ] Port `resolver.py` -> `src/core/resolver.ts` using `Bun.CryptoHasher("sha256")`.
- [ ] Port `sanitizer/elf.py` -> `src/sanitizer/elf.ts` and `sanitizer/shebang.py` -> `src/sanitizer/shebang.ts`.
- [ ] Port `compat.py` -> `src/core/compat.ts` (`bionic_compat.c` compilation).
- [ ] Implement Incremental DAG Graph (`src/utils/dag.ts`) for modular rebuild triggers.

### Phase 3: Build Pipeline & Execution
- [ ] Update `scripts/docker/Dockerfile.builder` to install Bun and global linters.
- [ ] Port `docker/runner.py` -> `src/docker/runner.ts`.
- [ ] Port `pipeline.py` -> `src/core/pipeline.ts` and `fetcher.py` -> `src/core/fetcher.ts`.
- [ ] Port builders: `debian.py` -> `src/builders/debian.ts`, `pacman.py` -> `src/builders/pacman.ts`, `alpine.py` -> `src/builders/alpine.ts`.

### Phase 4: CI/CD & Final Cutover
- [ ] Translate GitHub Actions (`.github/workflows/*.yml`) to use `bun run src/cli/index.ts`.
- [ ] Port CLI scripts: `generate_shards.py` -> `src/cli/generateShards.ts`, `upstream_check.py` -> `src/cli/upstreamCheck.ts`, `update_recipe.py` -> `src/cli/updateRecipe.ts`, `jules_autofix.py` -> `src/cli/julesAutofix.ts`.
- [ ] Remove all `.py` files and `pyproject.toml`.
- [ ] Generate final standalone binary: `bun build ./src/cli/index.ts --compile --outfile repoexe`.

### Phase 5: Refactoring Installation & Indexing
- [ ] **Fix Site UI**: Update `scripts/site/index.html` to remove deprecated manager checkboxes (npm, pip, yarn, pnpm, uv) and update the `curl` install command snippet to only use active managers (e.g. `enable apt pacman apk all`).
- [ ] **Fix Install Script Error Hiding**: Refactor `pkg/repoexe/install` script so invalid arguments explicitly throw an error rather than silently defaulting to apt/pacman.
- [ ] **Optimize Index Generation**: Rewrite index generator (`src/cli/indexGen.ts`) to build `Packages` and `packages.json` by reading metadata embedded directly in GitHub tag release notes body JSON.
