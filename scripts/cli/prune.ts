import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { extractDebArch, formatDebianFilenameVersion, getDebMultiArch } from '../builders/debian.ts';
import {
  CANONICAL_ARCHES,
  type DependencyToken,
  filterDepsForArch,
  normalizeArch,
  parseDependencyList,
  type VersionConstraint,
} from '../core/dependencies.ts';
import { parseFilenameDebVersion } from '../core/fetcher.ts';
import { parseRecipe } from '../core/parser.ts';
import { getSubpackageNames } from '../core/subpkg.ts';
import type { PackageRecipe, SubpackageDefinition } from '../core/types.ts';
import { compareDebianVersions, formatDebianVersion, satisfiesVersionConstraint } from '../core/version.ts';
import { DependencyGraph } from '../utils/dag.ts';

export function getExpectedAssetFilenames(recipe: PackageRecipe): Set<string> {
  const pkg = recipe.name;
  const versionStrDeb = formatDebianFilenameVersion(recipe);
  const expected = new Set<string>(['metadata.json', `${pkg}_metadata.json`]);
  for (const a of ['aarch64', 'arm64', 'arm', 'x86_64', 'i686', 'all']) {
    expected.add(`${pkg}_${a}_metadata.json`);
  }

  const subNames = getSubpackageNames(recipe);
  const names = [pkg, ...subNames];
  for (const subName of subNames) {
    expected.add(`${subName}_metadata.json`);
    for (const a of ['aarch64', 'arm64', 'arm', 'x86_64', 'i686', 'all']) {
      expected.add(`${subName}_${a}_metadata.json`);
    }
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

export function parsePaginatedGhJsonArray(raw: string): Array<Record<string, any>> {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  let parsed: unknown;
  let isJsonSyntaxError = false;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    isJsonSyntaxError = true;
  }

  if (!isJsonSyntaxError) {
    if (!Array.isArray(parsed)) {
      throw new Error('Expected JSON array from paginated GitHub API response.');
    }
    if (parsed.length > 0 && parsed.every((item) => Array.isArray(item))) {
      return parsed.flat();
    }
    if (parsed.some((item) => Array.isArray(item))) {
      throw new Error('Mixed nested and flat elements in paginated GitHub API response.');
    }
    return parsed as Array<Record<string, any>>;
  }

  // Fallback for concatenated multi-page JSON arrays: [...][...]
  const pages: Array<Record<string, any>> = [];
  let i = 0;
  while (i < trimmed.length) {
    while (i < trimmed.length && /\s/.test(trimmed[i])) {
      i++;
    }
    if (i >= trimmed.length) {
      break;
    }
    if (trimmed[i] !== '[') {
      throw new Error('Invalid paginated JSON response: expected array opening bracket.');
    }
    let depth = 0;
    let inStr = false;
    let escaped = false;
    const start = i;
    let end = -1;
    for (; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (inStr) {
        if (escaped) {
          escaped = false;
        } else if (ch === '\\') {
          escaped = true;
        } else if (ch === '"') {
          inStr = false;
        }
      } else {
        if (ch === '"') {
          inStr = true;
        } else if (ch === '[') {
          depth++;
        } else if (ch === ']') {
          depth--;
          if (depth === 0) {
            end = i + 1;
            i++;
            break;
          }
        }
      }
    }
    if (end === -1) {
      throw new Error('Unterminated JSON array in paginated GitHub API response.');
    }
    const chunk = JSON.parse(trimmed.slice(start, end));
    if (!Array.isArray(chunk)) {
      throw new Error('Expected JSON array page in paginated GitHub API response.');
    }
    pages.push(...chunk);
  }
  return pages;
}

export interface ReleaseOwnershipMetadata {
  managedByRepoExe: boolean;
  ownerName?: string;
  ownedPackages: Set<string>;
}

export function parseReleaseOwnershipMetadata(releaseBody?: string): ReleaseOwnershipMetadata {
  const ownedPackages = new Set<string>();
  if (!releaseBody || !releaseBody.trim()) {
    return { managedByRepoExe: false, ownedPackages };
  }
  try {
    const parsed = JSON.parse(releaseBody.trim());
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { managedByRepoExe: false, ownedPackages };
    }
    const obj = parsed as Record<string, unknown>;
    const ownerName = typeof obj.name === 'string' && obj.name.trim() ? obj.name.trim() : undefined;
    const hasRepoExeShape =
      obj.managed_by === 'repoexe' ||
      (Boolean(ownerName) &&
        (Array.isArray(obj.owned_packages) ||
          typeof obj.state_hash === 'string' ||
          typeof obj.version === 'string' ||
          obj.partial === true));
    if (hasRepoExeShape) {
      if (ownerName) {
        ownedPackages.add(ownerName);
      }
      if (Array.isArray(obj.owned_packages)) {
        for (const pkg of obj.owned_packages) {
          if (typeof pkg === 'string' && pkg.trim()) {
            ownedPackages.add(pkg.trim());
          }
        }
      }
    }
    return { managedByRepoExe: hasRepoExeShape, ownerName, ownedPackages };
  } catch {
    return { managedByRepoExe: false, ownedPackages };
  }
}

export interface ReleaseRecord {
  tag_name?: string;
  body?: string;
  assets?: Array<{ name?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

export function isPackageReleaseTag(rel: ReleaseRecord, pkgsDir: string): boolean {
  const tag = rel.tag_name || '';
  if (!tag || tag.includes('@')) {
    return false;
  }
  const assets: Array<{ name?: string }> = rel.assets || [];
  if (assets.some((a) => a.name?.startsWith(`${tag}_`) && a.name?.endsWith('.deb'))) {
    return true;
  }
  if (assets.some((a) => a.name === `${tag}_metadata.json`)) {
    return true;
  }
  const recipePath = join(pkgsDir, tag, 'recipe.ts');
  if (existsSync(recipePath)) {
    try {
      const recipe = parseRecipe(recipePath);
      const subNames = getSubpackageNames(recipe);
      if (assets.some((a) => a.name?.endsWith('.deb') && subNames.some((sub) => a.name?.startsWith(`${sub}_`)))) {
        return true;
      }
    } catch {}
  } else {
    // Recipe is absent: require positive publisher-written ownership metadata before classifying child-only releases
    const ownership = parseReleaseOwnershipMetadata(typeof rel.body === 'string' ? rel.body : undefined);
    if (ownership.managedByRepoExe && (!ownership.ownerName || ownership.ownerName === tag)) {
      if (
        ownership.ownedPackages.size > 0 &&
        assets.some(
          (a) =>
            typeof a.name === 'string' &&
            ((a.name.endsWith('.deb') && ownership.ownedPackages.has(a.name.split('_')[0])) ||
              (a.name.endsWith('_metadata.json') &&
                (() => {
                  const base = a.name.slice(0, -'_metadata.json'.length);
                  let metaPkg = base;
                  const match = base.match(
                    /^(.*?)(?:_(aarch64|arm64|x86_64|amd64|arm|armhf|armel|armv7|i686|i386|all))?$/i,
                  );
                  if (match && match[2] && CANONICAL_ARCHES.has(normalizeArch(match[2]))) {
                    metaPkg = match[1];
                  }
                  return ownership.ownedPackages.has(metaPkg);
                })())),
        )
      ) {
        return true;
      }
    }
  }
  return false;
}

function getPublicationBranchRecipeInventory(): Set<string> | null {
  try {
    const res = spawnSync('git', ['ls-tree', '--name-only', 'origin/main', 'pkg/'], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      const set = new Set<string>();
      for (const line of res.stdout.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('pkg/')) {
          set.add(trimmed.slice(4));
        } else if (trimmed) {
          set.add(trimmed);
        }
      }
      return set;
    }
  } catch {}
  return null;
}

export function identifyOrphanedReleases(
  releases: Array<Record<string, any>>,
  pkgsDir: string,
  allRecipes?: Record<string, PackageRecipe>,
): string[] {
  const pubInventory = getPublicationBranchRecipeInventory();
  const orphaned: string[] = [];
  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (tag.includes('@')) {
      orphaned.push(tag);
      continue;
    }
    if (!isPackageReleaseTag(rel, pkgsDir)) {
      continue;
    }

    const recipePath = join(pkgsDir, tag, 'recipe.ts');
    if (existsSync(recipePath)) {
      continue;
    }
    // If it does not exist in local checkout, check if it exists on the publication branch (origin/main)
    // A run from an older ref must not delete a release that exists on main (Thread #4)
    if (pubInventory && pubInventory.has(tag)) {
      continue;
    }

    let isRequiredByLiveDep = false;
    if (allRecipes && typeof allRecipes === 'object') {
      const assets: Array<{ name?: string }> = rel.assets || [];
      let relProvides: string[] = [];
      if (typeof rel.body === 'string' && rel.body.trim()) {
        try {
          const parsed = JSON.parse(rel.body.trim());
          if (parsed && typeof parsed === 'object' && Array.isArray(parsed.provides)) {
            relProvides = parsed.provides;
          }
        } catch {}
      }

      for (const asset of assets) {
        const aName = asset.name || '';
        if (!aName.endsWith('.deb')) {
          continue;
        }
        const assetPkg = aName.split('_')[0];
        const assetVer = parseFilenameDebVersion(aName);

        const assetProvides = (asset as { provides?: string[] | string }).provides;
        const allProvidesStrings: string[] = [
          ...(Array.isArray(assetProvides) ? assetProvides : assetProvides ? [assetProvides] : []),
          ...relProvides,
        ];

        interface ProvidedCap {
          name: string;
          version?: string;
          hasExplicitVersion: boolean;
        }
        const providedCaps: ProvidedCap[] = [
          { name: assetPkg, version: assetVer, hasExplicitVersion: Boolean(assetVer) },
        ];
        for (const provStr of allProvidesStrings) {
          for (const clause of parseDependencyList(provStr)) {
            for (const tok of clause) {
              const pName = tok.name.split(':')[0].trim();
              providedCaps.push({
                name: pName,
                version: tok.versionConstraint?.version,
                hasExplicitVersion: Boolean(tok.versionConstraint?.version),
              });
            }
          }
        }

        for (const liveRecipe of Object.values(allRecipes)) {
          const rawDeps: string[] = [];
          if (Array.isArray(liveRecipe.deps)) {
            rawDeps.push(...liveRecipe.deps);
          }
          if (Array.isArray(liveRecipe.build_deps)) {
            rawDeps.push(...liveRecipe.build_deps);
          }
          if (liveRecipe.subpackages) {
            for (const sDef of Object.values(liveRecipe.subpackages)) {
              if (sDef && typeof sDef === 'object') {
                if (Array.isArray(sDef.deps)) {
                  rawDeps.push(...sDef.deps);
                }
                if (
                  typeof sDef.parent_dep === 'string' &&
                  !['exact', 'same-version', 'none'].includes(sDef.parent_dep)
                ) {
                  rawDeps.push(sDef.parent_dep);
                }
              }
            }
          }
          for (const clause of parseDependencyList(rawDeps)) {
            for (const tok of clause) {
              const reqName = tok.name.split(':')[0].trim();
              for (const cap of providedCaps) {
                if (cap.name === reqName) {
                  if (!tok.versionConstraint) {
                    isRequiredByLiveDep = true;
                    break;
                  }
                  if (cap.hasExplicitVersion) {
                    if (satisfiesVersionConstraint(cap.version || '', tok.versionConstraint)) {
                      isRequiredByLiveDep = true;
                      break;
                    }
                  } else {
                    // Do not treat unavailable published provider data as proof that a versioned virtual dependency has no match
                    isRequiredByLiveDep = true;
                    break;
                  }
                }
              }
              if (isRequiredByLiveDep) {
                break;
              }
            }
            if (isRequiredByLiveDep) {
              break;
            }
          }
          if (isRequiredByLiveDep) {
            break;
          }
        }
        if (isRequiredByLiveDep) {
          break;
        }
      }
    }
    if (!isRequiredByLiveDep) {
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
  isAny?: boolean;
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
        const isAny = token.multiArch === 'any' || token.name.endsWith(':any');
        const effectiveReqArch = token.multiArch && !isAny ? normalizeArch(token.multiArch) : targetArch;
        reqs.push({
          name: depPkg,
          constraint: token.versionConstraint,
          targetArch: effectiveReqArch,
          isAny,
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
      if ((asset as { state?: string }).state && (asset as { state?: string }).state !== 'uploaded') {
        continue;
      }
      replacedPkgArches.add(`${debPackageName(name)}:${extractDebArch(name)}`);
    }
  }

  const subpkgNames = new Set(getSubpackageNames(recipe));
  const emittedPkgs = new Set<string>([recipe.name, ...subpkgNames]);

  const providedVirtualNames = new Set<string>();
  const collectVirtualNames = (rawList: string[] | string | undefined): void => {
    if (!rawList) {
      return;
    }
    const list = Array.isArray(rawList) ? rawList : [rawList];
    for (const clause of parseDependencyList(list)) {
      for (const tok of clause) {
        const pName = tok.name.split(':')[0].trim();
        if (pName) {
          providedVirtualNames.add(pName);
        }
      }
    }
  };
  collectVirtualNames(recipe.provides);
  if (recipe.subpackages) {
    for (const sub of Object.values(recipe.subpackages)) {
      if (sub && Array.isArray((sub as SubpackageDefinition).provides)) {
        collectVirtualNames((sub as SubpackageDefinition).provides);
      }
    }
  }
  for (const asset of assets) {
    collectVirtualNames((asset as { provides?: string[] | string }).provides);
  }
  const allTrackedNames = new Set<string>([...emittedPkgs, ...providedVirtualNames]);

  // Collect all distinct non-all architectures of the parent present in assets
  const parentArches = new Set<string>();
  let hasOldAllParent = false;
  for (const asset of assets) {
    const name = asset.name || '';
    if (name.endsWith('.deb') && debPackageName(name) === recipe.name) {
      const arch = extractDebArch(name);
      if (arch === 'all') {
        hasOldAllParent = true;
      } else if (arch && arch !== 'unknown') {
        parentArches.add(arch);
      }
    }
  }

  const requiredParentArches = new Set<string>(parentArches);
  if (hasOldAllParent && !replacedPkgArches.has(`${recipe.name}:all`)) {
    const parentTargetArches = recipe.arches && recipe.arches.length > 0 ? recipe.arches : [recipe.arch || 'aarch64'];
    for (const a of parentTargetArches) {
      if (a !== 'all') {
        requiredParentArches.add(normalizeArch(a));
      }
    }
  }

  const parentFullyPublished =
    replacedPkgArches.has(`${recipe.name}:all`) ||
    (requiredParentArches.size > 0
      ? Array.from(requiredParentArches).every((a) => replacedPkgArches.has(`${recipe.name}:${a}`))
      : !hasOldAllParent);

  const normArch = (a?: string): string => (!a || a === 'all' ? 'all' : a === 'arm64' ? 'aarch64' : a);

  const currentParentVer = formatDebianVersion(recipe);

  // Helper to determine if an asset has a valid replacement published (Thread #5 & Thread #17)
  const hasValidReplacement = (pkg: string, arch: string, oldVer?: string): boolean => {
    if (oldVer && compareDebianVersions(currentParentVer, oldVer) <= 0) {
      return false;
    }

    if (pkg === recipe.name) {
      return arch === 'all'
        ? parentFullyPublished
        : replacedPkgArches.has(`${pkg}:all`) || replacedPkgArches.has(`${pkg}:${arch}`);
    }

    const subDef = recipe.subpackages
      ? (Object.values(recipe.subpackages).find((s) => s && (s as SubpackageDefinition).name === pkg) as
          SubpackageDefinition | undefined)
      : undefined;

    if (arch === 'all') {
      return (!childHasParentDependency(subDef) || parentFullyPublished) && replacedPkgArches.has(`${pkg}:all`);
    }

    if (replacedPkgArches.has(`${pkg}:all`)) {
      if (childHasParentDependency(subDef)) {
        const parentCoversArch =
          replacedPkgArches.has(`${recipe.name}:all`) || replacedPkgArches.has(`${recipe.name}:${arch}`);
        if (!parentCoversArch) {
          return false;
        }
      }
      if (subDef && Array.isArray(subDef.deps) && subDef.deps.length > 0) {
        const clauses = parseDependencyList(subDef.deps);
        const filtered = filterDepsForArch(clauses, arch);
        for (const clause of filtered) {
          const hasCover = clause.some((tok: DependencyToken) => {
            const tokName = tok.name.split(':')[0].trim();
            if (
              allTrackedNames.has(tokName) ||
              replacedPkgArches.has(`${tokName}:all`) ||
              replacedPkgArches.has(`${tokName}:${arch}`)
            ) {
              return replacedPkgArches.has(`${tokName}:all`) || replacedPkgArches.has(`${tokName}:${arch}`);
            }
            return true;
          });
          if (!hasCover) {
            return false;
          }
        }
      }
      return true;
    }

    return (
      replacedPkgArches.has(`${pkg}:${arch}`) &&
      (!childHasParentDependency(subDef) ||
        replacedPkgArches.has(`${recipe.name}:all`) ||
        replacedPkgArches.has(`${recipe.name}:${arch}`))
    );
  };

  const retainedAssets = new Set<T>();
  for (const asset of assets) {
    const name = asset.name || '';
    if (whitelist.has(name)) {
      retainedAssets.add(asset);
    } else if (name.endsWith('.deb')) {
      const pkg = debPackageName(name);
      const arch = extractDebArch(name);
      const ver = parseFilenameDebVersion(name);
      if (!hasValidReplacement(pkg, arch, ver)) {
        retainedAssets.add(asset);
      }
    }
  }

  // Retention roots from recipe.deps, recipe.subpackages, and cross-release pins (Thread #16)
  const activeRequirements: DepRequirement[] = [];
  if (Array.isArray(recipe.deps)) {
    activeRequirements.push(
      ...collectDepRequirements(recipe.deps, allTrackedNames, recipe.arch === 'all' ? 'all' : recipe.arch || 'aarch64'),
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
        activeRequirements.push(...collectDepRequirements(subDef.deps, allTrackedNames, childArch));
      }
      if (typeof subDef.parent_dep === 'string' && !['exact', 'same-version', 'none'].includes(subDef.parent_dep)) {
        activeRequirements.push(...collectDepRequirements([subDef.parent_dep], allTrackedNames, childArch));
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

      const publishedDeps = (otherRecipe as { publishedDeps?: string[] }).publishedDeps;
      const otherDeps = Array.isArray(publishedDeps) ? publishedDeps : otherRecipe.deps;
      if (Array.isArray(otherDeps)) {
        for (const cArch of consumerArches) {
          activeRequirements.push(...collectDepRequirements(otherDeps, allTrackedNames, cArch));
        }
      }
      if (Array.isArray(otherRecipe.build_deps)) {
        for (const cArch of consumerArches) {
          activeRequirements.push(...collectDepRequirements(otherRecipe.build_deps, allTrackedNames, cArch));
        }
      }
      if (otherRecipe.subpackages) {
        for (const sDef of Object.values(otherRecipe.subpackages)) {
          if (sDef && typeof sDef === 'object') {
            const rawSubArch = (sDef as SubpackageDefinition).arch;
            const subArches = rawSubArch === 'all' ? ['all'] : rawSubArch ? [rawSubArch] : consumerArches;

            const childPubDeps = (sDef as { publishedDeps?: string[] }).publishedDeps;
            const childDeps = Array.isArray(childPubDeps)
              ? [...childPubDeps]
              : [...((sDef as SubpackageDefinition).deps || [])];
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
                activeRequirements.push(...collectDepRequirements(childDeps, allTrackedNames, cArch));
              }
            }
          }
        }
      }
    }
  }

  interface AssetCandidate {
    asset: T;
    name: string;
    ver: string;
    arch: string;
    isProvider?: boolean;
    explicitProvidedVer?: string;
    multiArch?: string;
  }
  const candidateLookup = new Map<string, AssetCandidate[]>();
  for (const asset of assets) {
    if ((asset as { state?: string }).state && (asset as { state?: string }).state !== 'uploaded') {
      continue;
    }
    const name = asset.name || '';
    if (!name.endsWith('.deb')) {
      continue;
    }
    const pkg = debPackageName(name);
    const arch = extractDebArch(name);
    const ver = parseFilenameDebVersion(name);

    let candMultiArch: string | undefined =
      (asset as { multiarch?: string; multi_arch?: string }).multiarch ||
      (asset as { multiarch?: string; multi_arch?: string }).multi_arch ||
      (asset as Record<string, any>)['Multi-Arch'] ||
      (asset as Record<string, any>)['multi-arch'];
    if (!candMultiArch) {
      const localPath =
        (asset as { path?: string; localPath?: string }).path ||
        (asset as { path?: string; localPath?: string }).localPath;
      if (localPath && existsSync(localPath)) {
        const ma = getDebMultiArch(localPath);
        if (ma) {
          candMultiArch = ma;
        }
      }
    }
    if (!candMultiArch) {
      if (recipe.name === pkg) {
        candMultiArch =
          (recipe as { multiarch?: string; multi_arch?: string }).multiarch ||
          (recipe as { multiarch?: string; multi_arch?: string }).multi_arch;
      } else if (recipe.subpackages) {
        for (const [sKey, sDef] of Object.entries(recipe.subpackages)) {
          if (sDef && typeof sDef === 'object' && ((sDef as SubpackageDefinition).name || sKey) === pkg) {
            candMultiArch =
              (sDef as { multiarch?: string; multi_arch?: string }).multiarch ||
              (sDef as { multiarch?: string; multi_arch?: string }).multi_arch;
            break;
          }
        }
      }
      if (!candMultiArch && allRecipes) {
        const ownerRec = allRecipes[pkg];
        if (ownerRec) {
          candMultiArch =
            (ownerRec as { multiarch?: string; multi_arch?: string }).multiarch ||
            (ownerRec as { multiarch?: string; multi_arch?: string }).multi_arch;
        }
      }
    }

    const item: AssetCandidate = { asset, name: pkg, ver, arch, multiArch: candMultiArch };
    const list = candidateLookup.get(pkg) || [];
    list.push(item);
    candidateLookup.set(pkg, list);

    const aProvides = (asset as { provides?: string[] | string }).provides;
    if (aProvides) {
      const provList = Array.isArray(aProvides) ? aProvides : [aProvides];
      for (const clause of parseDependencyList(provList)) {
        for (const tok of clause) {
          const provName = tok.name.split(':')[0].trim();
          const explicitVer = tok.versionConstraint?.version;
          if (provName) {
            const pList = candidateLookup.get(provName) || [];
            pList.push({
              asset,
              name: provName,
              ver: explicitVer || '',
              arch,
              isProvider: true,
              explicitProvidedVer: explicitVer,
              multiArch: candMultiArch,
            });
            candidateLookup.set(provName, pList);
          }
        }
      }
    }
  }

  // Fixed-point dependency retention loop (Thread #2 & Thread #4)
  const processedAssets = new Set<T>();
  const processedReqKeys = new Set<string>();
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
        const assetDeps = (asset as { depends?: string[] | string }).depends;
        if (assetDeps !== undefined) {
          const rawDeps = Array.isArray(assetDeps) ? assetDeps : assetDeps ? [assetDeps] : [];
          activeRequirements.push(...collectDepRequirements(rawDeps, allTrackedNames, arch));
        } else {
          if (Array.isArray(recipe.deps)) {
            activeRequirements.push(...collectDepRequirements(recipe.deps, allTrackedNames, arch));
          }
          const currentVer = formatDebianVersion(recipe);
          if (ver !== currentVer) {
            for (const subName of subpkgNames) {
              activeRequirements.push({
                name: subName,
                constraint: { operator: '=', version: ver },
                targetArch: arch,
              });
            }
          }
        }
      } else if (
        subpkgNames.has(pkg) ||
        pkg.startsWith(`${recipe.name}-`) ||
        (asset as { owner?: string }).owner === recipe.name
      ) {
        const subDef = recipe.subpackages
          ? (Object.values(recipe.subpackages).find((s) => s && (s as SubpackageDefinition).name === pkg) as
              SubpackageDefinition | undefined)
          : undefined;
        const assetDeps = (asset as { depends?: string[] | string }).depends;
        if (assetDeps) {
          const rawDeps = Array.isArray(assetDeps) ? assetDeps : [assetDeps];
          activeRequirements.push(...collectDepRequirements(rawDeps, allTrackedNames, arch));
        } else if (subDef) {
          if (Array.isArray(subDef.deps)) {
            activeRequirements.push(...collectDepRequirements(subDef.deps, allTrackedNames, arch));
          }
          const op = subDef.parent_dep === 'same-version' ? '>=' : '=';
          if (typeof subDef.parent_dep === 'string' && !['exact', 'same-version', 'none'].includes(subDef.parent_dep)) {
            activeRequirements.push(...collectDepRequirements([subDef.parent_dep], allTrackedNames, arch));
          } else if (childHasParentDependency(subDef)) {
            if (arch === 'all') {
              if (parentArches.size > 0) {
                for (const pArch of parentArches) {
                  activeRequirements.push({
                    name: recipe.name,
                    constraint: { operator: op, version: ver },
                    targetArch: pArch,
                  });
                }
              } else {
                activeRequirements.push({
                  name: recipe.name,
                  constraint: { operator: op, version: ver },
                  targetArch: 'all',
                });
              }
            } else {
              activeRequirements.push({
                name: recipe.name,
                constraint: { operator: op, version: ver },
                targetArch: arch,
              });
            }
          }
        } else {
          const op = '=';
          if (arch === 'all') {
            if (parentArches.size > 0) {
              for (const pArch of parentArches) {
                activeRequirements.push({
                  name: recipe.name,
                  constraint: { operator: op, version: ver },
                  targetArch: pArch,
                });
              }
            } else {
              activeRequirements.push({
                name: recipe.name,
                constraint: { operator: op, version: ver },
                targetArch: 'all',
              });
            }
          } else {
            activeRequirements.push({
              name: recipe.name,
              constraint: { operator: op, version: ver },
              targetArch: arch,
            });
          }
        }
      }
    }

    // 2. Satisfy active requirements from release assets
    const reqsToProcess = [...activeRequirements];
    for (const req of reqsToProcess) {
      const reqKey = `${req.name}:${req.targetArch || 'all'}:${req.constraint?.operator || ''}:${req.constraint?.version || ''}:${req.isAny ? 'any' : ''}`;
      if (processedReqKeys.has(reqKey)) {
        continue;
      }
      processedReqKeys.add(reqKey);

      const potentialCands = candidateLookup.get(req.name) || [];
      const candidates: Array<{ asset: T; ver: string; multiArch?: string }> = [];
      for (const cand of potentialCands) {
        let archMatches =
          normArch(req.targetArch) === 'all' ||
          normArch(cand.arch) === 'all' ||
          normArch(req.targetArch) === normArch(cand.arch);
        if (req.isAny) {
          if (cand.multiArch === 'allowed' || cand.multiArch === undefined) {
            archMatches = true;
          }
        }
        if (!archMatches) {
          continue;
        }
        if (cand.isProvider && !cand.explicitProvidedVer && req.constraint) {
          continue;
        }
        if (cand.isProvider && !req.constraint) {
          candidates.push({ asset: cand.asset, ver: cand.ver, multiArch: cand.multiArch });
        } else if (satisfiesVersionConstraint(cand.ver, req.constraint)) {
          candidates.push({ asset: cand.asset, ver: cand.ver, multiArch: cand.multiArch });
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
        } else if (req.isAny) {
          // Retain newest Multi-Arch: allowed candidate; keep older candidates if Multi-Arch cannot be established
          const allowedCands = candidates.filter((c) => c.multiArch === 'allowed');
          if (allowedCands.length > 0) {
            allowedCands.sort((a, b) => compareDebianVersions(b.ver, a.ver));
            const candAsset = allowedCands[0].asset;
            if (!retainedAssets.has(candAsset)) {
              retainedAssets.add(candAsset);
              changed = true;
            }
          }
          const unestablished = candidates.filter((c) => c.multiArch === undefined);
          for (const cand of unestablished) {
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
        } else if (req.constraint) {
          // Retain all compatible candidates when a version constraint is present
          // to preserve jointly installable dependency sets across co-dependencies
          for (const cand of candidates) {
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
      const ver = parseFilenameDebVersion(name);
      if (hasValidReplacement(pkg, arch, ver)) {
        (asset as Record<string, unknown>).requiredParentArches = Array.from(requiredParentArches);
        toDelete.push(asset);
      }
    } else if (name.endsWith('_metadata.json')) {
      const base = name.slice(0, -'_metadata.json'.length);
      let metaPkg = base;
      const match = base.match(/^(.*?)(?:_(aarch64|arm64|x86_64|amd64|arm|armhf|armel|armv7|i686|i386|all))?$/i);
      if (match && match[2] && CANONICAL_ARCHES.has(normalizeArch(match[2]))) {
        metaPkg = match[1];
      }
      if (emittedPkgs.has(metaPkg) && hasValidReplacement(metaPkg, 'all')) {
        toDelete.push(asset);
      }
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

  const releasesRes = spawnSync('gh', ['api', '--paginate', '--slurp', `repos/${owner}/${repoName}/releases`], {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (releasesRes.status !== 0) {
    console.log(`Failed to fetch releases: ${releasesRes.stderr}`);
    return;
  }

  let releases: Array<Record<string, any>> = [];
  try {
    releases = parsePaginatedGhJsonArray(releasesRes.stdout);
  } catch (e) {
    console.error(`::error:: Failed to parse paginated releases JSON: ${e instanceof Error ? e.message : String(e)}`);
    return;
  }

  const deletionTasks: Array<{
    tag: string;
    name: string;
    assetId: number;
    requiredParentArches?: string[];
  }> = [];

  let allRecipes: Record<string, PackageRecipe> | undefined;
  if (existsSync(pkgsDir)) {
    try {
      const dag = new DependencyGraph(pkgsDir);
      const rejectedNames = Object.keys(dag.rejectedRecipes);
      if (rejectedNames.length > 0) {
        console.error(
          `::error:: Dependency discovery rejected ${rejectedNames.length} recipe(s) (${rejectedNames.join(', ')}). Aborting asset pruning to prevent deleting required dependencies.`,
        );
        return;
      }
      allRecipes = dag.recipes;
    } catch (err) {
      console.error(
        `::error:: Dependency discovery failed in ${pkgsDir}: ${err instanceof Error ? err.message : String(err)}. Aborting asset pruning to prevent deleting required dependencies.`,
      );
      return;
    }
  } else {
    console.error(`::error:: Package directory ${pkgsDir} does not exist or is unavailable. Aborting asset pruning.`);
    return;
  }

  const orphanedReleases = identifyOrphanedReleases(releases, pkgsDir, allRecipes);

  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (tag.includes('@')) {
      continue;
    }
    if (!isPackageReleaseTag(rel, pkgsDir)) {
      continue;
    }
    const assets = rel.assets || [];

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
            deletionTasks.push({
              tag,
              name: asset.name,
              assetId: asset.id,
              requiredParentArches: (asset as { requiredParentArches?: string[] }).requiredParentArches,
            });
          }
        }
      } catch (e) {
        console.log(`Could not parse recipe for ${tag}: ${e}`);
      }
    }
  }

  // 1. Prune orphaned releases (deleted packages)
  // Ensure indexing a non-publication ref cannot cause a release or tag to be deleted (Thread #4)
  const isCI = Boolean(process.env.CI || process.env.GITHUB_ACTIONS);
  const refName = process.env.GITHUB_REF_NAME;
  const isPublicationBranch = !isCI || process.env.GITHUB_REF === 'refs/heads/main';
  if (!isPublicationBranch) {
    if (orphanedReleases.length > 0) {
      console.log(`Notice: Skipping orphan release deletion on non-publication ref '${refName}'.`);
      orphanedReleases.length = 0;
    }
    if (deletionTasks.length > 0) {
      console.log(`Notice: Skipping outdated asset deletion on non-publication ref '${refName}'.`);
      deletionTasks.length = 0;
    }
  }

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
      // Re-verify that replacement assets still exist on release before deleting (Thread #6, #7, #8)
      const currentReleaseView = spawnSync('gh', ['release', 'view', task.tag, '--json', 'assets'], {
        encoding: 'utf-8',
      });
      if (currentReleaseView.status !== 0 || !currentReleaseView.stdout) {
        console.warn(
          `::warning:: Skipping deletion of '${task.name}' on '${task.tag}': failed to query live release assets.`,
        );
        continue;
      }
      let liveAssets: Array<{ name?: string; state?: string }> = [];
      try {
        const parsed = JSON.parse(currentReleaseView.stdout);
        liveAssets = (parsed.assets || []) as Array<{ name?: string; state?: string }>;
      } catch {
        console.warn(
          `::warning:: Skipping deletion of '${task.name}' on '${task.tag}': invalid JSON from release assets query.`,
        );
        continue;
      }

      if (task.name.endsWith('.deb')) {
        const taskPkg = debPackageName(task.name);
        const taskArch = extractDebArch(task.name);
        const taskVer = parseFilenameDebVersion(task.name);
        const normTaskArch = normalizeArch(taskArch);

        let hasMatchingReplacement = false;
        if (normTaskArch === 'all' && taskPkg === task.tag) {
          // Check if there is a newer uploaded 'all' replacement
          const hasAllReplacement = liveAssets.some((a) => {
            if (!a.name || !a.name.endsWith('.deb') || a.state !== 'uploaded') {
              return false;
            }
            if (debPackageName(a.name) !== taskPkg) {
              return false;
            }
            if (normalizeArch(extractDebArch(a.name)) !== 'all') {
              return false;
            }
            return compareDebianVersions(parseFilenameDebVersion(a.name), taskVer) > 0;
          });

          if (hasAllReplacement) {
            hasMatchingReplacement = true;
          } else {
            // Apply planner's migration coverage rule: every required parent architecture must have a newer uploaded replacement
            const requiredParentArches = new Set<string>(task.requiredParentArches || []);
            if (requiredParentArches.size === 0) {
              const recipe = allRecipes[task.tag];
              if (recipe) {
                const parentTargetArches =
                  recipe.arches && recipe.arches.length > 0 ? recipe.arches : [recipe.arch || 'aarch64'];
                for (const a of parentTargetArches) {
                  if (a !== 'all') {
                    requiredParentArches.add(normalizeArch(a));
                  }
                }
              }
            }

            if (requiredParentArches.size > 0) {
              hasMatchingReplacement = Array.from(requiredParentArches).every((reqArch) =>
                liveAssets.some((a) => {
                  if (!a.name || !a.name.endsWith('.deb') || a.state !== 'uploaded') {
                    return false;
                  }
                  if (debPackageName(a.name) !== taskPkg) {
                    return false;
                  }
                  if (normalizeArch(extractDebArch(a.name)) !== reqArch) {
                    return false;
                  }
                  return compareDebianVersions(parseFilenameDebVersion(a.name), taskVer) > 0;
                }),
              );
            }
          }
        } else {
          hasMatchingReplacement = liveAssets.some((a) => {
            if (!a.name || !a.name.endsWith('.deb') || a.state !== 'uploaded') {
              return false;
            }
            if (debPackageName(a.name) !== taskPkg) {
              return false;
            }
            const candArch = extractDebArch(a.name);
            const normCandArch = normalizeArch(candArch);
            const archMatches = normCandArch === 'all' || normCandArch === normTaskArch;
            if (!archMatches) {
              return false;
            }
            const candVer = parseFilenameDebVersion(a.name);
            return compareDebianVersions(candVer, taskVer) > 0;
          });
        }

        if (!hasMatchingReplacement) {
          console.warn(
            `::warning:: Aborting deletion of '${task.name}' on '${task.tag}': matching uploaded replacement asset not found on live release.`,
          );
          continue;
        }
      }

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
