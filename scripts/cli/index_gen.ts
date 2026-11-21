import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { extractDebArch, generateAptMetadata, generateReleaseFile, getDebMultiArch } from '../builders/debian.ts';
import {
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
import { formatDebianVersion, satisfiesVersionConstraint } from '../core/version.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { generatePackagesJson, type ReleaseAssetInfo } from '../utils/metadata.ts';
import {
  getExpectedAssetFilenames,
  identifyOutdatedAssets,
  parsePaginatedGhJsonArray,
  parseReleaseOwnershipMetadata,
  type ReleaseAssetRecord,
} from './prune.ts';

export function getRetainedReleaseAssetFilenames(
  recipe: PackageRecipe,
  assets: ReleaseAssetRecord[] = [],
  allRecipes?: Record<string, PackageRecipe>,
  releaseBody?: string,
): Set<string> {
  const expectedFiles = getExpectedAssetFilenames(recipe);
  const outdatedNames = new Set(identifyOutdatedAssets(assets, recipe, recipe.name, allRecipes).map((a) => a.name));
  const validNames = new Set([recipe.name, ...getSubpackageNames(recipe)]);
  const ownership = parseReleaseOwnershipMetadata(releaseBody);
  const publishedOwnedNames =
    ownership.managedByRepoExe && (!ownership.ownerName || ownership.ownerName === recipe.name)
      ? ownership.ownedPackages
      : new Set<string>();

  const isOwnedByOtherRecipe = (pkgName: string): boolean => {
    if (!allRecipes) {
      return false;
    }
    for (const [otherName, otherRecipe] of Object.entries(allRecipes)) {
      if (otherName === recipe.name || !otherRecipe) {
        continue;
      }
      if (otherRecipe.name === pkgName) {
        return true;
      }
      if (getSubpackageNames(otherRecipe).includes(pkgName)) {
        return true;
      }
    }
    return false;
  };

  const extractAssetDeps = (asset: ReleaseAssetRecord): DependencyToken[][] => {
    const rawDeps: string[] = [];
    const assetObj = asset as unknown as Record<string, unknown>;
    if (typeof assetObj.depends === 'string') {
      rawDeps.push(assetObj.depends);
    } else if (Array.isArray(assetObj.depends)) {
      rawDeps.push(...(assetObj.depends as string[]));
    }
    if (typeof assetObj.dependencies === 'string') {
      rawDeps.push(assetObj.dependencies);
    } else if (Array.isArray(assetObj.dependencies)) {
      rawDeps.push(...(assetObj.dependencies as string[]));
    }
    const res: DependencyToken[][] = [];
    for (const d of rawDeps) {
      res.push(...parseDependencyList(d));
    }
    return res;
  };

  const candidateAssets = assets.filter(
    (a) => Boolean(a.name) && a.name.endsWith('.deb') && !outdatedNames.has(a.name),
  );

  const admittedAssets = new Set<ReleaseAssetRecord>();
  for (const asset of candidateAssets) {
    const name = asset.name || '';
    const pkg = name.split('_')[0];
    if (validNames.has(pkg)) {
      expectedFiles.add(name);
      admittedAssets.add(asset);
    }
  }

  // Iteratively admit owned historical packages that satisfy dependencies of live recipes OR already admitted archives
  const activeRequiredDeps: DependencyToken[][] = [];
  if (allRecipes) {
    for (const otherRecipe of Object.values(allRecipes)) {
      if (!otherRecipe) {
        continue;
      }
      if (Array.isArray(otherRecipe.deps)) {
        for (const depStr of otherRecipe.deps) {
          activeRequiredDeps.push(...parseDependencyList(depStr));
        }
      }
      if (otherRecipe.subpackages) {
        for (const sDef of Object.values(otherRecipe.subpackages)) {
          if (sDef && typeof sDef === 'object') {
            const rawSubDeps: string[] = [];
            if (Array.isArray((sDef as SubpackageDefinition).deps)) {
              rawSubDeps.push(...(sDef as SubpackageDefinition).deps!);
            }
            if (
              typeof (sDef as SubpackageDefinition).parent_dep === 'string' &&
              !['exact', 'same-version', 'none'].includes((sDef as SubpackageDefinition).parent_dep!)
            ) {
              rawSubDeps.push((sDef as SubpackageDefinition).parent_dep!);
            }
            for (const depStr of rawSubDeps) {
              activeRequiredDeps.push(...parseDependencyList(depStr));
            }
          }
        }
      }
    }
  }

  for (const asset of admittedAssets) {
    activeRequiredDeps.push(...extractAssetDeps(asset));
  }

  const satisfiesActiveDeps = (pkgName: string, assetVer: string): boolean => {
    if (!allRecipes && activeRequiredDeps.length === 0) {
      return true;
    }
    for (const clause of activeRequiredDeps) {
      for (const tok of clause) {
        if (tok.name.split(':')[0].trim() === pkgName && satisfiesVersionConstraint(assetVer, tok.versionConstraint)) {
          return true;
        }
      }
    }
    return false;
  };

  let changed = true;
  while (changed) {
    changed = false;
    for (const asset of candidateAssets) {
      const name = asset.name || '';
      if (expectedFiles.has(name)) {
        continue;
      }
      const pkg = name.split('_')[0];
      const hasPublishedOwnership =
        publishedOwnedNames.has(pkg) ||
        (typeof asset.owner === 'string' && asset.owner === recipe.name) ||
        (typeof asset.source === 'string' && asset.source === recipe.name);
      if (
        hasPublishedOwnership &&
        !isOwnedByOtherRecipe(pkg) &&
        satisfiesActiveDeps(pkg, parseFilenameDebVersion(name))
      ) {
        expectedFiles.add(name);
        admittedAssets.add(asset);
        activeRequiredDeps.push(...extractAssetDeps(asset));
        changed = true;
      }
    }
  }
  return expectedFiles;
}

export function getExactPackageArtifacts(artPath: string, pkgName: string, subpkgNames: string[] = []): string[] {
  const matching: string[] = [];
  if (!existsSync(artPath)) {
    return matching;
  }

  const allNames = [pkgName, ...subpkgNames];

  const traverse = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(full);
      } else if (entry.isFile()) {
        const name = entry.name;
        for (const p of allNames) {
          if (name.startsWith(`${p}_`) && name.endsWith('.deb')) {
            matching.push(full);
            break;
          }
        }
      }
    }
  };
  traverse(artPath);
  return Array.from(new Set(matching)).sort();
}

function getDebDepends(debPath: string): string | null {
  try {
    const resDep = spawnSync('dpkg-deb', ['-f', debPath, 'Depends'], { encoding: 'utf-8' });
    const resPre = spawnSync('dpkg-deb', ['-f', debPath, 'Pre-Depends'], { encoding: 'utf-8' });
    if (resDep.status === 0 && resPre.status === 0) {
      const dep = (resDep.stdout || '').trim();
      const pre = (resPre.stdout || '').trim();
      const parts = [dep, pre].filter(Boolean);
      return parts.join(', ');
    }
  } catch {}
  return null;
}

function getDebProvides(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Provides'], { encoding: 'utf-8' });
    if (res.status === 0 && typeof res.stdout === 'string') {
      return res.stdout.trim();
    }
  } catch {}
  return null;
}

export function isExternalPackage(depPkg: string, dag: DependencyGraph, repoRoot: string): boolean {
  const ownerPkg = dag.recipes[depPkg] ? depPkg : dag.subpackageMap[depPkg];
  const providers =
    dag.providersMap[depPkg] ||
    (dag.providesMap[depPkg]
      ? [
          {
            owner: dag.providesMap[depPkg],
            pkgName: dag.providesMap[depPkg],
            version: dag.providesVersionMap[depPkg],
          },
        ]
      : []);
  return !ownerPkg && providers.length === 0 && !existsSync(join(repoRoot, 'pkg', depPkg));
}

export function isRemoteAssetSatisfied(
  tok: DependencyToken,
  reqArch: string,
  dag: DependencyGraph,
  getReleaseAssets: (releaseTag: string) => Array<{ name: string }>,
  artPath: string,
): boolean {
  const depPkg = tok.name.split(':')[0].trim();
  const ownerPkg = dag.recipes[depPkg] ? depPkg : dag.subpackageMap[depPkg];
  const providers =
    dag.providersMap[depPkg] ||
    (dag.providesMap[depPkg]
      ? [
          {
            owner: dag.providesMap[depPkg],
            pkgName: dag.providesMap[depPkg],
            version: dag.providesVersionMap[depPkg],
          },
        ]
      : []);

  const isAnyQualifier = tok.multiArch === 'any' || tok.name.endsWith(':any');
  const explicitArch = tok.multiArch && !isAnyQualifier ? normalizeArch(tok.multiArch) : undefined;
  const effectiveReqArch = explicitArch || reqArch;

  const doesArchiveProvideDep = (
    candArch: string,
    providesStrOrList: string[] | string | undefined,
    requiredPkg: string,
    versionConstraint?: VersionConstraint,
  ): boolean => {
    const archMatches = candArch === 'all' || (isAnyQualifier ? true : normalizeArch(candArch) === effectiveReqArch);
    if (!archMatches || !providesStrOrList) {
      return false;
    }
    const rawList = Array.isArray(providesStrOrList) ? providesStrOrList : [providesStrOrList];
    for (const provClause of parseDependencyList(rawList)) {
      for (const t of provClause) {
        if (t.name.split(':')[0].trim() === requiredPkg) {
          if (!versionConstraint) {
            return true;
          }
          if (t.versionConstraint && satisfiesVersionConstraint(t.versionConstraint.version, versionConstraint)) {
            return true;
          }
        }
      }
    }
    return false;
  };

  if (providers.length > 0) {
    for (const prov of providers) {
      if (
        'arch' in prov &&
        prov.arch &&
        prov.arch !== 'all' &&
        (isAnyQualifier ? false : normalizeArch(prov.arch) !== effectiveReqArch)
      ) {
        continue;
      }
      const provOwner = prov.owner;
      const provPkg = prov.pkgName || prov.owner;
      if (tok.versionConstraint) {
        if (!prov.version || !satisfiesVersionConstraint(prov.version, tok.versionConstraint)) {
          continue;
        }
      }
      const assets = getReleaseAssets(provOwner);
      const remoteProvCands = assets.filter((a) => a.name.endsWith('.deb') && a.name.startsWith(`${provPkg}_`));
      const getRemoteAssetProvides = (assetName: string): string[] | string | undefined => {
        const aVer = parseFilenameDebVersion(assetName);
        const ownerRecipe = dag.recipes[provOwner];
        if (ownerRecipe && aVer === formatDebianVersion(ownerRecipe)) {
          if (provPkg === provOwner && ownerRecipe.provides) {
            return ownerRecipe.provides;
          }
          if (ownerRecipe.subpackages) {
            for (const [sKey, sDef] of Object.entries(ownerRecipe.subpackages)) {
              if (sDef && typeof sDef === 'object') {
                const sName = (sDef as SubpackageDefinition).name || sKey;
                if (sName === provPkg && (sDef as SubpackageDefinition).provides) {
                  return (sDef as SubpackageDefinition).provides;
                }
              }
            }
          }
        }
        if (prov.version) {
          return [`${depPkg} (= ${prov.version})`];
        }
        return undefined;
      };

      const satisfiesRemote = remoteProvCands.some((a) =>
        doesArchiveProvideDep(extractDebArch(a.name), getRemoteAssetProvides(a.name), depPkg, tok.versionConstraint),
      );
      if (satisfiesRemote) {
        return true;
      }
    }
    if (!ownerPkg) {
      return false;
    }
  }

  const releaseTag = ownerPkg || depPkg;
  const assets = getReleaseAssets(releaseTag);
  const remoteCands = assets
    .filter((a) => a.name.endsWith('.deb') && a.name.startsWith(`${depPkg}_`))
    .map((a) => ({ name: a.name, arch: extractDebArch(a.name), ver: parseFilenameDebVersion(a.name) }));

  return remoteCands.some((cand) => {
    if (isAnyQualifier) {
      const localCandPath = join(artPath, cand.name);
      let ma: string | null = null;
      if (existsSync(localCandPath)) {
        ma = getDebMultiArch(localCandPath);
      } else {
        const ownerRecipe = dag.recipes[releaseTag];
        if (ownerRecipe) {
          if (depPkg === releaseTag) {
            ma =
              (ownerRecipe as { multiarch?: string; multi_arch?: string }).multiarch ||
              (ownerRecipe as { multiarch?: string; multi_arch?: string }).multi_arch ||
              null;
          } else if (ownerRecipe.subpackages) {
            for (const [sKey, sDef] of Object.entries(ownerRecipe.subpackages)) {
              if (sDef && typeof sDef === 'object') {
                const sName = (sDef as SubpackageDefinition).name || sKey;
                if (sName === depPkg) {
                  ma =
                    (sDef as { multiarch?: string; multi_arch?: string }).multiarch ||
                    (sDef as { multiarch?: string; multi_arch?: string }).multi_arch ||
                    null;
                  break;
                }
              }
            }
          }
        }
      }
      if (ma !== 'allowed') {
        return false;
      }
    }
    const archMatches = cand.arch === 'all' || normalizeArch(cand.arch) === effectiveReqArch;
    return archMatches && satisfiesVersionConstraint(cand.ver, tok.versionConstraint);
  });
}

export function filterPublishableArtifacts(
  matchingFiles: string[],
  artPath: string,
  repoRoot: string = resolve('.'),
  permittedCandidates?: Set<string> | string[],
): string[] {
  const dag = new DependencyGraph(join(repoRoot, 'pkg'));
  const permittedSet = permittedCandidates ? new Set(permittedCandidates) : null;
  const releaseAssetCache = new Map<string, Array<{ name: string }>>();
  const getReleaseAssets = (releaseTag: string): Array<{ name: string }> => {
    if (releaseAssetCache.has(releaseTag)) {
      return releaseAssetCache.get(releaseTag)!;
    }
    let assets: Array<{ name: string }> = [];
    try {
      const ghRes = spawnSync('gh', ['release', 'view', releaseTag, '--json', 'assets'], {
        encoding: 'utf-8',
      });
      if (ghRes.status === 0 && ghRes.stdout) {
        const data = JSON.parse(ghRes.stdout);
        assets = data.assets || [];
      }
    } catch {}
    releaseAssetCache.set(releaseTag, assets);
    return assets;
  };

  let availableDebs: Array<{ name: string; ver: string; arch: string; path: string }> = [];
  const scanDir = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(full);
      } else if (ent.isFile() && ent.name.endsWith('.deb')) {
        if (permittedSet && !permittedSet.has(full)) {
          continue;
        }
        const pkg = ent.name.split('_')[0];
        const arch = extractDebArch(ent.name);
        const ver = parseFilenameDebVersion(ent.name);
        availableDebs.push({ name: pkg, ver, arch, path: full });
      }
    }
  };
  scanDir(artPath);

  // Pre-filter unreadable files (Thread #11)
  const initialFiles: string[] = [];
  const unreadableFiles = new Set<string>();
  const fileDependsMap = new Map<string, string>();
  for (const file of matchingFiles) {
    if (permittedSet && !permittedSet.has(file)) {
      continue;
    }
    if (!file.endsWith('.deb')) {
      initialFiles.push(file);
      continue;
    }
    const depStr = getDebDepends(file);
    if (depStr === null) {
      console.warn(`::warning:: Unreadable control data in archive '${basename(file)}'; withholding from publication.`);
      unreadableFiles.add(file);
      continue;
    }
    fileDependsMap.set(file, depStr);
    initialFiles.push(file);
  }

  // Fixpoint iteration to eliminate candidates that depend on withheld archives (Thread #13)
  const debProvidesCache = new Map<string, string>();
  const debMultiArchCache = new Map<string, string | null>();
  const getCachedDebMultiArch = (debPath: string): string | null => {
    if (debMultiArchCache.has(debPath)) {
      return debMultiArchCache.get(debPath)!;
    }
    const val = getDebMultiArch(debPath);
    debMultiArchCache.set(debPath, val);
    return val;
  };
  const initialFilesSet = new Set(initialFiles);
  let currentEligibleSet = new Set(initialFiles);
  let changed = true;

  while (changed) {
    changed = false;
    const nextEligible: string[] = [];

    // Filter availableDebs to only those currently eligible or retained
    availableDebs = availableDebs.filter(
      (d) => !unreadableFiles.has(d.path) && (!initialFilesSet.has(d.path) || currentEligibleSet.has(d.path)),
    );

    for (const file of currentEligibleSet) {
      if (!file.endsWith('.deb')) {
        nextEligible.push(file);
        continue;
      }
      const debArch = extractDebArch(basename(file));
      const depStr = fileDependsMap.get(file);
      if (depStr === undefined) {
        continue;
      }
      if (depStr === '') {
        nextEligible.push(file);
        continue;
      }

      const clauses = parseDependencyList([depStr]);
      const filtered = filterDepsForArch(clauses, debArch);
      let allClausesSatisfiable = true;

      for (const clause of filtered) {
        let targetArchesToCheck = [normalizeArch(debArch)];
        if (debArch === 'all') {
          const baseName = basename(file);
          const pkg = baseName.split('_')[0];
          const parentName = dag.recipes[pkg] ? pkg : dag.subpackageMap[pkg];
          const parentRecipe = parentName ? dag.recipes[parentName] : undefined;
          if (parentRecipe?.arches && parentRecipe.arches.length > 0) {
            const normalized = parentRecipe.arches.map(normalizeArch);
            if (normalized.length === 1 && normalized[0] === 'all') {
              targetArchesToCheck = ['aarch64', 'arm', 'x86_64', 'i686'];
            } else {
              targetArchesToCheck = normalized.filter((a) => a !== 'all');
            }
          } else if (parentRecipe?.arch && parentRecipe.arch !== 'all') {
            targetArchesToCheck = [normalizeArch(parentRecipe.arch)];
          } else {
            targetArchesToCheck = ['aarch64', 'arm', 'x86_64', 'i686'];
          }
        }

        const isClauseSatisfied = targetArchesToCheck.every((reqArch) =>
          clause.some((tok) => {
            const depPkg = tok.name.split(':')[0].trim();
            const isAnyQualifier = tok.multiArch === 'any' || tok.name.endsWith(':any');
            const explicitArch = tok.multiArch && !isAnyQualifier ? normalizeArch(tok.multiArch) : undefined;
            const effectiveReqArch = explicitArch || reqArch;

            // Resolve subpackage to canonical parent owner or virtual package providers before checking external
            const ownerPkg = dag.recipes[depPkg] ? depPkg : dag.subpackageMap[depPkg];
            const providers =
              dag.providersMap[depPkg] ||
              (dag.providesMap[depPkg]
                ? [
                    {
                      owner: dag.providesMap[depPkg],
                      pkgName: dag.providesMap[depPkg],
                      version: dag.providesVersionMap[depPkg],
                    },
                  ]
                : []);

            if (!ownerPkg && providers.length === 0 && !existsSync(join(repoRoot, 'pkg', depPkg))) {
              return true;
            }

            if (providers.length > 0) {
              for (const prov of providers) {
                if (
                  'arch' in prov &&
                  prov.arch &&
                  prov.arch !== 'all' &&
                  (isAnyQualifier ? false : normalizeArch(prov.arch) !== effectiveReqArch)
                ) {
                  continue;
                }
                const provOwner = prov.owner;
                const provPkg = prov.pkgName || prov.owner;
                const getCachedDebProvides = (debPath: string): string => {
                  if (debProvidesCache.has(debPath)) {
                    return debProvidesCache.get(debPath)!;
                  }
                  const val = getDebProvides(debPath) || '';
                  debProvidesCache.set(debPath, val);
                  return val;
                };

                const doesArchiveProvideDep = (
                  candArch: string,
                  providesStrOrList: string[] | string | undefined,
                  requiredPkg: string,
                  versionConstraint?: VersionConstraint,
                ): boolean => {
                  const archMatches =
                    candArch === 'all' || (isAnyQualifier ? true : normalizeArch(candArch) === effectiveReqArch);
                  if (!archMatches) {
                    return false;
                  }
                  if (!providesStrOrList) {
                    return false;
                  }
                  const rawList = Array.isArray(providesStrOrList) ? providesStrOrList : [providesStrOrList];
                  for (const provClause of parseDependencyList(rawList)) {
                    for (const t of provClause) {
                      if (t.name.split(':')[0].trim() === requiredPkg) {
                        if (!versionConstraint) {
                          return true;
                        }
                        if (t.versionConstraint) {
                          if (satisfiesVersionConstraint(t.versionConstraint.version, versionConstraint)) {
                            return true;
                          }
                        }
                      }
                    }
                  }
                  return false;
                };

                const localProvCands = availableDebs.filter((d) => d.name === provPkg);
                const satisfiesLocal = localProvCands.some((cand) =>
                  doesArchiveProvideDep(cand.arch, getCachedDebProvides(cand.path), depPkg, tok.versionConstraint),
                );
                if (satisfiesLocal) {
                  return true;
                }

                if (tok.versionConstraint) {
                  if (!prov.version || !satisfiesVersionConstraint(prov.version, tok.versionConstraint)) {
                    continue;
                  }
                }

                const assets = getReleaseAssets(provOwner);
                const remoteProvCands = assets.filter(
                  (a) => a.name.endsWith('.deb') && a.name.startsWith(`${provPkg}_`),
                );

                const getRemoteAssetProvides = (assetName: string): string[] | string | undefined => {
                  const aVer = parseFilenameDebVersion(assetName);
                  const ownerRecipe = dag.recipes[provOwner];
                  if (ownerRecipe && aVer === formatDebianVersion(ownerRecipe)) {
                    if (provPkg === provOwner && ownerRecipe.provides) {
                      return ownerRecipe.provides;
                    }
                    if (ownerRecipe.subpackages) {
                      for (const [sKey, sDef] of Object.entries(ownerRecipe.subpackages)) {
                        if (sDef && typeof sDef === 'object') {
                          const sName = (sDef as SubpackageDefinition).name || sKey;
                          if (sName === provPkg && (sDef as SubpackageDefinition).provides) {
                            return (sDef as SubpackageDefinition).provides;
                          }
                        }
                      }
                    }
                  }
                  if (prov.version) {
                    return [`${depPkg} (= ${prov.version})`];
                  }
                  return undefined;
                };

                const satisfiesRemote = remoteProvCands.some((a) =>
                  doesArchiveProvideDep(
                    extractDebArch(a.name),
                    getRemoteAssetProvides(a.name),
                    depPkg,
                    tok.versionConstraint,
                  ),
                );
                if (satisfiesRemote) {
                  return true;
                }
              }
              if (!ownerPkg) {
                return false;
              }
            }

            const releaseTag = ownerPkg || depPkg;

            const localCands = availableDebs
              .filter((d) => d.name === depPkg)
              .map((d) => ({ arch: d.arch, ver: d.ver, path: d.path }));

            const satisfiesLocal = localCands.some((cand) => {
              if (isAnyQualifier) {
                const ma = getCachedDebMultiArch(cand.path);
                if (ma !== 'allowed') {
                  return false;
                }
              }
              const archMatches = cand.arch === 'all' || normalizeArch(cand.arch) === effectiveReqArch;
              return archMatches && satisfiesVersionConstraint(cand.ver, tok.versionConstraint);
            });
            if (satisfiesLocal) {
              return true;
            }

            const assets = getReleaseAssets(releaseTag);
            const remoteCands = assets
              .filter((a) => a.name.endsWith('.deb') && a.name.startsWith(`${depPkg}_`))
              .map((a) => ({ name: a.name, arch: extractDebArch(a.name), ver: parseFilenameDebVersion(a.name) }));

            const satisfiesRemote = remoteCands.some((cand) => {
              if (isAnyQualifier) {
                const localCandPath = join(artPath, cand.name);
                let ma: string | null = null;
                if (existsSync(localCandPath)) {
                  ma = getCachedDebMultiArch(localCandPath);
                } else {
                  const ownerRecipe = dag.recipes[releaseTag];
                  if (ownerRecipe) {
                    if (depPkg === releaseTag) {
                      ma =
                        (ownerRecipe as { multiarch?: string; multi_arch?: string }).multiarch ||
                        (ownerRecipe as { multiarch?: string; multi_arch?: string }).multi_arch ||
                        null;
                    } else if (ownerRecipe.subpackages) {
                      for (const [sKey, sDef] of Object.entries(ownerRecipe.subpackages)) {
                        if (sDef && typeof sDef === 'object') {
                          const sName = (sDef as SubpackageDefinition).name || sKey;
                          if (sName === depPkg) {
                            ma =
                              (sDef as { multiarch?: string; multi_arch?: string }).multiarch ||
                              (sDef as { multiarch?: string; multi_arch?: string }).multi_arch ||
                              null;
                            break;
                          }
                        }
                      }
                    }
                  }
                }
                if (ma !== 'allowed') {
                  return false;
                }
              }
              const archMatches = cand.arch === 'all' || normalizeArch(cand.arch) === effectiveReqArch;
              return archMatches && satisfiesVersionConstraint(cand.ver, tok.versionConstraint);
            });
            return satisfiesRemote;
          }),
        );

        if (!isClauseSatisfied) {
          allClausesSatisfiable = false;
          break;
        }
      }

      if (allClausesSatisfiable) {
        nextEligible.push(file);
      } else {
        console.warn(
          `::warning:: Withholding ${basename(file)} from publication: unsatisfied dependency in current candidate set.`,
        );
        changed = true;
      }
    }
    currentEligibleSet = new Set(nextEligible);
  }

  return Array.from(currentEligibleSet);
}

export async function fetchExistingReleaseAssetsToArtifacts(
  artPath: string,
  eligibleStagedDebs?: Set<string>,
  allStagedDebs?: string[],
  retainedRemoteDir?: string,
): Promise<Map<string, ReleaseAssetInfo[]>> {
  const assetMap = new Map<string, ReleaseAssetInfo[]>();
  if (process.env.REPOEXE_SKIP_REMOTE === '1') {
    return assetMap;
  }
  const ghCheck = spawnSync('which', ['gh']);
  if (ghCheck.status !== 0) {
    console.warn('Warning: GitHub CLI (gh) is not installed or not available in PATH; skipping remote asset fetch.');
    return assetMap;
  }

  mkdirSync(artPath, { recursive: true });
  const repoRoot = resolve('.');
  const pkgsDir = join(repoRoot, 'pkg');

  const repoRes = spawnSync('gh', ['repo', 'view', '--json', 'name,owner'], { encoding: 'utf-8' });
  if (repoRes.status !== 0) {
    throw new Error(
      `Failed to resolve GitHub repository via 'gh repo view': ${repoRes.stderr?.trim() || 'exit code ' + repoRes.status}`,
    );
  }

  let owner: string;
  let repoName: string;
  try {
    const repoInfo = JSON.parse(repoRes.stdout);
    owner = repoInfo.owner?.login || repoInfo.owner;
    repoName = repoInfo.name;
    if (!owner || !repoName) {
      throw new Error('Repository owner or name is missing from gh repo view output');
    }
  } catch (err) {
    throw new Error(
      `Failed to parse repository info from gh repo view: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const releasesRes = spawnSync('gh', ['api', '--paginate', '--slurp', `repos/${owner}/${repoName}/releases`], {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (releasesRes.status !== 0) {
    throw new Error(`GitHub release discovery failed: ${releasesRes.stderr || 'exit code ' + releasesRes.status}`);
  }

  let releases: Array<Record<string, any>> = [];
  try {
    releases = parsePaginatedGhJsonArray(releasesRes.stdout);
  } catch (err) {
    throw new Error(
      `Failed to parse paginated GitHub release inventory: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  let allRecipes: Record<string, PackageRecipe> | undefined;
  if (existsSync(pkgsDir)) {
    try {
      const dag = new DependencyGraph(pkgsDir);
      if (Object.keys(dag.rejectedRecipes).length > 0) {
        const rejectedNames = Object.keys(dag.rejectedRecipes).join(', ');
        throw new Error(`DependencyGraph rejected invalid recipes: ${rejectedNames}`);
      }
      allRecipes = dag.recipes;
    } catch (err) {
      throw new Error(
        `Failed to load recipe dependency graph for repository index: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (!tag || tag.includes('@')) {
      continue;
    }
    const pkg = tag;
    const recipePath = join(pkgsDir, pkg, 'recipe.ts');

    // Skip packages that no longer exist in the repository
    if (!existsSync(recipePath)) {
      continue;
    }

    let expectedFiles = new Set<string>();
    try {
      const recipe = parseRecipe(recipePath);
      if (!allRecipes) {
        const targetExpected = getExpectedAssetFilenames(recipe);
        const validNames = new Set([recipe.name, ...getSubpackageNames(recipe)]);
        expectedFiles = new Set<string>();
        for (const asset of rel.assets || []) {
          const aName = (asset as { name?: string }).name || '';
          if (aName.endsWith('.deb')) {
            const p = aName.split('_')[0];
            if (validNames.has(p) || targetExpected.has(aName)) {
              expectedFiles.add(aName);
            }
          }
        }
      } else {
        expectedFiles = getRetainedReleaseAssetFilenames(
          recipe,
          rel.assets || [],
          allRecipes,
          typeof rel.body === 'string' ? rel.body : undefined,
        );
      }
    } catch {
      continue;
    }

    if (expectedFiles.size === 0) {
      continue;
    }

    const pkgAssets: ReleaseAssetInfo[] = [];

    for (const asset of rel.assets || []) {
      const name = asset.name || '';
      const downloadUrl = asset.browser_download_url;
      if (!name || !downloadUrl) {
        continue;
      }

      if (!expectedFiles.has(name)) {
        continue;
      }

      pkgAssets.push({
        name,
        size: typeof asset.size === 'number' ? asset.size : 0,
        download_count: typeof asset.download_count === 'number' ? asset.download_count : 0,
        browser_download_url: downloadUrl,
      });

      const targetFile = join(artPath, name);
      const isRejectedStagedFile = Boolean(allStagedDebs?.includes(targetFile) && !eligibleStagedDebs?.has(targetFile));
      if (!existsSync(targetFile) || isRejectedStagedFile) {
        console.log(`⚡ Downloading existing published asset for index accumulation: ${name}...`);
        let downloadOk = false;
        try {
          const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
          let resp: Response;
          if (ghToken && asset.url) {
            resp = await fetch(asset.url, {
              headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: 'application/octet-stream',
              },
            });
          } else {
            resp = await fetch(downloadUrl);
          }
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            if (isRejectedStagedFile) {
              const runRetainedDir = retainedRemoteDir || join(artPath, '.retained_remote');
              mkdirSync(runRetainedDir, { recursive: true });
              const retainedFile = join(runRetainedDir, name);
              writeFileSync(retainedFile, buf);
            } else {
              writeFileSync(targetFile, buf);
            }
            downloadOk = true;
          }
        } catch {}
        if (!downloadOk) {
          throw new Error(`Failed to download required release asset '${name}' for package '${pkg}'.`);
        }
      }
    }

    if (pkgAssets.length > 0) {
      assetMap.set(pkg, pkgAssets);
    }
  }

  return assetMap;
}

export async function prepareSite(
  siteDir: string = 'site',
  artifactsDir: string = 'artifacts',
  skipRemote: boolean = false,
  stagingDir?: string,
): Promise<void> {
  let runRetainedDir: string | null = null;
  // Track whether aptStaging was auto-generated (needs cleanup) or caller-provided
  let autoStagingDir: string | null = null;
  try {
    runRetainedDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), '.retained_remote_run-'));
    autoStagingDir = !stagingDir ? mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'apt_staging-')) : null;
    const sPath = resolve(siteDir);
    const repoRoot = resolve('.');
    const artPath = resolve(artifactsDir);
    const shouldSkipRemote = skipRemote || process.env.REPOEXE_SKIP_REMOTE === '1';

    for (const sub of ['apt']) {
      mkdirSync(join(sPath, sub), { recursive: true });
    }

    const aptStaging = autoStagingDir || resolve(stagingDir!);
    const resolvedArtPath = resolve(artPath);
    const resolvedRepoRoot = resolve(repoRoot);
    const resolvedSiteDir = resolve(sPath);
    const getPhysicalPath = (p: string): string => {
      let curr = resolve(p);
      const suffixParts: string[] = [];
      while (!existsSync(curr)) {
        const parent = dirname(curr);
        if (parent === curr) {
          break;
        }
        suffixParts.unshift(basename(curr));
        curr = parent;
      }
      try {
        const real = realpathSync(curr);
        return suffixParts.length > 0 ? join(real, ...suffixParts) : real;
      } catch {
        return resolve(p);
      }
    };
    const isSameOrSub = (target: string, base: string): boolean => {
      const physTarget = getPhysicalPath(target);
      const physBase = getPhysicalPath(base);
      const rel = relative(physBase, physTarget);
      return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
    };
    const isRepoRootOrAncestor = aptStaging === resolvedRepoRoot || isSameOrSub(resolvedRepoRoot, aptStaging);
    const resolvedPkgDir = resolve(join(resolvedRepoRoot, 'pkg'));
    const overlapsArtifacts = isSameOrSub(aptStaging, resolvedArtPath) || isSameOrSub(resolvedArtPath, aptStaging);
    const overlapsSite = isSameOrSub(aptStaging, resolvedSiteDir) || isSameOrSub(resolvedSiteDir, aptStaging);
    const overlapsRetainedDir = isSameOrSub(aptStaging, runRetainedDir) || isSameOrSub(runRetainedDir, aptStaging);
    const overlapsSources =
      isSameOrSub(aptStaging, resolvedPkgDir) ||
      isSameOrSub(resolvedPkgDir, aptStaging) ||
      isSameOrSub(aptStaging, join(resolvedRepoRoot, 'scripts')) ||
      isSameOrSub(join(resolvedRepoRoot, 'scripts'), aptStaging) ||
      isSameOrSub(aptStaging, join(resolvedRepoRoot, '.git')) ||
      isSameOrSub(join(resolvedRepoRoot, '.git'), aptStaging);
    const liveAptPool = join(resolvedSiteDir, 'apt');
    const artifactsOverlapsLivePool =
      isSameOrSub(resolvedArtPath, liveAptPool) || isSameOrSub(liveAptPool, resolvedArtPath);
    if (isRepoRootOrAncestor || overlapsArtifacts || overlapsSite || overlapsSources || overlapsRetainedDir) {
      throw new Error(
        `Invalid aptStaging directory '${aptStaging}': must not equal or contain workspace root, site output, build inputs, or retained scratch.`,
      );
    }
    if (artifactsOverlapsLivePool) {
      throw new Error(
        `Invalid artifactsDir '${artifactsDir}': must not overlap live APT pool directory '${liveAptPool}'.`,
      );
    }
    mkdirSync(aptStaging, { recursive: true });

    // 1. Publish newly built artifacts to GitHub Releases if gh CLI is available
    const ghCheck = spawnSync('which', ['gh']);
    const globalEligibleArtifacts = new Set<string>();
    const allStagedDebs: string[] = [];
    let ranEligibilityScan = false;
    if (!shouldSkipRemote && existsSync(artPath) && ghCheck.status === 0) {
      ranEligibilityScan = true;
      console.log('⚡ Publishing release artifacts to GitHub Releases...');
      const scanAllStagedDebs = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            scanAllStagedDebs(full);
          } else if (entry.isFile() && entry.name.endsWith('.deb')) {
            allStagedDebs.push(full);
          }
        }
      };
      scanAllStagedDebs(artPath);

      const metaFiles: string[] = [];
      const findMetas = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            findMetas(full);
          } else if (entry.name.endsWith('_metadata.json')) {
            metaFiles.push(full);
          }
        }
      };
      findMetas(artPath);

      const dag = new DependencyGraph(join(repoRoot, 'pkg'));
      const rejectedRecipes = Object.keys(dag.rejectedRecipes);
      if (rejectedRecipes.length > 0) {
        throw new Error(`Cannot publish artifacts: invalid recipe(s) detected in graph: ${rejectedRecipes.join(', ')}`);
      }
      const buildOrder = new Map(dag.resolveBuildOrder(undefined, undefined, true).map((name, idx) => [name, idx]));
      metaFiles.sort(
        (a, b) =>
          (buildOrder.get(basename(a, '_metadata.json')) ?? 9999) -
          (buildOrder.get(basename(b, '_metadata.json')) ?? 9999),
      );

      interface PackageUploadGroup {
        pkgName: string;
        tag: string;
        subpkgNames: string[];
        rawMatchingFiles: string[];
        pkgMetaFile: string;
        meta: Record<string, unknown>;
      }
      const packageUploadGroups: PackageUploadGroup[] = [];
      const uploadCandidateFiles = new Set<string>();
      for (const pkgMetaFile of metaFiles) {
        try {
          const meta = JSON.parse(readFileSync(pkgMetaFile, 'utf-8'));
          const pkgName = meta.name;
          let subpkgNames: string[] = [];
          const recipePath = join('pkg', pkgName);
          if (existsSync(recipePath)) {
            try {
              const recipe = parseRecipe(recipePath);
              subpkgNames = getSubpackageNames(recipe);
            } catch (e: unknown) {
              const msg = e instanceof Error ? e.message : String(e);
              console.log(
                `::warning:: Could not read subpackages for ${pkgName}; subpackage debs will not be published: ${msg}`,
              );
            }
          }
          const rawMatchingFiles = getExactPackageArtifacts(artPath, pkgName, subpkgNames);
          packageUploadGroups.push({ pkgName, tag: pkgName, subpkgNames, rawMatchingFiles, pkgMetaFile, meta });
          for (const f of rawMatchingFiles) {
            uploadCandidateFiles.add(f);
          }
        } catch {}
      }

      const filesToFilter = allStagedDebs.filter((f) => uploadCandidateFiles.has(f));
      for (const eligible of filterPublishableArtifacts(filesToFilter, artPath, repoRoot)) {
        globalEligibleArtifacts.add(eligible);
      }

      interface ConfirmedDebInfo {
        name: string;
        pkg: string;
        version: string;
        arch: string;
        multiArch?: string | null;
        provides: Array<{ name: string; version?: string }>;
      }

      const confirmedPublishedDebs = new Map<string, ConfirmedDebInfo[]>();
      const addConfirmedDeb = (debName: string, filePath?: string): void => {
        if (!debName.endsWith('.deb')) {
          return;
        }
        const pkg = debName.split('_')[0];
        const arch = extractDebArch(debName);
        const version = parseFilenameDebVersion(debName);
        let ma: string | null = null;
        const provides: Array<{ name: string; version?: string }> = [];
        if (filePath && existsSync(filePath)) {
          ma = getDebMultiArch(filePath);
          const provStr = getDebProvides(filePath);
          if (provStr) {
            for (const provClause of parseDependencyList([provStr])) {
              for (const provTok of provClause) {
                const pName = provTok.name.split(':')[0].trim();
                if (pName) {
                  provides.push({ name: pName, version: provTok.versionConstraint?.version });
                }
              }
            }
          }
        } else {
          const recipe = dag.recipes[pkg];
          if (recipe && version === formatDebianVersion(recipe)) {
            ma =
              ((recipe as unknown as Record<string, unknown>).multiarch as string) ||
              ((recipe as unknown as Record<string, unknown>).multi_arch as string) ||
              null;
            if (recipe.provides) {
              const provList = Array.isArray(recipe.provides) ? recipe.provides : [recipe.provides];
              for (const clause of parseDependencyList(provList)) {
                for (const tok of clause) {
                  const pName = tok.name.split(':')[0].trim();
                  if (pName) {
                    provides.push({ name: pName, version: tok.versionConstraint?.version });
                  }
                }
              }
            }
          } else {
            const owner = dag.subpackageMap[pkg];
            const ownerRecipe = owner ? dag.recipes[owner] : undefined;
            if (ownerRecipe && version === formatDebianVersion(ownerRecipe)) {
              const subDef = ownerRecipe.subpackages
                ? (Object.values(ownerRecipe.subpackages).find((s) => s && (s as SubpackageDefinition).name === pkg) as
                    SubpackageDefinition | undefined)
                : undefined;
              if (subDef) {
                ma =
                  ((subDef as unknown as Record<string, unknown>).multiarch as string) ||
                  ((subDef as unknown as Record<string, unknown>).multi_arch as string) ||
                  null;
                if (subDef.provides) {
                  const provList = Array.isArray(subDef.provides) ? subDef.provides : [subDef.provides];
                  for (const clause of parseDependencyList(provList)) {
                    for (const tok of clause) {
                      const pName = tok.name.split(':')[0].trim();
                      if (pName) {
                        provides.push({ name: pName, version: tok.versionConstraint?.version });
                      }
                    }
                  }
                }
              }
            }
          }
        }
        const info: ConfirmedDebInfo = { name: debName, pkg, version, arch, multiArch: ma, provides };
        const list = confirmedPublishedDebs.get(pkg) || [];
        if (!list.some((e) => e.name === debName)) {
          list.push(info);
          confirmedPublishedDebs.set(pkg, list);
        }
        for (const prov of provides) {
          const provList = confirmedPublishedDebs.get(prov.name) || [];
          if (!provList.some((e) => e.name === debName)) {
            provList.push(info);
            confirmedPublishedDebs.set(prov.name, provList);
          }
        }
      };

      const isConfirmedArchiveSatisfied = (tok: DependencyToken, reqArch: string): boolean => {
        const reqPkg = tok.name.split(':')[0].trim();
        const isAny = tok.multiArch === 'any' || tok.name.endsWith(':any');
        const explicitArch = tok.multiArch && !isAny ? normalizeArch(tok.multiArch) : undefined;
        const effectiveReqArch = explicitArch || reqArch;
        const cands = confirmedPublishedDebs.get(reqPkg) || [];
        return cands.some((cand) => {
          const archMatches = cand.arch === 'all' || normalizeArch(cand.arch) === effectiveReqArch;
          if (isAny) {
            if (cand.multiArch !== 'allowed') {
              return false;
            }
          } else if (!archMatches) {
            return false;
          }
          if (cand.pkg === reqPkg) {
            if (tok.versionConstraint) {
              return satisfiesVersionConstraint(cand.version, tok.versionConstraint);
            }
            return true;
          }
          const prov = cand.provides.find((p) => p.name === reqPkg);
          if (prov) {
            if (!tok.versionConstraint) {
              return true;
            }
            if (!prov.version) {
              return false;
            }
            return satisfiesVersionConstraint(prov.version, tok.versionConstraint);
          }
          return false;
        });
      };

      const isSiblingArchiveSatisfied = (
        tok: DependencyToken,
        reqArch: string,
        currentCandidates: string[],
      ): boolean => {
        const reqPkg = tok.name.split(':')[0].trim();
        const isAny = tok.multiArch === 'any' || tok.name.endsWith(':any');
        const explicitArch = tok.multiArch && !isAny ? normalizeArch(tok.multiArch) : undefined;
        const effectiveReqArch = explicitArch || reqArch;
        return currentCandidates.some((candFile) => {
          const candName = basename(candFile);
          if (!candName.endsWith('.deb')) {
            return false;
          }
          const candPkg = candName.split('_')[0];
          const candArch = extractDebArch(candName);
          const archMatches = candArch === 'all' || normalizeArch(candArch) === effectiveReqArch;
          if (isAny) {
            const ma = getDebMultiArch(candFile);
            if (ma !== 'allowed') {
              return false;
            }
          } else if (!archMatches) {
            return false;
          }

          if (candPkg === reqPkg) {
            const candVer = parseFilenameDebVersion(candName);
            if (tok.versionConstraint) {
              return satisfiesVersionConstraint(candVer, tok.versionConstraint);
            }
            return true;
          }

          const provStr = getDebProvides(candFile);
          if (provStr) {
            for (const provClause of parseDependencyList([provStr])) {
              for (const provTok of provClause) {
                const pName = provTok.name.split(':')[0].trim();
                if (pName === reqPkg) {
                  if (!tok.versionConstraint) {
                    return true;
                  }
                  if (!provTok.versionConstraint?.version) {
                    return false;
                  }
                  return satisfiesVersionConstraint(provTok.versionConstraint.version, tok.versionConstraint);
                }
              }
            }
          }
          return false;
        });
      };

      const releaseAssetCache = new Map<string, Array<{ name: string }>>();
      const getReleaseAssets = (releaseTag: string): Array<{ name: string }> => {
        if (releaseAssetCache.has(releaseTag)) {
          return releaseAssetCache.get(releaseTag)!;
        }
        let assets: Array<{ name: string }> = [];
        try {
          const ghRes = spawnSync('gh', ['release', 'view', releaseTag, '--json', 'assets'], {
            encoding: 'utf-8',
          });
          if (ghRes.status === 0 && ghRes.stdout) {
            const data = JSON.parse(ghRes.stdout);
            assets = data.assets || [];
          }
        } catch {}
        releaseAssetCache.set(releaseTag, assets);
        return assets;
      };

      for (const group of packageUploadGroups) {
        const { pkgName, tag, subpkgNames, rawMatchingFiles, pkgMetaFile, meta } = group;
        try {
          const withheldFiles = rawMatchingFiles.filter((f) => !globalEligibleArtifacts.has(f));
          let groupCandidates = rawMatchingFiles.filter((f) => globalEligibleArtifacts.has(f));

          // Reapply eligibility to the whole group after any deferral (Thread #2 & Thread #3)
          let groupChanged = true;
          while (groupChanged) {
            groupChanged = false;
            const survivingInGroup: string[] = [];

            for (const f of groupCandidates) {
              const debPkg = basename(f).split('_')[0];
              const isChild = debPkg !== pkgName;
              if (isChild) {
                const depStr = getDebDepends(f);
                if (depStr === null) {
                  console.warn(
                    `::warning:: Deferring child archive '${basename(f)}' from publication: unable to read dependencies from control.`,
                  );
                  withheldFiles.push(f);
                  globalEligibleArtifacts.delete(f);
                  const surviving = filterPublishableArtifacts(
                    Array.from(globalEligibleArtifacts),
                    artPath,
                    repoRoot,
                    globalEligibleArtifacts,
                  );
                  globalEligibleArtifacts.clear();
                  for (const s of surviving) {
                    globalEligibleArtifacts.add(s);
                  }
                  groupChanged = true;
                  break;
                }
                if (depStr.length > 0) {
                  const depClauses = parseDependencyList([depStr]);
                  const cArch = normalizeArch(extractDebArch(basename(f)));
                  const recipeConcreteArches = (
                    (meta.arches as string[]) || (meta.arch ? [meta.arch as string] : ['aarch64'])
                  )
                    .filter((a) => a !== 'all')
                    .map(normalizeArch);
                  const targetArches: string[] =
                    cArch === 'all' ? (recipeConcreteArches.length > 0 ? recipeConcreteArches : ['aarch64']) : [cArch];

                  let allDepsConfirmed = true;
                  for (const tArch of targetArches) {
                    const filtered = filterDepsForArch(depClauses, tArch);
                    for (const clause of filtered) {
                      const clauseSatisfied = clause.some((tok) => {
                        const reqPkg = tok.name.split(':')[0].trim();
                        // 1. Satisfied if external package
                        if (isExternalPackage(reqPkg, dag, repoRoot)) {
                          return true;
                        }
                        // 2. Satisfied if compatible sibling remains in final upload group
                        if (isSiblingArchiveSatisfied(tok, tArch, groupCandidates)) {
                          return true;
                        }
                        // 3. Satisfied if confirmed published archive matches version and arch
                        if (isConfirmedArchiveSatisfied(tok, tArch)) {
                          return true;
                        }
                        // 4. Satisfied if an existing release asset in the repo satisfies it
                        if (isRemoteAssetSatisfied(tok, tArch, dag, getReleaseAssets, artPath)) {
                          return true;
                        }
                        return false;
                      });
                      if (!clauseSatisfied) {
                        allDepsConfirmed = false;
                        break;
                      }
                    }
                    if (!allDepsConfirmed) {
                      break;
                    }
                  }
                  if (!allDepsConfirmed) {
                    console.warn(
                      `::warning:: Deferring child archive '${basename(f)}' from publication: runtime dependency not yet confirmed published.`,
                    );
                    withheldFiles.push(f);
                    globalEligibleArtifacts.delete(f);
                    const surviving = filterPublishableArtifacts(
                      Array.from(globalEligibleArtifacts),
                      artPath,
                      repoRoot,
                      globalEligibleArtifacts,
                    );
                    globalEligibleArtifacts.clear();
                    for (const s of surviving) {
                      globalEligibleArtifacts.add(s);
                    }
                    groupChanged = true;
                    break;
                  }
                }
              }
              survivingInGroup.push(f);
            }
            if (groupChanged) {
              groupCandidates = groupCandidates.filter((f) => globalEligibleArtifacts.has(f));
            } else {
              groupCandidates = survivingInGroup;
            }
          }

          const eligibleForUpload = groupCandidates;

          if (eligibleForUpload.length === 0) {
            console.log(`Notice: No publishable artifact files matched for tag ${tag}`);
            continue;
          }

          const viewRes = spawnSync('gh', ['release', 'view', tag, '--json', 'body,assets'], { encoding: 'utf-8' });
          const ownedPackages = new Set<string>([pkgName, ...subpkgNames]);
          const existingAssets: Array<{ name: string; size: number; digest?: string }> = [];
          let shouldUpdateNotes = true;
          let releaseConfirmedMissing = false;

          if (viewRes.status === 0 && viewRes.stdout) {
            try {
              const existingView = JSON.parse(viewRes.stdout) as {
                body?: string;
                assets?: Array<{ name?: string; size?: number; digest?: string }>;
              };
              if (Array.isArray(existingView.assets)) {
                for (const a of existingView.assets) {
                  if (a?.name && typeof a.size === 'number') {
                    existingAssets.push({
                      name: a.name,
                      size: a.size,
                      digest: typeof a.digest === 'string' ? a.digest : undefined,
                    });
                    addConfirmedDeb(a.name);
                  }
                }
              }
              const prevOwnership = parseReleaseOwnershipMetadata(existingView.body);
              if (prevOwnership.managedByRepoExe && (!prevOwnership.ownerName || prevOwnership.ownerName === pkgName)) {
                for (const prevPkg of prevOwnership.ownedPackages) {
                  ownedPackages.add(prevPkg);
                }
              }
            } catch {
              shouldUpdateNotes = false;
            }
          } else {
            const err = (viewRes.stderr || '').toLowerCase();
            if (err.includes('not found') || err.includes('could not find') || err.includes('404')) {
              releaseConfirmedMissing = true;
            } else {
              shouldUpdateNotes = false;
            }
          }

          const baseMeta = {
            ...meta,
            managed_by: 'repoexe',
            owned_packages: Array.from(ownedPackages).sort(),
          };
          const effectiveMeta =
            withheldFiles.length > 0 ? { ...baseMeta, state_hash: undefined, partial: true } : baseMeta;
          const notesBody = JSON.stringify(effectiveMeta, null, 2);

          const filesToUpload: string[] = [];
          for (const f of eligibleForUpload) {
            const fName = basename(f);
            const published = existingAssets.find((a) => a.name === fName);
            if (published) {
              let localSize: number | undefined;
              let localSha: string | undefined;
              try {
                localSize = statSync(f).size;
                localSha = createHash('sha256').update(readFileSync(f)).digest('hex');
              } catch {}
              const digestMatches = published.digest
                ? published.digest.toLowerCase() === `sha256:${localSha}`.toLowerCase()
                : true;
              if (localSize !== undefined && published.size === localSize && digestMatches) {
                // Published archive bytes match staged artifact; skip upload
                addConfirmedDeb(fName, f);
                continue;
              }
              console.warn(
                `::warning:: Published asset '${fName}' on tag '${tag}' differs from staged build (${published.size} vs ${localSize ?? 'unknown'} bytes, digest match: ${digestMatches}).`,
              );
            }
            filesToUpload.push(f);
          }

          const isParentAsset = (f: string): boolean => {
            const b = basename(f);
            return b.startsWith(`${tag}_`) || b.endsWith('_metadata.json');
          };

          if (releaseConfirmedMissing) {
            const parentEligible = eligibleForUpload.filter(isParentAsset);
            const childEligible = eligibleForUpload.filter((f) => !isParentAsset(f));
            const createArgs = ['release', 'create', tag, ...parentEligible, '--title', tag, '--notes', notesBody];
            const res = spawnSync('gh', createArgs, {
              encoding: 'utf-8',
            });
            if (res.status === 0) {
              console.log(`✓ Successfully published GitHub release tag: ${tag}`);
              for (const f of parentEligible) {
                addConfirmedDeb(basename(f), f);
              }
              if (childEligible.length > 0) {
                const childRes = spawnSync('gh', ['release', 'upload', tag, ...childEligible, '--clobber'], {
                  encoding: 'utf-8',
                });
                if (childRes.status === 0) {
                  for (const f of childEligible) {
                    addConfirmedDeb(basename(f), f);
                  }
                } else {
                  console.warn(`::warning:: Failed to upload child subpackages for ${tag}: ${childRes.stderr?.trim()}`);
                  for (const f of childEligible) {
                    globalEligibleArtifacts.delete(f);
                  }
                  const surviving = filterPublishableArtifacts(
                    Array.from(globalEligibleArtifacts),
                    artPath,
                    repoRoot,
                    globalEligibleArtifacts,
                  );
                  globalEligibleArtifacts.clear();
                  for (const f of surviving) {
                    globalEligibleArtifacts.add(f);
                  }
                }
              }
            } else {
              console.log(`::warning:: Failed to create release tag ${tag}: ${res.stderr?.trim()}`);
              for (const f of eligibleForUpload) {
                globalEligibleArtifacts.delete(f);
              }
              const surviving = filterPublishableArtifacts(
                Array.from(globalEligibleArtifacts),
                artPath,
                repoRoot,
                globalEligibleArtifacts,
              );
              globalEligibleArtifacts.clear();
              for (const f of surviving) {
                globalEligibleArtifacts.add(f);
              }
            }
          } else if (filesToUpload.length === 0) {
            let editOk = true;
            if (shouldUpdateNotes) {
              const resEdit = spawnSync('gh', ['release', 'edit', tag, '--notes', notesBody], {
                encoding: 'utf-8',
              });
              if (resEdit.status !== 0) {
                editOk = false;
                console.warn(
                  `::warning:: Incomplete publication for ${tag}: failed to update release notes: ${resEdit.stderr?.trim()}`,
                );
              }
            }
            if (editOk) {
              console.log(`✓ All release assets for ${tag} are already published and up to date.`);
              for (const f of eligibleForUpload) {
                addConfirmedDeb(basename(f), f);
              }
            }
          } else {
            const parentsToUpload = filesToUpload.filter(isParentAsset);
            const childrenToUpload = filesToUpload.filter((f) => !isParentAsset(f));

            let parentUploadOk = true;
            if (parentsToUpload.length > 0) {
              const resParent = spawnSync('gh', ['release', 'upload', tag, ...parentsToUpload, '--clobber'], {
                encoding: 'utf-8',
              });
              if (resParent.status === 0) {
                for (const f of parentsToUpload) {
                  addConfirmedDeb(basename(f), f);
                }
              } else {
                parentUploadOk = false;
                console.log(
                  `::warning:: Failed to upload parent release assets for ${tag}: ${resParent.stderr?.trim()}`,
                );
                for (const f of filesToUpload) {
                  globalEligibleArtifacts.delete(f);
                }
                const surviving = filterPublishableArtifacts(
                  Array.from(globalEligibleArtifacts),
                  artPath,
                  repoRoot,
                  globalEligibleArtifacts,
                );
                globalEligibleArtifacts.clear();
                for (const f of surviving) {
                  globalEligibleArtifacts.add(f);
                }
              }
            }

            if (parentUploadOk && childrenToUpload.length > 0) {
              const resChild = spawnSync('gh', ['release', 'upload', tag, ...childrenToUpload, '--clobber'], {
                encoding: 'utf-8',
              });
              if (resChild.status === 0) {
                for (const f of childrenToUpload) {
                  addConfirmedDeb(basename(f), f);
                }
              } else {
                console.warn(
                  `::warning:: Failed to upload child release assets for ${tag}: ${resChild.stderr?.trim()}`,
                );
                for (const f of childrenToUpload) {
                  globalEligibleArtifacts.delete(f);
                }
                const surviving = filterPublishableArtifacts(
                  Array.from(globalEligibleArtifacts),
                  artPath,
                  repoRoot,
                  globalEligibleArtifacts,
                );
                globalEligibleArtifacts.clear();
                for (const f of surviving) {
                  globalEligibleArtifacts.add(f);
                }
              }
            }

            if (parentUploadOk) {
              let editOk = true;
              if (shouldUpdateNotes) {
                const resEdit = spawnSync('gh', ['release', 'edit', tag, '--notes', notesBody], {
                  encoding: 'utf-8',
                });
                if (resEdit.status !== 0) {
                  editOk = false;
                  console.warn(
                    `::warning:: Incomplete publication for ${tag}: uploaded assets but failed to update release notes: ${resEdit.stderr?.trim()}`,
                  );
                }
              }
              if (editOk) {
                console.log(`✓ Uploaded release assets to existing tag: ${tag}`);
              }
            }
          }
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.log(`::warning:: Failed publishing release tag for ${basename(pkgMetaFile)}: ${msg}`);
        }
      }
    }

    // 2. Fetch existing release assets
    let releaseAssetMap = new Map<string, ReleaseAssetInfo[]>();
    if (!shouldSkipRemote) {
      try {
        releaseAssetMap = await fetchExistingReleaseAssetsToArtifacts(
          artPath,
          globalEligibleArtifacts,
          allStagedDebs,
          runRetainedDir,
        );
      } catch (err: unknown) {
        throw new Error(
          `Could not fetch existing release assets; aborting site generation: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    // 3. Copy accumulated artifacts to aptStaging
    if (existsSync(aptStaging)) {
      rmSync(aptStaging, { recursive: true, force: true });
    }
    mkdirSync(aptStaging, { recursive: true });

    const stagedDebsSet = new Set(allStagedDebs);
    if (existsSync(artPath)) {
      const copyArtifacts = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (entry.name.startsWith('.')) {
            continue;
          }
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            copyArtifacts(full);
          } else if (entry.isFile()) {
            if (entry.name.endsWith('.deb')) {
              if (stagedDebsSet.has(full) && !globalEligibleArtifacts.has(full)) {
                continue;
              }
              copyFileSync(full, join(aptStaging, entry.name));
            }
          }
        }
      };
      copyArtifacts(artPath);

      if (runRetainedDir && existsSync(runRetainedDir)) {
        for (const entry of readdirSync(runRetainedDir)) {
          if (entry.endsWith('.deb')) {
            copyFileSync(join(runRetainedDir, entry), join(aptStaging, entry));
          }
        }
        rmSync(runRetainedDir, { recursive: true, force: true });
      }
    }

    // 4. Generate APT Metadata and Release File
    const debFiles = existsSync(aptStaging) ? readdirSync(aptStaging).filter((f) => f.endsWith('.deb')) : [];

    const arches = new Set<string>(['aarch64', 'arm64', 'arm', 'x86_64', 'i686']);
    for (const f of debFiles) {
      const arch = extractDebArch(f);
      if (arch !== 'unknown' && arch !== 'all') {
        arches.add(arch);
        if (arch === 'arm64') {
          arches.add('aarch64');
        } else if (arch === 'aarch64') {
          arches.add('arm64');
        }
      }
    }

    for (const arch of arches) {
      generateAptMetadata(aptStaging, 'main', arch);
    }
    const aptSiteDir = join(sPath, 'apt');
    const isExistingSigned =
      existsSync(join(aptSiteDir, 'dists', 'stable', 'InRelease')) ||
      existsSync(join(aptSiteDir, 'dists', 'stable', 'Release.gpg'));
    const requireSigned =
      Boolean(process.env.GPG_PRIVATE_KEY) || isExistingSigned || process.env.REQUIRE_APT_SIGNING === 'true';
    generateReleaseFile(aptStaging, 'stable', 'main', requireSigned);

    // Atomic promotion: build replacement pool in a unique scratch directory on the site filesystem
    let aptNextDir: string | null = null;
    let aptPrevDir: string | null = null;

    try {
      aptNextDir = mkdtempSync(join(sPath, '.apt_next-'));
      chmodSync(aptNextDir, 0o755);
      const runSuffix = basename(aptNextDir).slice('.apt_next-'.length);
      aptPrevDir = join(sPath, `.apt_prev-${runSuffix}`);

      // Copy all published .deb assets directly to aptNextDir
      for (const f of debFiles) {
        copyFileSync(join(aptStaging, f), join(aptNextDir, f));
      }

      const distsDir = join(aptStaging, 'dists');
      if (existsSync(distsDir)) {
        mkdirSync(join(aptNextDir, 'dists'), { recursive: true });
        const cpRes = spawnSync('cp', ['-a', `${distsDir}/.`, `${join(aptNextDir, 'dists')}/`]);
        if (cpRes.status !== 0) {
          throw new Error(
            `Failed to copy APT metadata from '${distsDir}' to '${aptNextDir}/dists': cp exited with code ${cpRes.status}`,
          );
        }
      }

      // Switch published generation atomically
      if (existsSync(aptSiteDir)) {
        renameSync(aptSiteDir, aptPrevDir);
      }
      try {
        renameSync(aptNextDir, aptSiteDir);
        if (existsSync(aptPrevDir)) {
          rmSync(aptPrevDir, { recursive: true, force: true });
        }
      } catch (err) {
        if (existsSync(aptPrevDir) && !existsSync(aptSiteDir)) {
          renameSync(aptPrevDir, aptSiteDir);
        }
        throw err;
      }
    } finally {
      if (aptNextDir && existsSync(aptNextDir)) {
        rmSync(aptNextDir, { recursive: true, force: true });
      }
    }

    // 5. Generate packages.json Store Manifest
    generatePackagesJson(
      join(repoRoot, 'pkg'),
      join(sPath, 'packages.json'),
      artPath,
      releaseAssetMap,
      ranEligibilityScan ? globalEligibleArtifacts : undefined,
    );

    // 6. Copy Frontend Source & Keyrings (dereferencing symlinks so site artifacts tarball cleanly)
    const siteSrcDir = join(repoRoot, 'scripts', 'site');
    if (existsSync(siteSrcDir)) {
      spawnSync('cp', ['-aL', `${siteSrcDir}/.`, `${sPath}/`]);
    }

    // Bundle scripts/site/app.ts using Bun into site/app.js
    const appTs = join(siteSrcDir, 'app.ts');
    if (existsSync(appTs)) {
      try {
        const buildRes = await Bun.build({
          entrypoints: [appTs],
          outdir: sPath,
          target: 'browser',
          minify: true,
        });
        if (!buildRes.success) {
          console.warn('::warning:: Bun build error compiling app.ts:', buildRes.logs);
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`::warning:: Failed to bundle app.ts with Bun: ${msg}`);
      }
    }

    // Ensure site/install is a concrete file, never a dangling symlink
    const siteInstall = join(sPath, 'install');
    try {
      const lstat = lstatSync(siteInstall);
      if (lstat.isSymbolicLink()) {
        const linkTarget = readlinkSync(siteInstall);
        const resolvedTarget = resolve(dirname(siteInstall), linkTarget);
        rmSync(siteInstall, { force: true });
        if (existsSync(resolvedTarget)) {
          copyFileSync(resolvedTarget, siteInstall);
        }
      }
    } catch {}

    const repoexeInstall = join(repoRoot, 'pkg', 'repoexe', 'install');
    if (existsSync(repoexeInstall)) {
      rmSync(siteInstall, { force: true });
      copyFileSync(repoexeInstall, siteInstall);
    }

    const gpgKeyPath = join(repoRoot, 'scripts', 'repoexe.gpg');
    if (existsSync(gpgKeyPath)) {
      copyFileSync(gpgKeyPath, join(sPath, 'repoexe.gpg'));
    }

    writeFileSync(join(sPath, '.nojekyll'), '', 'utf-8');
    console.log(`✓ Complete RepoExe site environment successfully generated at ${sPath}`);
  } finally {
    if (runRetainedDir && existsSync(runRetainedDir)) {
      rmSync(runRetainedDir, { recursive: true, force: true });
    }
    if (autoStagingDir && existsSync(autoStagingDir)) {
      rmSync(autoStagingDir, { recursive: true, force: true });
    }
  }
}

if (import.meta.main) {
  prepareSite();
}
