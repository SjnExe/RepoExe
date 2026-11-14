import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseRecipe } from '../core/parser.ts';
import type { PackageRecipe } from '../core/types.ts';

export function getExpectedAssetFilenames(recipe: PackageRecipe): Set<string> {
  const ver = recipe.version;
  const rev = recipe.revision;
  const pkg = recipe.name;

  const versionStrDeb = rev > 0 ? `${ver}-${rev}` : ver;
  const expected = new Set<string>(['metadata.json', `${pkg}_metadata.json`]);

  expected.add(`${pkg}_${versionStrDeb}_arm64.deb`);
  expected.add(`${pkg}_${versionStrDeb}_aarch64.deb`);
  expected.add(`${pkg}_${versionStrDeb}_all.deb`);

  return expected;
}

export function identifyOrphanedReleases(releases: Array<Record<string, any>>, pkgsDir: string): string[] {
  const orphaned: string[] = [];
  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (!tag.includes('@')) continue;
    const [pkg] = tag.split('@');
    const recipePath = join(pkgsDir, pkg, 'recipe.ts');
    if (!existsSync(recipePath)) {
      orphaned.push(tag);
    }
  }
  return orphaned;
}

export function identifyOutdatedAssets(
  assets: Array<Record<string, any>>,
  recipe?: PackageRecipe,
  pkgName?: string,
): Array<Record<string, any>> {
  const toDelete: Array<Record<string, any>> = [];
  if (!recipe) return toDelete;

  const whitelist = getExpectedAssetFilenames(recipe);

  for (const asset of assets) {
    const name = asset.name || '';
    if (!whitelist.has(name)) {
      toDelete.push(asset);
    }
  }

  return toDelete;
}

export async function pruneReleaseTags(): Promise<void> {
  const repoRoot = resolve('.');
  const pkgsDir = join(repoRoot, 'pkg');

  const repoRes = spawnSync('gh', ['repo', 'view', '--json', 'name,owner'], { encoding: 'utf-8' });
  if (repoRes.status !== 0) {
    console.log('⚠️ gh CLI unauthenticated or not inside git repository.');
    return;
  }

  let owner: string;
  let repoName: string;
  try {
    const repoInfo = JSON.parse(repoRes.stdout);
    owner = repoInfo.owner.login;
    repoName = repoInfo.name;
  } catch (e) {
    console.log(`Failed to parse repo info: ${e}`);
    return;
  }

  const releasesRes = spawnSync('gh', ['api', '--paginate', `repos/${owner}/${repoName}/releases`], {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (releasesRes.status !== 0) {
    console.log(`Failed to fetch releases: ${releasesRes.stderr}`);
    return;
  }

  let releases: Array<Record<string, any>> = [];
  try {
    releases = JSON.parse(releasesRes.stdout);
  } catch (e) {
    console.log(`Failed to parse releases JSON: ${e}`);
    return;
  }

  const deletionTasks: Array<{ tag: string; name: string; assetId: number }> = [];
  const orphanedReleases = identifyOrphanedReleases(releases, pkgsDir);

  for (const rel of releases) {
    const tag = rel.tag_name || '';
    const assets = rel.assets || [];
    if (!tag.includes('@')) continue;

    const [pkg, channel] = tag.split('@');
    const recipePath = join(pkgsDir, pkg, 'recipe.ts');

    if (existsSync(recipePath)) {
      try {
        const recipe = parseRecipe(recipePath, channel);
        const outdated = identifyOutdatedAssets(assets, recipe, pkg);
        for (const asset of outdated) {
          if (asset.id && asset.name) {
            deletionTasks.push({ tag, name: asset.name, assetId: asset.id });
          }
        }
      } catch (e) {
        console.log(`Could not parse recipe for ${pkg}: ${e}`);
      }
    }
  }

  // 1. Prune orphaned releases (deleted packages)
  for (const tag of orphanedReleases) {
    console.log(`🗑️ Pruning deleted package release and tag: ${tag}`);
    spawnSync('gh', ['release', 'delete', tag, '--cleanup-tag', '-y']);
  }

  // 2. Prune outdated assets
  if (deletionTasks.length === 0 && orphanedReleases.length === 0) {
    console.log('✓ All release assets and tags are up to date! Nothing to prune.');
    return;
  }

  if (deletionTasks.length > 0) {
    console.log(`🗑️ Found ${deletionTasks.length} outdated asset(s) to prune...`);
    for (const task of deletionTasks) {
      const res = spawnSync(
        'gh',
        ['api', '--method', 'DELETE', `repos/${owner}/${repoName}/releases/assets/${task.assetId}`],
        { encoding: 'utf-8' },
      );
      if (res.status === 0) {
        console.log(`✓ [${task.tag}] Deleted ${task.name}`);
      } else {
        console.log(`❌ [${task.tag}] Failed to delete ${task.name}: ${res.stderr?.trim()}`);
      }
    }
  }
}

if (import.meta.main) {
  pruneReleaseTags();
}
