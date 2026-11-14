import { expect, test } from 'bun:test';
import { getExactPackageArtifacts, prepareSite } from '../cli/index_gen.ts';
import { lstatSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

test('getExactPackageArtifacts prevents prefix collision', (): void => {
  const testDir = join(tmpdir(), `repoexe-test-artifacts-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  writeFileSync(join(testDir, 'foo_1.0.0_arm64.deb'), '');

  // Sibling packages with matching prefix
  writeFileSync(join(testDir, 'foo-tools_1.0.0_arm64.deb'), '');
  writeFileSync(join(testDir, 'foo-extra_2.0.0_arm64.deb'), '');

  const fooMatches = getExactPackageArtifacts(testDir, 'foo');
  expect(fooMatches.length).toBe(1);
  expect(fooMatches.some((f) => f.includes('foo-tools'))).toBeFalse();
  expect(fooMatches.some((f) => f.includes('foo-extra'))).toBeFalse();

  const fooToolsMatches = getExactPackageArtifacts(testDir, 'foo-tools');
  expect(fooToolsMatches.length).toBe(1);
  expect(fooToolsMatches.every((f) => f.includes('foo-tools'))).toBeTrue();

  rmSync(testDir, { recursive: true, force: true });
});

test('prepareSite dereferences install script and generates tar-clean site', async (): Promise<void> => {
  const testBase = join(tmpdir(), `repoexe-site-test-${Date.now()}`);
  const testSite = join(testBase, 'site');
  const testArt = join(testBase, 'artifacts');
  const testStaging = join(testBase, 'apt_staging');
  const testGpgHome = join(testBase, 'gnupg');
  mkdirSync(testSite, { recursive: true });
  mkdirSync(testArt, { recursive: true });
  mkdirSync(testStaging, { recursive: true });
  mkdirSync(testGpgHome, { recursive: true, mode: 0o700 });

  const oldGpgHome = process.env.GNUPGHOME;
  process.env.GNUPGHOME = testGpgHome;

  try {
    await prepareSite(testSite, testArt, true, testStaging);

    const siteInstall = join(testSite, 'install');
    expect(siteInstall).toBeDefined();

    // Ensure site/install is a concrete regular file, never a dangling relative symlink
    const lstat = lstatSync(siteInstall);
    expect(lstat.isSymbolicLink()).toBeFalse();
    expect(lstat.isFile()).toBeTrue();
    const content = readFileSync(siteInstall, 'utf-8');
    expect(content.length).toBeGreaterThan(0);

    // Tar upload test verification: tar must package site cleanly without exit code 1
    const testTar = join(testBase, 'test_pages.tar.gz');
    const tarRes = spawnSync('tar', ['-czf', testTar, '-C', testSite, '.']);
    expect(tarRes.status).toBe(0);
  } finally {
    if (oldGpgHome !== undefined) {
      process.env.GNUPGHOME = oldGpgHome;
    } else {
      delete process.env.GNUPGHOME;
    }
    rmSync(testBase, { recursive: true, force: true });
  }
});
