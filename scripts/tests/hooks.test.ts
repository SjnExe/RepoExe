import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { postinstallTask, resolveGitDir } from '../hooks/postinstall.ts';
import {
  insertSetupAfterLeadingComments,
  maskGitHubExpressions,
  runPreCommitHook,
  shellHasErrexit,
  validateWorkflowScripts,
} from '../hooks/pre-commit.ts';

const tmpBase = process.env.TMPDIR || (process.env.PREFIX ? `${process.env.PREFIX}/tmp` : tmpdir());
const testDir = join(tmpBase, 'repoexe-hook-test-' + Date.now());

describe('pre-commit and postinstall hooks', () => {
  beforeAll(() => {
    mkdirSync(join(testDir, '.git', 'hooks'), { recursive: true });
    // Write fake HEAD
    Bun.write(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('resolves normal .git directory', async (): Promise<void> => {
    const gitDir = await resolveGitDir(join(testDir, '.git'));
    expect(gitDir).toBe(join(testDir, '.git'));
  });

  it('resolves gitdir pointers in worktree or submodules', async (): Promise<void> => {
    const worktreeDir = join(testDir, 'worktree');
    mkdirSync(worktreeDir, { recursive: true });
    await Bun.write(join(worktreeDir, '.git'), `gitdir: ../.git\n`);

    const gitDir = await resolveGitDir(join(worktreeDir, '.git'));
    expect(gitDir).toBe(join(testDir, '.git'));
  });

  it('installs pre-commit hook in git repository via postinstallTask', async (): Promise<void> => {
    const installed = await postinstallTask(join(testDir, '.git'));
    expect(installed).toBe(true);

    const hookFile = Bun.file(join(testDir, '.git', 'hooks', 'pre-commit'));
    expect(await hookFile.exists()).toBe(true);
    const content = await hookFile.text();
    expect(content).toContain('bun scripts/hooks/pre-commit.ts');
  });

  it('skips hook binding when not in a git repo', async (): Promise<void> => {
    const nonGitDir = join(testDir, 'nongit');
    mkdirSync(nonGitDir, { recursive: true });
    const installed = await postinstallTask(join(nonGitDir, '.git'));
    expect(installed).toBe(false);
  });

  it('runs runPreCommitHook successfully with options', async (): Promise<void> => {
    const success = await runPreCommitHook({
      stagedFiles: [],
      skipFormat: true,
      skipHealthCheck: false,
      skipTests: true, // Avoid recursive test spawning inside test runner
      skipActionlint: true,
      quiet: true,
    });
    expect(success).toBe(true);
  }, 15000);

  it('correctly masks GitHub Actions expressions with nested quotes', (): void => {
    expect(maskGitHubExpressions("echo ${{ '}}' }}")).toBe('echo __GH_EXPR__');
    expect(maskGitHubExpressions("echo ${{ 'it''s ok }}' }}")).toBe('echo __GH_EXPR__');
    expect(maskGitHubExpressions('val=${{ github.event.issue.number }}')).toBe('val=__GH_EXPR__');
  });

  it('accepts workflow scripts with expression placeholders that would trigger SC2157', async (): Promise<void> => {
    if (Bun.which('shellcheck') === null) {
      return;
    }
    const wfDir = join(testDir, 'wf-sc2157');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'sc2157.yml'),
      `name: Test SC2157
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: |
          if [ -z "\${{ env.OPTIONAL }}" ]; then echo empty; fi
`,
    );
    const result = await validateWorkflowScripts(wfDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('skips validation for Windows runners defaulting to PowerShell and verifies dispatch via recording checker', async (): Promise<void> => {
    const wfDir = join(testDir, 'wf-windows');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'windows.yml'),
      `name: Windows Job
jobs:
  build:
    runs-on: windows-latest
    steps:
      - run: if ($true) { Write-Host "Hello from Windows PowerShell" }
  linux-control:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Hello from Linux Bash"
`,
    );
    const recorded: Array<{ script: string; dialect: string }> = [];
    const recordingChecker = async (script: string, dialect: 'sh' | 'bash'): Promise<{ ok: boolean }> => {
      recorded.push({ script, dialect });
      return { ok: true };
    };

    const result = await validateWorkflowScripts(wfDir, recordingChecker);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].script).toContain('Hello from Linux Bash');
    expect(recorded[0].dialect).toBe('bash');
  });

  it('validates container jobs using POSIX sh dialect', async (): Promise<void> => {
    if (Bun.which('shellcheck') === null) {
      return;
    }
    const validDir = join(testDir, 'wf-container-valid');
    mkdirSync(validDir, { recursive: true });
    // Valid POSIX sh script should pass
    await Bun.write(
      join(validDir, 'container-valid.yml'),
      `name: Container Valid
jobs:
  test:
    runs-on: ubuntu-latest
    container: alpine:latest
    steps:
      - run: test 1 -eq 1 && echo "OK"
`,
    );
    const validResult = await validateWorkflowScripts(validDir);
    expect(validResult.ok).toBe(true);

    const invalidDir = join(testDir, 'wf-container-invalid');
    mkdirSync(invalidDir, { recursive: true });
    // Bashism ([[ ... ]]) in container job should be flagged under sh dialect
    await Bun.write(
      join(invalidDir, 'container-invalid.yml'),
      `name: Container Invalid
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: alpine:latest
    steps:
      - run: if [[ 1 == 1 ]]; then echo "Bashism"; fi
`,
    );
    const invalidResult = await validateWorkflowScripts(invalidDir);
    expect(invalidResult.ok).toBe(false);
    expect(
      invalidResult.errors.some((err: string): boolean => err.includes('SC3010') || err.includes('POSIX sh')),
    ).toBe(true);
  });

  it('validates default Linux shell script with cd src followed by echo ready without SC2164', async (): Promise<void> => {
    if (Bun.which('shellcheck') === null) {
      return;
    }
    const wfDir = join(testDir, 'wf-default-shell-cd');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'cd-test.yml'),
      `name: Default Shell CD
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          cd src
          echo ready
`,
    );
    const result = await validateWorkflowScripts(wfDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('verifies shell startup option injection and errexit detection', (): void => {
    expect(shellHasErrexit('bash -e {0}')).toBe(true);
    expect(shellHasErrexit('bash {0}')).toBe(false);
    expect(shellHasErrexit('sh -o errexit {0}')).toBe(true);
    const withSetup = insertSetupAfterLeadingComments('cd src\necho ok', 'set -eo pipefail\n');
    expect(withSetup).toBe('set -eo pipefail\ncd src\necho ok');
  });
});
