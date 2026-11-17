import { spawnSync } from 'node:child_process';
import {
  accessSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';

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
  skipActionlint?: boolean;
  skipTests?: boolean;
  quiet?: boolean;
}

export function maskGitHubExpressions(script: string): string {
  let result = '';
  let i = 0;
  while (i < script.length) {
    if (script.startsWith('${{', i)) {
      let j = i + 3;
      let inString = false;
      let closed = false;
      while (j < script.length) {
        if (inString) {
          if (script[j] === "'") {
            if (script[j + 1] === "'") {
              j += 2;
              continue;
            } else {
              inString = false;
            }
          }
          j++;
        } else {
          if (script[j] === "'") {
            inString = true;
            j++;
          } else if (script.startsWith('}}', j)) {
            j += 2;
            closed = true;
            break;
          } else {
            j++;
          }
        }
      }
      if (!closed) {
        throw new Error('Unterminated GitHub Actions expression ${{ in script.');
      }
      result += '__GH_EXPR__';
      i = j;
    } else {
      result += script[i];
      i++;
    }
  }
  return result;
}

function isWindowsRunner(runsOn: unknown): boolean {
  if (typeof runsOn === 'string') {
    return runsOn.toLowerCase().includes('windows');
  }
  if (Array.isArray(runsOn)) {
    return runsOn.some((r) => typeof r === 'string' && r.toLowerCase().includes('windows'));
  }
  if (runsOn && typeof runsOn === 'object') {
    const labels = (runsOn as Record<string, unknown>).labels;
    if (typeof labels === 'string') {
      return labels.toLowerCase().includes('windows');
    }
    if (Array.isArray(labels)) {
      return labels.some((r) => typeof r === 'string' && r.toLowerCase().includes('windows'));
    }
  }
  return false;
}

function hasContainer(container: unknown): boolean {
  if (typeof container === 'string') {
    return container.trim().length > 0;
  }
  if (container && typeof container === 'object') {
    return true;
  }
  return false;
}

export function shellHasErrexit(rawShell?: string): boolean {
  if (!rawShell) {
    return false;
  }
  const tokens = rawShell.trim().split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '-o' && tokens[i + 1] === 'errexit') {
      return true;
    }
    if (t.startsWith('-') && !t.startsWith('--')) {
      if (t.slice(1).includes('e')) {
        return true;
      }
    }
  }
  return false;
}

export function insertSetupAfterLeadingComments(content: string, setup: string): string {
  const lines = content.split('\n');
  let insertIdx = 0;
  while (insertIdx < lines.length) {
    const trimmed = lines[insertIdx].trim();
    if (trimmed.startsWith('#') || trimmed === '') {
      insertIdx++;
    } else {
      break;
    }
  }
  const before = lines.slice(0, insertIdx);
  const after = lines.slice(insertIdx);
  return [...before, setup.trimEnd(), ...after].join('\n');
}

export function getStagedWorkflowsSnapshot(workflowDir = '.github/workflows'): string {
  const lsProc = spawnSync('git', ['ls-files', '--cached', '-z', workflowDir], { encoding: 'utf-8' });
  const indexedFiles =
    lsProc.status === 0 && lsProc.stdout
      ? lsProc.stdout
          .split('\0')
          .filter((f) => f.length > 0 && dirname(f) === workflowDir && (f.endsWith('.yml') || f.endsWith('.yaml')))
      : [];

  if (indexedFiles.length === 0) {
    if (!existsSync(workflowDir)) {
      return workflowDir;
    }
    const diskFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
    if (diskFiles.length === 0) {
      return workflowDir;
    }
  }

  const tmpSnapshotDir = join(
    process.env.TMPDIR || tmpdir(),
    `staged-workflows-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tmpSnapshotDir, { recursive: true });

  try {
    if (indexedFiles.length > 0) {
      for (const gitPath of indexedFiles) {
        const baseName = gitPath.split('/').pop()!;
        const gitShow = spawnSync('git', ['show', `:${gitPath}`], { encoding: 'utf-8' });
        if (gitShow.status !== 0 || gitShow.stdout === null) {
          throw new Error(
            `Failed to read staged blob for '${gitPath}' from git index: ${gitShow.stderr || 'unknown error'}`,
          );
        }
        writeFileSync(join(tmpSnapshotDir, baseName), gitShow.stdout, 'utf-8');
      }
    } else {
      const diskFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
      for (const file of diskFiles) {
        copyFileSync(join(workflowDir, file), join(tmpSnapshotDir, file));
      }
    }
    return tmpSnapshotDir;
  } catch (err) {
    rmSync(tmpSnapshotDir, { recursive: true, force: true });
    throw err;
  }
}

/** Validates embedded bash run scripts in workflow files using native shellcheck. */
export async function validateWorkflowScripts(
  workflowDir = '.github/workflows',
  checker?: (script: string, dialect: 'sh' | 'bash') => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; errors: string[] }> {
  if (!existsSync(workflowDir) || (!checker && Bun.which('shellcheck') === null)) {
    return { ok: true, errors: [] };
  }
  const errors: string[] = [];
  const files = readdirSync(workflowDir).filter((f: string): boolean => f.endsWith('.yml') || f.endsWith('.yaml'));

  for (const file of files) {
    const fullPath = join(workflowDir, file);
    const content = readFileSync(fullPath, 'utf-8');
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(content);
    } catch (e) {
      errors.push(`[${file}] Failed to parse YAML: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (!parsed || typeof parsed !== 'object') {
      continue;
    }
    const parsedObj = parsed as Record<string, unknown>;
    const jobs = parsedObj.jobs;
    if (!jobs || typeof jobs !== 'object') {
      continue;
    }

    const getShellString = (val: unknown, location: string): string | undefined => {
      if (val === undefined || val === null) {
        return undefined;
      }
      if (typeof val === 'string') {
        return val;
      }
      errors.push(`[${file}] Malformed shell option at ${location}: expected string, got ${typeof val}`);
      return undefined;
    };

    const workflowDefaults =
      parsedObj.defaults && typeof parsedObj.defaults === 'object'
        ? (parsedObj.defaults as Record<string, unknown>)
        : undefined;
    const workflowRun =
      workflowDefaults?.run && typeof workflowDefaults.run === 'object'
        ? (workflowDefaults.run as Record<string, unknown>)
        : undefined;
    const workflowShell = getShellString(workflowRun?.shell, 'defaults.run.shell');

    for (const [jobId, rawJob] of Object.entries(jobs as Record<string, unknown>)) {
      if (!rawJob || typeof rawJob !== 'object') {
        continue;
      }
      const job = rawJob as Record<string, unknown>;
      const jobDefaults =
        job.defaults && typeof job.defaults === 'object' ? (job.defaults as Record<string, unknown>) : undefined;
      const jobRun =
        jobDefaults?.run && typeof jobDefaults.run === 'object'
          ? (jobDefaults.run as Record<string, unknown>)
          : undefined;
      const jobShell = getShellString(jobRun?.shell, `job '${jobId}' defaults.run.shell`) || workflowShell;

      const defaultShell = hasContainer(job.container) ? 'sh' : isWindowsRunner(job['runs-on']) ? 'pwsh' : 'bash';
      const steps = Array.isArray(job.steps) ? job.steps : [];

      for (let i = 0; i < steps.length; i++) {
        const rawStep = steps[i];
        if (!rawStep || typeof rawStep !== 'object') {
          continue;
        }
        const step = rawStep as Record<string, unknown>;
        if (typeof step.run !== 'string') {
          continue;
        }

        const stepShell = getShellString(step.shell, `step ${i + 1} (${jobId})`);
        const rawShell = (stepShell || jobShell || '').trim();
        const effectiveShell = (stepShell || jobShell || defaultShell).trim();
        const rawToken = effectiveShell.split(/\s+/)[0] || '';
        const shellBinary = basename(rawToken).toLowerCase();

        // Skip steps with non-shell interpreters (e.g. python, node, pwsh)
        const isBash = shellBinary === 'bash';
        const isSh = shellBinary === 'sh';
        if (!isBash && !isSh) {
          continue;
        }

        const dialect = isSh ? 'sh' : 'bash';
        const script = step.run;
        if (!script.trim()) {
          continue;
        }

        // Mask GitHub Actions expressions ${{ ... }} with dummy identifier in a quote-aware manner
        const masked = maskGitHubExpressions(script);

        // Prepend shell-option setup for built-in/default shells enabling workflow execution options (e.g. errexit)
        const isBuiltinBash = rawShell === 'bash' || (!rawShell && isBash);
        const isBuiltinSh = rawShell === 'sh' || (!rawShell && isSh);
        let prefix = '';
        if (isBuiltinBash) {
          prefix = 'set -eo pipefail\n';
        } else if (isBuiltinSh) {
          prefix = 'set -e\n';
        } else if (rawShell && shellHasErrexit(rawShell)) {
          prefix = 'set -e\n';
        }

        let toCheck = masked;
        if (prefix) {
          toCheck = insertSetupAfterLeadingComments(toCheck, prefix);
        }

        if (checker) {
          const checkRes = await checker(toCheck, dialect);
          if (!checkRes.ok) {
            errors.push(`[${file}] Step ${i + 1} (${jobId}): ${checkRes.error || 'ShellCheck validation failed'}`);
          }
          continue;
        }

        const proc = Bun.spawn(
          ['shellcheck', '--norc', '-s', dialect, '-e', 'SC2296,SC1083,SC2153,SC2154,SC2050,SC1091,SC2157,SC2043', '-'],
          {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        proc.stdin.write(toCheck);
        proc.stdin.end();

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
          const combined =
            [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || `shellcheck exited with code ${exitCode}`;
          const stepLabel = step.name || step.id || `step ${i + 1}`;
          errors.push(`[${file}: job '${jobId}', ${stepLabel}]\n${combined}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
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

    // 5. GitHub Actions workflow validation via actionlint
    if (!options?.skipActionlint) {
      const isTermux = Boolean(process.env.TERMUX_VERSION) || (process.env.PREFIX || '').includes('com.termux');
      const localActionlint = join(homedir(), '.local', 'bin', 'actionlint');
      let actionlintBin: string | null = null;
      let isLocalExec = false;
      if (existsSync(localActionlint)) {
        try {
          accessSync(localActionlint, constants.X_OK);
          isLocalExec = true;
        } catch {}
      }
      if (isLocalExec) {
        actionlintBin = localActionlint;
      } else {
        actionlintBin = Bun.which('actionlint');
      }

      const hasShellcheck = Bun.which('shellcheck') !== null;
      const willRunWorkflows = Boolean(actionlintBin || (isTermux && hasShellcheck));

      if (willRunWorkflows) {
        const stagedWorkflowDir = getStagedWorkflowsSnapshot('.github/workflows');
        try {
          if (actionlintBin) {
            if (!options?.quiet) {
              console.log('🐙 Validating GitHub Actions workflows via actionlint...');
            }
            const workflowFiles = existsSync(stagedWorkflowDir)
              ? readdirSync(stagedWorkflowDir)
                  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
                  .map((f) => join(stagedWorkflowDir, f))
              : [];

            if (workflowFiles.length > 0) {
              const args = isTermux ? ['-shellcheck=', ...workflowFiles] : workflowFiles;
              const res = await $`${actionlintBin} ${args}`.nothrow().quiet();

              if (res.exitCode !== 0) {
                console.error(`=== Actionlint Check Failed (Exit: ${res.exitCode}) ===\n${res.stdout}${res.stderr}`);
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
            rmSync(stagedWorkflowDir, { recursive: true, force: true });
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
