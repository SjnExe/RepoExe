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

### 3. Gitignore and Lockfiles
*   **`.gitignore`**: Must include `node_modules` and `.prettiercache` to prevent committing build artifacts and caches.
*   **Version Control**: The `bun.lock` file **must** be explicitly added and committed to version control to guarantee deterministic builds.

### 4. `package.json` Specification
The `package.json` must strictly enforce immutability in CI and leverage native tools:
- **Scripts**: Include `lint` (`oxlint`), `format` (`prettier`), `test` (`bun test`), and `build` (`bun build --compile`).
- **Hooks**: Use a `prepare` or `postinstall` script to ensure Husky/git-hooks are configured if needed.
- **Dependency Management**: Use **only Bun** (`bun install`, `bun add`, etc.) – do not use npm.
- **Dependency Versions**: Use the **latest** version tag for *every* dependency specified in `package.json` (e.g., `"oxlint": "latest"`). CI workflows must use `bun install --frozen-lockfile` to guarantee deterministic builds based on the committed `bun.lock`.

### 5. File Formats & Linting
*   **Linter**: Use **Oxlint** (maintained natively by Termux repositories) for ultra-fast linting, falling back to ESLint only if necessary. Use **Prettier** for formatting.
*   **Recipe Format**: Transition from `pkg.yml` to **`pkg.ts`** *only* if the TS format looks good and is easy for maintaining. Otherwise, retain the YAML format (`pkg.yml`).

#### Example: Current YAML vs Refactored TS
Below is a comparison of the current YAML recipe for Bun vs how the refactored TS format might look. Use this to judge whether TS formatting provides an advantage in maintainability.

```bash
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

phases:
  prepare: |
    # 1. Ensure host LLVM 21, nasm, and host Bun runner are installed
    if ! command -v clang-21 >/dev/null 2>&1; then
      curl -fsSL --retry 5 https://apt.llvm.org/llvm-snapshot.gpg.key | sudo tee /etc/apt/trusted.gpg.d/apt.llvm.org.asc >/dev/null || true
      echo "deb https://apt.llvm.org/noble/ llvm-toolchain-noble-21 main" | sudo tee /etc/apt/sources.list.d/llvm.list
      sudo apt-get update -qq || true
      sudo apt-get install -yq clang-21 lld-21 llvm-21 nasm || true
    fi

    HOST_ARCH="$(uname -m)"
    if [ "$HOST_ARCH" = "aarch64" ] || [ "$HOST_ARCH" = "arm64" ]; then
      BUN_ARCH="aarch64"
    else
      BUN_ARCH="x64"
    fi
    mkdir -p /tmp/host-bun
    curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-linux-${BUN_ARCH}.zip" -o /tmp/host-bun/bun.zip
    unzip -q -o /tmp/host-bun/bun.zip -d /tmp/host-bun
    mv /tmp/host-bun/bun-linux-${BUN_ARCH}/bun /tmp/host-bun/bun 2>/dev/null || true
    chmod +x /tmp/host-bun/bun
    export PATH="/usr/lib/llvm-21/bin:/tmp/host-bun:$PATH"

    # ... (remaining prepare logic truncated for brevity, identical to current yaml)

  make: |
    export PATH="/usr/lib/llvm-21/bin:/tmp/host-bun:$PATH"
    export ANDROID_NDK_ROOT="${NDK:-/opt/android-ndk}"

    bun run build:release --abi=android --arch=aarch64 --android-ndk="${NDK:-/opt/android-ndk}" --canary=false --lto=on

  install: |
    BUN_BIN=""
    if [ -f "./build/release/bun" ]; then
      BUN_BIN="./build/release/bun"
    else
      BUN_BIN=$(find . -name bun -type f -perm -111 -not -path "*/node_modules/*" -not -path "*/scripts/*" | head -n 1)
    fi

    if [ -z "$BUN_BIN" ]; then
      echo "::error::bun executable not found after build"
      exit 1
    fi

    # Clean staging prefix to remove any stray staged dependencies
    rm -rf "${DESTDIR}${PREFIX}"
    mkdir -p "${DESTDIR}${PREFIX}/bin"
    chmod +x "$BUN_BIN"
    # ... (remaining install logic truncated for brevity, identical to current yaml)

  test: |
    export TMPDIR="${TMPDIR:-${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
    bun --version
    bunx --version
    # ... (remaining test logic truncated for brevity, identical to current yaml)

# ==========================================================

# === REFACTORED TYPESCRIPT RECIPE (pkg/bun/pkg.ts) ===
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
      # 1. Ensure host LLVM 21, nasm, and host Bun runner are installed
      if ! command -v clang-21 >/dev/null 2>&1; then
        curl -fsSL --retry 5 https://apt.llvm.org/llvm-snapshot.gpg.key | sudo tee /etc/apt/trusted.gpg.d/apt.llvm.org.asc >/dev/null || true
        echo "deb https://apt.llvm.org/noble/ llvm-toolchain-noble-21 main" | sudo tee /etc/apt/sources.list.d/llvm.list
        sudo apt-get update -qq || true
        sudo apt-get install -yq clang-21 lld-21 llvm-21 nasm || true
      fi

      HOST_ARCH="$(uname -m)"
      if [ "$HOST_ARCH" = "aarch64" ] || [ "$HOST_ARCH" = "arm64" ]; then
        BUN_ARCH="aarch64"
      else
        BUN_ARCH="x64"
      fi
      mkdir -p /tmp/host-bun
      curl -fsSL "https://github.com/oven-sh/bun/releases/download/bun-v1.4.0/bun-linux-\${BUN_ARCH}.zip" -o /tmp/host-bun/bun.zip
      unzip -q -o /tmp/host-bun/bun.zip -d /tmp/host-bun
      mv /tmp/host-bun/bun-linux-\${BUN_ARCH}/bun /tmp/host-bun/bun 2>/dev/null || true
      chmod +x /tmp/host-bun/bun
      export PATH="/usr/lib/llvm-21/bin:/tmp/host-bun:$PATH"

      # ... (remaining prepare logic truncated for brevity)
    `,
    make: `
      export PATH="/usr/lib/llvm-21/bin:/tmp/host-bun:$PATH"
      export ANDROID_NDK_ROOT="\${NDK:-/opt/android-ndk}"

      bun run build:release --abi=android --arch=aarch64 --android-ndk="\${NDK:-/opt/android-ndk}" --canary=false --lto=on
    `,
    install: `
      BUN_BIN=""
      if [ -f "./build/release/bun" ]; then
        BUN_BIN="./build/release/bun"
      else
        BUN_BIN=$(find . -name bun -type f -perm -111 -not -path "*/node_modules/*" -not -path "*/scripts/*" | head -n 1)
      fi

      if [ -z "$BUN_BIN" ]; then
        echo "::error::bun executable not found after build"
        exit 1
      fi

      # Clean staging prefix to remove any stray staged dependencies
      rm -rf "\${DESTDIR}\${PREFIX}"
      mkdir -p "\${DESTDIR}\${PREFIX}/bin"
      chmod +x "$BUN_BIN"
      # ... (remaining install logic truncated for brevity)
    `,
    test: `
      export TMPDIR="\${TMPDIR:-\${PREFIX:-/data/data/com.termux/files/usr}/tmp}"
      bun --version
      bunx --version
      # ... (remaining test logic truncated for brevity)
    `
  }
};

export default recipe;
```

### 6. Project Directory Structure
The new orchestrator will replace the flat `scripts/` folder with a highly modular `src/` directory mapped to domain boundaries:
```text
src/
├── cli/          # Entrypoints, argument parsing (util.parseArgs)
├── core/         # Core orchestrator logic
│   ├── config.ts   # Global configuration, env merging
│   ├── parser.ts   # Recipe parsing (TS evaluation or YAML parsing)
│   ├── graph.ts    # Incremental dependency graph calculation
│   └── types.ts    # Zod/TS interfaces for recipes
├── builders/     # Format specific packers (deb, pacman, apk)
├── execution/    # Subprocess/shell runners (Bun.spawnSync wrappers)
├── sanitizer/    # ELF linters, shebang fixing
└── utils/        # General helpers (hashers, loggers)
```

### 7. Incremental Builds & Orchestration Modularity
The build orchestrator (`src/core/graph.ts`) must support **Incremental Rebuilding**:
- When a file in `src/builders/` changes, only package generation needs checking.
- When `pkg/bun/patches/` changes, the `state_hash` of the Bun package changes, triggering a rebuild of Bun and anything depending on it.
- **Implementation**: The matrix generator (`scripts/cli/generate_shards.py` -> `src/cli/generateShards.ts`) must construct a Directed Acyclic Graph (DAG) of packages to determine exactly which shards are affected by a git diff.

### 8. Cross-Compilation Boundaries (Host vs. Termux Target)
RepoExe builds native Termux binaries via GitHub Actions using Docker. We must strictly separate **Host** and **Target**:
- **Host**: The Ubuntu x86_64 runner and the `scripts/docker/Dockerfile.builder` image. This image must be updated to install Bun (to execute the new orchestrator) while maintaining the LLVM/NDK cross-compilation toolchains.
- **Target**: The generated binaries must link against Termux's Bionic libc, using `$PREFIX` (`/data/data/com.termux/files/usr`). The orchestrator scripts explicitly manage this boundary by configuring `CFLAGS`, `LDFLAGS`, and injecting the Bionic compat layer (`/tmp/bionic_compat.o`) before spawning `make`.

---

## 🚀 Migration Roadmap Checklists

### Phase 0: Environment & Foundation
- [ ] Initialize `package.json` (`bun init -y`). Add scripts (`lint`, `format`, `test`, `build`) and enforce `--frozen-lockfile` in CI. Ensure all dependency tags are set to `latest`.
- [ ] Ensure `.gitignore` explicitly ignores `node_modules` and `.prettiercache`.
- [ ] Ensure `bun.lock` is tracked and committed to version control.
- [ ] Create `bunfig.toml` using the specification above.
- [ ] Add `tsconfig.json` (`"target": "esnext"`, `"moduleResolution": "bundler"`).
- [ ] Install `oxlint` and `prettier` using **only Bun** (no npm).
- [ ] Update `AGENTS.md` with the new Bun setup script.
- [ ] Create `src/cli/index.ts` with a dummy CLI parser.

### Phase 1: Schemas & Type Contracts
- [ ] Evaluate recipe formatting strategy: compare `.yml` vs `.ts`. Retain YAML parsing fallback if `.ts` isn't easy enough to maintain.
- [ ] Design the TypeScript interface for `PackageRecipe` (`src/core/types.ts`).
- [ ] If proceeding with `.ts`, write a translation script to automatically convert existing `pkg/**/*.yml` files to `pkg/**/*.ts`.
- [ ] Write tests ensuring recipes are validated/typed properly (either via TS evaluation or YAML parsing).

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