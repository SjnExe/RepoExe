import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getPackageSourceDateEpoch, normalizeSourceDir } from '../builders/debian.ts';
import {
  buildCargoRustflagsEnv,
  buildCompileStamp,
  cleanupStagingDirs,
  comparePatchFilenames,
  computeSourceIdentity,
  executePack,
  executeTest,
  fetchAndPrepareSource,
  resolveAndValidatePatches,
  resolveTestArch,
  simulateDryRun,
  snapshotPatches,
  stageValidatedOutputs,
  validateCompileStamp,
} from '../cli/build.ts';
import { safeRenameSync } from '../core/compat.ts';
import { parseFilenameDebVersion } from '../core/fetcher.ts';
import type { PackageRecipe } from '../core/types.ts';

describe('build CLI helpers', (): void => {
  const origEpoch = process.env.SOURCE_DATE_EPOCH;
  beforeAll((): void => {
    process.env.SOURCE_DATE_EPOCH = '1700000000';
  });
  afterAll((): void => {
    if (origEpoch !== undefined) {
      process.env.SOURCE_DATE_EPOCH = origEpoch;
    } else {
      delete process.env.SOURCE_DATE_EPOCH;
    }
  });
  it('returns pDir if recipe has no source', (): void => {
    const recipe = { name: 'no-source', version: '1.0.0' };
    const dest = join(process.env.TMPDIR || tmpdir(), `dest-${Date.now()}`);
    const workDir = fetchAndPrepareSource(recipe, 'pkg/no-source', dest);
    expect(workDir).toBe('pkg/no-source');
  });

  it('reuses existing extracted source when continueBuild is enabled and source is prepared', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-continue-${Date.now()}`);
    const srcDir = join(testDest, 'src');
    mkdirSync(srcDir, { recursive: true });
    const sampleFile = join(srcDir, 'test.txt');
    writeFileSync(sampleFile, 'hello');
    utimesSync(sampleFile, 1750000000, 1750000000);
    const beforeMtime = statSync(sampleFile).mtimeMs;

    const recipe = { name: 'dummy', version: '1.0.0', source: 'https://example.com/dummy.tar.gz' };
    const identity = computeSourceIdentity(recipe, 'pkg/dummy');
    const sourceEpoch = getPackageSourceDateEpoch('pkg/dummy');
    writeFileSync(
      join(testDest, '.source_prepared.json'),
      JSON.stringify({ identity, workDir: srcDir, sourceEpoch }),
    );

    const workDir = fetchAndPrepareSource(recipe, 'pkg/dummy', testDest, true);
    expect(workDir).toBe(srcDir);
    expect(statSync(sampleFile).mtimeMs).toBe(beforeMtime);

    rmSync(testDest, { recursive: true, force: true });
  });

  it('rejects reusing extracted source when .source_prepared sentinel is missing', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-noprep-${Date.now()}`);
    const srcDir = join(testDest, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'partial.txt'), 'partial');

    // Use local file URL to avoid live network download
    const recipe = { name: 'dummy', version: '1.0.0', source: 'file:///nonexistent/dummy.tar.gz' };
    expect(() => fetchAndPrepareSource(recipe, 'pkg/dummy', testDest, true)).toThrow();
    // After fresh preparation begins, partial.txt is wiped
    expect(existsSync(join(srcDir, 'partial.txt'))).toBeFalse();

    rmSync(testDest, { recursive: true, force: true });
  });

  it('rejects reusing extracted source when source identity has changed', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-idchange-${Date.now()}`);
    const srcDir = join(testDest, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'old.txt'), 'old');

    const oldRecipe = {
      name: 'dummy',
      version: '1.0.0',
      source: 'file:///nonexistent/dummy.tar.gz',
    };
    const oldIdentity = computeSourceIdentity(oldRecipe, 'pkg/dummy');
    writeFileSync(
      join(testDest, '.source_prepared.json'),
      JSON.stringify({ identity: oldIdentity, workDir: srcDir }),
    );

    // New version produces different identity, so continueBuild rejects stale source
    const newRecipe = {
      name: 'dummy',
      version: '2.0.0',
      source: 'file:///nonexistent/dummy.tar.gz',
    };
    expect(() => fetchAndPrepareSource(newRecipe, 'pkg/dummy', testDest, true)).toThrow();
    expect(existsSync(join(srcDir, 'old.txt'))).toBeFalse();

    rmSync(testDest, { recursive: true, force: true });
  });

  it('differentiates source identity when patch declaration order changes', (): void => {
    const r1 = { name: 'dummy', version: '1.0.0', patches: ['0001-a.patch', '0002-b.patch'] };
    const r2 = { name: 'dummy', version: '1.0.0', patches: ['0002-b.patch', '0001-a.patch'] };
    const id1 = computeSourceIdentity(r1, 'pkg/dummy');
    const id2 = computeSourceIdentity(r2, 'pkg/dummy');
    expect(id1).not.toBe(id2);
  });

  it('rejects unsupported package formats in executePack', async (): Promise<void> => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-pack-${Date.now()}`);
    const testOut = join(testDest, 'out');
    const recipe = {
      name: 'bad-fmt',
      version: '1.0.0',
      formats: ['deb'], // invalid, should be apt
    };
    expect(executePack(recipe, 'pkg/bad-fmt', testDest, testOut)).rejects.toThrow(
      'Unsupported package format',
    );
    rmSync(testDest, { recursive: true, force: true });
  });

  it('runs simulateDryRun cleanly', async (): Promise<void> => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-dry-${Date.now()}`);
    const testOut = join(testDest, 'out');
    const recipe: PackageRecipe = {
      name: 'test-pkg',
      version: '1.2.3',
      epoch: 0,
      revision: 1,
      arch: 'aarch64',
      description: 'A test package fixture',
      license: 'MIT',
      homepage: 'https://example.com',
      maintainer: 'RepoExe <repoexe@example.com>',
      component: 'main',
      build_system: 'custom',
      source: 'https://example.com/test-pkg.tar.gz',
      sha256: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
      formats: ['apt'],
      build_deps: ['make'],
      deps: ['libc'],
      recommends: [],
      suggests: [],
      conflicts: [],
      provides: [],
      replaces: [],
      resources: {},
      heavy_build: false,
      cache: false,
      auto_update: false,
      update_strategy: null,
      custom_update_cmd: null,
      patches: [],
      cflags: null,
      cxxflags: null,
      ldflags: null,
      phases: {
        configure: './configure',
        make: 'make -j4',
      },
      vars: {},
      env: {},
      toolchains: {},
      state_hash: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    };

    let logCalled = false;
    const originalLog = console.log;
    console.log = (..._args: any[]) => {
      logCalled = true;
    };

    try {
      await simulateDryRun(recipe, 'pkg/test-pkg', testDest, testOut, 'build', true);
      expect(logCalled).toBeTrue();
    } finally {
      console.log = originalLog;
      rmSync(testDest, { recursive: true, force: true });
    }
  });

  it('parseFilenameDebVersion correctly decodes epoch and version from debian filename', (): void => {
    expect(parseFilenameDebVersion('foo_1_2.0-1_aarch64.deb')).toBe('1:2.0-1');
    expect(parseFilenameDebVersion('foo_2.0-1_aarch64.deb')).toBe('2.0-1');
    expect(parseFilenameDebVersion('foo_3:1.2_all.deb')).toBe('3:1.2');
    expect(parseFilenameDebVersion('foo_1.0_x86_64.deb')).toBe('1.0');
    expect(parseFilenameDebVersion('foo_1_2.0-1_x86_64.deb')).toBe('1:2.0-1');
  });

  it('normalizeSourceDir normalizes file mtimes to target epoch', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `norm-src-${Date.now()}`);
    mkdirSync(join(testDir, 'sub'), { recursive: true });
    writeFileSync(join(testDir, 'sub', 'file.c'), 'int main() {}\n');

    const targetEpoch = 1704067200;
    normalizeSourceDir(testDir, targetEpoch);

    const st = statSync(join(testDir, 'sub', 'file.c'));
    expect(Math.floor(st.mtimeMs / 1000)).toBe(targetEpoch);

    rmSync(testDir, { recursive: true, force: true });
  });

  it('simulateDryRun includes numerically sorted patches/diffs and subpackage artifacts', async (): Promise<void> => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dryrun-sub-${Date.now()}`);
    const testPkgDir = join(testDest, 'pkg');
    const patchesDir = join(testPkgDir, 'patches');
    mkdirSync(patchesDir, { recursive: true });
    writeFileSync(join(patchesDir, '0002-fix.patch'), 'patch 2');
    writeFileSync(join(patchesDir, '0001-fix.diff'), 'patch 1');

    const recipe = {
      name: 'parent',
      version: '1.0',
      revision: 1,
      arch: 'aarch64',
      subpackages: {
        dev: {
          name: 'parent-dev',
          arch: 'all',
          include: ['include/**'],
        },
      },
    } as unknown as PackageRecipe;

    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]): void => {
      logs.push(args.join(' '));
    };

    try {
      await simulateDryRun(recipe, testPkgDir, testDest, testDest, 'build', true);
      const output = logs.join('\n');
      expect(output).toContain('0001-fix.diff, 0002-fix.patch');
      expect(output).toContain('parent_1.0-1_aarch64.deb');
      expect(output).toContain('parent-dev_1.0-1_all.deb');
    } finally {
      console.log = originalLog;
      rmSync(testDest, { recursive: true, force: true });
    }
  });

  it('cleanupStagingDirs removes .compile_success, .stage_compiled, stage, and child stages', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-clean-${Date.now()}`);
    mkdirSync(join(testDest, 'stage', 'bin'), { recursive: true });
    mkdirSync(join(testDest, 'stage_dev', 'lib'), { recursive: true });
    mkdirSync(join(testDest, 'stage_tools', 'bin'), { recursive: true });
    mkdirSync(join(testDest, '.stage_compiled'), { recursive: true });
    writeFileSync(join(testDest, '.compile_success'), 'ok');
    writeFileSync(join(testDest, 'unrelated.txt'), 'keep');

    cleanupStagingDirs(testDest);

    expect(existsSync(join(testDest, '.compile_success'))).toBeFalse();
    expect(existsSync(join(testDest, '.stage_compiled'))).toBeFalse();
    expect(existsSync(join(testDest, 'stage'))).toBeFalse();
    expect(existsSync(join(testDest, 'stage_dev'))).toBeFalse();
    expect(existsSync(join(testDest, 'stage_tools'))).toBeFalse();
    expect(existsSync(join(testDest, 'unrelated.txt'))).toBeTrue();

    rmSync(testDest, { recursive: true, force: true });
  });

  it('comparePatchFilenames sorts numbered patch filenames numerically and deterministically', (): void => {
    const patches = ['0001-fix10.patch', '0001-fix2.patch', '0002-feature.diff'];
    patches.sort(comparePatchFilenames);
    expect(patches).toEqual(['0001-fix2.patch', '0001-fix10.patch', '0002-feature.diff']);
  });

  it('re-prepares source when continueBuild is enabled but sourceEpoch differs', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-epochdiff-${Date.now()}`);
    const srcDir = join(testDest, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'test.txt'), 'hello');

    try {
      const recipe = {
        name: 'dummy',
        version: '1.0.0',
        source: 'file:///nonexistent/dummy.tar.gz',
      };
      const identity = computeSourceIdentity(recipe, 'pkg/dummy');
      const effectiveEpoch = getPackageSourceDateEpoch('pkg/dummy');
      writeFileSync(
        join(testDest, '.source_prepared.json'),
        JSON.stringify({ identity, workDir: srcDir, sourceEpoch: effectiveEpoch + 1000 }),
      );

      expect(() => fetchAndPrepareSource(recipe, 'pkg/dummy', testDest, true)).toThrow(
        /Failed to download source archive/,
      );
    } finally {
      rmSync(testDest, { recursive: true, force: true });
    }
  });

  it('rejects unnumbered patch filenames in fetchAndPrepareSource', (): void => {
    const testPkg = join(process.env.TMPDIR || tmpdir(), `pkg-patchtest-${Date.now()}`);
    const patchDir = join(testPkg, 'patches');
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(join(patchDir, 'fix.diff'), '--- a\n+++ b\n');
    const srcTar = join(testPkg, 'source.tar');
    spawnSync('tar', ['-cf', srcTar, '-C', testPkg, 'patches']);

    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-patchtest-${Date.now()}`);
    const recipe = {
      name: 'patchpkg',
      version: '1.0.0',
      source: `file://${srcTar}`,
      patches: ['fix.diff'],
    };

    expect(() => fetchAndPrepareSource(recipe, testPkg, testDest, false)).toThrow(
      /Invalid patch filename 'fix.diff'/,
    );

    rmSync(testPkg, { recursive: true, force: true });
    rmSync(testDest, { recursive: true, force: true });
  });

  it('sorts patch filenames deterministically with tie-breaker (Thread #5)', (): void => {
    const p1 = '0001-fix2.patch';
    const p2 = '0001-fix02.patch';
    const sorted = [p1, p2].sort(comparePatchFilenames);
    expect(sorted).toEqual(['0001-fix02.patch', '0001-fix2.patch']);
  });

  it('validates patch selection in resolveAndValidatePatches (Thread #8)', (): void => {
    const testPkg = join(process.env.TMPDIR || tmpdir(), `pkg-validatetest-${Date.now()}`);
    const patchDir = join(testPkg, 'patches');
    mkdirSync(patchDir, { recursive: true });
    writeFileSync(join(patchDir, '0001-fix.patch'), 'patch content\n');

    const valid = resolveAndValidatePatches(
      { name: 'testpkg', patches: ['patches/0001-fix.patch'] },
      testPkg,
    );
    expect(valid).toEqual(['0001-fix.patch']);

    expect(() =>
      resolveAndValidatePatches(
        { name: 'testpkg', patches: ['patches/0002-missing.patch'] },
        testPkg,
      ),
    ).toThrow(/Patch file .* not found/);

    rmSync(testPkg, { recursive: true, force: true });
  });

  it('stages only validated archives matching exact version (Threads #6 & #32)', (): void => {
    const tmpBase = join(process.env.TMPDIR || tmpdir(), `test-stage-val-${Date.now()}`);
    const outputDir = join(tmpBase, 'output');
    const validatedDir = join(tmpBase, 'output_validated');
    mkdirSync(outputDir, { recursive: true });

    writeFileSync(join(outputDir, 'app_1.0_aarch64.deb'), 'v1 deb');
    writeFileSync(join(outputDir, 'app_2.0_aarch64.deb'), 'v2 deb');
    writeFileSync(join(outputDir, 'app-doc_1.0_all.deb'), 'v1 doc deb');
    writeFileSync(join(outputDir, 'app-doc_2.0_all.deb'), 'v2 doc deb');
    writeFileSync(join(outputDir, 'app_metadata.json'), '{}');
    writeFileSync(join(outputDir, 'app_x86_64_metadata.json'), '{}');

    const recipe: Partial<PackageRecipe> & { name: string; version: string } = {
      name: 'app',
      version: '2.0',
      revision: 0,
      epoch: 0,
      subpackages: {
        doc: { name: 'app-doc', arch: 'all', include: ['doc/**'] },
      },
    };

    stageValidatedOutputs(recipe, outputDir, validatedDir);

    expect(existsSync(join(validatedDir, 'app_2.0_aarch64.deb'))).toBe(true);
    expect(existsSync(join(validatedDir, 'app-doc_2.0_all.deb'))).toBe(true);
    expect(existsSync(join(validatedDir, 'app_metadata.json'))).toBe(true);
    expect(existsSync(join(validatedDir, 'app_x86_64_metadata.json'))).toBe(true);
    // Older v1 files must not be staged
    expect(existsSync(join(validatedDir, 'app_1.0_aarch64.deb'))).toBe(false);
    expect(existsSync(join(validatedDir, 'app-doc_1.0_all.deb'))).toBe(false);

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('rejects patch-shaped directories in resolveAndValidatePatches (Thread #3)', (): void => {
    const tmpBase = join(process.env.TMPDIR || tmpdir(), `test-patchdir-${Date.now()}`);
    const patchDir = join(tmpBase, 'patches', '0001-fix.diff');
    mkdirSync(patchDir, { recursive: true });

    try {
      expect(() => resolveAndValidatePatches({ name: 'testpkg' }, tmpBase)).toThrow(
        /Patch entry '0001-fix\.diff'.*is not a regular file/,
      );
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('hashes symlinked patches in computeSourceIdentity (Thread #4)', (): void => {
    const tmpBase = join(process.env.TMPDIR || tmpdir(), `test-symlink-patch-${Date.now()}`);
    const patchDir = join(tmpBase, 'patches');
    mkdirSync(patchDir, { recursive: true });

    const targetFile = join(tmpBase, 'actual-target.patch');
    writeFileSync(targetFile, 'content 1\n');
    symlinkSync(targetFile, join(patchDir, '0001-symlink.patch'));

    const r = { name: 'testpkg', version: '1.0' };
    const id1 = computeSourceIdentity(r, tmpBase);

    // Update target content
    writeFileSync(targetFile, 'content 2 modified\n');
    const id2 = computeSourceIdentity(r, tmpBase);

    expect(id1).not.toBe(id2);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('restores existing validated files when promotion fails (Thread #5, #23)', (): void => {
    const tmpBase = join(process.env.TMPDIR || tmpdir(), `test-promo-rollback-${Date.now()}`);
    const outputDir = join(tmpBase, 'output');
    const validatedDir = join(tmpBase, 'output_validated');
    mkdirSync(outputDir, { recursive: true });
    mkdirSync(validatedDir, { recursive: true });

    // Existing file in validatedDir
    writeFileSync(join(validatedDir, 'app_1.0_aarch64.deb'), 'original v1');

    // New replacements in outputDir: two files so first promotes and second fails
    writeFileSync(join(outputDir, 'app_1.0_aarch64.deb'), 'new v1 replacement');
    writeFileSync(join(outputDir, 'app_metadata.json'), '{"name":"app"}');

    let injectedReached = false;
    let debReplaced = false;
    const failingRename = (src: string, dst: string): void => {
      if (src.includes('.promo.backup-')) {
        renameSync(src, dst);
        return;
      }
      if (dst.endsWith('app_1.0_aarch64.deb')) {
        renameSync(src, dst);
        debReplaced = true;
        return;
      }
      if (debReplaced) {
        injectedReached = true;
        throw new Error('Injected failure on second promotion rename');
      }
      renameSync(src, dst);
    };

    const recipe: Partial<PackageRecipe> & { name: string; version: string } = {
      name: 'app',
      version: '1.0',
    };

    try {
      expect(() => {
        stageValidatedOutputs(recipe, outputDir, validatedDir, undefined, failingRename);
      }).toThrow('Injected failure on second promotion rename');

      expect(injectedReached).toBeTrue();
      // Verify original v1 was restored!
      expect(existsSync(join(validatedDir, 'app_1.0_aarch64.deb'))).toBeTrue();
      expect(readFileSync(join(validatedDir, 'app_1.0_aarch64.deb'), 'utf-8')).toBe('original v1');
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('Finding #8: snapshotPatches fails immediately when declared patch is missing and patches/ directory does not exist', (): void => {
    const tmpPkg = join(process.env.TMPDIR || tmpdir(), `pkg-nopatchdir-${Date.now()}`);
    mkdirSync(tmpPkg, { recursive: true });
    try {
      expect(() =>
        snapshotPatches({ name: 'missing-dir-pkg', patches: ['0001-fix.patch'] }, tmpPkg),
      ).toThrow(/Patch file .*0001-fix\.patch not found/);
    } finally {
      rmSync(tmpPkg, { recursive: true, force: true });
    }
  });

  it('Thread #3: cleanupStagingDirs removes non-writable 0555 stage subdirectories without following symlinks', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-ro-clean-${Date.now()}`);
    const roDir = join(testDest, '.stage_compiled', 'readonly_dir');
    const outsideDir = join(testDest, 'outside_keep');
    mkdirSync(roDir, { recursive: true });
    mkdirSync(outsideDir, { recursive: true });
    writeFileSync(join(roDir, 'file.txt'), 'locked');
    writeFileSync(join(outsideDir, 'keep.txt'), 'safe');
    symlinkSync(outsideDir, join(testDest, '.stage_compiled', 'link_out'));
    chmodSync(roDir, 0o555);
    chmodSync(outsideDir, 0o555);

    try {
      cleanupStagingDirs(testDest);
      expect(existsSync(join(testDest, '.stage_compiled'))).toBeFalse();
      expect(existsSync(join(outsideDir, 'keep.txt'))).toBeTrue();
      expect(statSync(outsideDir).mode & 0o777).toBe(0o555);
    } finally {
      chmodSync(outsideDir, 0o755);
      rmSync(testDest, { recursive: true, force: true });
    }
  });

  it('Thread #4: stageValidatedOutputs promotes nothing when testedArtifacts is empty array', (): void => {
    const tmpBase = join(process.env.TMPDIR || tmpdir(), `test-empty-tested-${Date.now()}`);
    const outputDir = join(tmpBase, 'output');
    const validatedDir = join(tmpBase, 'output_validated');
    mkdirSync(outputDir, { recursive: true });
    writeFileSync(join(outputDir, 'app_1.0_aarch64.deb'), 'stale deb');
    writeFileSync(join(outputDir, 'app_metadata.json'), '{"name":"app"}');

    try {
      stageValidatedOutputs({ name: 'app', version: '1.0' }, outputDir, validatedDir, []);
      expect(existsSync(join(validatedDir, 'app_1.0_aarch64.deb'))).toBeFalse();
      expect(existsSync(join(validatedDir, 'app_metadata.json'))).toBeFalse();
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('Thread #3: stageValidatedOutputs promotes sidecar only when matching tested archive digest', (): void => {
    const tmpBase = join(process.env.TMPDIR || tmpdir(), `test-digest-promo-${Date.now()}`);
    const outputDir = join(tmpBase, 'output');
    const validatedDir = join(tmpBase, 'output_validated');
    mkdirSync(outputDir, { recursive: true });

    const debContent = 'test deb payload for digest verification';
    const debName = 'app_1.0_aarch64.deb';
    writeFileSync(join(outputDir, debName), debContent);
    const hash = createHash('sha256').update(debContent).digest('hex');

    // Matching sidecar with archive_digest
    writeFileSync(
      join(outputDir, 'app_aarch64_metadata.json'),
      JSON.stringify({ name: 'app', arch: 'aarch64', archive_digest: hash }),
    );
    // Legacy sidecar without archive_digest
    writeFileSync(
      join(outputDir, 'app_metadata.json'),
      JSON.stringify({ name: 'app', arch: 'aarch64' }),
    );
    // Sidecar for different architecture
    writeFileSync(
      join(outputDir, 'app_x86_64_metadata.json'),
      JSON.stringify({ name: 'app', arch: 'x86_64', archive_digest: hash }),
    );

    try {
      stageValidatedOutputs({ name: 'app', version: '1.0' }, outputDir, validatedDir, [debName]);
      expect(existsSync(join(validatedDir, debName))).toBeTrue();
      expect(existsSync(join(validatedDir, 'app_aarch64_metadata.json'))).toBeTrue();
      expect(existsSync(join(validatedDir, 'app_metadata.json'))).toBeFalse();
      expect(existsSync(join(validatedDir, 'app_x86_64_metadata.json'))).toBeFalse();
    } finally {
      rmSync(tmpBase, { recursive: true, force: true });
    }
  });

  it('Thread #5: simulateDryRun hides _all.deb child on non-producer architecture', async (): Promise<void> => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dryrun-nonprod-${Date.now()}`);
    mkdirSync(testDest, { recursive: true });
    const recipe = {
      name: 'multi',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'arm',
      arches: ['aarch64', 'arm'],
      subpackages: {
        doc: { name: 'multi-doc', arch: 'all', include: ['share/doc/**'] },
      },
    } as unknown as PackageRecipe;

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: unknown[]): void => {
      logs.push(args.join(' '));
    };
    try {
      await simulateDryRun(recipe, testDest, testDest, testDest, 'build', true);
      const out = logs.join('\n');
      expect(out).toContain('multi_1.0_arm.deb');
      expect(out).not.toContain('multi-doc_1.0_all.deb');
    } finally {
      console.log = origLog;
      rmSync(testDest, { recursive: true, force: true });
    }
  });

  it('Thread #6: buildCargoRustflagsEnv appends remap to CARGO_ENCODED_RUSTFLAGS without deleting RUSTFLAGS', (): void => {
    const withEncoded = buildCargoRustflagsEnv(
      { CARGO_ENCODED_RUSTFLAGS: '-C\x1fopt-level=3\x1f-C\x1flto' },
      '/path with spaces/src',
    );
    expect(withEncoded.deleteRustflags).toBeFalse();
    expect(withEncoded.CARGO_ENCODED_RUSTFLAGS).toBe(
      '-C\x1fopt-level=3\x1f-C\x1flto\x1f--remap-path-prefix=/path with spaces/src=.',
    );

    const withNeither = buildCargoRustflagsEnv({}, '/path with spaces/src');
    expect(withNeither.deleteRustflags).toBeFalse();
    expect(withNeither.CARGO_ENCODED_RUSTFLAGS).toBeUndefined();
  });

  it('Thread #7: validateCompileStamp enforces architecture and compile identity match', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `stamp-check-${Date.now()}`);
    mkdirSync(testDest, { recursive: true });
    const armRecipe = {
      arch: 'arm',
      state_hash: 'hash-arm',
      version: '1.0',
      revision: 0,
      epoch: 0,
    };
    const x86Recipe = {
      arch: 'x86_64',
      state_hash: 'hash-x86',
      version: '1.0',
      revision: 0,
      epoch: 0,
    };
    const allRecipe = {
      arch: 'all',
      state_hash: 'hash-all',
      version: '1.0',
      revision: 0,
      epoch: 0,
    };
    try {
      writeFileSync(
        join(testDest, '.compile_success'),
        JSON.stringify(buildCompileStamp(armRecipe)),
      );
      expect(validateCompileStamp(testDest, armRecipe).valid).toBeTrue();
      const mismatch = validateCompileStamp(testDest, x86Recipe);
      expect(mismatch.valid).toBeFalse();
      expect(mismatch.archMismatch).toBeTrue();

      // arch: all with concrete architecture validation
      writeFileSync(
        join(testDest, '.compile_success'),
        JSON.stringify(buildCompileStamp(allRecipe, undefined, 'arm')),
      );
      expect(validateCompileStamp(testDest, allRecipe, undefined, 'arm').valid).toBeTrue();
      const allMismatch = validateCompileStamp(testDest, allRecipe, undefined, 'aarch64');
      expect(allMismatch.valid).toBeFalse();
      expect(allMismatch.archMismatch).toBeTrue();
    } finally {
      rmSync(testDest, { recursive: true, force: true });
    }
  });

  it('Thread #3: resolveTestArch resolves concrete architecture for arch: all recipes', (): void => {
    // When explicitBuildArch is provided, use it for 'all' recipes
    expect(resolveTestArch('all', 'arm')).toBe('arm');
    expect(resolveTestArch('all', 'x86_64')).toBe('x86_64');

    // When recipe has a concrete arch, preserve it regardless of explicitBuildArch
    expect(resolveTestArch('aarch64', 'arm')).toBe('aarch64');
    expect(resolveTestArch('arm', 'aarch64')).toBe('arm');

    // When explicitBuildArch is omitted, fall back to TARGET_ARCH or aarch64
    const oldTarget = process.env.TARGET_ARCH;
    try {
      process.env.TARGET_ARCH = 'i686';
      expect(resolveTestArch('all')).toBe('i686');
      delete process.env.TARGET_ARCH;
      expect(resolveTestArch('all')).toBe('aarch64');
    } finally {
      if (oldTarget !== undefined) {
        process.env.TARGET_ARCH = oldTarget;
      } else {
        delete process.env.TARGET_ARCH;
      }
    }
  });

  it('Thread #15: executeTest selects native mode and runs stage executable without host Docker socket', (): void => {
    const testDir = join(process.env.TMPDIR || tmpdir(), `test-stage-exec-${Date.now()}`);
    const stageDir = join(testDir, 'stage');
    const binDir = join(stageDir, 'data/data/com.termux/files/usr/bin');
    mkdirSync(binDir, { recursive: true });
    const markerFile = join(testDir, 'executed.marker');
    const scriptPath = join(binDir, 'dummy-pkg');
    writeFileSync(scriptPath, `#!/bin/sh\nprintf "%s\\n" "dummy v1.0" > "$REPOEXE_TEST_MARKER"\n`);
    chmodSync(scriptPath, 0o755);

    const oldBackend = process.env.REPOEXE_TEST_BACKEND;
    const oldMarker = process.env.REPOEXE_TEST_MARKER;
    try {
      process.env.REPOEXE_TEST_BACKEND = 'native';
      process.env.REPOEXE_TEST_MARKER = markerFile;
      const result = executeTest(
        {
          name: 'dummy-pkg',
          version: '1.0',
          arch: 'all',
          phases: { test: 'dummy-pkg' },
        },
        testDir,
        testDir,
      );
      // Testing stage without .deb archives returns [] so unbuilt archives are not promoted
      expect(result).toEqual([]);
      expect(existsSync(markerFile)).toBeTrue();
    } finally {
      if (oldBackend !== undefined) {
        process.env.REPOEXE_TEST_BACKEND = oldBackend;
      } else {
        delete process.env.REPOEXE_TEST_BACKEND;
      }
      if (oldMarker !== undefined) {
        process.env.REPOEXE_TEST_MARKER = oldMarker;
      } else {
        delete process.env.REPOEXE_TEST_MARKER;
      }
      rmSync(testDir, { recursive: true, force: true });
    }
  });

  it('throws when testedArtifacts has non-empty files but outputDir is missing (Thread #2)', (): void => {
    const tmpBase = join(process.env.TMPDIR || tmpdir(), `test-promo-missing-${Date.now()}`);
    const missingOutputDir = join(tmpBase, 'non-existent-output');
    const validatedDir = join(tmpBase, 'validated');
    const recipe: Partial<PackageRecipe> & { name: string } = { name: 'app' };

    expect(() => {
      stageValidatedOutputs(recipe, missingOutputDir, validatedDir, ['app_2.0_arm.deb']);
    }).toThrow(/Incomplete tested artifact set for promotion/);

    // Empty testedArtifacts is a no-op
    expect(() => {
      stageValidatedOutputs(recipe, missingOutputDir, validatedDir, []);
    }).not.toThrow();

    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('safeRenameSync reliably renames files and directories', (): void => {
    const tmp = join(process.env.TMPDIR || tmpdir(), `test-saferename-${Date.now()}`);
    mkdirSync(tmp, { recursive: true });
    try {
      const srcFile = join(tmp, 'src.txt');
      const dstFile = join(tmp, 'dst.txt');
      writeFileSync(srcFile, 'hello safeRename');
      safeRenameSync(srcFile, dstFile);
      expect(existsSync(srcFile)).toBeFalse();
      expect(existsSync(dstFile)).toBeTrue();
      expect(readFileSync(dstFile, 'utf-8')).toBe('hello safeRename');

      const srcDir = join(tmp, 'src_dir');
      const dstDir = join(tmp, 'dst_dir');
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, 'file.txt'), 'nested');
      safeRenameSync(srcDir, dstDir);
      expect(existsSync(srcDir)).toBeFalse();
      expect(existsSync(dstDir)).toBeTrue();
      expect(readFileSync(join(dstDir, 'file.txt'), 'utf-8')).toBe('nested');

      // Test EXDEV injected fallback for file, directory, and symlink
      const mockExdevRename = (_s: string, _d: string): void => {
        const err = new Error('Cross-device link');
        (err as unknown as { code: string }).code = 'EXDEV';
        throw err;
      };

      const exdevFileSrc = join(tmp, 'exdev_src.txt');
      const exdevFileDst = join(tmp, 'exdev_dst.txt');
      writeFileSync(exdevFileSrc, 'exdev file content');
      safeRenameSync(exdevFileSrc, exdevFileDst, mockExdevRename);
      expect(existsSync(exdevFileSrc)).toBeFalse();
      expect(existsSync(exdevFileDst)).toBeTrue();
      expect(readFileSync(exdevFileDst, 'utf-8')).toBe('exdev file content');

      const exdevDirSrc = join(tmp, 'exdev_src_dir');
      const exdevDirDst = join(tmp, 'exdev_dst_dir');
      mkdirSync(exdevDirSrc, { recursive: true });
      writeFileSync(join(exdevDirSrc, 'data.txt'), 'exdev dir data');
      safeRenameSync(exdevDirSrc, exdevDirDst, mockExdevRename);
      expect(existsSync(exdevDirSrc)).toBeFalse();
      expect(existsSync(exdevDirDst)).toBeTrue();
      expect(readFileSync(join(exdevDirDst, 'data.txt'), 'utf-8')).toBe('exdev dir data');

      const exdevLinkTarget = join(tmp, 'link_target.txt');
      writeFileSync(exdevLinkTarget, 'target content');
      const exdevLinkSrc = join(tmp, 'exdev_link');
      symlinkSync(exdevLinkTarget, exdevLinkSrc);
      const exdevLinkDst = join(tmp, 'exdev_link_dst');
      safeRenameSync(exdevLinkSrc, exdevLinkDst, mockExdevRename);
      expect(existsSync(exdevLinkSrc)).toBeFalse();
      expect(lstatSync(exdevLinkDst).isSymbolicLink()).toBeTrue();
      expect(readlinkSync(exdevLinkDst)).toBe(exdevLinkTarget);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
