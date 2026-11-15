import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ARCH_MAP } from '../builders/debian.ts';
import { extractAllPackageNames, parseDependencyList } from '../core/dependencies.ts';
import { checkExistingReleaseHash } from '../core/fetcher.ts';
import { parseRecipe } from '../core/parser.ts';
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
    if (isExclude) token = token.slice(1);

    const targetPart = token;

    const matchedPkgs = new Set<string>();
    if (targetPart.startsWith('type:') || targetPart.startsWith('format:')) {
      const targetFmt = targetPart.split(':')[1];
      for (const [p, r] of Object.entries(dag.recipes)) {
        if (r.formats.includes(targetFmt)) matchedPkgs.add(p);
      }
    } else if (targetPart === 'all') {
      for (const p of allPkgs) matchedPkgs.add(p);
    } else if (allPkgs.has(targetPart)) {
      matchedPkgs.add(targetPart);
    }

    if (isExclude) {
      for (const p of matchedPkgs) excludedPkgs.add(p);
    } else {
      hasPositiveSelection = true;
      for (const p of matchedPkgs) selectedPkgs.add(p);
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

export async function buildMatrixLayer(
  pkgsList: string[],
  pkgsDir: string,
  dag: DependencyGraph,
  isExplicitTarget: boolean = false,
): Promise<Array<Record<string, any>>> {
  const matrix: Array<Record<string, any>> = [];
  const forceRebuild = ['true', '1'].includes((process.env.FORCE_REBUILD || '').toLowerCase()) || isExplicitTarget;

  for (const p of pkgsList) {
    const recipePath = join(pkgsDir, p, 'recipe.ts');
    if (!existsSync(recipePath)) continue;

    try {
      const r = dag.recipes[p] || parseRecipe(recipePath);
      const targetArches = r.arches && r.arches.length > 0 ? r.arches : [r.arch || 'aarch64'];

      let maxZram = Number(r.resources.zram ?? 0);
      let maxSwap = Number(r.resources.swap ?? 0);
      let maxFreeSpace = Boolean(r.resources.free_space ?? false);
      let maxTmpfs = Math.min(6, Number(r.resources.tmpfs ?? 4));

      const buildDepClauses = parseDependencyList(r.build_deps);
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
        const stateHash = r.state_hash || '';
        if (!forceRebuild && stateHash && (await checkExistingReleaseHash(p, stateHash, targetArch))) {
          console.error(`Notice: Skipping matrix shard for ${p} [${targetArch}] (state_hash unchanged).`);
          continue;
        }

        matrix.push({
          package: p,
          arch: targetArch,
          heavy: r.heavy_build || maxSwap > 0 || maxZram > 0,
          cache: r.cache,
          build_system: r.build_system,
          zram: maxZram,
          swap: maxSwap,
          free_space: maxFreeSpace,
          tmpfs: maxTmpfs,
          force: forceRebuild,
        });
      }
    } catch (err: any) {
      console.error(`Notice: Failed to build matrix layer for ${p}: ${err.message}`);
    }
  }

  return matrix;
}

export async function getMissingReleasePackages(dag: DependencyGraph, repoSlug?: string): Promise<string[]> {
  const slug = repoSlug || process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const apiUrl = `https://api.github.com/repos/${slug}/releases?per_page=100`;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const headers: Record<string, string> = { 'User-Agent': 'RepoExe-Matrix-Generator' };
  if (token) headers.Authorization = `Bearer ${token}`;

  try {
    const resp = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return [];
    const releases = (await resp.json()) as Array<{
      tag_name?: string;
      assets?: Array<{ name: string }>;
    }>;
    if (!Array.isArray(releases)) return [];

    const releaseDebMap = new Map<string, Set<string>>();
    for (const rel of releases) {
      const tag = rel.tag_name || '';
      const debSet = new Set<string>();
      if (Array.isArray(rel.assets)) {
        for (const a of rel.assets) {
          if (typeof a?.name === 'string' && a.name.endsWith('.deb')) {
            debSet.add(a.name);
          }
        }
      }
      releaseDebMap.set(tag, debSet);
    }

    const missing: string[] = [];
    for (const [pkgName, recipe] of Object.entries(dag.recipes)) {
      const debs = releaseDebMap.get(pkgName);
      if (!debs || debs.size === 0) {
        missing.push(pkgName);
        continue;
      }

      const requiredArches = recipe.arches && recipe.arches.length > 0 ? recipe.arches : [recipe.arch || 'aarch64'];
      const isMissingArch = requiredArches.some((reqArch) => {
        if (reqArch === 'all') {
          return !Array.from(debs).some((d) => d.endsWith('_all.deb'));
        }
        const norm = ARCH_MAP[reqArch] || (reqArch === 'arm64' ? 'aarch64' : reqArch);
        return !Array.from(debs).some((d) => d.endsWith(`_${norm}.deb`) || d.endsWith('_all.deb'));
      });

      if (isMissingArch) {
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

  if (!rawInput || rawInput === 'auto') {
    const diffFiles = getGitDiffFiles(repoRoot);
    const changedPkgs = Array.from(getChangedPackages(repoRoot, dag));
    const missingPkgs = await getMissingReleasePackages(dag);
    const candidatePkgs = new Set<string>([...changedPkgs, ...missingPkgs]);

    if (candidatePkgs.size > 0) {
      targetPkgs = parseTargetTokens(Array.from(candidatePkgs).join(' '), dag, pkgsDir);
    } else if (diffFiles.size > 0) {
      targetPkgs = [];
    } else {
      targetPkgs = parseTargetTokens('all', dag, pkgsDir);
    }
  } else {
    targetPkgs = parseTargetTokens(rawInput, dag, pkgsDir);
    if (rawInput !== 'all' && rawInput !== 'all@all') {
      isExplicit = true;
    }
  }

  const matrix = await buildMatrixLayer(targetPkgs, pkgsDir, dag, isExplicit);
  console.log(JSON.stringify({ matrix }));
}

if (import.meta.main) {
  main();
}
