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
  skipHealthCheck?: boolean;
  skipTests?: boolean;
  skipActionlint?: boolean;
  quiet?: boolean;
}

/**
 * Runs the pre-commit hook validation pipeline.
 *
 * @param options - Optional configuration overriding staged files or skipping verification stages.
 * @returns Resolves with true if all pre-commit checks pass, false otherwise.
 */
export async function runPreCommitHook(options?: PreCommitOptions): Promise<boolean> {
  ensurePrefixPath();

  try {
    let stagedFiles = options?.stagedFiles;
    if (!stagedFiles) {
      const stagedOutput = await $`git diff --cached --name-only -z --diff-filter=ACMR`.text();
      stagedFiles = stagedOutput.split('\0').filter(Boolean);
    }

    if (!options?.quiet) {
      console.log('🔍 Running RepoExe pre-commit verification...');
    }

    // 1. Stage and format inspection
    if (stagedFiles.length > 0 && !options?.skipFormat) {
      const existingFiles: string[] = [];
      for (const f of stagedFiles) {
        if (await Bun.file(f).exists()) {
          existingFiles.push(f);
        }
      }

      const formattableFiles = existingFiles.filter(
        (f) => /\.(js|ts|json|ya?ml|md)$/.test(f) && !f.includes('node_modules/') && !f.includes('.git/'),
      );

      if (formattableFiles.length > 0) {
        const unstagedFiles = new Set<string>();
        try {
          const unstagedOutput = await $`git diff --name-only -z -- ${formattableFiles}`.quiet().text();
          for (const f of unstagedOutput.split('\0').filter(Boolean)) {
            unstagedFiles.add(f);
          }
        } catch (err) {
          console.error('Failed to inspect unstaged changes:', err);
          return false;
        }

        const fullyStagedFiles = formattableFiles.filter((f) => !unstagedFiles.has(f));
        const partiallyStagedFiles = formattableFiles.filter((f) => unstagedFiles.has(f));

        if (fullyStagedFiles.length > 0) {
          if (!options?.quiet) {
            console.log(`🎨 Formatting ${fullyStagedFiles.length} fully staged file(s)...`);
          }
          await $`bun fmt ${fullyStagedFiles}`.quiet();
          await $`git add ${fullyStagedFiles}`.quiet();
        }

        if (partiallyStagedFiles.length > 0 && !options?.quiet) {
          console.log(`ℹ️  Skipped re-staging for ${partiallyStagedFiles.length} partially staged file(s).`);
        }
      }
    }

    // 2. Actionlint validation (if workflow files are affected or actionlint is available)
    if (!options?.skipActionlint) {
      const hasWorkflowChanges = stagedFiles.some((f) => f.startsWith('.github/workflows/'));
      const actionlintCmd = await $`which actionlint`.quiet().nothrow();
      if (actionlintCmd.exitCode === 0) {
        if (hasWorkflowChanges || stagedFiles.length === 0) {
          if (!options?.quiet) {
            console.log('📋 Linting GitHub Workflows with actionlint...');
          }
          const alResult = await $`actionlint`.nothrow();
          if (alResult.exitCode !== 0) {
            console.error(
              `=== Actionlint Failed (Exit: ${alResult.exitCode}) ===\n${alResult.stderr || alResult.stdout}`,
            );
            return false;
          }
        }
      }
    }

    // 3. RepoExe orchestrator health check
    if (!options?.skipHealthCheck) {
      if (!options?.quiet) {
        console.log('🏥 Running RepoExe build system & recipe health check...');
      }
      const checkResult = await $`bun run scripts/cli/build.ts check`.nothrow();
      if (checkResult.exitCode !== 0) {
        console.error(
          `=== Health Check Failed (Exit: ${checkResult.exitCode}) ===\n${checkResult.stdout}${checkResult.stderr}`,
        );
        console.error('\n❌ Health check failed.');
        return false;
      }
    }

    // 4. Unit test suite execution
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
    skipHealthCheck: args.includes('--skip-check'),
    skipTests: args.includes('--skip-tests'),
    skipActionlint: args.includes('--skip-actionlint'),
  };

  const success = await runPreCommitHook(options);
  if (!success) {
    process.exit(1);
  }
}
