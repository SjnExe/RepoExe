import { delimiter, join } from 'node:path';

import { $ } from 'bun';

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
  skipTests?: boolean;
  quiet?: boolean;
}

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
        console.error(`=== Oxlint Check Failed (Exit: ${lintRes.exitCode}) ===\n${lintRes.stdout}${lintRes.stderr}`);
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

    // 5. Unit test suite execution
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
    skipTests: args.includes('--skip-tests'),
  };

  const success = await runPreCommitHook(options);
  if (!success) {
    process.exit(1);
  }
}
