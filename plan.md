# RepoExe Migration Plan

## 📝 Objective
Migrate the RepoExe orchestrator from Python to a natively executed TypeScript (via Bun) architecture, focusing on Termux portability, single-binary distribution, and AI-maintainability.

---

## 🤝 Session Handover Context
*   **Current State**: The repository is entirely in Python. No implementation code has been touched yet. We are actively expanding this blueprint to cover cross-compilation, incremental builds, and directory structures.
*   **Next Immediate Action**: Initialize the Node/Bun project (`package.json`, `tsconfig.json`), write the `bunfig.toml`, update `AGENTS.md` using the exact snippet below, and set up the parsing schema.

---

## 🏗️ Architecture & Tools Specification

Future sessions do **not** need to curl/fetch AddonExe. The required patterns are defined here:

### 1. `AGENTS.md` Target Setup
When the environment is ready for Bun, the `AGENTS.md` file must be updated to use this exact setup script for the Jules environment:
```bash
sudo curl -fsSL https://bun.sh/install | sudo BUN_INSTALL=/usr/local/bun bash
sudo ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
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

### 3. `package.json` Specification
The `package.json` must strictly enforce immutability in CI and leverage native tools:
- **Scripts**: Include `lint` (`oxlint`), `format` (`prettier`), `test` (`bun test`), and `build` (`bun build --compile`).
- **Hooks**: Use a `prepare` or `postinstall` script to ensure Husky/git-hooks are configured if needed.
- **Dependency Management**: CI workflows must use `bun install --frozen-lockfile` to guarantee deterministic builds.

### 4. File Formats & Linting
*   **Linter**: Use **Oxlint** (maintained natively by Termux repositories) for ultra-fast linting, falling back to ESLint only if necessary. Use **Prettier** for formatting.
*   **Recipe Format**: Transition from `pkg.yml` to **`pkg.ts`** to eliminate parsing overhead and enable strict typings.

#### Example `pkg.ts` Build Recipe
```typescript
import { PackageRecipe } from "../../src/core/types";

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
    prepare: `
      # Setup host toolchain vs target toolchain logic here
      echo "Preparing build..."
    `,
    make: `
      # Cross-compile for Termux target
      bun run build:release --abi=android --arch=aarch64
    `,
    install: `
      install -Dm755 bun "\${DESTDIR}\${PREFIX}/bin/bun"
    `,
    test: `
      export TMPDIR="\${PREFIX}/tmp"
      bun --version
    `
  }
};

export default recipe;
```

### 5. Project Directory Structure
The new orchestrator will replace the flat `scripts/` folder with a highly modular `src/` directory mapped to domain boundaries:
```text
src/
├── cli/          # Entrypoints, argument parsing (util.parseArgs)
├── core/         # Core orchestrator logic
│   ├── config.ts   # Global configuration, env merging
│   ├── parser.ts   # Recipe parsing (TS evaluation)
│   ├── graph.ts    # Incremental dependency graph calculation
│   └── types.ts    # Zod/TS interfaces for recipes
├── builders/     # Format specific packers (deb, pacman, apk)
├── execution/    # Subprocess/shell runners (Bun.spawnSync wrappers)
├── sanitizer/    # ELF linters, shebang fixing
└── utils/        # General helpers (hashers, loggers)
```

### 6. Incremental Builds & Orchestration Modularity
The build orchestrator (`src/core/graph.ts`) must support **Incremental Rebuilding**:
- When a file in `src/builders/` changes, only package generation needs checking.
- When `pkg/bun/patches/` changes, the `state_hash` of the Bun package changes, triggering a rebuild of Bun and anything depending on it.
- **Implementation**: The matrix generator (`scripts/cli/generate_shards.py` -> `src/cli/generateShards.ts`) must construct a Directed Acyclic Graph (DAG) of packages to determine exactly which shards are affected by a git diff.

### 7. Cross-Compilation Boundaries (Host vs. Termux Target)
RepoExe builds native Termux binaries via GitHub Actions using Docker. We must strictly separate **Host** and **Target**:
- **Host**: The Ubuntu x86_64 runner and the `scripts/docker/Dockerfile.builder` image. This image must be updated to install Bun (to execute the new orchestrator) while maintaining the LLVM/NDK cross-compilation toolchains.
- **Target**: The generated binaries must link against Termux's Bionic libc, using `$PREFIX` (`/data/data/com.termux/files/usr`). The orchestrator scripts explicitly manage this boundary by configuring `CFLAGS`, `LDFLAGS`, and injecting the Bionic compat layer (`/tmp/bionic_compat.o`) before spawning `make`.

---

## 🚀 Migration Roadmap Checklists

### Phase 0: Environment & Foundation
- [ ] Initialize `package.json` (`bun init -y`). Add scripts (`lint`, `format`, `test`, `build`) and enforce `--frozen-lockfile` in CI.
- [ ] Create `bunfig.toml` using the specification above.
- [ ] Add `tsconfig.json` (`"target": "esnext"`, `"moduleResolution": "bundler"`).
- [ ] Install `oxlint` and `prettier`. Set up npm scripts.
- [ ] Update `AGENTS.md` with the new Bun setup script.
- [ ] Create `src/cli/index.ts` with a dummy CLI parser.

### Phase 1: Schemas & Type Contracts
- [ ] Design the TypeScript interface for `PackageRecipe` (`src/core/types.ts`).
- [ ] Write a translation script to automatically convert existing `pkg/**/*.yml` files to `pkg/**/*.ts` using the new types.
- [ ] Write tests ensuring the TS recipes are strictly typed and load correctly.

### Phase 2: Core Domain Logic & Utilities
- [ ] Port `compute_state_hash` using `Bun.CryptoHasher("sha256")`.
- [ ] Port ELF linter (`utils/elf_linter.py` -> `src/utils/elfLinter.ts`).
- [ ] Port Bionic source patcher (`auto_patch_bionic_sources`).
- [ ] Implement the Incremental DAG Graph (`src/core/graph.ts`) for modular rebuild triggers.

### Phase 3: Build Pipeline & Execution
- [ ] Update `scripts/docker/Dockerfile.builder` to install Bun instead of Python tools.
- [ ] Port `execute_compile` ensuring strict Host vs. Target cross-compilation separation.
- [ ] Port `execute_pack` (Subpackage processing, `dpkg-deb`, `tar`, `apk` generation).
- [ ] Maintain hardcoded Termux path routing (`/data/data/com.termux/files/usr`).

### Phase 4: CI/CD & Final Cutover
- [ ] Translate GitHub Actions (`.github/workflows/*.yml`) to use `bun run src/cli/index.ts`.
- [ ] Port auxiliary scripts: `generate_shards.py` (integrate the DAG), `update_recipe.py`.
- [ ] Remove all `.py` files and `pyproject.toml`.
- [ ] Generate the final standalone binary: `bun build ./src/cli/index.ts --compile --outfile repoexe`.