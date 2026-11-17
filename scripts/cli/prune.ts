import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { extractDebArch, formatDebianFilenameVersion } from '../builders/debian.ts';
import { parseDependencyList, type VersionConstraint } from '../core/dependencies.ts';
import { parseFilenameDebVersion } from '../core/fetcher.ts';
import { parseRecipe } from '../core/parser.ts';
import { getSubpackageNames } from '../core/subpkg.ts';
import type { PackageRecipe, SubpackageDefinition } from '../core/types.ts';
import { compareDebianVersions, satisfiesVersionConstraint } from '../core/version.ts';
import { DependencyGraph } from '../utils/dag.ts';

export function getExpectedAssetFilenames(recipe: PackageRecipe): Set<string> {
  const pkg = recipe.name;
  const versionStrDeb = formatDebianFilenameVersion(recipe);
  const expected = new Set<string>(['metadata.json', `${pkg}_metadata.json`]);

  const subNames = getSubpackageNames(recipe);
  const names = [pkg, ...subNames];
  for (const subName of subNames) {
    expected.add(`${subName}_metadata.json`);
  }

  for (const name of names) {
    expected.add(`${name}_${versionStrDeb}_arm64.deb`);
    expected.add(`${name}_${versionStrDeb}_aarch64.deb`);
    expected.add(`${name}_${versionStrDeb}_arm.deb`);
    expected.add(`${name}_${versionStrDeb}_x86_64.deb`);
    expected.add(`${name}_${versionStrDeb}_i686.deb`);
    expected.add(`${name}_${versionStrDeb}_all.deb`);
  }

  return expected;
}

export function identifyOrphanedReleases(releases: Array<Record<string, any>>, pkgsDir: string): string[] {
  const orphaned: string[] = [];
  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (tag.includes('@')) {
      orphaned.push(tag);
      continue;
    }
    const isPkgRelease =
      rel.assets && rel.assets.some((a: any) => a.name?.startsWith(`${tag}_`) && a.name?.endsWith('.deb'));
    if (!isPkgRelease) {
      continue;
    }

    const recipePath = join(pkgsDir, tag, 'recipe.ts');
    if (!existsSync(recipePath)) {
      orphaned.push(tag);
    }
  }
  return orphaned;
}

const debPackageName = (name: string): string => name.split('_')[0];

interface DepRequirement {
  name: string;
  constraint?: VersionConstraint;
  targetArch?: string;
}

function collectDepRequirements(depStrings: string[], emittedPkgs: Set<string>, targetArch?: string): DepRequirement[] {
  const reqs: DepRequirement[] = [];
  if (!depStrings || depStrings.length === 0) {
    return reqs;
  }
  const clauses = parseDependencyList(depStrings);
  for (const branch of clauses) {
    for (const token of branch) {
      const depPkg = token.name.split(':')[0].trim();
      if (emittedPkgs.has(depPkg)) {
        reqs.push({
          name: depPkg,
          constraint: token.versionConstraint,
          targetArch,
        });
      }
    }
  }
  return reqs;
}

function childHasParentDependency(subDef?: SubpackageDefinition): boolean {
  if (!subDef) {
    return true;
  }
  return subDef.parent_dep !== 'none';
}

export interface ReleaseAssetRecord {
  name: string;
  id?: number;
  url?: string;
  browser_download_url?: string;
  [key: string]: unknown;
}

export function identifyOutdatedAssets<T extends ReleaseAssetRecord = ReleaseAssetRecord>(
  assets: T[],
  recipe?: PackageRecipe,
  _pkgName?: string,
  allRecipes?: Record<string, PackageRecipe>,
): T[] {
  const toDelete: T[] = [];
  if (!recipe) {
    return toDelete;
  }

  const whitelist = getExpectedAssetFilenames(recipe);
  const replacedPkgArches = new Set<string>();

  for (const asset of assets) {
    const name = asset.name || '';
    if (whitelist.has(name) && name.endsWith('.deb')) {
      replacedPkgArches.add(`${debPackageName(name)}:${extractDebArch(name)}`);
    }
  }

  const subpkgNames = new Set(getSubpackageNames(recipe));
  const emittedPkgs = new Set<string>([recipe.name, ...subpkgNames]);

  // Collect all distinct non-all architectures of the parent present in assets
  const parentArches = new Set<string>();
  for (const asset of assets) {
    const name = asset.name || '';
    if (name.endsWith('.deb') && debPackageName(name) === recipe.name) {
      const arch = extractDebArch(name);
      if (arch && arch !== 'all') {
        parentArches.add(arch);
      }
    }
  }

  const parentFullyPublished =
    parentArches.size === 0 ||
    replacedPkgArches.has(`${recipe.name}:all`) ||
    Array.from(parentArches).every((a) => replacedPkgArches.has(`${recipe.name}:${a}`));

  const normArch = (a?: string): string => (!a || a === 'all' ? 'all' : a === 'arm64' ? 'aarch64' : a);

  // Helper to determine if an asset has a valid replacement published (Thread #17)
  const hasValidReplacement = (pkg: string, arch: string): boolean => {
    const subDef = recipe.subpackages
      ? (Object.values(recipe.subpackages).find((s) => s && (s as SubpackageDefinition).name === pkg) as
          SubpackageDefinition | undefined)
      : undefined;

    if (childHasParentDependency(subDef)) {
      if (arch === 'all') {
        return parentFullyPublished && replacedPkgArches.has(`${pkg}:all`);
      }
      // When replacing a native arch child with an all package, verify parent covers that arch
      if (replacedPkgArches.has(`${pkg}:all`)) {
        const parentCoversArch =
          replacedPkgArches.has(`${recipe.name}:all`) || replacedPkgArches.has(`${recipe.name}:${arch}`);
        if (!parentCoversArch) {
          return false;
        }
        return true;
      }
      return (
        replacedPkgArches.has(`${pkg}:${arch}`) &&
        (replacedPkgArches.has(`${recipe.name}:all`) || replacedPkgArches.has(`${recipe.name}:${arch}`))
      );
    }

    return replacedPkgArches.has(`${pkg}:all`) || replacedPkgArches.has(`${pkg}:${arch}`);
  };

  const retainedAssets = new Set<T>();
  for (const asset of assets) {
    const name = asset.name || '';
    if (whitelist.has(name)) {
      retainedAssets.add(asset);
    } else if (name.endsWith('.deb')) {
      const pkg = debPackageName(name);
      const arch = extractDebArch(name);
      if (!hasValidReplacement(pkg, arch)) {
        retainedAssets.add(asset);
      }
    }
  }

  // Retention roots from recipe.deps, recipe.subpackages, and cross-release pins (Thread #16)
  const activeRequirements: DepRequirement[] = [];
  if (Array.isArray(recipe.deps)) {
    activeRequirements.push(
      ...collectDepRequirements(recipe.deps, emittedPkgs, recipe.arch === 'all' ? 'all' : recipe.arch || 'aarch64'),
    );
  }

  if (recipe.subpackages) {
    for (const subDef of Object.values(recipe.subpackages)) {
      if (!subDef || typeof subDef !== 'object') {
        continue;
      }
      const childArch =
        (subDef as SubpackageDefinition).arch || (recipe.arch === 'all' ? 'all' : recipe.arch || 'aarch64');
      if (Array.isArray(subDef.deps)) {
        activeRequirements.push(...collectDepRequirements(subDef.deps, emittedPkgs, childArch));
      }
      if (typeof subDef.parent_dep === 'string' && !['exact', 'same-version', 'none'].includes(subDef.parent_dep)) {
        activeRequirements.push(...collectDepRequirements([subDef.parent_dep], emittedPkgs, childArch));
      }
    }
  }

  if (allRecipes) {
    for (const [otherName, otherRecipe] of Object.entries(allRecipes)) {
      if (otherName === recipe.name || !otherRecipe) {
        continue;
      }
      const consumerArches =
        otherRecipe.arch === 'all'
          ? ['all']
          : otherRecipe.arches && otherRecipe.arches.length > 0
            ? otherRecipe.arches
            : [otherRecipe.arch || 'aarch64'];

      if (Array.isArray(otherRecipe.deps)) {
        for (const cArch of consumerArches) {
          activeRequirements.push(...collectDepRequirements(otherRecipe.deps, emittedPkgs, cArch));
        }
      }
      if (otherRecipe.subpackages) {
        for (const sDef of Object.values(otherRecipe.subpackages)) {
          if (sDef && typeof sDef === 'object') {
            const rawSubArch = (sDef as SubpackageDefinition).arch;
            const subArches = rawSubArch === 'all' ? ['all'] : rawSubArch ? [rawSubArch] : consumerArches;

            const childDeps = [...((sDef as SubpackageDefinition).deps || [])];
            if (
              (sDef as SubpackageDefinition).parent_dep &&
              typeof (sDef as SubpackageDefinition).parent_dep === 'string' &&
              (sDef as SubpackageDefinition).parent_dep !== 'exact' &&
              (sDef as SubpackageDefinition).parent_dep !== 'same-version'
            ) {
              childDeps.push((sDef as SubpackageDefinition).parent_dep!);
            }

            if (childDeps.length > 0) {
              for (const cArch of subArches) {
                activeRequirements.push(...collectDepRequirements(childDeps, emittedPkgs, cArch));
              }
            }
          }
        }
      }
    }
  }

  // Fixed-point dependency retention loop (Thread #2 & Thread #4)
  const processedAssets = new Set<T>();
  let changed = true;
  while (changed) {
    changed = false;

    // 1. Collect dependencies from retained assets (including pinned assets with replacements)
    for (const asset of retainedAssets) {
      if (processedAssets.has(asset)) {
        continue;
      }
      processedAssets.add(asset);

      const name = asset.name || '';
      if (!name.endsWith('.deb')) {
        continue;
      }
      const pkg = debPackageName(name);
      const arch = extractDebArch(name);
      const ver = parseFilenameDebVersion(name);

      if (pkg === recipe.name) {
        if (Array.isArray(recipe.deps)) {
          activeRequirements.push(...collectDepRequirements(recipe.deps, emittedPkgs, arch));
        }
      } else if (subpkgNames.has(pkg)) {
        const subDef = recipe.subpackages
          ? (Object.values(recipe.subpackages).find((s) => s && (s as SubpackageDefinition).name === pkg) as
              SubpackageDefinition | undefined)
          : undefined;
        if (subDef) {
          if (Array.isArray(subDef.deps)) {
            activeRequirements.push(...collectDepRequirements(subDef.deps, emittedPkgs, arch));
          }
          if (typeof subDef.parent_dep === 'string' && !['exact', 'same-version', 'none'].includes(subDef.parent_dep)) {
            activeRequirements.push(...collectDepRequirements([subDef.parent_dep], emittedPkgs, arch));
          } else if (childHasParentDependency(subDef)) {
            if (arch === 'all') {
              if (parentArches.size > 0) {
                for (const pArch of parentArches) {
                  activeRequirements.push({
                    name: recipe.name,
                    constraint: { operator: '=', version: ver },
                    targetArch: pArch,
                  });
                }
              } else {
                activeRequirements.push({
                  name: recipe.name,
                  constraint: { operator: '=', version: ver },
                  targetArch: 'all',
                });
              }
            } else {
              activeRequirements.push({
                name: recipe.name,
                constraint: { operator: '=', version: ver },
                targetArch: arch,
              });
            }
          }
        }
      }
    }

    // 2. Satisfy active requirements from release assets
    for (const req of activeRequirements) {
      const candidates: Array<{ asset: T; ver: string }> = [];
      for (const asset of assets) {
        const name = asset.name || '';
        if (!name.endsWith('.deb') || debPackageName(name) !== req.name) {
          continue;
        }
        const candArch = extractDebArch(name);
        const archMatches =
          normArch(req.targetArch) === 'all' ||
          normArch(candArch) === 'all' ||
          normArch(req.targetArch) === normArch(candArch);
        if (!archMatches) {
          continue;
        }
        const candVer = parseFilenameDebVersion(name);
        if (satisfiesVersionConstraint(candVer, req.constraint)) {
          candidates.push({ asset, ver: candVer });
        }
      }

      if (candidates.length > 0) {
        if (req.constraint?.operator === '=') {
          for (const cand of candidates) {
            if (!retainedAssets.has(cand.asset)) {
              retainedAssets.add(cand.asset);
              changed = true;
            }
          }
        } else if (normArch(req.targetArch) === 'all') {
          // An 'all' package can be installed on any architecture, so retain the best compatible candidate per candidate architecture
          const bestByArch = new Map<string, { asset: T; ver: string }>();
          for (const cand of candidates) {
            const cArch = normArch(extractDebArch(cand.asset.name));
            const existing = bestByArch.get(cArch);
            if (!existing || compareDebianVersions(cand.ver, existing.ver) > 0) {
              bestByArch.set(cArch, cand);
            }
          }
          for (const cand of bestByArch.values()) {
            if (!retainedAssets.has(cand.asset)) {
              retainedAssets.add(cand.asset);
              changed = true;
            }
          }
        } else {
          candidates.sort((a, b) => compareDebianVersions(b.ver, a.ver));
          const candAsset = candidates[0].asset;
          if (!retainedAssets.has(candAsset)) {
            retainedAssets.add(candAsset);
            changed = true;
          }
        }
      }
    }
  }

  for (const asset of assets) {
    const name = asset.name || '';
    if (whitelist.has(name) || retainedAssets.has(asset)) {
      continue;
    }

    if (name.endsWith('.deb')) {
      const pkg = debPackageName(name);
      const arch = extractDebArch(name);
      if (hasValidReplacement(pkg, arch)) {
        toDelete.push(asset);
      }
    } else {
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

  let allRecipes: Record<string, PackageRecipe> | undefined;
  if (existsSync(pkgsDir)) {
    try {
      const dag = new DependencyGraph(pkgsDir);
      allRecipes = dag.recipes;
    } catch {
      // ignore
    }
  }

  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (tag.includes('@')) {
      continue;
    }
    const assets = rel.assets || [];
    const isPkgRelease = assets.some((a: any) => a.name?.startsWith(`${tag}_`) && a.name?.endsWith('.deb'));
    if (!isPkgRelease) {
      continue;
    }

    const recipePath = join(pkgsDir, tag, 'recipe.ts');

    if (existsSync(recipePath)) {
      try {
        const recipe = parseRecipe(recipePath);
        const whitelist = getExpectedAssetFilenames(recipe);
        const hasCurrentDebInRelease = assets.some((a: any) => whitelist.has(a.name || '') && a.name?.endsWith('.deb'));

        if (!hasCurrentDebInRelease) {
          console.log(`Notice: Preserving existing assets for ${tag} until replacement is confirmed on release.`);
          continue;
        }

        const outdated = identifyOutdatedAssets(assets, recipe, tag, allRecipes);
        for (const asset of outdated) {
          if (asset.id && asset.name) {
            deletionTasks.push({ tag, name: asset.name, assetId: asset.id });
          }
        }
      } catch (e) {
        console.log(`Could not parse recipe for ${tag}: ${e}`);
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
