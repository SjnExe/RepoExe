import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { extractDebArch, generateAptMetadata } from '../builders/debian.ts';
import {
  getExactPackageArtifacts,
  getRetainedReleaseAssetFilenames,
  isExternalPackage,
  isRemoteAssetSatisfied,
  prepareSite,
} from '../cli/index_gen.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { createRecipe } from './fixtures.ts';

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

test('getRetainedReleaseAssetFilenames includes retained child subpackage and pinned parent archives', (): void => {
  const recipe = createRecipe({
    name: 'parent',
    version: '2.0.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    subpackages: {
      dev: { name: 'parent-dev', include: ['include/**'] },
    },
  });

  const assets = [
    // Current replacement for parent
    { name: 'parent_2.0.0_aarch64.deb' },
    // Current x86_64 parent without child to test that older parent_1.0.0_x86_64 is retained by child pin
    { name: 'parent_2.0.0_x86_64.deb' },
    // Retained older child subpackage on x86_64
    { name: 'parent-dev_1.0.0_x86_64.deb' },
    // Retained pinned parent required by older child
    { name: 'parent_1.0.0_x86_64.deb' },
    // Outdated parent on aarch64 (replaced by 2.0.0)
    { name: 'parent_1.0.0_aarch64.deb' },
    // Unrelated package accidentally in release
    { name: 'unrelated_1.0.0_all.deb' },
  ];

  const retained = getRetainedReleaseAssetFilenames(recipe, assets);
  expect(retained.has('parent_2.0.0_aarch64.deb')).toBeTrue();
  expect(retained.has('parent_2.0.0_x86_64.deb')).toBeTrue();
  expect(retained.has('parent-dev_1.0.0_x86_64.deb')).toBeTrue();
  expect(retained.has('parent_1.0.0_x86_64.deb')).toBeTrue();
  expect(retained.has('parent_1.0.0_aarch64.deb')).toBeFalse();
  expect(retained.has('unrelated_1.0.0_all.deb')).toBeFalse();
});

test('getRetainedReleaseAssetFilenames retains :all child and parent during partial aarch64-only publication', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    subpackages: {
      doc: {
        name: 'foo-doc',
        arch: 'all',
        include: ['share/doc/**'],
      },
    },
  });

  const assets = [
    // Pre-existing release contains arm parent and older all child
    { name: 'foo_1_arm.deb' },
    { name: 'foo-doc_1_all.deb' },
    // Only aarch64 build succeeds and publishes version 2 parent and all child
    { name: 'foo_2_aarch64.deb' },
    { name: 'foo-doc_2_all.deb' },
  ];

  const retained = getRetainedReleaseAssetFilenames(recipe, assets);
  // Both current aarch64 artifacts and retained older arm/all pair must be retained
  expect(retained.has('foo_2_aarch64.deb')).toBeTrue();
  expect(retained.has('foo-doc_2_all.deb')).toBeTrue();
  expect(retained.has('foo_1_arm.deb')).toBeTrue();
  expect(retained.has('foo-doc_1_all.deb')).toBeTrue();
});

test('Thread #8: getRetainedReleaseAssetFilenames requires published ownership metadata for historical archives', (): void => {
  const otherRecipe = createRecipe({ name: 'other', version: '1', arch: 'aarch64' });
  const clientRecipe = createRecipe({ name: 'client', version: '1', arch: 'aarch64', deps: ['helper (= 2)'] });
  const allRecipes = { other: otherRecipe, client: clientRecipe };

  // Without published ownership metadata, unrelated helper_1 and helper_2 are NOT admitted
  const unownedAssets = [
    { name: 'other_1_aarch64.deb' },
    { name: 'helper_1_aarch64.deb' },
    { name: 'helper_2_aarch64.deb' },
  ];
  const retainedNoOwner = getRetainedReleaseAssetFilenames(otherRecipe, unownedAssets, allRecipes);
  expect(retainedNoOwner.has('helper_1_aarch64.deb')).toBeFalse();
  expect(retainedNoOwner.has('helper_2_aarch64.deb')).toBeFalse();

  // With published ownership metadata, compatible historical child helper_2 is admitted while incompatible helper_1 is not
  const ownerBody = JSON.stringify({ managed_by: 'repoexe', name: 'other', owned_packages: ['other', 'helper'] });
  const retainedOwned = getRetainedReleaseAssetFilenames(otherRecipe, unownedAssets, allRecipes, ownerBody);
  expect(retainedOwned.has('helper_2_aarch64.deb')).toBeTrue();
  expect(retainedOwned.has('helper_1_aarch64.deb')).toBeFalse();
});

test('Thread #9: prepareSite preserves caller artifactsDir located at siteDir/apt_next', async (): Promise<void> => {
  const testBase = join(process.env.TMPDIR || tmpdir(), `repoexe-aptnext-safe-${Date.now()}`);
  const testSite = join(testBase, 'output');
  const testArt = join(testSite, 'apt_next');
  const testStaging = join(testBase, 'staging');
  mkdirSync(testArt, { recursive: true });
  mkdirSync(testStaging, { recursive: true });
  writeFileSync(join(testArt, 'keep_metadata.json'), '{"name":"keep"}');

  const oldGpgHome = process.env.GNUPGHOME;
  const oldGpgKey = process.env.GPG_PRIVATE_KEY;
  const oldReqSigning = process.env.REQUIRE_APT_SIGNING;
  const fakeGpgHome = join(testBase, '.gnupg');
  mkdirSync(fakeGpgHome, { recursive: true, mode: 0o700 });
  process.env.GNUPGHOME = fakeGpgHome;
  delete process.env.GPG_PRIVATE_KEY;
  delete process.env.REQUIRE_APT_SIGNING;

  try {
    await prepareSite(testSite, testArt, true, testStaging);
    expect(existsSync(join(testArt, 'keep_metadata.json'))).toBeTrue();
  } finally {
    if (oldReqSigning !== undefined) {
      process.env.REQUIRE_APT_SIGNING = oldReqSigning;
    } else {
      delete process.env.REQUIRE_APT_SIGNING;
    }
    if (oldGpgHome !== undefined) {
      process.env.GNUPGHOME = oldGpgHome;
    } else {
      delete process.env.GNUPGHOME;
    }
    if (oldGpgKey !== undefined) {
      process.env.GPG_PRIVATE_KEY = oldGpgKey;
    } else {
      delete process.env.GPG_PRIVATE_KEY;
    }
    rmSync(testBase, { recursive: true, force: true });
  }
});

test('Thread #3: isExternalPackage identifies external packages vs repository targets', (): void => {
  const tmpInventoryDir = mkdtempSync(join(tmpdir(), 'test-pkg-inventory-'));
  const tmpPkgDir = join(tmpInventoryDir, 'pkg');
  mkdirSync(join(tmpPkgDir, 'direct-pkg'), { recursive: true });
  writeFileSync(join(tmpPkgDir, 'direct-pkg', 'recipe.ts'), `export default { name: 'direct-pkg', version: '1.0' };\n`);

  mkdirSync(join(tmpPkgDir, 'parent-pkg'), { recursive: true });
  writeFileSync(
    join(tmpPkgDir, 'parent-pkg', 'recipe.ts'),
    `export default {
      name: 'parent-pkg',
      version: '1.0',
      subpackages: {
        'child-subpkg': { name: 'child-subpkg' }
      }
    };\n`,
  );

  mkdirSync(join(tmpPkgDir, 'provider-pkg'), { recursive: true });
  writeFileSync(
    join(tmpPkgDir, 'provider-pkg', 'recipe.ts'),
    `export default {
      name: 'provider-pkg',
      version: '1.0',
      provides: ['virtual-feature']
    };\n`,
  );

  try {
    const dag = new DependencyGraph(tmpPkgDir);
    // Direct package in inventory -> internal
    expect(isExternalPackage('direct-pkg', dag, tmpInventoryDir)).toBeFalse();
    // Subpackage in inventory -> internal
    expect(isExternalPackage('child-subpkg', dag, tmpInventoryDir)).toBeFalse();
    // Virtual provider in inventory -> internal
    expect(isExternalPackage('virtual-feature', dag, tmpInventoryDir)).toBeFalse();
    // Absent package not in inventory -> external
    expect(isExternalPackage('absent-pkg', dag, tmpInventoryDir)).toBeTrue();
  } finally {
    rmSync(tmpInventoryDir, { recursive: true, force: true });
  }
});

test('isRemoteAssetSatisfied honors explicit architecture qualifiers', (): void => {
  const tmpInventoryDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'test-explicit-arch-'));
  const tmpPkgDir = join(tmpInventoryDir, 'pkg');
  mkdirSync(join(tmpPkgDir, 'libsdk'), { recursive: true });
  writeFileSync(
    join(tmpPkgDir, 'libsdk', 'recipe.ts'),
    `export default { name: 'libsdk', version: '2.0', arches: ['arm', 'x86_64'] };\n`,
  );

  try {
    const dag = new DependencyGraph(tmpPkgDir);
    const mockGetAssets = (_tag: string): Array<{ name: string }> => [
      { name: 'libsdk_2.0_arm.deb' },
      { name: 'libsdk_2.0_x86_64.deb' },
    ];

    // Explicit :arm qualifier matches arm asset even when consumer arch is x86_64
    const satisfiedArm = isRemoteAssetSatisfied(
      { name: 'libsdk:arm', multiArch: 'arm' },
      'x86_64',
      dag,
      mockGetAssets,
      tmpInventoryDir,
    );
    expect(satisfiedArm).toBeTrue();

    // Explicit :i686 qualifier fails when only arm and x86_64 exist
    const unsatisfiedI686 = isRemoteAssetSatisfied(
      { name: 'libsdk:i686', multiArch: 'i686' },
      'x86_64',
      dag,
      mockGetAssets,
      tmpInventoryDir,
    );
    expect(unsatisfiedI686).toBeFalse();
  } finally {
    rmSync(tmpInventoryDir, { recursive: true, force: true });
  }
});
