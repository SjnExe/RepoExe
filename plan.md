# RepoExe Migration Plan

## 📝 Objective
Migrate the RepoExe orchestrator from Python to a natively executed TypeScript (via Bun) architecture, ensuring 100% backward compatibility for `pkg.yml` recipes and CLI arguments.

## 🧠 Q&A / Key Decisions
*   **YAML vs TypeScript for Recipes**: *Is YAML the best format for building recipes, or should we use TypeScript?*
    *   **Decision**: Keep `pkg.yml` as YAML for now to maintain **strict backward compatibility** (a core requirement). YAML is universally declarative and easier for non-programmers to read. However, under the hood, Zod (TypeScript) will strictly parse and validate these YAML files. Transitioning to `pkg.ts` could be a future enhancement, but it breaks the "drop-in replacement" rule for existing CI pipelines.
*   **Biome on Termux**: *Is Biome supported in Termux?*
    *   **Decision**: Native Biome binaries for Android/aarch64 in Termux can be tricky as they depend on native Rust bindings which may not always have prebuilt Android targets published on npm. If `bunx @biomejs/biome` fails on Termux, we will fall back to **ESLint + Prettier** (which run purely in JS via Bun) to guarantee the "Everything should work on Termux" requirement.
*   **AI Model Selection**: *Gemini 3.1 Pro vs Gemini 3.6 Flash for coding?*
    *   **Recommendation**: Use **Gemini 3.1 Pro** for complex architectural changes, deep refactoring, and initial setup (it reasons better about project-wide boundaries). Use **Gemini 3.6 Flash** for rapid, iterative bug fixing, writing repetitive tests, or simple feature additions where speed and context-window length are more important than deep reasoning.
*   **Session Management**: The migration *must* be done across multiple sessions. This `plan.md` acts as the state tracker.

## 🤝 Handover Context (For Next Session)
*   **Current State**: The repository is still entirely in Python. We have finalized the architecture decision (Bun/TypeScript) and updated the `AGENTS.md` and `bunfig.toml` to prepare the environment.
*   **Next Immediate Action**: Initialize the Node/Bun project (`package.json`, `tsconfig.json`, `eslint.config.js`), set up the Zod schemas for parsing `pkg.yml`, and port the core parsing logic (`scripts/core/parser.py` -> `src/core/parser.ts`).

---

## 🚀 Migration Roadmap Checklists

### Phase 0: Environment & Foundation
- [x] Create `plan.md`.
- [x] Add `bunfig.toml` (optimized for multi-core and strict execution).
- [x] Update `AGENTS.md` with new Bun-specific setup instructions.
- [ ] Initialize `package.json` (`bun init -y`).
- [ ] Add `tsconfig.json` (`"target": "esnext"`, `"moduleResolution": "bundler"`).
- [ ] Set up linting/formatting (ESLint + Prettier for Termux compatibility).
- [ ] Create `src/cli/index.ts` with a dummy CLI parser (`cac` or `util.parseArgs`) mimicking `build.py` arguments.

### Phase 1: Schemas & Type Contracts
- [ ] Install `zod` and `js-yaml`.
- [ ] Create `src/core/schema.ts` porting `PackageRecipe` and `ChannelOverride` dataclasses.
- [ ] Implement `src/core/parser.ts` to read `pkg.yml` and validate against Zod.
- [ ] Write `bun test` cases validating existing `pkg/bun/pkg.yml` parses identically to the Python version.

### Phase 2: Core Domain Logic & Utilities
- [ ] Port `compute_state_hash` using `Bun.CryptoHasher("sha256")`.
- [ ] Port ELF linter (`utils/elf_linter.py` -> `src/utils/elfLinter.ts`).
- [ ] Port Shebang sanitizer (`sanitizer/shebang.py` -> `src/sanitizer/shebang.ts`).
- [ ] Port Bionic source patcher (`auto_patch_bionic_sources`).
- [ ] Ensure all file system modifications use synchronous APIs (`Bun.spawnSync`, `fs.writeFileSync`) to prevent race conditions.

### Phase 3: Build Pipeline & Execution
- [ ] Port `execute_compile` (Environment setup, git cloning/curl downloading, patching).
- [ ] Port `execute_pack` (Subpackage processing, `dpkg-deb`, `tar`, `apk` generation).
- [ ] Port `execute_test` (`proot` test runner mapping).
- [ ] Ensure dynamic path routing (`/data/data/com.termux/files/usr`) behaves exactly as before.

### Phase 4: CI/CD & Final Cutover
- [ ] Translate GitHub Actions (`.github/workflows/*.yml`) from `uv run python scripts/cli/build.py` to `bun run src/cli/index.ts`.
- [ ] Port auxiliary scripts: `generate_shards.py`, `update_recipe.py`, `index_gen.py`.
- [ ] Generate the final standalone binary: `bun build ./src/cli/index.ts --compile --outfile repoexe`.
- [ ] Remove all `.py` files from `scripts/`.
- [ ] Update README to reflect the new architecture.

## ⚠️ Important Considerations
*   **Synchronous Execution**: Use `Bun.spawnSync()` to perfectly map Python's `subprocess.run()` behavior. Avoid async spawns unless explicitly needed, as they can cause race conditions during heavy file I/O operations (like `make`).
*   **Truthiness**: In TS, `[]` and `{}` evaluate to `true`. Always explicitly check `.length === 0` or `Object.keys().length === 0`.
*   **Pathing**: Use explicit absolute paths (`process.cwd()`, `import.meta.dir`) as `import.meta.url` behaves differently when compiled into a single executable.