import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { extractAllPackageNames, parseDependencyList } from '../core/dependencies.ts';
import { checkExistingReleaseHash } from '../core/fetcher.ts';
import { parseRecipe } from '../core/parser.ts';
import { DependencyGraph } from '../utils/dag.ts';

export function getGitDiffFiles(repoRoot: string): Set<string> {
  const baseRef = (process.env.GITHUB_BASE_REF || '').trim();
  const diffCmd = baseRef
    ? ['diff', '--name-only', `origin/${baseRef}...HEAD`]
    : ['diff', '--name-only', 'HEAD~1', 'HEAD'];

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
      const stateHash = r.state_hash || '';

      if (!forceRebuild && stateHash && (await checkExistingReleaseHash(p, stateHash))) {
        console.error(`Notice: Skipping matrix shard for ${p} (state_hash unchanged).`);
        continue;
      }

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

      matrix.push({
        package: p,
        heavy: r.heavy_build || maxSwap > 0 || maxZram > 0,
        cache: r.cache,
        build_system: r.build_system,
        zram: maxZram,
        swap: maxSwap,
        free_space: maxFreeSpace,
        tmpfs: maxTmpfs,
        force: forceRebuild,
      });
    } catch (err: any) {
      console.error(`Notice: Failed to build matrix layer for ${p}: ${err.message}`);
    }
  }

  return matrix;
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
    if (changedPkgs.length > 0) {
      targetPkgs = parseTargetTokens(changedPkgs.join(' '), dag, pkgsDir);
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
