import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanStageElfs, getPackageSourceDateEpoch, normalizeStageDir, prepareDebianDir } from '../builders/debian.ts';
import { cleanupPackageOutputs } from '../cli/build.ts';
import type { PackageRecipe } from '../core/types.ts';
import { createRecipe } from './fixtures.ts';

describe('Debian Packaging & Reproducibility Helpers (scripts/builders/debian.ts)', (): void => {
  test('getPackageSourceDateEpoch respects SOURCE_DATE_EPOCH override', (): void => {
    const old = process.env.SOURCE_DATE_EPOCH;
    try {
      process.env.SOURCE_DATE_EPOCH = '1700000000';
      expect(getPackageSourceDateEpoch()).toBe(1700000000);
    } finally {
      if (old !== undefined) {
        process.env.SOURCE_DATE_EPOCH = old;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
    }
  });

  test('getPackageSourceDateEpoch returns package commit timestamp or HEAD fallback', (): void => {
    const old = process.env.SOURCE_DATE_EPOCH;
    delete process.env.SOURCE_DATE_EPOCH;
    const testRepo = join(process.env.TMPDIR || tmpdir(), `git-epoch-${Date.now()}`);
    mkdirSync(join(testRepo, 'pkg', 'aisleriot'), { recursive: true });
    spawnSync('git', ['init', testRepo], { stdio: 'ignore' });
    spawnSync('git', ['-C', testRepo, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore' });
    spawnSync('git', ['-C', testRepo, 'config', 'user.name', 'Test User'], { stdio: 'ignore' });

    try {
      // Commit 1: touches pkg/aisleriot (older timestamp: 1704067200)
      writeFileSync(join(testRepo, 'pkg', 'aisleriot', 'recipe.ts'), 'export default {};');
      spawnSync('git', ['-C', testRepo, 'add', '.'], { stdio: 'ignore' });
      const c1 = spawnSync('git', ['-C', testRepo, 'commit', '--no-gpg-sign', '-m', 'pkg commit'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2024-01-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2024-01-01T00:00:00Z',
        },
      });
      expect(c1.status).toBe(0);

      // Commit 2: touches outside pkg/aisleriot (newer timestamp: 1717200000)
      writeFileSync(join(testRepo, 'README.md'), '# Repo');
      spawnSync('git', ['-C', testRepo, 'add', '.'], { stdio: 'ignore' });
      const c2 = spawnSync('git', ['-C', testRepo, 'commit', '--no-gpg-sign', '-m', 'root commit'], {
        stdio: 'ignore',
        env: {
          ...process.env,
          GIT_AUTHOR_DATE: '2024-06-01T00:00:00Z',
          GIT_COMMITTER_DATE: '2024-06-01T00:00:00Z',
        },
      });
      expect(c2.status).toBe(0);

      const headEpoch = getPackageSourceDateEpoch(undefined, testRepo);
      const pkgEpoch = getPackageSourceDateEpoch(join(testRepo, 'pkg', 'aisleriot'), testRepo);

      expect(headEpoch).toBe(1717200000);
      expect(pkgEpoch).toBe(1704067200);
      expect(headEpoch).not.toBe(pkgEpoch);

      process.env.SOURCE_DATE_EPOCH = '0';
      expect(getPackageSourceDateEpoch(undefined, testRepo)).toBe(0);
    } finally {
      if (old !== undefined) {
        process.env.SOURCE_DATE_EPOCH = old;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
      rmSync(testRepo, { recursive: true, force: true });
    }
  });

  test('getPackageSourceDateEpoch returns constant fallback when git log unavailable', (): void => {
    const old = process.env.SOURCE_DATE_EPOCH;
    delete process.env.SOURCE_DATE_EPOCH;
    const emptyDir = join(
      process.env.TMPDIR || tmpdir(),
      `empty-repo-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(emptyDir, { recursive: true });
    spawnSync('git', ['init', '-q', emptyDir]);
    try {
      expect(getPackageSourceDateEpoch(undefined, emptyDir)).toBe(1704067200);
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
      if (old !== undefined) {
        process.env.SOURCE_DATE_EPOCH = old;
      }
    }
  });

  test('normalizeStageDir enforces uniform modes and timestamps', (): void => {
    const testDir = join(
      process.env.TMPDIR || tmpdir(),
      `norm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const binDir = join(testDir, 'bin');
    const libDir = join(testDir, 'lib');
    const shareBinDir = join(testDir, 'usr', 'share', 'sample', 'bin');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(libDir, { recursive: true });
    mkdirSync(shareBinDir, { recursive: true });

    const execFile = join(binDir, 'mytool');
    const regularFile = join(libDir, 'data.txt');
    const soFile = join(libDir, 'libfoo.so');
    const shareFile = join(shareBinDir, 'nonexec.txt');

    writeFileSync(execFile, '#!/bin/sh\necho ok\n');
    writeFileSync(regularFile, 'some text\n');
    writeFileSync(soFile, 'elf data');
    writeFileSync(shareFile, 'documentation or non-exec data\n');
    chmodSync(shareFile, 0o644);

    const targetEpoch = 1704067200; // 2024-01-01 00:00:00 UTC
    normalizeStageDir(testDir, targetEpoch);

    const execStat = statSync(execFile);
    expect(execStat.mode & 0o777).toBe(0o755);
    expect(Math.floor(execStat.mtimeMs / 1000)).toBe(targetEpoch);

    const regularStat = statSync(regularFile);
    expect(regularStat.mode & 0o777).toBe(0o644);
    expect(Math.floor(regularStat.mtimeMs / 1000)).toBe(targetEpoch);

    const soStat = statSync(soFile);
    expect(soStat.mode & 0o777).toBe(0o755);
    expect(Math.floor(soStat.mtimeMs / 1000)).toBe(targetEpoch);

    const shareStat = statSync(shareFile);
    expect(shareStat.mode & 0o777).toBe(0o644);
    expect(Math.floor(shareStat.mtimeMs / 1000)).toBe(targetEpoch);

    rmSync(testDir, { recursive: true, force: true });
  });

  test('cleanStageElfs throws when termux-elf-cleaner fails with nonzero exit (Thread #2)', (): void => {
    const testDir = join(
      process.env.TMPDIR || tmpdir(),
      `elf-fail-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    mkdirSync(testDir, { recursive: true });
    const elfFile = join(testDir, 'bad_elf');
    // Write ELF magic header (0x7f, 'E', 'L', 'F') followed by data
    const buf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x01, 0x02]);
    writeFileSync(elfFile, buf);

    // Mock cleaner using a script that exits with 1 and writes diagnostic message
    const mockCleaner = join(testDir, 'mock-cleaner.sh');
    writeFileSync(mockCleaner, '#!/bin/sh\necho "mock cleaner exit failure" >&2\nexit 1\n');
    chmodSync(mockCleaner, 0o755);

    try {
      expect(() => cleanStageElfs(testDir, mockCleaner)).toThrow(/mock cleaner exit failure/);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('prepareDebianDir throws when declared conffile is missing from all stages (Thread #3)', (): void => {
    const testDir = join(
      process.env.TMPDIR || tmpdir(),
      `conffile-missing-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const stageDir = join(testDir, 'stage');
    const pkgDir = join(testDir, 'pkg');
    mkdirSync(stageDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });

    writeFileSync(join(pkgDir, 'conffiles'), '/data/data/com.termux/files/usr/etc/missing.conf\n');

    const recipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
    });

    try {
      expect(() => prepareDebianDir(recipe, testDir, pkgDir, stageDir)).toThrow(
        /Conffile '\/data\/data\/com.termux\/files\/usr\/etc\/missing.conf' declared in conffiles does not exist in stage or any subpackage stage/,
      );
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('cleanupPackageOutputs removes stale .deb for package and subpackages, preserving unrelated packages with matching key', (): void => {
    const testOut = join(process.env.TMPDIR || tmpdir(), `debian-cleanup-${Date.now()}`);
    mkdirSync(testOut, { recursive: true });

    try {
      writeFileSync(join(testOut, 'sample_1.0_aarch64.deb'), 'deb');
      writeFileSync(join(testOut, 'sample-dev_1.0_aarch64.deb'), 'deb');
      writeFileSync(join(testOut, 'sample_metadata.json'), '{}');
      writeFileSync(join(testOut, 'other_1.0_aarch64.deb'), 'keep');
      writeFileSync(join(testOut, 'dev_1.0_aarch64.deb'), 'keep unrelated dev prefix');

      const recipe: PackageRecipe = createRecipe({
        name: 'sample',
        version: '1.0.0',
        subpackages: {
          dev: { name: 'sample-dev', include: ['include/**'] },
        },
      });

      cleanupPackageOutputs(recipe, testOut);

      expect(existsSync(join(testOut, 'sample_1.0_aarch64.deb'))).toBeFalse();
      expect(existsSync(join(testOut, 'sample-dev_1.0_aarch64.deb'))).toBeFalse();
      expect(existsSync(join(testOut, 'sample_metadata.json'))).toBeFalse();
      expect(existsSync(join(testOut, 'other_1.0_aarch64.deb'))).toBeTrue();
      expect(existsSync(join(testOut, 'dev_1.0_aarch64.deb'))).toBeTrue();
    } finally {
      rmSync(testOut, { recursive: true, force: true });
    }
  });
});
