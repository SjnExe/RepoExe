import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  linkSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { prepareDebianDir } from '../builders/debian.ts';
import { splitSubpackages } from '../core/subpkg.ts';
import type { PackageRecipe } from '../core/types.ts';
import { createRecipe } from './fixtures.ts';

describe('Subpackage Engine (scripts/core/subpkg.ts)', () => {
  let testDir: string;
  let stageDir: string;

  beforeEach((): void => {
    testDir = join(process.env.TMPDIR || tmpdir(), `subpkg-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    stageDir = join(testDir, 'stage');
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/include'), { recursive: true });
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/lib/pkgconfig'), { recursive: true });
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/share/man/man1'), { recursive: true });
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc/sample'), { recursive: true });
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/bin/nested'), { recursive: true });

    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/include/sample.h'), '#define SAMPLE 1\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/lib/pkgconfig/sample.pc'), 'Name: sample\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/lib/libsample.a'), 'dummy archive');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/lib/libsample.so'), 'dummy shared obj');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/share/man/man1/sample.1'), '.TH SAMPLE 1\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc/sample/README.md'), '# Sample\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/bin/sample-cli'), '#!/bin/sh\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/bin/nested/sub-tool'), '#!/bin/sh\n');
  });

  afterEach((): void => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  test('splits auto:dev and auto:doc subpackages correctly', (): void => {
    const parentRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '2.4.0',
      revision: 2,
      arch: 'aarch64',
      subpackages: ['auto:dev', 'auto:doc'],
    });

    const childResults = splitSubpackages(parentRecipe, stageDir, testDir);
    expect(childResults).toHaveLength(2);

    const devSub = childResults.find((c) => c.recipe.name === 'sample-dev');
    expect(devSub).toBeDefined();
    expect(devSub?.recipe.arch).toBe('aarch64');
    expect(devSub?.recipe.deps).toContain('sample (= 2.4.0-2)');

    const devStage = join(testDir, 'stage_sample-dev');
    expect(existsSync(join(devStage, 'data/data/com.termux/files/usr/include/sample.h'))).toBeTrue();
    expect(existsSync(join(devStage, 'data/data/com.termux/files/usr/lib/pkgconfig/sample.pc'))).toBeTrue();
    expect(existsSync(join(devStage, 'data/data/com.termux/files/usr/lib/libsample.a'))).toBeTrue();

    // Verify moved files no longer exist in parent stage
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/include/sample.h'))).toBeFalse();
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/lib/pkgconfig/sample.pc'))).toBeFalse();
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/lib/libsample.a'))).toBeFalse();

    // Shared library must remain in parent stage
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/lib/libsample.so'))).toBeTrue();

    const docSub = childResults.find((c) => c.recipe.name === 'sample-doc');
    expect(docSub).toBeDefined();
    expect(docSub?.recipe.arch).toBe('all');
    expect(docSub?.recipe.deps).toContain('sample (= 2.4.0-2)');

    const docStage = join(testDir, 'stage_sample-doc');
    expect(existsSync(join(docStage, 'data/data/com.termux/files/usr/share/man/man1/sample.1'))).toBeTrue();
    expect(existsSync(join(docStage, 'data/data/com.termux/files/usr/share/doc/sample/README.md'))).toBeTrue();
  });

  test('splits custom subpackages with parent_dep pinned', (): void => {
    const parentRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      revision: 0,
      epoch: 1,
      arch: 'arm',
      arches: ['arm'],
      formats: ['apt'],
      description: 'Sample parent',
      deps: [],
      build_deps: [],
      subpackages: {
        'sample-tools': {
          name: 'sample-tools',
          description: 'Sample CLI tools',
          include: ['bin/*'],
          parent_dep: 'same-version',
        },
      },
    });

    const childResults = splitSubpackages(parentRecipe, stageDir, testDir);
    expect(childResults).toHaveLength(1);

    const toolsSub = childResults[0];
    expect(toolsSub.recipe.name).toBe('sample-tools');
    expect(toolsSub.recipe.arch).toBe('arm');
    expect(toolsSub.recipe.deps).toContain('sample (>= 1:1.0.0)');

    const toolsStage = join(testDir, 'stage_sample-tools');
    expect(existsSync(join(toolsStage, 'data/data/com.termux/files/usr/bin/sample-cli'))).toBeTrue();
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/bin/sample-cli'))).toBeFalse();

    // Verify non-recursive bin/* did NOT match nested file bin/nested/sub-tool
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/bin/nested/sub-tool'))).toBeTrue();
    expect(existsSync(join(toolsStage, 'data/data/com.termux/files/usr/bin/nested/sub-tool'))).toBeFalse();
  });

  test('splits subpackages preserving valid and dangling symlinks', (): void => {
    const incDir = join(stageDir, 'data/data/com.termux/files/usr/include');
    symlinkSync('sample.h', join(incDir, 'valid-link.h'));
    symlinkSync('nonexistent.h', join(incDir, 'dangling-link.h'));

    const parentRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      arches: ['aarch64'],
      formats: ['apt'],
      description: 'Sample parent',
      deps: [],
      build_deps: [],
      subpackages: {
        'sample-dev': {
          name: 'sample-dev',
          include: ['include/**'],
        },
      },
    });

    const splits = splitSubpackages(parentRecipe, stageDir, testDir);
    expect(splits).toHaveLength(1);

    const devStage = join(testDir, 'stage_sample-dev');
    const validLink = join(devStage, 'data/data/com.termux/files/usr/include/valid-link.h');
    const danglingLink = join(devStage, 'data/data/com.termux/files/usr/include/dangling-link.h');

    expect(readlinkSync(validLink)).toBe('sample.h');
    expect(readlinkSync(danglingLink)).toBe('nonexistent.h');
  });

  test('re-running splitSubpackages restores from immutable compiled stage', (): void => {
    const firstRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      arches: ['aarch64'],
      formats: ['apt'],
      description: 'Sample parent',
      deps: [],
      build_deps: [],
      subpackages: {
        'sample-dev': {
          name: 'sample-dev',
          include: ['include/**'],
        },
      },
    });

    splitSubpackages(firstRecipe, stageDir, testDir);
    expect(existsSync(join(testDir, 'stage_sample-dev/data/data/com.termux/files/usr/include/sample.h'))).toBeTrue();
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/include/sample.h'))).toBeFalse();

    // Now re-split with sample-sdk instead of sample-dev
    const secondRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      arches: ['aarch64'],
      formats: ['apt'],
      description: 'Sample parent',
      deps: [],
      build_deps: [],
      subpackages: {
        'sample-sdk': {
          name: 'sample-sdk',
          include: ['include/**'],
        },
      },
    });

    splitSubpackages(secondRecipe, stageDir, testDir);
    expect(existsSync(join(testDir, 'stage_sample-sdk/data/data/com.termux/files/usr/include/sample.h'))).toBeTrue();
    expect(existsSync(join(testDir, 'stage_sample-dev'))).toBeFalse();

    // Now call with empty subpackages: should restore stage from stage_compiled and remove stage_sample-sdk
    const thirdRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      arches: ['aarch64'],
      formats: ['apt'],
      description: 'Sample parent',
      deps: [],
      build_deps: [],
      subpackages: {},
    });

    const thirdResults = splitSubpackages(thirdRecipe, stageDir, testDir);
    expect(thirdResults).toHaveLength(0);
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/include/sample.h'))).toBeTrue();
    expect(existsSync(join(testDir, 'stage_sample-sdk'))).toBeFalse();
  });

  test('cleans up temporary snapshot directory after snapshot completion or failure', (): void => {
    const parentRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      subpackages: {
        'sample-dev': {
          name: 'sample-dev',
          include: ['include/**'],
        },
      },
    });

    // 1. Simulate failed copy leaving partial temporary directory
    const failingCopy = (_src: string, dst: string): void => {
      mkdirSync(dst, { recursive: true });
      writeFileSync(join(dst, 'partial.txt'), 'corrupted');
      throw new Error('Simulated snapshot copy failure');
    };

    expect(() => splitSubpackages(parentRecipe, stageDir, testDir, 'aarch64', failingCopy)).toThrow(
      'Simulated snapshot copy failure',
    );

    // Assert that temporary directory is removed and original stage remains intact
    const entriesAfterFail = existsSync(testDir) ? readdirSync(testDir) : [];
    const tmpDirsAfterFail = entriesAfterFail.filter((e) => e.startsWith('.stage_compiled.tmp-'));
    expect(tmpDirsAfterFail.length).toBe(0);
    expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/include/sample.h'))).toBeTrue();

    // 2. Assert that subsequent attempt succeeds
    const results = splitSubpackages(parentRecipe, stageDir, testDir);
    expect(results).toHaveLength(1);
    expect(results[0].recipe.name).toBe('sample-dev');
    expect(existsSync(join(testDir, '.stage_compiled'))).toBeTrue();
    const entriesAfterSuccess = existsSync(testDir) ? readdirSync(testDir) : [];
    const tmpDirsAfterSuccess = entriesAfterSuccess.filter((e) => e.startsWith('.stage_compiled.tmp-'));
    expect(tmpDirsAfterSuccess.length).toBe(0);
  });

  test('prepareDebianDir partitions explicit conffiles between parent and subpackages based on stage ownership (Thread #6)', (): void => {
    const pkgDir = join(testDir, 'pkg-sample');
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(
      join(pkgDir, 'conffiles'),
      '/data/data/com.termux/files/usr/etc/parent.conf\n/data/data/com.termux/files/usr/etc/sub.conf\n',
    );

    const parentEtc = join(stageDir, 'data/data/com.termux/files/usr/etc');
    mkdirSync(parentEtc, { recursive: true });
    writeFileSync(join(parentEtc, 'parent.conf'), 'parent config');

    const subStageDir = join(testDir, 'stage_sample-sub');
    const subEtc = join(subStageDir, 'data/data/com.termux/files/usr/etc');
    mkdirSync(subEtc, { recursive: true });
    writeFileSync(join(subEtc, 'sub.conf'), 'sub config');
    writeFileSync(join(subEtc, 'unlisted.conf'), 'unlisted config');

    const parentRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      arches: ['aarch64'],
      formats: ['apt'],
      description: 'Sample parent',
      deps: [],
      build_deps: [],
      subpackages: {},
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    });

    const subRecipe: PackageRecipe = createRecipe({
      name: 'sample-sub',
      version: '1.0.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      formats: ['apt'],
      description: 'Sample subpackage',
      deps: [],
      build_deps: [],
      subpackages: {},
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    });

    prepareDebianDir(parentRecipe, testDir, pkgDir, stageDir);
    const parentConffiles = Bun.file(join(stageDir, 'DEBIAN/conffiles'));
    expect(parentConffiles.size).toBeGreaterThan(0);
    const parentText = readFileSync(join(stageDir, 'DEBIAN/conffiles'), 'utf-8');
    expect(parentText).toContain('/data/data/com.termux/files/usr/etc/parent.conf');
    expect(parentText).not.toContain('/data/data/com.termux/files/usr/etc/sub.conf');

    prepareDebianDir(subRecipe, testDir, undefined, subStageDir, pkgDir);
    const subConffiles = Bun.file(join(subStageDir, 'DEBIAN/conffiles'));
    expect(subConffiles.size).toBeGreaterThan(0);
    const subText = readFileSync(join(subStageDir, 'DEBIAN/conffiles'), 'utf-8');
    expect(subText).toContain('/data/data/com.termux/files/usr/etc/sub.conf');
    expect(subText).not.toContain('/data/data/com.termux/files/usr/etc/parent.conf');
    expect(subText).not.toContain('/data/data/com.termux/files/usr/etc/unlisted.conf');
  });

  test('rejects subpackage declaring architecture mismatch with compiled target (Thread #22)', (): void => {
    const parentRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      arch: 'arm',
      subpackages: {
        'sample-arm': {
          name: 'sample-arm',
          arch: 'arm',
          include: ['bin/**'],
        },
      },
    });

    expect(() => splitSubpackages(parentRecipe, stageDir, testDir, 'aarch64')).toThrow(
      /which does not match compiled target architecture 'aarch64'/,
    );
  });

  test('preserves hard links when creating and restoring snapshot (Thread #21)', (): void => {
    // Create two hard-linked files in the stage directory if supported by filesystem
    const file1 = join(stageDir, 'data/data/com.termux/files/usr/bin/link1');
    const file2 = join(stageDir, 'data/data/com.termux/files/usr/bin/link2');
    writeFileSync(file1, 'hardlinked content');
    let canHardlink = true;
    try {
      linkSync(file1, file2);
    } catch {
      canHardlink = false;
    }

    const parentRecipe: PackageRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      arch: 'aarch64',
      subpackages: {
        tools: {
          name: 'sample-tools',
          include: ['bin/**'],
        },
      },
    });

    // Run splitSubpackages twice to trigger snapshot save and restore
    splitSubpackages(parentRecipe, stageDir, testDir, 'aarch64');
    const results = splitSubpackages(parentRecipe, stageDir, testDir, 'aarch64');
    expect(results).toHaveLength(1);

    if (canHardlink) {
      const childStage = results[0].stageDir;
      const childFile1 = join(childStage, 'data/data/com.termux/files/usr/bin/link1');
      const childFile2 = join(childStage, 'data/data/com.termux/files/usr/bin/link2');

      expect(existsSync(childFile1)).toBeTrue();
      expect(existsSync(childFile2)).toBeTrue();
      expect(statSync(childFile1).ino).toBe(statSync(childFile2).ino);
    }
  });

  test('Finding #11: removes empty read-only source directories, preserves child modes, and supports re-splitting', (): void => {
    const lockedDir = join(stageDir, 'data/data/com.termux/files/usr/share/doc/locked');
    mkdirSync(lockedDir, { recursive: true });
    writeFileSync(join(lockedDir, 'manual.txt'), 'readonly manual\n');
    chmodSync(lockedDir, 0o555);
    chmodSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc'), 0o555);

    const parentRecipe = createRecipe({
      name: 'sample',
      version: '1.0.0',
      arch: 'aarch64',
      subpackages: {
        doc: { name: 'sample-doc', arch: 'all', include: ['share/doc/**'] },
      },
    });

    try {
      const first = splitSubpackages(parentRecipe, stageDir, testDir, 'aarch64');
      expect(first).toHaveLength(1);

      const childLocked = join(first[0].stageDir, 'data/data/com.termux/files/usr/share/doc/locked');
      expect(existsSync(join(childLocked, 'manual.txt'))).toBeTrue();
      expect(statSync(childLocked).mode & 0o777).toBe(0o555);

      // Empty read-only directories must be pruned from parent stage (no EACCES leak)
      expect(existsSync(lockedDir)).toBeFalse();
      expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc'))).toBeFalse();

      // Re-running splitSubpackages restores cleanly from .stage_compiled despite 0o555 modes
      const second = splitSubpackages(parentRecipe, stageDir, testDir, 'aarch64');
      expect(second).toHaveLength(1);
      expect(
        existsSync(join(second[0].stageDir, 'data/data/com.termux/files/usr/share/doc/locked/manual.txt')),
      ).toBeTrue();
    } finally {
      // Ensure afterEach rmSync can clean up read-only snapshot dirs
      const chmodAll = (d: string): void => {
        if (!existsSync(d)) {
          return;
        }
        try {
          chmodSync(d, 0o755);
        } catch {}
        for (const e of readdirSync(d, { withFileTypes: true })) {
          if (e.isDirectory()) {
            chmodAll(join(d, e.name));
          }
        }
      };
      chmodAll(testDir);
    }
  });
});
