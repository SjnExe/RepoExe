import { describe, expect, it } from 'bun:test';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { executePack, fetchAndPrepareSource, simulateDryRun } from '../cli/build.ts';
import type { PackageRecipe } from '../core/types.ts';

describe('build CLI helpers', (): void => {
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
    writeFileSync(join(srcDir, 'test.txt'), 'hello');
    writeFileSync(join(testDest, '.source_prepared'), '1.0.0');

    const recipe = { name: 'dummy', version: '1.0.0', source: 'https://example.com/dummy.tar.gz' };
    const workDir = fetchAndPrepareSource(recipe, 'pkg/dummy', testDest, true);
    expect(workDir).toBe(srcDir);

    rmSync(testDest, { recursive: true, force: true });
  });

  it('rejects reusing extracted source when .source_prepared sentinel is missing', (): void => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-noprep-${Date.now()}`);
    const srcDir = join(testDest, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'partial.txt'), 'partial');

    // Without .source_prepared, fetchAndPrepareSource wipes srcDir and tries to fetch
    const recipe = { name: 'dummy', version: '1.0.0', source: 'https://example.com/dummy.tar.gz' };
    expect(() => fetchAndPrepareSource(recipe, 'pkg/dummy', testDest, true)).toThrow();
    // After fresh preparation begins, partial.txt is wiped
    expect(existsSync(join(srcDir, 'partial.txt'))).toBeFalse();

    rmSync(testDest, { recursive: true, force: true });
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
      revision: 1,
      epoch: 0,
      arch: 'aarch64',
      formats: ['apt', 'apk'],
      build_deps: ['make'],
      deps: ['libc'],
      source: 'https://example.com/test-pkg.tar.gz',
      phases: {
        configure: './configure',
        make: 'make -j4',
      },
    };

    let logCalled = false;
    const originalLog = console.log;
    console.log = (...args: any[]) => {
      logCalled = true;
    };

    try {
      await simulateDryRun(recipe, 'pkg/test-pkg', testDest, testOut, 'latest', 'build', true);
      expect(logCalled).toBeTrue();
    } finally {
      console.log = originalLog;
      rmSync(testDest, { recursive: true, force: true });
    }
  });
});
