import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ARCH_MAP } from '../builders/debian.ts';
import { extractAllPackageNames, normalizeArch, parseDependencyList } from '../core/dependencies.ts';
import { checkExistingReleaseHash } from '../core/fetcher.ts';
import { computeStateHash, parseRecipe } from '../core/parser.ts';
import { getSubpackageNames } from '../core/subpkg.ts';
import type { PackageRecipe } from '../core/types.ts';
import { formatDebianFilenameVersion } from '../core/version.ts';
import { DependencyGraph } from '../utils/dag.ts';

export function getGitDiffFiles(repoRoot: string): Set<string> {
  const baseRef = (process.env.GITHUB_BASE_REF || '').trim();
  const eventBefore = (process.env.GITHUB_EVENT_BEFORE || '').trim();

  let diffCmd: string[];
  if (baseRef) {
    diffCmd = ['diff', '--name-only', `origin/${baseRef}...HEAD`];
  } else if (eventBefore && eventBefore !== '0000000000000000000000000000000000000000') {
    const verifyBefore = spawnSync('git', ['rev-parse', '--verify', eventBefore], { cwd: repoRoot });
    if (verifyBefore.status === 0) {
      diffCmd = ['diff', '--name-only', `${eventBefore}..HEAD`];
    } else {
      diffCmd = ['diff', '--name-only', 'HEAD~1', 'HEAD'];
    }
  } else {
    diffCmd = ['diff', '--name-only', 'HEAD~1', 'HEAD'];
  }

  let res = spawnSync('git', diffCmd, { cwd: repoRoot, encoding: 'utf-8' });
  if (res.status !== 0 || !res.stdout?.trim()) {
    res = spawnSync('git', ['diff', '--name-only', 'HEAD'], { cwd: repoRoot, encoding: 'utf-8' });
  }

  if (res.status === 0 && res.stdout?.trim()) {
    return new Set(
      res.stdout
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean),
    );
  }
  return new Set();
}

export function getChangedPackages(repoRoot: string, dag?: DependencyGraph): Set<string> {
  const files = getGitDiffFiles(repoRoot);
  const changed = new Set<string>();

  for (const f of files) {
    const parts = f.split('/');
    if (parts.length >= 2 && parts[0] === 'pkg') {
      changed.add(parts[1]);
    }
  }

  if (dag) {
    const builderFormatMap: Record<string, string> = {
      'debian.ts': 'apt',
    };

    for (const f of files) {
      const parts = f.split('/');
      if (parts.length >= 3 && parts[0] === 'scripts' && parts[1] === 'builders') {
        const targetFmt = builderFormatMap[parts[2]];
        if (targetFmt) {
          for (const [pkgName, recipe] of Object.entries(dag.recipes)) {
            if (recipe.formats.includes(targetFmt)) {
              changed.add(pkgName);
            }
          }
        }
      }
    }

    // Include transitive downstream dependents so updating a dependency triggers rebuild & testing
    const directChanged = Array.from(changed);
    for (const p of directChanged) {
      for (const dep of dag.getDependents(p)) {
        changed.add(dep);
      }
    }
  }

  return changed;
}

export function parseTargetTokens(rawInput: string, dag: DependencyGraph, _pkgsDir?: string): string[] {
  const allPkgs = new Set(Object.keys(dag.recipes));
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean);

  const selectedPkgs = new Set<string>();
  const excludedPkgs = new Set<string>();

  let hasPositiveSelection = false;

  for (let token of tokens) {
    const isExclude = token.startsWith('!');
    if (isExclude) {
      token = token.slice(1);
    }

    const targetPart = token;

    const matchedPkgs = new Set<string>();
    if (targetPart.startsWith('type:') || targetPart.startsWith('format:')) {
      const targetFmt = targetPart.split(':')[1];
      for (const [p, r] of Object.entries(dag.recipes)) {
        if (r.formats.includes(targetFmt)) {
          matchedPkgs.add(p);
        }
      }
    } else if (targetPart === 'all') {
      for (const p of allPkgs) {
        matchedPkgs.add(p);
      }
    } else if (allPkgs.has(targetPart)) {
      matchedPkgs.add(targetPart);
    }

    if (isExclude) {
      for (const p of matchedPkgs) {
        excludedPkgs.add(p);
      }
    } else {
      hasPositiveSelection = true;
      for (const p of matchedPkgs) {
        selectedPkgs.add(p);
      }
    }
  }

  if (!hasPositiveSelection) {
    for (const p of allPkgs) {
      selectedPkgs.add(p);
    }
  }

  const finalRequested: string[] = [];
  for (const p of selectedPkgs) {
    if (!excludedPkgs.has(p)) {
      finalRequested.push(p);
    }
  }

  return finalRequested;
}

export interface MatrixShard {
  name: string;
  package: string;
  packages: string;
  arch: string;
  heavy: boolean;
  cache: boolean;
  build_system: string;
  zram: number;
  swap: number;
  free_space: boolean;
  tmpfs: number;
  force: boolean;
  is_indep?: boolean;
}

export async function buildMatrixLayer(
  pkgsList: string[],
  pkgsDir: string,
  dag: DependencyGraph,
  isExplicitTarget: boolean = false,
  maxConcurrency: number = 20,
  historicalDurations?: Map<string, Record<string, number>>,
): Promise<Array<MatrixShard>> {
  const forceRebuild = ['true', '1'].includes((process.env.FORCE_REBUILD || '').toLowerCase()) || isExplicitTarget;

  interface Candidate {
    pkg: string;
    targetArch: string;
    checkArch: string;
    isArchAll: boolean;
    heavy: boolean;
    cache: boolean;
    buildSystem: string;
    zram: number;
    swap: number;
    freeSpace: boolean;
    tmpfs: number;
    force: boolean;
    priority: number;
    estimatedDurationSec: number;
  }

  if (pkgsList.length === 0) {
    return [];
  }

  // Register any on-disk recipes present in pkgsList into dag so they receive dependency ordering
  for (const p of pkgsList) {
    if (!dag.recipes[p]) {
      const recipePath = join(pkgsDir, p, 'recipe.ts');
      if (existsSync(recipePath)) {
        try {
          const r = parseRecipe(recipePath);
          dag.registerRecipe(r);
        } catch {
          // ignore unparseable recipes here; handled in loop below
        }
      }
    }
  }

  const registeredPkgs = pkgsList.filter((p) => Boolean(dag.recipes[p]));

  const observedSamples: number[] = [];
  if (historicalDurations) {
    for (const archMap of historicalDurations.values()) {
      for (const dur of Object.values(archMap)) {
        if (typeof dur === 'number' && Number.isFinite(dur) && dur > 0) {
          observedSamples.push(dur);
        }
      }
    }
  }
  observedSamples.sort((a, b) => a - b);
  const medianObservedSec = observedSamples.length > 0 ? observedSamples[Math.floor(observedSamples.length / 2)] : 60;
  const dynamicHeavyThresholdSec = observedSamples.length > 0 ? Math.max(1800, medianObservedSec * 3) : Infinity;

  const candidates: Candidate[] = [];
  const archOrderCache = new Map<string, Map<string, number>>();
  const getOrderForArch = (arch: string): Map<string, number> => {
    if (!archOrderCache.has(arch)) {
      const order = registeredPkgs.length > 0 ? dag.resolveBuildOrder(registeredPkgs, arch) : [];
      const m = new Map<string, number>();
      order.forEach((name, idx) => m.set(name, idx));
      archOrderCache.set(arch, m);
    }
    return archOrderCache.get(arch)!;
  };

  for (const p of pkgsList) {
    const recipePath = join(pkgsDir, p, 'recipe.ts');
    if (!dag.recipes[p] && !existsSync(recipePath)) {
      continue;
    }

    try {
      const r = dag.recipes[p] || parseRecipe(recipePath);
      const isArchAll = r.arch === 'all' || (Array.isArray(r.arches) && r.arches.length === 1 && r.arches[0] === 'all');
      const concreteArches = (r.arches || [r.arch || 'aarch64']).filter((a) => a !== 'all');
      const targetArches = isArchAll ? ['aarch64'] : concreteArches.length > 0 ? concreteArches : ['aarch64'];

      let maxZram = Number(r.resources?.zram ?? 0);
      let maxSwap = Number(r.resources?.swap ?? 0);
      let maxFreeSpace = Boolean(r.resources?.free_space ?? false);
      let maxTmpfs = Math.min(6, Number(r.resources?.tmpfs ?? 4));

      const buildDepClauses = parseDependencyList(r.build_deps || []);
      const cleanBuildDeps = extractAllPackageNames(buildDepClauses);
      for (const depName of cleanBuildDeps) {
        const depRecipePath = join(pkgsDir, depName, 'recipe.ts');
        if (existsSync(depRecipePath)) {
          const dr = dag.recipes[depName] || parseRecipe(depRecipePath);
          maxZram = Math.max(maxZram, Number(dr.resources.zram ?? 0));
          maxSwap = Math.max(maxSwap, Number(dr.resources.swap ?? 0));
          maxFreeSpace = maxFreeSpace || Boolean(dr.resources.free_space ?? false);
          maxTmpfs = Math.max(maxTmpfs, Math.min(6, Number(dr.resources.tmpfs ?? 4)));
        }
      }

      for (const targetArch of targetArches) {
        const checkArch = isArchAll ? 'all' : targetArch;
        let stateHash = r.state_hash || '';
        if (!isArchAll) {
          const recipeDir = existsSync(join(pkgsDir, p)) ? join(pkgsDir, p) : undefined;
          const shardRecipe: PackageRecipe = {
            ...r,
            arch: targetArch,
          };
          stateHash = computeStateHash(shardRecipe, recipeDir);
        }
        if (!forceRebuild && stateHash && (await checkExistingReleaseHash(p, stateHash, checkArch, r))) {
          console.error(`Notice: Skipping matrix shard for ${p} [${checkArch}] (state_hash unchanged).`);
          continue;
        }

        const pkgTimings = historicalDurations?.get(p);
        const estimatedDurationSec =
          pkgTimings?.[checkArch] ?? pkgTimings?.[targetArch] ?? pkgTimings?.all ?? medianObservedSec;
        const isDynamicHeavy = estimatedDurationSec > dynamicHeavyThresholdSec;

        candidates.push({
          pkg: p,
          targetArch,
          checkArch,
          isArchAll,
          heavy: Boolean(r.heavy_build || maxSwap > 0 || maxZram > 0 || isDynamicHeavy),
          cache: Boolean(r.cache),
          buildSystem: r.build_system || 'custom',
          zram: maxZram,
          swap: maxSwap,
          freeSpace: maxFreeSpace,
          tmpfs: maxTmpfs,
          force: forceRebuild,
          priority: getOrderForArch(targetArch).get(p) ?? 999,
          estimatedDurationSec,
        });
      }
    } catch (err: any) {
      console.error(`Notice: Failed to build matrix layer for ${p}: ${err.message}`);
    }
  }

  const heavyCandidates = candidates.filter((c) => c.heavy);
  const lightCandidates = candidates.filter((c) => !c.heavy);

  const shards: MatrixShard[] = [];
  for (const h of heavyCandidates) {
    shards.push({
      name: `${h.pkg}:${h.checkArch}`,
      package: h.pkg,
      packages: h.pkg,
      arch: h.targetArch,
      heavy: true,
      cache: h.cache,
      build_system: h.buildSystem,
      zram: h.zram,
      swap: h.swap,
      free_space: h.freeSpace,
      tmpfs: h.tmpfs,
      force: h.force,
      is_indep: h.isArchAll,
    });
  }

  const lightGroups = new Map<string, Candidate[]>();
  for (const c of lightCandidates) {
    const key = `${c.targetArch}:${c.isArchAll ? 'all' : 'arch'}`;
    const grp = lightGroups.get(key) || [];
    grp.push(c);
    lightGroups.set(key, grp);
  }

  const remainingSlots = Math.max(lightGroups.size || 1, maxConcurrency - shards.length);
  const groupKeys = Array.from(lightGroups.keys());
  const groupTotalDuration = new Map<string, number>();
  let totalLightDuration = 0;
  for (const key of groupKeys) {
    const dur = lightGroups.get(key)!.reduce((sum, c) => sum + c.estimatedDurationSec, 0);
    groupTotalDuration.set(key, dur);
    totalLightDuration += dur;
  }

  // Allocate available concurrency slots proportionally to each group's estimated build duration
  const groupSlotAlloc = new Map<string, number>();
  let allocatedSlots = 0;
  for (const key of groupKeys) {
    groupSlotAlloc.set(key, 1);
    allocatedSlots++;
  }
  const extraSlots = Math.max(0, remainingSlots - allocatedSlots);
  if (extraSlots > 0 && totalLightDuration > 0) {
    const remainders: Array<{ key: string; rem: number }> = [];
    let assignedExtra = 0;
    for (const key of groupKeys) {
      const grp = lightGroups.get(key)!;
      const idealTotal = (groupTotalDuration.get(key)! / totalLightDuration) * remainingSlots;
      const desiredExtra = Math.max(0, Math.min(grp.length - 1, Math.floor(idealTotal) - 1));
      groupSlotAlloc.set(key, 1 + desiredExtra);
      assignedExtra += desiredExtra;
      remainders.push({ key, rem: idealTotal - Math.floor(idealTotal) });
    }
    remainders.sort((a, b) => b.rem - a.rem);
    let left = extraSlots - assignedExtra;
    for (const { key } of remainders) {
      if (left <= 0) {
        break;
      }
      const cur = groupSlotAlloc.get(key)!;
      const grpLen = lightGroups.get(key)!.length;
      if (cur < grpLen) {
        groupSlotAlloc.set(key, cur + 1);
        left--;
      }
    }
  }

  for (const [key, group] of lightGroups) {
    const slots = Math.min(group.length, groupSlotAlloc.get(key) ?? 1);
    const pkgSetInGroup = new Set(group.map((c) => c.pkg));
    const hasInternalDeps = group.some((c) => {
      const dependents = dag.getDependents(c.pkg);
      for (const d of dependents) {
        if (d !== c.pkg && pkgSetInGroup.has(d)) {
          return true;
        }
      }
      return false;
    });

    let batches: Candidate[][];
    if (slots <= 1) {
      group.sort((a, b) => a.priority - b.priority);
      batches = [group];
    } else if (hasInternalDeps) {
      // Preserve topological order across balanced duration chunks when intra-group dependencies exist
      group.sort((a, b) => a.priority - b.priority);
      const targetChunkDur = (groupTotalDuration.get(key) || 1) / slots;
      batches = [];
      let currentBatch: Candidate[] = [];
      let currentDur = 0;
      for (let i = 0; i < group.length; i++) {
        const cand = group[i];
        const remainingItems = group.length - i;
        const remainingBuckets = slots - batches.length;
        if (
          currentBatch.length > 0 &&
          remainingBuckets > 1 &&
          currentDur + cand.estimatedDurationSec > targetChunkDur &&
          remainingItems >= remainingBuckets
        ) {
          batches.push(currentBatch);
          currentBatch = [];
          currentDur = 0;
        }
        currentBatch.push(cand);
        currentDur += cand.estimatedDurationSec;
      }
      if (currentBatch.length > 0) {
        batches.push(currentBatch);
      }
    } else {
      // Longest Processing Time First (LPT) bin-packing for independent packages
      const sorted = [...group].sort((a, b) => b.estimatedDurationSec - a.estimatedDurationSec);
      const bins: Array<{ items: Candidate[]; totalDur: number }> = Array.from({ length: slots }, () => ({
        items: [],
        totalDur: 0,
      }));
      for (const cand of sorted) {
        bins.sort((a, b) => a.totalDur - b.totalDur);
        bins[0].items.push(cand);
        bins[0].totalDur += cand.estimatedDurationSec;
      }
      batches = bins
        .map((b) => b.items)
        .filter((b) => b.length > 0)
        .map((b) => b.sort((x, y) => x.priority - y.priority));
    }

    for (const batch of batches) {
      const pkgs = batch.map((b) => b.pkg);
      const first = batch[0];
      const displayName =
        pkgs.length === 1 ? `${first.pkg}:${first.checkArch}` : `${first.pkg}+${pkgs.length - 1}:${first.checkArch}`;

      shards.push({
        name: displayName,
        package: first.pkg,
        packages: pkgs.join(' '),
        arch: first.targetArch,
        heavy: false,
        cache: batch.some((b) => b.cache),
        build_system: batch.every((b) => b.buildSystem === first.buildSystem) ? first.buildSystem : 'custom',
        zram: Math.max(...batch.map((b) => b.zram)),
        swap: Math.max(...batch.map((b) => b.swap)),
        free_space: batch.some((b) => b.freeSpace),
        tmpfs: Math.max(...batch.map((b) => b.tmpfs)),
        force: batch.some((b) => b.force),
        is_indep: first.isArchAll,
      });
    }
  }

  return shards;
}

export async function getMissingReleasePackages(
  dag: DependencyGraph,
  repoSlug?: string,
  timingsOut?: Map<string, Record<string, number>>,
): Promise<string[]> {
  const slug = repoSlug || process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { 'User-Agent': 'RepoExe-Matrix-Generator' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  try {
    const releaseDebMap = new Map<string, Set<string>>();
    const partialReleases = new Set<string>();
    let page = 1;
    let hasMore = true;

    while (hasMore) {
      const apiUrl = `https://api.github.com/repos/${slug}/releases?per_page=100&page=${page}`;
      const resp = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(5000) });
      if (!resp.ok) {
        break;
      }
      const releases = (await resp.json()) as Array<{
        tag_name?: string;
        body?: string;
        assets?: Array<{ name: string; state?: string }>;
      }>;
      if (!Array.isArray(releases) || releases.length === 0) {
        break;
      }

      for (const rel of releases) {
        const tag = rel.tag_name || '';
        const debSet = releaseDebMap.get(tag) || new Set<string>();
        if (Array.isArray(rel.assets)) {
          for (const a of rel.assets) {
            if (typeof a?.name === 'string' && a.name.endsWith('.deb') && (!a.state || a.state === 'uploaded')) {
              debSet.add(a.name);
            }
          }
        }
        if (typeof rel.body === 'string' && rel.body.trim()) {
          try {
            const parsedBody = JSON.parse(rel.body);
            if (parsedBody && typeof parsedBody === 'object') {
              if (parsedBody.partial === true) {
                partialReleases.add(tag);
              }
              if (timingsOut && parsedBody.build_durations && typeof parsedBody.build_durations === 'object') {
                const durMap: Record<string, number> = {};
                for (const [k, v] of Object.entries(parsedBody.build_durations as Record<string, unknown>)) {
                  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
                    durMap[k] = v;
                  }
                }
                if (Object.keys(durMap).length > 0) {
                  timingsOut.set(tag, durMap);
                }
              }
            }
          } catch {}
        }
        releaseDebMap.set(tag, debSet);
      }

      if (releases.length < 100) {
        hasMore = false;
      } else {
        page++;
      }
    }

    const hasArchMatch = (debsList: string[], reqArch: string, expectedVer?: string, pkgPrefix?: string): boolean => {
      if (expectedVer && pkgPrefix) {
        if (reqArch === 'all') {
          return debsList.includes(`${pkgPrefix}_${expectedVer}_all.deb`);
        }
        const norm = ARCH_MAP[reqArch] || normalizeArch(reqArch);
        return (
          debsList.includes(`${pkgPrefix}_${expectedVer}_${norm}.deb`) ||
          (norm === 'aarch64' && debsList.includes(`${pkgPrefix}_${expectedVer}_arm64.deb`))
        );
      }
      if (reqArch === 'all') {
        return debsList.some((d) => d.endsWith('_all.deb'));
      }
      const norm = ARCH_MAP[reqArch] || normalizeArch(reqArch);
      return debsList.some((d) => d.endsWith(`_${norm}.deb`) || (norm === 'aarch64' && d.endsWith('_arm64.deb')));
    };

    const missing: string[] = [];
    for (const [pkgName, recipe] of Object.entries(dag.recipes)) {
      const debs = releaseDebMap.get(pkgName);
      if (!debs || debs.size === 0 || partialReleases.has(pkgName)) {
        missing.push(pkgName);
        continue;
      }

      const isArchAll =
        recipe.arch === 'all' ||
        (Array.isArray(recipe.arches) && recipe.arches.length === 1 && recipe.arches[0] === 'all');
      const concreteArches = (recipe.arches || [recipe.arch || 'aarch64'])
        .filter((a) => a !== 'all')
        .map(normalizeArch);
      const requiredArches = isArchAll ? ['all'] : concreteArches.length > 0 ? concreteArches : ['aarch64'];
      const debArray = Array.from(debs);
      const parentDebs = debArray.filter((d) => d.startsWith(`${pkgName}_`));
      const expectedVer = formatDebianFilenameVersion(recipe);

      const hasAnyCurrentParent = requiredArches.some((reqArch) =>
        hasArchMatch(parentDebs, reqArch, expectedVer, pkgName),
      );
      const isMissingParentArch = requiredArches.some(
        (reqArch) =>
          !hasArchMatch(parentDebs, reqArch) ||
          (hasAnyCurrentParent && !hasArchMatch(parentDebs, reqArch, expectedVer, pkgName)),
      );
      if (isMissingParentArch) {
        missing.push(pkgName);
        continue;
      }

      // Check each declared child archive for its required arch (for 'all' children, check only designated producer)
      let isMissingChild = false;
      if (recipe.subpackages && typeof recipe.subpackages === 'object') {
        const designatedProducer =
          isArchAll || concreteArches.length === 0
            ? 'all'
            : concreteArches.includes('aarch64')
              ? 'aarch64'
              : concreteArches[0];
        const subNames = getSubpackageNames(recipe);
        const subEntries = Object.entries(recipe.subpackages);
        for (let idx = 0; idx < subEntries.length; idx++) {
          const [, subDef] = subEntries[idx];
          const subName = subNames[idx];
          if (!subDef || !subName) {
            continue;
          }
          const childDebs = debArray.filter((d) => d.startsWith(`${subName}_`));
          const isAutoDoc = (subDef as unknown) === 'auto:doc';
          const rawSubArch = isAutoDoc
            ? 'all'
            : typeof subDef === 'object' && subDef.arch
              ? subDef.arch
              : isArchAll
                ? 'all'
                : undefined;

          if (rawSubArch === 'all') {
            const childProducerArch =
              typeof subDef === 'object' && subDef.producer_arch
                ? normalizeArch(subDef.producer_arch)
                : designatedProducer;
            if (!hasArchMatch(childDebs, 'all')) {
              isMissingChild = true;
              break;
            }
            if (
              (hasAnyCurrentParent || hasArchMatch(parentDebs, childProducerArch, expectedVer, pkgName)) &&
              !hasArchMatch(childDebs, 'all', expectedVer, subName)
            ) {
              isMissingChild = true;
              break;
            }
          } else {
            const childReqArches = rawSubArch ? [normalizeArch(rawSubArch)] : requiredArches;
            for (const cArch of childReqArches) {
              if (!hasArchMatch(childDebs, cArch)) {
                isMissingChild = true;
                break;
              }
              if (
                (hasAnyCurrentParent || hasArchMatch(parentDebs, cArch, expectedVer, pkgName)) &&
                !hasArchMatch(childDebs, cArch, expectedVer, subName)
              ) {
                isMissingChild = true;
                break;
              }
            }
            if (isMissingChild) {
              break;
            }
          }
        }
      }

      if (isMissingChild) {
        missing.push(pkgName);
      }
    }
    return missing;
  } catch {
    return [];
  }
}

async function main(): Promise<void> {
  const repoRoot = resolve('.');
  const pkgsDir = join(repoRoot, 'pkg');
  const cliArgs = process.argv.slice(2).join(' ').trim();
  const rawInput = (cliArgs || process.env.TARGET_INPUT || '').trim();

  const dag = new DependencyGraph(pkgsDir);

  let targetPkgs: string[];
  let isExplicit = false;

  const historicalDurations = new Map<string, Record<string, number>>();
  if (!rawInput || rawInput === 'auto') {
    const diffFiles = getGitDiffFiles(repoRoot);
    const changedPkgs = Array.from(getChangedPackages(repoRoot, dag));
    const missingPkgs = await getMissingReleasePackages(dag, undefined, historicalDurations);
    const candidatePkgs = new Set<string>([...changedPkgs, ...missingPkgs]);

    if (candidatePkgs.size > 0) {
      targetPkgs = parseTargetTokens(Array.from(candidatePkgs).join(' '), dag, pkgsDir);
    } else if (diffFiles.size > 0) {
      targetPkgs = [];
    } else {
      targetPkgs = parseTargetTokens('all', dag, pkgsDir);
    }
  } else {
    await getMissingReleasePackages(dag, undefined, historicalDurations);
    targetPkgs = parseTargetTokens(rawInput, dag, pkgsDir);
    if (rawInput !== 'all' && rawInput !== 'all@all') {
      isExplicit = true;
    }
  }

  const matrix = await buildMatrixLayer(targetPkgs, pkgsDir, dag, isExplicit, 20, historicalDurations);
  console.log(JSON.stringify({ matrix }));
}

if (import.meta.main) {
  main();
}
