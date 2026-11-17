import { expect, test } from 'bun:test';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { getExpectedAssetFilenames, identifyOrphanedReleases, identifyOutdatedAssets } from '../cli/prune.ts';
import { parseRecipe } from '../core/parser.ts';
import { createRecipe } from './fixtures.ts';

test('getExpectedAssetFilenames returns native format filenames', (): void => {
  const recipe = parseRecipe('pkg/aisleriot');
  const expected = getExpectedAssetFilenames(recipe);

  const debVer = recipe.revision > 0 ? `${recipe.version}-${recipe.revision}` : recipe.version;

  expect(expected.has(`aisleriot_${debVer}_arm64.deb`)).toBeTrue();
  expect(expected.has(`aisleriot_${debVer}_aarch64.deb`)).toBeTrue();
  expect(expected.has('metadata.json')).toBeTrue();
  // Ensure no pacman, apk, pip wheels or npm tgz are generated
  expect(Array.from(expected).some((f) => f.endsWith('.pkg.tar.zst'))).toBeFalse();
  expect(Array.from(expected).some((f) => f.endsWith('.apk'))).toBeFalse();
  expect(Array.from(expected).some((f) => f.endsWith('.whl'))).toBeFalse();
  expect(Array.from(expected).some((f) => f.endsWith('.tgz'))).toBeFalse();
});

test('getExpectedAssetFilenames includes subpackages when defined', (): void => {
  const recipe = createRecipe({
    name: 'testpkg',
    version: '1.2.0',
    revision: 1,
    subpackages: {
      dev: { name: 'testpkg-dev', include: ['include/**'] },
      doc: 'auto:doc',
    },
  });
  const expected = getExpectedAssetFilenames(recipe);
  expect(expected.has('testpkg_1.2.0-1_aarch64.deb')).toBeTrue();
  expect(expected.has('testpkg-dev_1.2.0-1_aarch64.deb')).toBeTrue();
  expect(expected.has('testpkg-doc_1.2.0-1_all.deb')).toBeTrue();
  expect(expected.has('testpkg-dev_metadata.json')).toBeTrue();
  expect(expected.has('testpkg-doc_metadata.json')).toBeTrue();
});

test('identifyOutdatedAssets filters unknown assets', (): void => {
  const recipe = parseRecipe('pkg/aisleriot');
  const debVer = recipe.revision > 0 ? `${recipe.version}-${recipe.revision}` : recipe.version;
  const assets = [
    { name: `aisleriot_${debVer}_arm64.deb`, id: 1 },
    { name: 'aisleriot_3.20.0_arm64.deb', id: 2 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, 'aisleriot');
  expect(outdated.length).toBe(1);
  expect(outdated[0].id).toBe(2);
});

test('identifyOutdatedAssets only prunes architectures with current replacements on release', (): void => {
  const recipe = parseRecipe('pkg/aisleriot');
  const debVer = recipe.revision > 0 ? `${recipe.version}-${recipe.revision}` : recipe.version;
  const assets1 = [
    { name: `aisleriot_${debVer}_aarch64.deb`, id: 1 },
    { name: 'aisleriot_3.20.0_aarch64.deb', id: 2 },
    { name: 'aisleriot_3.20.0_arm.deb', id: 3 },
    { name: 'aisleriot_3.20.0_x86_64.deb', id: 4 },
  ];

  // Only aarch64 has a replacement in assets
  const outdated1 = identifyOutdatedAssets(assets1, recipe, 'aisleriot');
  expect(outdated1.map((a) => a.id)).toEqual([2]);

  // When arm replacement is also published to release
  const assets2 = [...assets1, { name: `aisleriot_${debVer}_arm.deb`, id: 5 }];
  const outdated2 = identifyOutdatedAssets(assets2, recipe, 'aisleriot');
  expect(outdated2.map((a) => a.id)).toEqual([2, 3]);
});

test('identifyOutdatedAssets does not prune older child subpackages when only parent is replaced', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2.0.0',
    revision: 0,
    epoch: 0,
    subpackages: {
      dev: { name: 'foo-dev', include: ['include/**'] },
    },
  });

  const assets1 = [
    { name: 'foo_2.0.0_aarch64.deb', id: 1 },
    { name: 'foo-dev_1.0.0_aarch64.deb', id: 2 },
  ];

  // foo_2 does not make foo-dev_1 eligible for deletion
  const outdated1 = identifyOutdatedAssets(assets1, recipe, 'foo');
  expect(outdated1.length).toBe(0);

  // When foo-dev replacement is added to assets
  const assets2 = [...assets1, { name: 'foo-dev_2.0.0_aarch64.deb', id: 3 }];
  const outdated2 = identifyOutdatedAssets(assets2, recipe, 'foo');
  expect(outdated2.map((a) => a.id)).toEqual([2]);
});

test('identifyOutdatedAssets preserves explicit parent dependency of current children', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2.0.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    subpackages: {
      client: {
        name: 'foo-client',
        arch: 'aarch64',
        include: ['bin/**'],
        parent_dep: 'foo (= 1.0.0)',
      },
    },
  });

  const assets = [
    // Current replacement for parent
    { name: 'foo_2.0.0_aarch64.deb', id: 1 },
    // Current child subpackage
    { name: 'foo-client_2.0.0_aarch64.deb', id: 2 },
    // Explicit parent required by current child
    { name: 'foo_1.0.0_aarch64.deb', id: 3 },
    // Outdated parent on aarch64 that wasn't pinned
    { name: 'foo_0.9.0_aarch64.deb', id: 4 },
  ];

  // foo_1.0.0_aarch64.deb is pinned by current child's parent_dep: 'foo (= 1.0.0)'
  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  const outdatedIds = outdated.map((a) => a.id);
  expect(outdatedIds).toEqual([4]);
});

test('identifyOutdatedAssets retains :all child and older parent when publication covers only some parent architectures', (): void => {
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
    { name: 'foo_1_arm.deb', id: 1 },
    { name: 'foo-doc_1_all.deb', id: 2 },
    // Only aarch64 build succeeds and publishes version 2 parent and all child
    { name: 'foo_2_aarch64.deb', id: 3 },
    { name: 'foo-doc_2_all.deb', id: 4 },
  ];

  // Since arm parent is not replaced, foo-doc_1_all and foo_1_arm must be retained
  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  expect(outdated.map((a) => a.id)).toEqual([]);
});

test('identifyOutdatedAssets preserves version-pinned sibling subpackages', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    subpackages: {
      runtime: {
        name: 'foo-runtime',
        arch: 'aarch64',
        include: ['lib/**'],
        parent_dep: 'none',
      },
      tools: {
        name: 'foo-tools',
        arch: 'aarch64',
        include: ['bin/**'],
        parent_dep: 'none',
        deps: ['foo-runtime (= 1)'],
      },
    },
  });

  const assets = [
    // Current parent and current children
    { name: 'foo_2_aarch64.deb', id: 1 },
    { name: 'foo-runtime_2_aarch64.deb', id: 2 },
    { name: 'foo-tools_2_aarch64.deb', id: 3 },
    // Version 1 of foo-runtime pinned by foo-tools
    { name: 'foo-runtime_1_aarch64.deb', id: 4 },
    // Unpinned older version of parent (runtime has parent_dep: 'none')
    { name: 'foo_1_aarch64.deb', id: 5 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  const outdatedIds = outdated.map((a) => a.id);
  // foo_1_aarch64.deb is outdated and pruned; foo-runtime_1_aarch64.deb is preserved by sibling pin
  expect(outdatedIds).toEqual([5]);
});

test('identifyOutdatedAssets collects dependencies from parent recipe.deps (Thread #3)', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    deps: ['foo-runtime (= 1)'],
    subpackages: {
      runtime: {
        name: 'foo-runtime',
        arch: 'aarch64',
        include: ['lib/**'],
        parent_dep: 'none',
      },
    },
  });

  const assets = [
    { name: 'foo_2_aarch64.deb', id: 1 },
    { name: 'foo-runtime_2_aarch64.deb', id: 2 },
    { name: 'foo-runtime_1_aarch64.deb', id: 3 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  const outdatedIds = outdated.map((a) => a.id);
  // foo-runtime_1 is required by recipe.deps, so neither is deleted
  expect(outdatedIds).toEqual([]);
});

test('identifyOutdatedAssets preserves comparison operator and avoids treating newer version as compatible with << (Thread #2)', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    subpackages: {
      runtime: {
        name: 'foo-runtime',
        arch: 'aarch64',
        include: ['lib/**'],
        parent_dep: 'none',
      },
      tools: {
        name: 'foo-tools',
        arch: 'aarch64',
        include: ['bin/**'],
        parent_dep: 'none',
        deps: ['foo-runtime (<< 2)'],
      },
    },
  });

  const assets = [
    { name: 'foo_2_aarch64.deb', id: 1 },
    { name: 'foo-tools_2_aarch64.deb', id: 2 },
    { name: 'foo-runtime_2_aarch64.deb', id: 3 },
    { name: 'foo-runtime_1_aarch64.deb', id: 4 },
    { name: 'foo-runtime_3_aarch64.deb', id: 5 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  const outdatedIds = outdated.map((a) => a.id);
  // foo-runtime_1 satisfies '<< 2', so it must be preserved
  expect(outdatedIds.includes(4)).toBeFalse();
  // foo-runtime_3 violates '<< 2', so it must be marked outdated
  expect(outdatedIds.includes(5)).toBeTrue();
});

test('identifyOutdatedAssets collects transitive dependencies of pinned assets to fixed point (Thread #4)', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    subpackages: {
      runtime: {
        name: 'foo-runtime',
        arch: 'aarch64',
        include: ['lib/**'],
        // Default parent dependency on foo
      },
      tools: {
        name: 'foo-tools',
        arch: 'aarch64',
        include: ['bin/**'],
        parent_dep: 'none',
        deps: ['foo-runtime (= 1)'],
      },
    },
  });

  const assets = [
    { name: 'foo_2_aarch64.deb', id: 1 },
    { name: 'foo-runtime_2_aarch64.deb', id: 2 },
    { name: 'foo-tools_2_aarch64.deb', id: 3 },
    // Version 1 of foo-runtime pinned by foo-tools
    { name: 'foo-runtime_1_aarch64.deb', id: 4 },
    // Version 1 of parent foo required by foo-runtime_1
    { name: 'foo_1_aarch64.deb', id: 5 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  const outdatedIds = outdated.map((a) => a.id);
  // Both foo-runtime_1 and foo_1 are retained via fixed-point dependency chain
  expect(outdatedIds).toEqual([]);
});

test('identifyOutdatedAssets retains cross-release pinned version (Thread #16)', (): void => {
  const runtimeRecipe = createRecipe({
    name: 'runtime',
    version: '2',
    arch: 'aarch64',
  });

  const clientRecipe = createRecipe({
    name: 'client',
    version: '1',
    arch: 'aarch64',
    deps: ['runtime (= 1)'],
  });

  const assets = [
    { name: 'runtime_2_aarch64.deb', id: 1 },
    { name: 'runtime_1_aarch64.deb', id: 2 },
  ];

  const allRecipes = {
    runtime: runtimeRecipe,
    client: clientRecipe,
  };

  const outdated = identifyOutdatedAssets(assets, runtimeRecipe, 'runtime', allRecipes);
  const outdatedIds = outdated.map((a) => a.id);
  // runtime_1 is retained because client pins runtime (= 1)
  expect(outdatedIds).toEqual([]);
});

test('identifyOutdatedAssets checks parent coverage when all replaces native child (Thread #17)', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2',
    arch: 'aarch64',
    subpackages: {
      doc: {
        name: 'foo-doc',
        arch: 'all',
        include: ['share/doc/**'],
      },
    },
  });

  // Current release has foo_2_aarch64 and foo-doc_2_all, but NO foo_2_arm
  const assets = [
    { name: 'foo_2_aarch64.deb', id: 1 },
    { name: 'foo-doc_2_all.deb', id: 2 },
    // Old arm child should be retained because foo_2_arm is not available
    { name: 'foo-doc_1_arm.deb', id: 3 },
    { name: 'foo_1_arm.deb', id: 4 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  const outdatedIds = outdated.map((a) => a.id);
  // foo-doc_1_arm and foo_1_arm are preserved because replacement doc needs foo on arm
  expect(outdatedIds).not.toContain(3);
  expect(outdatedIds).not.toContain(4);
});

test('identifyOutdatedAssets retains pinned parent when all parent archives are architecture-independent (Thread #18)', (): void => {
  const recipe = createRecipe({
    name: 'foo',
    version: '2',
    arch: 'all',
    subpackages: {
      doc: {
        name: 'foo-doc',
        arch: 'all',
        include: ['share/doc/**'],
      },
    },
  });

  // Current release only published foo_2_all.deb; foo-doc_2_all is missing
  const assets = [
    { name: 'foo_2_all.deb', id: 1 },
    // Missing child replacement keeps foo-doc_1_all.deb
    { name: 'foo-doc_1_all.deb', id: 2 },
    // foo_1_all.deb should be retained because foo-doc_1_all depends on foo (= 1)
    { name: 'foo_1_all.deb', id: 3 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, 'foo');
  const outdatedIds = outdated.map((a) => a.id);
  expect(outdatedIds).not.toContain(2);
  expect(outdatedIds).not.toContain(3);
});

test('identifyOrphanedReleases detects deleted/missing recipes', (): void => {
  const tmpPkgDir = join(tmpdir(), `test-pkgs-${Date.now()}`);
  mkdirSync(join(tmpPkgDir, 'existing-pkg'), { recursive: true });
  writeFileSync(join(tmpPkgDir, 'existing-pkg', 'recipe.ts'), 'export default {};');

  const releases = [
    { tag_name: 'existing-pkg', assets: [{ name: 'existing-pkg_1.0_aarch64.deb' }] },
    { tag_name: 'deleted-pkg', assets: [{ name: 'deleted-pkg_1.0_aarch64.deb' }] },
    { tag_name: 'legacy-pkg@latest' },
    { tag_name: 'random-non-package-tag' },
  ];

  const orphaned = identifyOrphanedReleases(releases, tmpPkgDir);
  expect(orphaned).toContain('deleted-pkg');
  expect(orphaned).toContain('legacy-pkg@latest');
  expect(orphaned).not.toContain('existing-pkg');
  expect(orphaned).not.toContain('random-non-package-tag');

  rmSync(tmpPkgDir, { recursive: true, force: true });
});
