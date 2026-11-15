# RepoExe Agent Guidelines

## 🧪 Testing & Verification Commands

- **Unit Tests (Bun Test):** `bun test --parallel`
- **Type Check (Bun Check):** `bun check`
- **Lint (Oxlint):** `bun run lint:check` (or `bun lint`)
- **Code Formatter (Bun Format):** `bun fmt --check` (or `bun fmt --staged`)
- **Recipe & Health Audit:** `bun run audit`
- **Build CLI:** `bun run build`
- **Generate Shards:** `bun run shards`

## 🏗️ Architectural Constraints

1.  **Site Directory:** The root `site/` folder is strictly for generated build artifacts (like `packages.json` and registry index HTML files) and is ignored in `.gitignore`. **All source files for the frontend (HTML/JS/CSS) and installation scripts must go in `scripts/site/`.** `scripts/cli/index_gen.ts` copies them over during CI.
2.  **Staging Directories:** Any temporary directories created during generation (like `apt_staging`) must be added to `.gitignore`.
3.  **Docker Builders:** All Docker configurations (e.g., `Dockerfile`, `runner.py`) must remain in `scripts/docker/` and are triggered by `docker.yml`. Tester image exclusively targets Bionic libc (`x11-repo`, `root-repo`) without `glibc-repo` or `glibc-runner`. Modifying `scripts/docker/` files returns an empty package matrix `[]` in `generate_shards.py` so package rebuilds are not falsely triggered.
4.  **No `__init__.py` in Deb Roots:** When building `.deb` packages via `scripts/builders/debian.py`, ensure source recipe metadata (`recipe.ts`, `pkg.yml`, `__init__.py`) are excluded from the archive root to prevent `dpkg` read-only errors on Termux.
5.  **GitHub Releases:** When using `gh release create` programmatically, do not pass `--clobber`. It is invalid for creation operations and causes silent failures.
6.  **Binary Dependency Invariants:** Binary `DEBIAN/control` files strictly forbid architecture qualifiers (`[arch]`). All architecture qualifiers must be filtered and stripped at packaging time via `scripts/core/dependencies.ts`. The repository targets APT (`.deb`) exclusively.
7.  **Bionic Compatibility Invariants:** All polyfill functions in `scripts/compat/bionic_compat.c` must compile with `-fvisibility=hidden` (`visibility("hidden")`) to prevent dynamically linked executables from exporting them and interposing over `libc.so` or external runtimes. External Bionic libc imports (`environ`, `__errno`, `__get_h_errno`) referenced inside hidden visibility regions must explicitly declare `visibility("default")`. Mathematical polyfills (`sincos`, `sincosf`) must use `optnone` / `optimize("O0")` to prevent compiler optimization loops.
8.  **Bionic Guile i18n Invariant:** Android Bionic's `<langinfo.h>` lacks `GROUPING` and `MON_GROUPING`. Cross-compiled GNU Guile bytecode (`ice-9/i18n.go`) calls `nl-langinfo(GROUPING)`, causing `number->locale-string` to throw `Unbound variable: GROUPING` on Android. Applications embedding Guile on Android must guard or monkey-patch `(ice-9 i18n)`'s `number->locale-string` (or fallback to `number->string`) to prevent unhandled runtime exceptions.
9.  **Pure APT Release & Asset Invariant:** The repository strictly targets Debian APT (`.deb`). Release tags are strictly named by package name (`${pkgName}`). Programmatic downloads of release assets with authentication tokens must query the GitHub release asset API endpoint (`asset.url`) with header `Accept: application/octet-stream` rather than `browser_download_url` to prevent authentication redirection failures.

## 🚀 Workflows & Runners

- All orchestration, compilation, and audit jobs (`generate-matrix`, `lint-audit`, `test-suite`, `build`, `publish-site`, `build-status`) execute strictly on standard x86_64 runners via `ubuntu-latest`.
- Builder and tester containers are compiled for `linux/amd64` using the official Google Android NDK cross-toolchain.
- Cross-architecture verification and smoke tests utilize QEMU user emulation (`docker/setup-qemu-action@v3`) seamlessly on the x86_64 host.
