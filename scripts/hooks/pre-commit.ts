import { accessSync, constants, existsSync, readdirSync, rmSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, delimiter, dirname, join, relative } from 'node:path';

import { $ } from 'bun';

/** Resolves the actionlint executable, preferring ~/.local/bin/actionlint if executable. */
export function resolveActionlintBinary(): string | null {
  const localActionlint = join(homedir(), '.local', 'bin', 'actionlint');
  if (existsSync(localActionlint)) {
    try {
      if (statSync(localActionlint).isFile()) {
        accessSync(localActionlint, constants.X_OK);
        return localActionlint;
      }
    } catch {}
  }
  return Bun.which('actionlint');
}

/** Ensures that Termux or custom environment PATH entries include PREFIX/bin. */
export function ensurePrefixPath(): void {
  if (process.env.PREFIX) {
    const prefixBinDir = join(process.env.PREFIX, 'bin');
    const pathEntries = (process.env.PATH ?? '').split(delimiter);
    if (!pathEntries.includes(prefixBinDir)) {
      process.env.PATH = `${prefixBinDir}${delimiter}${process.env.PATH ?? ''}`;
    }
  }
}

/** Options for customizing pre-commit hook execution during tests or CI. */
export interface PreCommitOptions {
  stagedFiles?: string[];
  skipFormat?: boolean;
  skipTypeCheck?: boolean;
  skipLint?: boolean;
  skipHealthCheck?: boolean;
  skipActionlint?: boolean;
  skipTests?: boolean;
  quiet?: boolean;
}

import { getStagedWorkflowsSnapshot, validateWorkflowScripts } from './workflow_lint.ts';
export * from './workflow_lint.ts';

/**
 * Runs the pre-commit hook validation pipeline using Bun-native tools.
 *
 * @param options - Optional configuration overriding stages.
 * @returns Resolves with true if all pre-commit checks pass, false otherwise.
 */
export async function runPreCommitHook(options?: PreCommitOptions): Promise<boolean> {
  ensurePrefixPath();

  try {
    if (!options?.quiet) {
      console.log('🔍 Running RepoExe pre-commit verification...');
    }

    // 1. Stage and format via native Bun formatter
    if (!options?.skipFormat) {
      if (!options?.quiet) {
        console.log('🎨 Formatting staged files via bun fmt --staged...');
      }
      await $`bun fmt --staged`.quiet();
    }

    // 2. Incremental TypeScript type check via native bun check
    if (!options?.skipTypeCheck) {
      if (!options?.quiet) {
        console.log('⚡ Running incremental type check via bun check...');
      }
      const checkTypes = await $`bun check`.nothrow().quiet();
      if (checkTypes.exitCode !== 0) {
        console.error(
          `=== Type Check Failed (Exit: ${checkTypes.exitCode}) ===\n${checkTypes.stdout}${checkTypes.stderr}`,
        );
        console.error('\n❌ Pre-commit type checks failed.');
        return false;
      }
    }

    // 3. Fast linting via Oxlint
    if (!options?.skipLint) {
      if (!options?.quiet) {
        console.log('📋 Linting via oxlint...');
      }
      const lintRes = await $`bunx oxlint`.nothrow().quiet();
      if (lintRes.exitCode !== 0) {
        console.error(
          `=== Oxlint Check Failed (Exit: ${lintRes.exitCode}) ===\n${lintRes.stdout}${lintRes.stderr}`,
        );
        console.error('\n❌ Pre-commit lint checks failed.');
        return false;
      }
    }

    // 4. RepoExe orchestrator health check
    if (!options?.skipHealthCheck) {
      if (!options?.quiet) {
        console.log('🏥 Running RepoExe build system & recipe health check...');
      }
      const checkResult = await $`bun scripts/cli/build.ts check`.nothrow();
      if (checkResult.exitCode !== 0) {
        console.error(
          `=== Health Check Failed (Exit: ${checkResult.exitCode}) ===\n${checkResult.stdout}${checkResult.stderr}`,
        );
        console.error('\n❌ Health check failed.');
        return false;
      }
    }

    // 5. GitHub Actions workflow validation via actionlint
    if (!options?.skipActionlint) {
      const isTermux =
        Boolean(process.env.TERMUX_VERSION) || (process.env.PREFIX || '').includes('com.termux');
      const actionlintBin = resolveActionlintBinary();

      const hasShellcheck = Bun.which('shellcheck') !== null;
      const willRunWorkflows = Boolean(actionlintBin || (isTermux && hasShellcheck));

      if (willRunWorkflows) {
        const stagedWorkflowDir = getStagedWorkflowsSnapshot('.github/workflows');
        try {
          if (actionlintBin) {
            if (!options?.quiet) {
              console.log('🐙 Validating GitHub Actions workflows via actionlint...');
            }
            const tmpRoot =
              basename(dirname(stagedWorkflowDir)) === '.github'
                ? dirname(dirname(stagedWorkflowDir))
                : dirname(stagedWorkflowDir);
            const workflowFiles = existsSync(stagedWorkflowDir)
              ? readdirSync(stagedWorkflowDir)
                  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
                  .map((f) => relative(tmpRoot, join(stagedWorkflowDir, f)))
              : [];

            if (workflowFiles.length > 0) {
              const args = isTermux ? ['-shellcheck=', ...workflowFiles] : workflowFiles;
              const res = await $`${actionlintBin} ${args}`.cwd(tmpRoot).nothrow().quiet();

              if (res.exitCode !== 0) {
                console.error(
                  `=== Actionlint Check Failed (Exit: ${res.exitCode}) ===\n${res.stdout}${res.stderr}`,
                );
                console.error('\n❌ Workflow checks failed.');
                return false;
              }
            }
          }

          // On Termux, actionlint requires -shellcheck="" to prevent SIGSYS (faccessat2) crashes.
          // Validate embedded workflow scripts via native Termux shellcheck for parity with CI.
          // Always run on Termux even when actionlint is absent, as long as shellcheck is available.
          if (isTermux && hasShellcheck) {
            const scRes = await validateWorkflowScripts(stagedWorkflowDir);
            if (!scRes.ok) {
              console.error(`=== Workflow Shellcheck Failed ===\n${scRes.errors.join('\n\n')}`);
              console.error('\n❌ Workflow shellcheck checks failed.');
              return false;
            }
          }
        } finally {
          if (stagedWorkflowDir !== '.github/workflows' && existsSync(stagedWorkflowDir)) {
            const tmpRoot =
              basename(dirname(stagedWorkflowDir)) === '.github'
                ? dirname(dirname(stagedWorkflowDir))
                : dirname(stagedWorkflowDir);
            rmSync(tmpRoot, { recursive: true, force: true });
          }
        }
      }
    }

    // 6. Unit test suite execution
    if (!options?.skipTests) {
      if (!options?.quiet) {
        console.log('🧪 Running Bun unit test suite...');
      }
      const testResult = await $`bun test --parallel`.nothrow();
      if (testResult.exitCode !== 0) {
        console.error(
          `=== Unit Tests Failed (Exit: ${testResult.exitCode}) ===\n${testResult.stdout}${testResult.stderr}`,
        );
        console.error('\n❌ Unit test suite failed.');
        return false;
      }
    }

    if (!options?.quiet) {
      console.log('✨ All RepoExe pre-commit checks passed!');
    }
    return true;
  } catch (error) {
    console.error('Pre-commit hook exception:', error);
    return false;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: PreCommitOptions = {
    skipFormat: args.includes('--skip-format'),
    skipTypeCheck: args.includes('--skip-type-check'),
    skipLint: args.includes('--skip-lint'),
    skipHealthCheck: args.includes('--skip-check'),
    skipActionlint: args.includes('--skip-actionlint'),
    skipTests: args.includes('--skip-tests'),
  };

  const success = await runPreCommitHook(options);
  if (!success) {
    process.exit(1);
  }
}
