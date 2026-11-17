import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { cleanupPackageOutputs } from '../cli/build.ts';
import { auditRepositoryHealth } from '../utils/health.ts';

describe('health and cleanup helpers', (): void => {
  it('rejects unnumbered declared patch filenames in health check', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `health-test-${Date.now()}`);
    const pkgDir = join(testDir, 'testpkg');
    const patchDir = join(pkgDir, 'patches');
    mkdirSync(patchDir, { recursive: true });

    try {
      writeFileSync(
        join(pkgDir, 'recipe.ts'),
        `export default {
  name: 'testpkg',
  version: '1.0.0',
  revision: 0,
  arch: 'aarch64',
  description: 'test pkg',
  patches: ['fix.diff'],
  phases: { make: 'echo 1' },
};
`,
      );
      writeFileSync(join(patchDir, 'fix.diff'), '--- a\n+++ b\n');

      expect(() => auditRepositoryHealth(testDir)).toThrow(/Repository health check failed with 1 error/);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('rejects implicit patch entries that are directories', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `health-dir-patch-test-${Date.now()}`);
    const pkgDir = join(testDir, 'dirpatchpkg');
    const patchDir = join(pkgDir, 'patches', '0001-fix.diff');
    mkdirSync(patchDir, { recursive: true });

    try {
      writeFileSync(
        join(pkgDir, 'recipe.ts'),
        `export default {
  name: 'dirpatchpkg',
  version: '1.0.0',
  revision: 0,
  arch: 'aarch64',
  description: 'dir patch pkg',
  phases: { make: 'echo 1' },
};
`,
      );

      expect(() => auditRepositoryHealth(testDir)).toThrow(/Repository health check failed with 1 error/);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('rejects undeclared unnumbered .diff patch in health check', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `health-diff-test-${Date.now()}`);
    const pkgDir = join(testDir, 'diffpkg');
    const patchDir = join(pkgDir, 'patches');
    mkdirSync(patchDir, { recursive: true });

    try {
      writeFileSync(
        join(pkgDir, 'recipe.ts'),
        `export default {
  name: 'diffpkg',
  version: '1.0.0',
  revision: 0,
  arch: 'aarch64',
  description: 'diff pkg',
  phases: { make: 'echo 1' },
};
`,
      );
      writeFileSync(join(patchDir, 'fix.diff'), '--- a\n+++ b\n');

      expect(() => auditRepositoryHealth(testDir)).toThrow(/Repository health check failed with 1 error/);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('accepts properly 4-digit numbered declared patches in health check', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `health-valid-${Date.now()}`);
    const pkgDir = join(testDir, 'validpkg');
    mkdirSync(pkgDir, { recursive: true });

    writeFileSync(
      join(pkgDir, 'recipe.ts'),
      `export default {
  name: 'validpkg',
  version: '1.0.0',
  revision: 0,
  arch: 'aarch64',
  description: 'valid pkg',
  patches: ['0001-fix.diff'],
  phases: { make: 'echo 1' },
};
`,
    );

    const patchDir = join(pkgDir, 'patches');
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(join(patchDir, '0001-fix.diff'), '--- a\n+++ b\n');

    const report = auditRepositoryHealth(testDir);
    expect(report.valid_packages).toBe(1);

    rmSync(testDir, { recursive: true, force: true });
  });

  it('cleanupPackageOutputs removes matching debs and metadata json', (): void => {
    const testOut = join(process.env.TMPDIR || tmpdir(), `out-cleanup-${Date.now()}`);
    mkdirSync(testOut, { recursive: true });

    try {
      writeFileSync(join(testOut, 'sample_1.0_aarch64.deb'), 'deb');
      writeFileSync(join(testOut, 'sample-dev_1.0_aarch64.deb'), 'deb');
      writeFileSync(join(testOut, 'sample_metadata.json'), '{}');
      writeFileSync(join(testOut, 'other_1.0_aarch64.deb'), 'keep');
      writeFileSync(join(testOut, 'dev_1.0_aarch64.deb'), 'keep unrelated dev prefix');

      const fakeRecipe = {
        name: 'sample',
        subpackages: {
          dev: { name: 'sample-dev' },
        },
      };

      cleanupPackageOutputs(fakeRecipe as any, testOut);

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
