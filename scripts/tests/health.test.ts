import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

      expect(() => auditRepositoryHealth(testDir)).toThrow(/Invalid patch filename 'fix\.diff'/);
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

      expect(() => auditRepositoryHealth(testDir)).toThrow(
        /Patch entry '0001-fix\.diff'.*is not a regular file/,
      );
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

      expect(() => auditRepositoryHealth(testDir)).toThrow(/Invalid patch filename 'fix\.diff'/);
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

  it('accepts properly 4-digit numbered implicit patches in health check', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `health-implicit-valid-${Date.now()}`);
    const pkgDir = join(testDir, 'implicitpkg');
    mkdirSync(pkgDir, { recursive: true });

    writeFileSync(
      join(pkgDir, 'recipe.ts'),
      `export default {
  name: 'implicitpkg',
  version: '1.0.0',
  revision: 0,
  arch: 'aarch64',
  description: 'implicit pkg',
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

  it('accepts explicit declared patches even if unused unnumbered patch exists in directory', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `health-explicit-unused-${Date.now()}`);
    const pkgDir = join(testDir, 'explicitpkg');
    mkdirSync(pkgDir, { recursive: true });

    writeFileSync(
      join(pkgDir, 'recipe.ts'),
      `export default {
  name: 'explicitpkg',
  version: '1.0.0',
  revision: 0,
  arch: 'aarch64',
  description: 'explicit pkg',
  patches: ['0001-fix.diff'],
  phases: { make: 'echo 1' },
};
`,
    );

    const patchDir = join(pkgDir, 'patches');
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(join(patchDir, '0001-fix.diff'), '--- a\n+++ b\n');
    writeFileSync(join(patchDir, 'fix.diff'), '--- a\n+++ b\n');

    const report = auditRepositoryHealth(testDir);
    expect(report.valid_packages).toBe(1);

    rmSync(testDir, { recursive: true, force: true });
  });

  it('ignores non-file patch-shaped directories when recipe.patches is explicitly declared', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `health-explicit-nonfile-${Date.now()}`);
    const pkgDir = join(testDir, 'explicitdirpkg');
    const patchDir = join(pkgDir, 'patches');
    mkdirSync(join(patchDir, 'unused.patch'), { recursive: true });

    try {
      writeFileSync(
        join(pkgDir, 'recipe.ts'),
        `export default {
  name: 'explicitdirpkg',
  version: '1.0.0',
  revision: 0,
  arch: 'aarch64',
  description: 'explicit pkg with unused patch dir',
  patches: ['0001-fix.patch'],
  phases: { make: 'echo 1' },
};
`,
      );
      writeFileSync(join(patchDir, '0001-fix.patch'), '--- a\n+++ b\n');

      const report = auditRepositoryHealth(testDir);
      expect(report.valid_packages).toBe(1);
    } finally {
      rmSync(testDir, { recursive: true, force: true });
    }
  });
});
