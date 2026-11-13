import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { postinstallTask, resolveGitDir } from '../hooks/postinstall.ts';
import { runPreCommitHook } from '../hooks/pre-commit.ts';

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

  it('resolves normal .git directory', async () => {
    const gitDir = await resolveGitDir(join(testDir, '.git'));
    expect(gitDir).toBe(join(testDir, '.git'));
  });

  it('resolves gitdir pointers in worktree or submodules', async () => {
    const worktreeDir = join(testDir, 'worktree');
    mkdirSync(worktreeDir, { recursive: true });
    await Bun.write(join(worktreeDir, '.git'), `gitdir: ../.git\n`);

    const gitDir = await resolveGitDir(join(worktreeDir, '.git'));
    expect(gitDir).toBe(join(testDir, '.git'));
  });

  it('installs pre-commit hook in git repository via postinstallTask', async () => {
    const installed = await postinstallTask(join(testDir, '.git'));
    expect(installed).toBe(true);

    const hookFile = Bun.file(join(testDir, '.git', 'hooks', 'pre-commit'));
    expect(await hookFile.exists()).toBe(true);
    const content = await hookFile.text();
    expect(content).toContain('bun scripts/hooks/pre-commit.ts');
  });

  it('skips hook binding when not in a git repo', async () => {
    const nonGitDir = join(testDir, 'nongit');
    mkdirSync(nonGitDir, { recursive: true });
    const installed = await postinstallTask(join(nonGitDir, '.git'));
    expect(installed).toBe(false);
  });

  it('runs runPreCommitHook successfully with options', async () => {
    const success = await runPreCommitHook({
      stagedFiles: [],
      skipFormat: true,
      skipHealthCheck: false,
      skipTests: true, // Avoid recursive test spawning inside test runner
      skipActionlint: true,
      quiet: true,
    });
    expect(success).toBe(true);
  });
});
