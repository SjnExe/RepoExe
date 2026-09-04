# RepoExe: Architectural Audit & TypeScript Migration Roadmap

## 1. Deep Repository Audit

### 1.1 Architectural Style
RepoExe is currently structured as a **Micro-modular Python CLI Orchestrator**.
It operates as a collection of specialized scripts glued together by a central CLI (`scripts/cli/build.py`). It does not run continuously as a server; rather, it parses declarative YAML recipes (`pkg.yml`), spawns heavy OS-level subprocesses (`git`, `tar`, `curl`, `make`, `clang`), modifies the filesystem (source patching, ELF sanitization), and outputs native system package archives (`.deb`, `.pkg.tar.zst`, `.apk`).

### 1.2 Runtime & Concurrency Model
- **Synchronous, Blocking I/O**: The Python implementation relies heavily on synchronous `subprocess.run()`, blocking the main thread while network requests, extractions, or compilations happen.
- **Process Spawning**: It executes heavily using `os.environ` mutation and standard subprocess calls.
- **Single-Threaded Control Flow**: While the spawned builds (e.g., `make -j4`) utilize multi-core concurrency, the Python orchestrator itself drives the pipeline sequentially without `asyncio` or `multiprocessing`.

### 1.3 Core Data Structures & State
- **Data Flow**: The source of truth is the declarative `pkg.yml` file. This is loaded via PyYAML and parsed into immutable-style `dataclass` models (`PackageRecipe`, `ChannelOverride` in `scripts/core/parser.py`).
- **Statefulness**: The application state is mostly transient. State logic is computed by hashing the `pkg.yml` fields and patches into a `state_hash`. The build phases execute sequentially against the filesystem (`destdir`/`stage`), which inherently holds the intermediate state.
- **No Databases/Caches**: It uses pure disk-based directories for staging (`build/build_<pkg>/stage`) and artifacts. There is no external database or persistent cache daemon involved.

### 1.4 Third-Party Ecosystem
The current Python ecosystem heavily leans on standard libraries but uses the following critical dependencies:
- **`pydantic` / `dataclasses`**: For type-safe data modeling and validation of `pkg.yml`.
- **`pyyaml`**: For parsing recipe files.
- **`requests`**: For network fetching, interacting with GitHub APIs, and release asset downloading.
- **`packaging`**: For version string comparisons and semver logic (`scripts/cli/update_recipe.py`).
- **`hatchling` / `uv`**: Used for the Python build backend and dependency management.

---

## 2. Feasibility & Target Stack Analysis

### 2.1 Language Viability: TypeScript + Bun
**Target Selection**: **TypeScript via Bun** is objectively the superior choice for this specific workload.
- **Why?** Since RepoExe already builds and packages Bun natively for Termux (`pkg/bun`), migrating to Bun enables **"dogfooding"**.
- **Portability & Distribution**: Bun provides `bun build --compile`, generating a statically bundled, single-binary executable that drops the Python interpreter requirement entirely. This drastically reduces environment fragility on Termux.
- **AI Maintainability**: TypeScript provides strict structural typing, excellent compiler diagnostics, and massive LLM training representation.
- **OS Subprocesses**: Bun's native `Bun.spawn` and `Bun.file()` APIs are highly optimized for exact shell orchestrations this repo demands.

### 2.2 Library & Pattern Mapping

| Python Component | TypeScript (Bun) Equivalent | Role |
| :--- | :--- | :--- |
| `dataclasses` / `pydantic` | **Zod** or **TypeBox** | Strict runtime validation of `pkg.yml` schemas. |
| `pyyaml` | **yaml** (npm) or **js-yaml** | Parsing declarative `pkg.yml` recipes. |
| `requests` | Native **`fetch()`** API | Downloading archives and interacting with GitHub APIs. |
| `subprocess.run()` | **`Bun.spawnSync()`** / **`Bun.$`** (Shell tag) | Executing shell commands (`git`, `tar`, compilers). |
| `packaging.version` | **semver** (npm) | Version parsing and range comparisons. |
| `hashlib.sha256()` | **`Bun.CryptoHasher("sha256")`** | Computing state hashes from files/recipes. |
| `pytest` | **`bun test`** | Built-in native testing. |
| `uv` / `pyproject.toml` | **`package.json`** / **`bun install`** | Dependency and project management. |

### 2.3 Hard Blocker Check
- **No Blockers Detected**: The orchestrator's domain is strictly I/O, subprocess execution, file patching, and HTTP fetching. There are no specialized Python C-extensions (like NumPy or TensorFlow) in use. Bun fully covers all required OS interactions.

---

## 3. Phased Migration Roadmap

To prevent a "big bang" rewrite and ensure AI agents can safely and iteratively apply these changes, the migration will follow these phases. **Backward compatibility of `pkg.yml` and CLI arguments is strictly enforced at every step.**

### Phase 0: Environment & Foundation
- Initialize a `package.json` at the repo root.
- Add `tsconfig.json` optimized for Bun (`"target": "esnext"`, `"moduleResolution": "bundler"`).
- Set up **Biome** for fast, AI-friendly linting and formatting.
- Implement a basic `bun test` harness.
- Establish the entry point (`src/cli/index.ts`) with a dummy CLI parser that mirrors the current `build.py` arguments.

### Phase 1: Schemas & Type Contracts
- Translate `scripts/core/parser.py` into Zod schemas (`src/core/schema.ts`).
- Define exact TypeScript interfaces for `PackageRecipe`, `ChannelOverride`, and `ResourceConfig`.
- Implement the YAML parsing layer using `js-yaml` and validate the output against the Zod schema.
- Write unit tests against existing `pkg.yml` files (e.g., `pkg/bun/pkg.yml`) to guarantee 100% parsing parity.

### Phase 2: Core Domain Logic & Utilities
- Migrate state hashing logic (`compute_state_hash`) using `Bun.CryptoHasher`.
- Port file utilities (e.g., ELF linter, shebang sanitizer, bionic source patcher from `scripts/core/pipeline.py`).
- Implement the dependency resolver (`scripts/core/fetcher.py`).
- Maintain synchronicity: Use `Bun.spawnSync` to closely mirror Python's blocking behavior to prevent unforeseen race conditions during complex file operations.

### Phase 3: Build Pipeline & Execution
- Translate `execute_compile`, `execute_pack`, and `execute_test` (`scripts/core/pipeline.py`).
- Map environment variables tightly (Termux NDK, Bionic overrides, `CFLAGS`, `LDFLAGS`).
- Port package format builders (`scripts/builders/debian.py`, `pacman.py`, `alpine.py`) using `Bun.spawnSync` to execute `dpkg-deb`, `tar`, etc.
- **Important**: Ensure dynamic path routing (`/data/data/com.termux/files/usr`) behaves exactly as before.

### Phase 4: CLI Interface & Integrations
- Implement standard CLI routing (`build`, `compile`, `pack`, `test`, `check`) mimicking `argparse` using `util.parseArgs` or a lightweight CLI library (e.g., `cac`).
- Migrate auxiliary scripts: `scripts/cli/generate_shards.py`, `update_recipe.py`, `index_gen.py`.
- Wire up the full end-to-end flow from CLI input -> parse recipe -> compile -> pack.

### Phase 5: Parity Testing & Cutover
- Set up E2E scripts to run a build using both the legacy Python orchestrator and the new Bun orchestrator.
- Hash the output `.deb` / `.apk` archives from both systems to guarantee exact binary parity.
- Update `AGENTS.md` and CI workflows (`.github/workflows/*.yml`) to use `bun run src/cli/index.ts` instead of `uv run ruff/pytest`.
- Finally, use `bun build ./src/cli/index.ts --compile --outfile repoexe-cli` to produce the standalone binary.

---

## 4. Gotchas & Risk Register

When migrating from Python to TypeScript via Bun, AI coding agents must watch out for the following semantic risks:

1. **Synchronous vs. Asynchronous Shell Execution**:
   - *Python*: `subprocess.run()` is strictly blocking by default.
   - *TypeScript*: `Bun.spawn()` is asynchronous, while `Bun.spawnSync()` is blocking.
   - *Risk*: Accidentally using async spawns without `await` can cause race conditions (e.g., trying to strip an ELF binary before `make` finishes). **Mitigation**: Use `Bun.spawnSync()` to perfectly map Python's behavior unless parallel execution is explicitly designed.

2. **File Path Resolution**:
   - *Python*: `pathlib.Path` handles resolutions gracefully (e.g., `Path(__file__).resolve().parents[2]`).
   - *TypeScript*: Requires `path.resolve`, `path.join`, and `import.meta.url` or `import.meta.dir` in Bun.
   - *Risk*: Misresolving the `pkg/` directory when running from a compiled single binary. **Mitigation**: Use explicit absolute paths based on `process.cwd()` when compiled.

3. **Truthiness & Defaults**:
   - *Python*: Empty dictionaries `{}` and lists `[]` evaluate to `False`.
   - *TypeScript*: Empty objects `{}` and arrays `[]` evaluate to `true`.
   - *Risk*: A Python check like `if not recipe.patches:` will execute if the list is empty. In TS, `if (!recipe.patches)` will bypass the block if `patches` is `[]`. **Mitigation**: Always explicitly check length (`if (recipe.patches.length === 0)`).

4. **YAML Parsing Edge Cases**:
   - *Python*: PyYAML can parse float-looking strings as floats (e.g., `version: 26.3` becomes `26.3`).
   - *TypeScript*: `js-yaml` has similar quirks.
   - *Risk*: Zod schema validation failing due to type mismatches. **Mitigation**: Use `z.coerce.string()` in Zod schemas for fields like `version` to guarantee string outputs.

5. **Error Handling**:
   - *Python*: `raise RuntimeError()` halts execution and bubbles up.
   - *TypeScript*: Throwing `Error` works similarly, but unhandled promise rejections can behave differently.
   - *Risk*: Silent failures if `.catch()` is missing on async tasks. **Mitigation**: Stick to synchronous flows where possible, or use explicit `try/catch` with `process.exit(1)` on fatal build errors.
