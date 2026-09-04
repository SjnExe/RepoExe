# RepoExe Migration Plan

## 📝 Objective
Migrate the RepoExe orchestrator from Python to a natively executed TypeScript (via Bun) architecture, focusing on Termux portability, single-binary distribution, and AI-maintainability.

---

## 🤝 Session Handover Context
*   **Current State**: The repository is entirely in Python. No implementation code has been touched yet.
*   **Next Immediate Action**: Initialize the Node/Bun project, write the `bunfig.toml`, update `AGENTS.md` using the exact snippet below, and set up the parsing schema.

---

## 🏗️ Architecture & Tools Specification (Inspired by AddonExe)

Future sessions do **not** need to curl/fetch AddonExe. The required patterns are defined here:

### 1. `AGENTS.md` Target Setup
When the environment is ready for Bun, the `AGENTS.md` file must be updated to use this exact setup script for the Jules environment:
```bash
sudo curl -fsSL https://bun.sh/install | sudo BUN_INSTALL=/usr/local/bun bash
sudo ln -sf /usr/local/bun/bin/bun /usr/local/bin/bun
bun install --frozen-lockfile --no-progress --no-summary
```

### 2. `bunfig.toml` Target State
When creating the Bun config, use this optimized multi-core pipeline setup:
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

### 3. File Formats & Linting
*   **Recipe Format**: Transition from `pkg.yml` to **`pkg.ts`**. TypeScript recipes natively provide strict typings, auto-completion, and eliminate parsing overhead.
*   **Linter**: Use **Oxlint** for ultra-fast, native Termux linting, falling back to ESLint only if necessary. Use **Prettier** for formatting.

---

## 🚀 Migration Roadmap Checklists

### Phase 0: Environment & Foundation
- [ ] Initialize `package.json` (`bun init -y`).
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
- [ ] Port Shebang sanitizer (`sanitizer/shebang.py` -> `src/sanitizer/shebang.ts`).
- [ ] Port Bionic source patcher (`auto_patch_bionic_sources`).
- [ ] Ensure all file system modifications use synchronous APIs (`Bun.spawnSync`, `fs.writeFileSync`) to mirror Python's behavior.

### Phase 3: Build Pipeline & Execution
- [ ] Port `execute_compile` (Environment setup, git cloning/curl downloading, patching).
- [ ] Port `execute_pack` (Subpackage processing, `dpkg-deb`, `tar`, `apk` generation).
- [ ] Port `execute_test` (`proot` test runner mapping).
- [ ] Maintain hardcoded Termux path routing (`/data/data/com.termux/files/usr`).

### Phase 4: CI/CD & Final Cutover
- [ ] Translate GitHub Actions (`.github/workflows/*.yml`) to use `bun run src/cli/index.ts`.
- [ ] Port auxiliary scripts: `generate_shards.py`, `update_recipe.py`, `index_gen.py`.
- [ ] Remove all `.py` files and `pyproject.toml`.
- [ ] Generate the final standalone binary: `bun build ./src/cli/index.ts --compile --outfile repoexe`.
