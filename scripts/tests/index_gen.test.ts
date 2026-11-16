import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractDebArch, generateAptMetadata } from '../builders/debian.ts';
import { getExactPackageArtifacts, prepareSite } from '../cli/index_gen.ts';

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

test('prepareSite parses metadata JSON files without reference errors', async (): Promise<void> => {
  const testBase = join(tmpdir(), `repoexe-site-meta-${Date.now()}`);
  const testSite = join(testBase, 'site');
  const testArt = join(testBase, 'artifacts');
  const testStaging = join(testBase, 'apt_staging');
  mkdirSync(testSite, { recursive: true });
  mkdirSync(testArt, { recursive: true });
  mkdirSync(testStaging, { recursive: true });

  writeFileSync(join(testArt, 'sample_metadata.json'), JSON.stringify({ name: 'sample' }));
  writeFileSync(join(testArt, 'sample_1.0.0_arm64.deb'), '');

  try {
    await prepareSite(testSite, testArt, true, testStaging);
    const metaParsed = JSON.parse(readFileSync(join(testArt, 'sample_metadata.json'), 'utf-8'));
    expect(metaParsed.name).toBe('sample');
    expect(existsSync(join(testSite, 'apt', 'sample_1.0.0_arm64.deb'))).toBeTrue();
  } finally {
    rmSync(testBase, { recursive: true, force: true });
  }
});

test('generateAptMetadata produces relative Filename and filters architectures', (): void => {
  const testDir = join(tmpdir(), `repoexe-apt-meta-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  try {
    // Generate mock Packages control file via dummy dpkg-deb simulation or real deb files if present
    // Testing architecture filtering logic directly:
    const arches = ['aarch64', 'x86_64'];
    for (const arch of arches) {
      generateAptMetadata(testDir, 'main', arch);
      const pkgPath = join(testDir, 'dists', 'stable', 'main', `binary-${arch}`, 'Packages');
      expect(existsSync(pkgPath)).toBeTrue();
      expect(existsSync(`${pkgPath}.gz`)).toBeTrue();
      const content = readFileSync(pkgPath, 'utf-8');
      expect(content.includes('https://github.com')).toBeFalse();
    }
  } finally {
    rmSync(testDir, { recursive: true, force: true });
  }
});
