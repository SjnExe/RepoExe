import { describe, expect, it } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAndPrepareSource, simulateDryRun } from '../cli/build.ts';

describe('build CLI helpers', () => {
  it('returns pDir if recipe has no source', () => {
    const recipe = { name: 'no-source', version: '1.0.0' };
    const dest = join(process.env.TMPDIR || tmpdir(), `dest-${Date.now()}`);
    const workDir = fetchAndPrepareSource(recipe, 'pkg/no-source', dest);
    expect(workDir).toBe('pkg/no-source');
  });

  it('reuses existing extracted source when continueBuild is enabled', () => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-continue-${Date.now()}`);
    const srcDir = join(testDest, 'src');
    mkdirSync(srcDir, { recursive: true });
    writeFileSync(join(srcDir, 'test.txt'), 'hello');

    const recipe = { name: 'dummy', version: '1.0.0', source: 'https://example.com/dummy.tar.gz' };
    const workDir = fetchAndPrepareSource(recipe, 'pkg/dummy', testDest, true);
    expect(workDir).toBe(srcDir);

    rmSync(testDest, { recursive: true, force: true });
  });

  it('runs simulateDryRun cleanly', async () => {
    const testDest = join(process.env.TMPDIR || tmpdir(), `dest-dry-${Date.now()}`);
    const testOut = join(testDest, 'out');
    const recipe = {
      name: 'test-pkg',
      version: '1.2.3',
      revision: 1,
      epoch: 0,
      arch: 'aarch64',
      formats: ['apt', 'apk'],
      build_deps: ['make'],
      depends: ['libc'],
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
