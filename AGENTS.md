# Agent Instructions for RepoExe Development

Welcome, AI Assistant (Jules)! This document provides specific guidelines and tips for working effectively on the RepoExe codebase. Please adhere to these instructions in addition to your general knowledge and the user's direct requests.

## 1. Core Objective

Your primary goal is to assist in maintaining, refactoring, and enhancing the RepoExe multi-format package orchestrator, specifically facilitating its migration from Python to a natively executed TypeScript (Bun) architecture.

## 2. Environment Setup

If you need to initialize or reset the environment (especially on Termux or CI), use the following commands. These handle dependencies, system tools, and repository state.

```bash
# Ensure Bun is installed (using our own package if on Termux)
if ! command -v bun >/dev/null 2>&1; then
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
fi

# Install dependencies
bun install --frozen-lockfile --no-progress --no-summary
```

## 3. Understanding the Codebase (Migration Context)

Before implementing changes, understand that the codebase is currently migrating from Python to TypeScript (Bun).
- **Master Plan**: Refer to `plan.md` in the repository root for the migration roadmap, checklists, and handover context.
- **Project Structure**:
    - `pkg/`: Contains declarative YAML (`pkg.yml`) recipes and patches for building packages. **(Do not modify the format of these files unless explicitly instructed; backward compatibility is paramount).**
    - `scripts/`: (Legacy) Contains the old Python orchestrator (`build.py`, `core/`, `builders/`).
    - `src/`: (New) Will contain the TypeScript/Bun orchestrator.
- **Core Architecture**: The orchestrator spawns heavy OS-level processes (`git`, `tar`, compilers) to build native Android/Termux binaries.

## 4. Workflow and Task Management

- **Chat-First Workflow**: The primary mode of operation is through the chat session. Tasks, plans, and execution happen dynamically here.
- **Multiple Sessions**: Large migrations will span multiple sessions. Always update the `Handover Context` section in `plan.md` at the end of your session to ensure the next AI agent knows exactly where to pick up.

## 5. Code Style, Quality & Constraints

- **Strict Backward Compatibility**: The existing `pkg.yml` specification, package definitions, and current CLI flags/arguments must remain 100% intact.
- **Language**: TypeScript via Bun.
- **Linting & Formatting**: We use ESLint and Prettier (over Biome) to ensure 100% compatibility running natively on Termux (Android).
- **Synchronous Execution**: When porting Python code (which is blocking), use `Bun.spawnSync()` or `fs.readFileSync` to map behavior perfectly and avoid race conditions during heavy disk I/O, unless parallel execution is explicitly designed.
- **Truthiness**: Be careful with Python vs JS truthiness. `[]` and `{}` evaluate to `true` in TS. Explicitly check `.length === 0`.
- **Termux Paths**: Hardcoded Termux paths (e.g., `/data/data/com.termux/files/usr`) are intentional and required for native execution on Android. Do not genericize them to `/usr/local` unless dynamically resolving `$PREFIX`.

## 6. Planning and Communication

- **Use `set_plan()`**: Always articulate your plan using the `set_plan` tool before starting significant code changes. Check off items in `plan.md` as you progress.
- **Be Clear**: Make your plan steps clear and actionable.
- **Ask Questions**: If the user's request is ambiguous or if you encounter significant issues, use `request_user_input`.

## 7. Testing

- Run tests using `bun test`.
- Ensure tests validate that the TypeScript parser generates the exact same output as the legacy Python parser.
