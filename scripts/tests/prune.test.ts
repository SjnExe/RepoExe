import { expect, test } from 'bun:test';
import { getExpectedAssetFilenames, identifyOrphanedReleases, identifyOutdatedAssets } from '../cli/prune.ts';
import { parseRecipe } from '../core/parser.ts';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

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

test('identifyOrphanedReleases detects deleted/missing recipes', (): void => {
  const tmpPkgDir = join(tmpdir(), `test-pkgs-${Date.now()}`);
  mkdirSync(join(tmpPkgDir, 'existing-pkg'), { recursive: true });
  writeFileSync(join(tmpPkgDir, 'existing-pkg', 'recipe.ts'), 'export default {};');

  const releases = [
    { tag_name: 'existing-pkg@latest' },
    { tag_name: 'deleted-pkg@latest' },
    { tag_name: 'pydantic-core@latest' },
    { tag_name: 'random-non-package-tag' },
  ];

  const orphaned = identifyOrphanedReleases(releases, tmpPkgDir);
  expect(orphaned).toContain('deleted-pkg@latest');
  expect(orphaned).toContain('pydantic-core@latest');
  expect(orphaned).not.toContain('existing-pkg@latest');
  expect(orphaned).not.toContain('random-non-package-tag');

  rmSync(tmpPkgDir, { recursive: true, force: true });
});
