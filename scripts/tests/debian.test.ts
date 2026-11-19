import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  buildAllDebs,
  cleanStageElfs,
  extractDebianField,
  generateAptMetadata,
  generateControlFile,
  getPackageSourceDateEpoch,
  normalizeStageDir,
  prepareDebianDir,
} from '../builders/debian.ts';
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
    const oldIndex = process.env.GIT_INDEX_FILE;
    delete process.env.SOURCE_DATE_EPOCH;
    delete process.env.GIT_INDEX_FILE;

    const gitEnv = { ...process.env };
    delete gitEnv.GIT_INDEX_FILE;
    delete gitEnv.GIT_DIR;
    delete gitEnv.GIT_WORK_TREE;
    delete gitEnv.GIT_OBJECT_DIRECTORY;
    delete gitEnv.GIT_COMMON_DIR;

    const testRepo = join(process.env.TMPDIR || tmpdir(), `git-epoch-${Date.now()}`);
    mkdirSync(join(testRepo, 'pkg', 'aisleriot'), { recursive: true });
    spawnSync('git', ['init', testRepo], { stdio: 'ignore', env: gitEnv });
    spawnSync('git', ['-C', testRepo, 'config', 'user.email', 'test@example.com'], { stdio: 'ignore', env: gitEnv });
    spawnSync('git', ['-C', testRepo, 'config', 'user.name', 'Test User'], { stdio: 'ignore', env: gitEnv });
    const emptyHooks = join(testRepo, '.empty_hooks');
    mkdirSync(emptyHooks, { recursive: true });
    spawnSync('git', ['-C', testRepo, 'config', 'core.hooksPath', emptyHooks], { stdio: 'ignore', env: gitEnv });

    try {
      // Commit 1: touches pkg/aisleriot (distinct from fallback 1704067200: 1706745600)
      const rFile = join('pkg', 'aisleriot', 'recipe.ts');
      writeFileSync(join(testRepo, rFile), 'export default {};');
      const add1 = spawnSync('git', ['-C', testRepo, 'add', '-f', rFile], { stdio: 'ignore', env: gitEnv });
      expect(add1.status).toBe(0);
      const c1 = spawnSync(
        'git',
        ['-C', testRepo, '-c', `core.hooksPath=${emptyHooks}`, 'commit', '--no-gpg-sign', '-m', 'pkg commit'],
        {
          stdio: 'ignore',
          env: {
            ...gitEnv,
            GIT_AUTHOR_DATE: '2024-02-01T00:00:00Z',
            GIT_COMMITTER_DATE: '2024-02-01T00:00:00Z',
          },
        },
      );
      expect(c1.status).toBe(0);

      // Commit 2: touches outside pkg/aisleriot (newer timestamp: 1717200000)
      writeFileSync(join(testRepo, 'README.md'), '# Repo');
      const add2 = spawnSync('git', ['-C', testRepo, 'add', '-f', 'README.md'], { stdio: 'ignore', env: gitEnv });
      expect(add2.status).toBe(0);
      const c2 = spawnSync(
        'git',
        ['-C', testRepo, '-c', `core.hooksPath=${emptyHooks}`, 'commit', '--no-gpg-sign', '-m', 'root commit'],
        {
          stdio: 'ignore',
          env: {
            ...gitEnv,
            GIT_AUTHOR_DATE: '2024-06-01T00:00:00Z',
            GIT_COMMITTER_DATE: '2024-06-01T00:00:00Z',
          },
        },
      );
      expect(c2.status).toBe(0);

      const headEpoch = getPackageSourceDateEpoch(undefined, testRepo);
      const pkgEpoch = getPackageSourceDateEpoch(join(testRepo, 'pkg', 'aisleriot'), testRepo);

      expect(headEpoch).toBe(1717200000);
      expect(pkgEpoch).toBe(1706745600);
      expect(headEpoch).not.toBe(pkgEpoch);

      process.env.SOURCE_DATE_EPOCH = '0';
      expect(getPackageSourceDateEpoch(undefined, testRepo)).toBe(0);
    } finally {
      if (old !== undefined) {
        process.env.SOURCE_DATE_EPOCH = old;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
      if (oldIndex !== undefined) {
        process.env.GIT_INDEX_FILE = oldIndex;
      } else {
        delete process.env.GIT_INDEX_FILE;
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

  test('normalizeStageDir normalizes control permissions, preserves payload modes, and clamps timestamps', (): void => {
    const testDir = join(
      process.env.TMPDIR || tmpdir(),
      `norm-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    const debianDir = join(testDir, 'DEBIAN');
    const binDir = join(testDir, 'bin');
    const secretDir = join(testDir, 'etc', 'ssl', 'private');
    mkdirSync(debianDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });
    mkdirSync(secretDir, { recursive: true });
    chmodSync(secretDir, 0o700);

    const controlFile = join(debianDir, 'control');
    const postinstFile = join(debianDir, 'postinst');
    const execFile = join(binDir, 'mytool');
    const secretKeyFile = join(secretDir, 'server.key');

    writeFileSync(controlFile, 'Package: test\n');
    writeFileSync(postinstFile, '#!/bin/sh\nexit 0\n');
    writeFileSync(execFile, '#!/bin/sh\necho ok\n');
    chmodSync(execFile, 0o755);
    writeFileSync(secretKeyFile, 'secret-data\n');
    chmodSync(secretKeyFile, 0o600);

    // Seed noncanonical modes to verify normalizeStageDir fixes them
    chmodSync(debianDir, 0o700);
    chmodSync(controlFile, 0o600);
    chmodSync(postinstFile, 0o644);

    const targetEpoch = 1704067200; // 2024-01-01 00:00:00 UTC
    normalizeStageDir(testDir, targetEpoch);

    // Control files and DEBIAN directory have fixed permissions
    const debianStat = statSync(debianDir);
    expect(debianStat.mode & 0o777).toBe(0o755);
    expect(Math.floor(debianStat.mtimeMs / 1000)).toBe(targetEpoch);

    const controlStat = statSync(controlFile);
    expect(controlStat.mode & 0o777).toBe(0o644);
    expect(Math.floor(controlStat.mtimeMs / 1000)).toBe(targetEpoch);

    const postinstStat = statSync(postinstFile);
    expect(postinstStat.mode & 0o777).toBe(0o755);
    expect(Math.floor(postinstStat.mtimeMs / 1000)).toBe(targetEpoch);

    // Deliberate payload modes are preserved
    const secretDirStat = statSync(secretDir);
    expect(secretDirStat.mode & 0o777).toBe(0o700);
    expect(Math.floor(secretDirStat.mtimeMs / 1000)).toBe(targetEpoch);

    const secretFileStat = statSync(secretKeyFile);
    expect(secretFileStat.mode & 0o777).toBe(0o600);
    expect(Math.floor(secretFileStat.mtimeMs / 1000)).toBe(targetEpoch);

    const execStat = statSync(execFile);
    expect(execStat.mode & 0o777).toBe(0o755);
    expect(Math.floor(execStat.mtimeMs / 1000)).toBe(targetEpoch);

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

  test('cleanupPackageOutputs matches subpackage definition by name when checking producer_arch', (): void => {
    const testOut = join(process.env.TMPDIR || tmpdir(), `debian-cleanup-sub-${Date.now()}`);
    mkdirSync(testOut, { recursive: true });

    try {
      writeFileSync(join(testOut, 'my-pkg_1.0_arm.deb'), 'deb');
      writeFileSync(join(testOut, 'my-pkg-doc_1.0_all.deb'), 'deb');

      const recipe: PackageRecipe = createRecipe({
        name: 'my-pkg',
        version: '1.0.0',
        arches: ['arm', 'aarch64'],
        subpackages: {
          doc: { name: 'my-pkg-doc', arch: 'all', producer_arch: 'aarch64', include: ['share/doc/**'] },
        },
      });

      // On ARM (non-producer of doc), doc should NOT be cleaned up
      cleanupPackageOutputs(recipe, testOut, 'arm');

      expect(existsSync(join(testOut, 'my-pkg_1.0_arm.deb'))).toBeFalse();
      expect(existsSync(join(testOut, 'my-pkg-doc_1.0_all.deb'))).toBeTrue();
    } finally {
      rmSync(testOut, { recursive: true, force: true });
    }
  });

  test('cleanupPackageOutputs resolves same default producer arch when arches order is arm, aarch64', (): void => {
    const testOut = join(process.env.TMPDIR || tmpdir(), `debian-cleanup-sub-default-${Date.now()}`);
    mkdirSync(testOut, { recursive: true });

    try {
      writeFileSync(join(testOut, 'my-pkg_1.0_arm.deb'), 'deb');
      writeFileSync(join(testOut, 'my-pkg-doc_1.0_all.deb'), 'deb');

      const recipe: PackageRecipe = createRecipe({
        name: 'my-pkg',
        version: '1.0.0',
        arches: ['arm', 'aarch64'],
        subpackages: {
          doc: { name: 'my-pkg-doc', arch: 'all', include: ['share/doc/**'] },
        },
      });

      // Default producer is aarch64. Packing ARM afterwards should preserve _all.deb
      cleanupPackageOutputs(recipe, testOut, 'arm');

      expect(existsSync(join(testOut, 'my-pkg_1.0_arm.deb'))).toBeFalse();
      expect(existsSync(join(testOut, 'my-pkg-doc_1.0_all.deb'))).toBeTrue();
    } finally {
      rmSync(testOut, { recursive: true, force: true });
    }
  });

  test('Finding #3: rejects architecture-restricted deps/provides on arch:all parent and on non-producer child shards', (): void => {
    const allParent = createRecipe({
      name: 'all-parent',
      version: '1.0.0',
      arch: 'all',
      deps: ['sdk-api [arm]'],
    });
    expect(() => generateControlFile(allParent)).toThrow(/architecture 'all'.*architecture-restricted/);

    const badProvidesParent = createRecipe({
      name: 'bad-prov',
      version: '1.0.0',
      arch: 'aarch64',
    });
    badProvidesParent.provides = ['virt-api (>= 1.0)'];
    expect(() => generateControlFile(badProvidesParent)).toThrow(/permits only '='/);

    const tmp = join(process.env.TMPDIR || tmpdir(), `deb-all-child-${Date.now()}`);
    const stageDir = join(tmp, 'stage');
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc'), { recursive: true });
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc/README'), 'hi\n');

    const multiParent = createRecipe({
      name: 'multi',
      version: '1.0.0',
      arches: ['aarch64', 'arm'],
      subpackages: {
        doc: { name: 'multi-doc', arch: 'all', include: ['share/doc/**'], deps: ['arm-only [arm]'] },
      },
    });

    const oldEpoch = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      // Must throw even on non-producer 'arm' shard
      expect(() => buildAllDebs(multiParent, tmp, join(tmp, 'out'), 'arm')).toThrow(
        /architecture 'all'.*architecture-restricted/,
      );
    } finally {
      if (oldEpoch !== undefined) {
        process.env.SOURCE_DATE_EPOCH = oldEpoch;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('Invariant 4: non-producer buildAllDebs omits _all.deb and removes non-producer child stage directory', (): void => {
    const tmp = join(process.env.TMPDIR || tmpdir(), `deb-nonprod-${Date.now()}`);
    const outDir = join(tmp, 'out');
    const stageDir = join(tmp, 'stage');
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/bin'), { recursive: true });
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc'), { recursive: true });
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/bin/multi'), '#!/bin/sh\necho ok\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc/README'), 'doc\n');

    const recipe = createRecipe({
      name: 'multi',
      version: '1.0.0',
      arch: 'arm',
      arches: ['aarch64', 'arm'],
      subpackages: {
        doc: { name: 'multi-doc', arch: 'all', include: ['share/doc/**'] },
      },
    });

    const oldEpoch = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      const debs = buildAllDebs(recipe, tmp, outDir, 'arm');
      expect(debs).toHaveLength(1);
      expect(debs[0]).toEndWith('multi_1.0.0_arm.deb');
      expect(existsSync(join(outDir, 'multi-doc_1.0.0_all.deb'))).toBeFalse();
      expect(existsSync(join(tmp, 'stage_multi-doc'))).toBeFalse();
      // Doc payload was still stripped from parent stage so arm deb does not bundle it
      expect(existsSync(join(stageDir, 'data/data/com.termux/files/usr/share/doc/README'))).toBeFalse();
    } finally {
      if (oldEpoch !== undefined) {
        process.env.SOURCE_DATE_EPOCH = oldEpoch;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('Thread #1: keeps skipped all-child stage until native child conffiles are validated', (): void => {
    const tmp = join(process.env.TMPDIR || tmpdir(), `deb-conffile-split-${Date.now()}`);
    const outDir = join(tmp, 'out');
    const pkgDir = join(tmp, 'pkg');
    const stageDir = join(tmp, 'stage');
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/etc/common'), { recursive: true });
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/etc/native'), { recursive: true });
    mkdirSync(join(stageDir, 'data/data/com.termux/files/usr/bin'), { recursive: true });
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/etc/common/shared.conf'), 'shared=1\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/etc/native/app.conf'), 'native=1\n');
    writeFileSync(join(stageDir, 'data/data/com.termux/files/usr/bin/app'), '#!/bin/sh\necho ok\n');
    writeFileSync(
      join(pkgDir, 'conffiles'),
      '/data/data/com.termux/files/usr/etc/common/shared.conf\n/data/data/com.termux/files/usr/etc/native/app.conf\n',
    );

    const recipe = createRecipe({
      name: 'cfapp',
      version: '1.0.0',
      arch: 'arm',
      arches: ['aarch64', 'arm'],
      subpackages: {
        // Put arch:all child assigned to aarch64 BEFORE native child
        common: { name: 'cfapp-common', arch: 'all', include: ['etc/common/**'] },
        native: { name: 'cfapp-native', include: ['etc/native/**'] },
      },
    });

    const oldEpoch = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      const debs = buildAllDebs(recipe, tmp, outDir, 'arm', pkgDir);
      expect(debs).toHaveLength(2);
      expect(existsSync(join(outDir, 'cfapp_1.0.0_arm.deb'))).toBeTrue();
      expect(existsSync(join(outDir, 'cfapp-native_1.0.0_arm.deb'))).toBeTrue();
      expect(existsSync(join(outDir, 'cfapp-common_1.0.0_all.deb'))).toBeFalse();
      expect(existsSync(join(tmp, 'stage_cfapp-common'))).toBeFalse();
    } finally {
      if (oldEpoch !== undefined) {
        process.env.SOURCE_DATE_EPOCH = oldEpoch;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('Thread #2: generateAptMetadata requires a single consistent concrete version across repeated dep clauses', (): void => {
    const tmp = join(process.env.TMPDIR || tmpdir(), `apt-consistent-ver-${Date.now()}`);
    const outDir = join(tmp, 'out');
    const pkgDir = join(tmp, 'pkgs');
    mkdirSync(outDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });

    const oldEpoch = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      const mkDeb = (r: PackageRecipe): void => {
        const d = join(tmp, `b_${r.name}_${r.version}`);
        mkdirSync(join(d, 'stage/data/data/com.termux/files/usr/bin'), { recursive: true });
        writeFileSync(join(d, 'stage/data/data/com.termux/files/usr/bin', r.name), '#!/bin/sh\necho ok\n');
        buildAllDebs(r, d, outDir, 'aarch64');
      };

      mkDeb(createRecipe({ name: 'libfoo', version: '1', arch: 'aarch64' }));
      mkDeb(createRecipe({ name: 'libfoo', version: '3', arch: 'aarch64' }));
      mkDeb(createRecipe({ name: 'libbar', version: '1', arch: 'aarch64' }));
      // Impossible for one installed libfoo version to satisfy both >= 2 and << 3 when only 1 and 3 exist
      mkDeb(
        createRecipe({ name: 'broken-app', version: '1', arch: 'aarch64', deps: ['libfoo (>= 2)', 'libfoo (<< 3)'] }),
      );
      // Satisfiable via alternative libbar for clause 1 and libfoo=3 for clause 2
      mkDeb(
        createRecipe({
          name: 'alt-app',
          version: '1',
          arch: 'aarch64',
          deps: ['libfoo (<< 3) | libbar', 'libfoo (>= 2)'],
        }),
      );

      generateAptMetadata(outDir, 'main', 'aarch64', pkgDir);
      const txt = readFileSync(join(outDir, 'dists/stable/main/binary-aarch64/Packages'), 'utf-8');
      expect(txt).not.toContain('Package: broken-app');
      expect(txt).toContain('Package: alt-app');
    } finally {
      if (oldEpoch !== undefined) {
        process.env.SOURCE_DATE_EPOCH = oldEpoch;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('generateAptMetadata resolves cross-architecture dependencies with explicit multi-arch qualifiers', (): void => {
    const tmp = join(process.env.TMPDIR || tmpdir(), `apt-cross-arch-${Date.now()}`);
    const outDir = join(tmp, 'out');
    const pkgDir = join(tmp, 'pkgs');
    mkdirSync(outDir, { recursive: true });
    mkdirSync(pkgDir, { recursive: true });

    const oldEpoch = process.env.SOURCE_DATE_EPOCH;
    process.env.SOURCE_DATE_EPOCH = '1700000000';
    try {
      const mkDeb = (r: PackageRecipe, debArch: string): void => {
        const d = join(tmp, `b_${r.name}_${r.version}_${debArch}`);
        mkdirSync(join(d, 'stage/data/data/com.termux/files/usr/bin'), { recursive: true });
        writeFileSync(join(d, 'stage/data/data/com.termux/files/usr/bin', r.name), '#!/bin/sh\necho ok\n');
        buildAllDebs(r, d, outDir, debArch);
      };

      mkDeb(createRecipe({ name: 'helper', version: '1.0', arch: 'arm' }), 'arm');
      mkDeb(createRecipe({ name: 'ma-helper', version: '1.0', arch: 'arm', multiarch: 'allowed' }), 'arm');
      mkDeb(
        createRecipe({ name: 'consumer', version: '1.0', arch: 'aarch64', deps: ['helper:arm (>= 1.0)'] }),
        'aarch64',
      );
      mkDeb(
        createRecipe({ name: 'any-consumer', version: '1.0', arch: 'aarch64', deps: ['ma-helper:any (>= 1.0)'] }),
        'aarch64',
      );
      mkDeb(
        createRecipe({ name: 'same-arch-consumer', version: '1.0', arch: 'aarch64', deps: ['consumer:aarch64'] }),
        'aarch64',
      );
      mkDeb(createRecipe({ name: 'unfulfilled', version: '1.0', arch: 'aarch64', deps: ['helper:i686'] }), 'aarch64');
      mkDeb(
        createRecipe({ name: 'unfulfilled-x86', version: '1.0', arch: 'aarch64', deps: ['helper:x86_64'] }),
        'aarch64',
      );

      generateAptMetadata(outDir, 'main', 'aarch64', pkgDir);
      const txt = readFileSync(join(outDir, 'dists/stable/main/binary-aarch64/Packages'), 'utf-8');
      expect(txt).toContain('Package: consumer');
      expect(txt).toContain('Package: any-consumer');
      expect(txt).toContain('Package: same-arch-consumer');
      expect(txt).not.toContain('Package: unfulfilled');
      expect(txt).not.toContain('Package: unfulfilled-x86');
      expect(txt).not.toContain('Package: helper');
    } finally {
      if (oldEpoch !== undefined) {
        process.env.SOURCE_DATE_EPOCH = oldEpoch;
      } else {
        delete process.env.SOURCE_DATE_EPOCH;
      }
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('Debian control reader unfolds single-line, folded, and absent Depends fields', (): void => {
    // Single-line
    const single = `Package: app\nVersion: 1.0\nDepends: libfoo (>= 1.0)\nArchitecture: aarch64`;
    expect(extractDebianField(single, 'Depends')).toBe('libfoo (>= 1.0)');

    // Folded
    const folded = `Package: app\nVersion: 1.0\nDepends: libfoo (>= 1.0),\n libbar (>= 2.0),\n libbaz\nArchitecture: aarch64`;
    expect(extractDebianField(folded, 'Depends')).toBe('libfoo (>= 1.0), libbar (>= 2.0), libbaz');

    // Missing
    const missing = `Package: app\nVersion: 1.0\nArchitecture: aarch64`;
    expect(extractDebianField(missing, 'Depends')).toBeUndefined();

    // Empty
    const empty = `Package: app\nVersion: 1.0\nDepends:\nArchitecture: aarch64`;
    expect(extractDebianField(empty, 'Depends')).toBe('');
  });
});
