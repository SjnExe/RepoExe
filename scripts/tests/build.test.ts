import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getPackageSourceDateEpoch, normalizeSourceDir } from '../builders/debian.ts';
import {
  cleanupStagingDirs,
  comparePatchFilenames,
  computeSourceIdentity,
  executePack,
  fetchAndPrepareSource,
  resolveAndValidatePatches,
  simulateDryRun,
  stageValidatedOutputs,
} from '../cli/build.ts';
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
    writeFileSync(join(testDest, '.source_prepared.json'), JSON.stringify({ identity, workDir: srcDir, sourceEpoch }));

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

    const oldRecipe = { name: 'dummy', version: '1.0.0', source: 'file:///nonexistent/dummy.tar.gz' };
    const oldIdentity = computeSourceIdentity(oldRecipe, 'pkg/dummy');
    writeFileSync(join(testDest, '.source_prepared.json'), JSON.stringify({ identity: oldIdentity, workDir: srcDir }));

    // New version produces different identity, so continueBuild rejects stale source
    const newRecipe = { name: 'dummy', version: '2.0.0', source: 'file:///nonexistent/dummy.tar.gz' };
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
    expect(executePack(recipe, 'pkg/bad-fmt', testDest, testOut)).rejects.toThrow('Unsupported package format');
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
      const recipe = { name: 'dummy', version: '1.0.0', source: 'file:///nonexistent/dummy.tar.gz' };
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

    expect(() => fetchAndPrepareSource(recipe, testPkg, testDest, false)).toThrow(/Invalid patch filename 'fix.diff'/);

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

    const valid = resolveAndValidatePatches({ name: 'testpkg', patches: ['patches/0001-fix.patch'] }, testPkg);
    expect(valid).toEqual(['0001-fix.patch']);

    expect(() =>
      resolveAndValidatePatches({ name: 'testpkg', patches: ['patches/0002-missing.patch'] }, testPkg),
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
    // Older v1 files must not be staged
    expect(existsSync(join(validatedDir, 'app_1.0_aarch64.deb'))).toBe(false);
    expect(existsSync(join(validatedDir, 'app-doc_1.0_all.deb'))).toBe(false);

    rmSync(tmpBase, { recursive: true, force: true });
  });
});
