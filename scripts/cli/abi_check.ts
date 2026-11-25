import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { type DependencyClause, filterDepsForArch, normalizeArch, parseDependencyList } from '../core/dependencies.ts';
import { loadTermuxIndex } from '../core/fetcher.ts';
import { parseRecipe } from '../core/parser.ts';
import type { PackageRecipe } from '../core/types.ts';
import { compareDebianVersions } from '../core/version.ts';

export interface AbiRevbumpCandidate {
  name: string;
  oldRevision: number;
  newRevision: number;
  heavy: boolean;
  arch: string;
  missingSonames: string[];
  changedDeps: string[];
}

export interface TermuxPackageRecord {
  name: string;
  version: string;
  baseUrl: string;
  filename: string;
}

interface ReleaseAbiMetadata {
  needed_sonames?: Record<string, string[]>;
  dep_versions?: Record<string, Record<string, string>>;
}

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'RepoExe' };
  const token = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function getBestTermuxEntry(entries: Record<string, string>[] | undefined): Record<string, string> | null {
  if (!entries || entries.length === 0) {
    return null;
  }
  let best: Record<string, string> | null = null;
  for (const entry of entries) {
    if (!entry.Version || !entry.Filename) {
      continue;
    }
    if (!best || compareDebianVersions(entry.Version, best.Version) > 0) {
      best = entry;
    }
  }
  return best;
}

export function detectChangedDeps(
  recordedDepVersions: Record<string, string>,
  termuxIndex: Record<string, Record<string, string>[]>,
): Array<{ name: string; oldVersion: string; newVersion: string }> {
  const changed: Array<{ name: string; oldVersion: string; newVersion: string }> = [];
  for (const [depName, oldVer] of Object.entries(recordedDepVersions)) {
    const best = getBestTermuxEntry(termuxIndex[depName]);
    if (!best?.Version) {
      continue;
    }
    if (compareDebianVersions(best.Version, oldVer) !== 0) {
      changed.push({ name: depName, oldVersion: oldVer, newVersion: best.Version });
    }
  }
  return changed.sort((a, b) => a.name.localeCompare(b.name));
}

export function collectTermuxClosure(
  rootDeps: string[] | DependencyClause[],
  termuxIndex: Record<string, Record<string, string>[]>,
  internalPkgNames: Set<string>,
): TermuxPackageRecord[] {
  const visited = new Set<string>();
  const result: TermuxPackageRecord[] = [];
  const queue: string[] = [];

  const clauses =
    rootDeps.length > 0 && typeof rootDeps[0] === 'string'
      ? parseDependencyList(rootDeps as string[])
      : (rootDeps as DependencyClause[]);

  for (const group of clauses) {
    for (const token of group) {
      if (token.name && !internalPkgNames.has(token.name) && !visited.has(token.name)) {
        queue.push(token.name);
      }
    }
  }

  while (queue.length > 0) {
    const name = queue.shift()!;
    if (visited.has(name) || internalPkgNames.has(name)) {
      continue;
    }
    visited.add(name);

    const best = getBestTermuxEntry(termuxIndex[name]);
    if (!best?.Version || !best.Filename || !best.BaseUrl) {
      continue;
    }
    result.push({
      name,
      version: best.Version,
      baseUrl: best.BaseUrl,
      filename: best.Filename,
    });

    if (best.Depends) {
      for (const group of parseDependencyList([best.Depends])) {
        for (const token of group) {
          if (token.name && !internalPkgNames.has(token.name) && !visited.has(token.name)) {
            queue.push(token.name);
          }
        }
      }
    }
  }

  return result;
}

export function extractSonamesFromDebListOutput(output: string): string[] {
  const sonames = new Set<string>();
  for (const rawLine of output.split('\n')) {
    const line = rawLine.trim();
    if (!line) {
      continue;
    }
    // Supports both `dpkg-deb -c` lines (with optional `-> target`) and plain `tar -tf` lines.
    const tokens = line.split(/\s+/);
    const arrowIdx = tokens.indexOf('->');
    const pathToken = arrowIdx > 0 ? tokens[arrowIdx - 1] : tokens[tokens.length - 1];
    if (!pathToken || !pathToken.includes('/lib/')) {
      continue;
    }
    const base = basename(pathToken);
    if (base.endsWith('.so') || /\.so\.[0-9]+/.test(base)) {
      sonames.add(base);
    }
  }
  return Array.from(sonames).sort();
}

export function findBrokenSonames(neededSonames: string[], providedSonames: Set<string>): string[] {
  return neededSonames.filter((s) => !providedSonames.has(s)).sort();
}

async function fetchReleaseAbiMetadata(pkgName: string): Promise<ReleaseAbiMetadata | null> {
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const url = `https://api.github.com/repos/${repoSlug}/releases/tags/${pkgName}`;
  try {
    const resp = await fetch(url, { headers: getGitHubHeaders(), signal: AbortSignal.timeout(8_000) });
    if (!resp.ok) {
      return null;
    }
    const data = (await resp.json()) as { body?: string };
    if (!data.body) {
      return null;
    }
    const parsed = JSON.parse(data.body) as ReleaseAbiMetadata;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function loadSonameDiskCache(arch: string): Record<string, string[]> {
  const cachePath = join(process.env.TMPDIR || tmpdir(), `abi_soname_cache_${arch}.json`);
  if (!existsSync(cachePath)) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(cachePath, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, string[]>) : {};
  } catch {
    return {};
  }
}

function saveSonameDiskCache(arch: string, cache: Record<string, string[]>): void {
  const cachePath = join(process.env.TMPDIR || tmpdir(), `abi_soname_cache_${arch}.json`);
  try {
    writeFileSync(cachePath, JSON.stringify(cache), 'utf-8');
  } catch {}
}

async function inspectTermuxDebSonames(
  pkg: TermuxPackageRecord,
  arch: string,
  cache: Record<string, string[]>,
): Promise<string[] | null> {
  const cacheKey = `${pkg.name}@${pkg.version}`;
  if (Array.isArray(cache[cacheKey])) {
    return cache[cacheKey];
  }

  const url = `${pkg.baseUrl.replace(/\/+$/, '')}/${pkg.filename.replace(/^\/+/, '')}`;
  const workDir = join(process.env.TMPDIR || tmpdir(), `abi_deb_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  mkdirSync(workDir, { recursive: true });
  const debPath = join(workDir, `${pkg.name}.deb`);

  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!resp.ok) {
      return null;
    }
    await Bun.write(debPath, await resp.arrayBuffer());

    let res = Bun.spawnSync(['dpkg-deb', '-c', debPath], { stdout: 'pipe', stderr: 'pipe' });
    if (res.exitCode !== 0) {
      res = Bun.spawnSync(['bsdtar', '-tf', debPath], { stdout: 'pipe', stderr: 'pipe' });
    }
    if (res.exitCode !== 0) {
      return null;
    }
    const sonames = extractSonamesFromDebListOutput(res.stdout.toString());
    cache[cacheKey] = sonames;
    saveSonameDiskCache(arch, cache);
    return sonames;
  } catch {
    return null;
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
}

export async function runAbiCheck(jsonOutput: boolean = false): Promise<AbiRevbumpCandidate[]> {
  const pkgRoot = resolve('pkg');
  if (!existsSync(pkgRoot)) {
    return [];
  }

  const recipes: PackageRecipe[] = [];
  const internalPkgNames = new Set<string>();
  for (const dir of readdirSync(pkgRoot).sort()) {
    const recipePath = join(pkgRoot, dir, 'recipe.ts');
    if (!existsSync(recipePath)) {
      continue;
    }
    try {
      const r = parseRecipe(recipePath);
      recipes.push(r);
      internalPkgNames.add(r.name);
    } catch {}
  }

  const releaseMetaMap = new Map<string, ReleaseAbiMetadata>();
  const CONCURRENCY = 12;
  for (let i = 0; i < recipes.length; i += CONCURRENCY) {
    const batch = recipes.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (r) => ({ name: r.name, meta: await fetchReleaseAbiMetadata(r.name) })),
    );
    for (const item of results) {
      if (item.meta?.needed_sonames && item.meta?.dep_versions) {
        releaseMetaMap.set(item.name, item.meta);
      }
    }
  }

  if (!jsonOutput) {
    console.log(`Checking ABI SONAMEs for ${releaseMetaMap.size}/${recipes.length} tracked packages...`);
  }

  const indexCache = new Map<string, Record<string, Record<string, string>[]>>();
  const sonameCaches = new Map<string, Record<string, string[]>>();
  const candidates: AbiRevbumpCandidate[] = [];

  for (const recipe of recipes) {
    const meta = releaseMetaMap.get(recipe.name);
    if (!meta?.needed_sonames || !meta?.dep_versions || !recipe.deps?.length) {
      continue;
    }

    const archEntries = Object.entries(meta.needed_sonames);
    for (const [rawArch, neededList] of archEntries) {
      if (!Array.isArray(neededList) || neededList.length === 0) {
        continue;
      }
      const recordedDeps = meta.dep_versions[rawArch];
      if (!recordedDeps || Object.keys(recordedDeps).length === 0) {
        continue;
      }

      const checkArch = rawArch === 'all' ? 'aarch64' : normalizeArch(rawArch);
      if (!indexCache.has(checkArch)) {
        indexCache.set(checkArch, await loadTermuxIndex(checkArch));
      }
      const termuxIndex = indexCache.get(checkArch)!;

      // Fast-path: skip immediately when none of this package's recorded deps changed in Termux
      const changedDeps = detectChangedDeps(recordedDeps, termuxIndex);
      if (changedDeps.length === 0) {
        continue;
      }

      if (!sonameCaches.has(checkArch)) {
        sonameCaches.set(checkArch, loadSonameDiskCache(checkArch));
      }
      const debCache = sonameCaches.get(checkArch)!;

      const archDeps = filterDepsForArch(parseDependencyList(recipe.deps), checkArch);
      const closure = collectTermuxClosure(archDeps, termuxIndex, internalPkgNames);
      const providedSonames = new Set<string>();
      let inspectionComplete = true;

      for (const depPkg of closure) {
        const sonames = await inspectTermuxDebSonames(depPkg, checkArch, debCache);
        if (!sonames) {
          inspectionComplete = false;
          break;
        }
        for (const s of sonames) {
          providedSonames.add(s);
        }
      }

      // Fail-safe: never trigger false revbumps if a Termux .deb download/inspection failed transiently
      if (!inspectionComplete) {
        continue;
      }

      const missingSonames = findBrokenSonames(neededList, providedSonames);
      if (missingSonames.length > 0) {
        const oldRevision = Number(recipe.revision ?? 0);
        candidates.push({
          name: recipe.name,
          oldRevision,
          newRevision: oldRevision + 1,
          heavy: Boolean(recipe.heavy_build || (recipe.resources?.swap ?? 0) > 0 || (recipe.resources?.zram ?? 0) > 0),
          arch: checkArch,
          missingSonames,
          changedDeps: changedDeps.map((d) => `${d.name}: ${d.oldVersion} -> ${d.newVersion}`),
        });
        break;
      }
    }
  }

  return candidates;
}

if (import.meta.main) {
  const jsonOutput = process.argv.includes('--json');
  const results = await runAbiCheck(jsonOutput);
  if (jsonOutput) {
    console.log(JSON.stringify(results, null, 2));
  } else if (results.length === 0) {
    console.log('✓ No ABI/SONAME breakages detected.');
  } else {
    for (const r of results) {
      console.log(
        `! ${r.name} (rev ${r.oldRevision} -> ${r.newRevision}) [${r.arch}]: missing ${r.missingSonames.join(', ')} (deps: ${r.changedDeps.join(', ')})`,
      );
    }
  }
}
