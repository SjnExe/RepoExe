import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { PREFIX } from '../utils/properties.ts';
import {
  filterDepsForArch,
  formatDebianDependency,
  parseDependencyList,
  type VersionConstraint,
} from './dependencies.ts';
import { satisfiesAllConstraints, satisfiesVersionConstraint } from './version.ts';

export { satisfiesAllConstraints, satisfiesVersionConstraint };

export function getTermuxRepos(arch: string = 'aarch64'): Array<[string, string]> {
  const normArch = arch === 'arm64' ? 'aarch64' : (arch || 'aarch64').toLowerCase();
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';
  return [
    ['https://packages-cf.termux.dev/apt/termux-main', `dists/stable/main/binary-${repoArch}/Packages`],
    ['https://packages-cf.termux.dev/apt/termux-x11', `dists/x11/main/binary-${repoArch}/Packages`],
    ['https://packages-cf.termux.dev/apt/termux-root', `dists/root/stable/binary-${repoArch}/Packages`],
  ];
}

export const TERMUX_REPOS: Array<[string, string]> = getTermuxRepos('aarch64');

export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const _PKG_INDICES: Record<string, Record<string, Record<string, string>[]>> = {};

function getAuthHeaders(headers?: Record<string, string>): Record<string, string> {
  const res: Record<string, string> = { 'User-Agent': USER_AGENT, ...headers };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token && !res.Authorization) {
    res.Authorization = `Bearer ${token}`;
  }
  return res;
}

export async function checkExistingReleaseHash(
  pkgName: string,
  targetHash: string,
  targetArch?: string,
): Promise<boolean> {
  if (!targetHash) {
    return false;
  }
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${pkgName}`;

  try {
    const resp = await fetch(apiUrl, { headers: getAuthHeaders(), signal: AbortSignal.timeout(5000) });
    if (!resp.ok) {
      return false;
    }
    const data = (await resp.json()) as {
      body?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };

    const debAssets = (data.assets || []).filter((a) => a.name.endsWith('.deb'));
    if (debAssets.length === 0) {
      return false;
    }

    if (targetArch) {
      const normArch = targetArch === 'arm64' ? 'aarch64' : targetArch.toLowerCase();
      const hasTargetArch =
        normArch === 'all'
          ? debAssets.some((a) => a.name.endsWith('_all.deb'))
          : debAssets.some(
              (a) =>
                a.name.endsWith(`_${normArch}.deb`) ||
                (normArch === 'aarch64' && a.name.endsWith('_arm64.deb')) ||
                a.name.endsWith('_all.deb'),
            );
      if (!hasTargetArch) {
        return false;
      }
    }

    const body = (data.body || '').trim();
    if (body) {
      try {
        const remoteMeta = JSON.parse(body);
        if (typeof remoteMeta === 'object' && remoteMeta.state_hash === targetHash) {
          return true;
        }
      } catch {}
    }

    for (const asset of data.assets || []) {
      if (asset.name === 'metadata.json' || asset.name === `${pkgName}_metadata.json`) {
        const assetResp = await fetch(asset.browser_download_url, { headers: getAuthHeaders() });
        if (assetResp.ok) {
          const meta = (await assetResp.json()) as { state_hash?: string };
          if (meta.state_hash === targetHash) {
            return true;
          }
        }
      }
    }
  } catch {}

  return false;
}

export async function loadTermuxIndex(
  targetArch: string = 'aarch64',
): Promise<Record<string, Record<string, string>[]>> {
  const normArch = targetArch === 'arm64' ? 'aarch64' : (targetArch || 'aarch64').toLowerCase();
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';
  if (_PKG_INDICES[repoArch]) {
    return _PKG_INDICES[repoArch];
  }

  const cacheFile = join(process.env.TMPDIR || tmpdir(), `termux_apt_index_v3_${repoArch}.json`);
  if (existsSync(cacheFile)) {
    try {
      _PKG_INDICES[repoArch] = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      if (_PKG_INDICES[repoArch]) {
        return _PKG_INDICES[repoArch];
      }
    } catch {}
  }

  const index: Record<string, Record<string, string>[]> = {};
  const addEntry = (key: string, entry: Record<string, string>): void => {
    if (!index[key]) {
      index[key] = [];
    }
    index[key].push(entry);
  };

  for (const [baseUrl, relPath] of getTermuxRepos(repoArch)) {
    for (const ext of ['.gz', '']) {
      try {
        const url = `${baseUrl}/${relPath}${ext}`;
        let resp: Response | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
            if (resp.ok) {
              break;
            }
            if (resp.status === 404 || (resp.status >= 400 && resp.status < 500 && resp.status !== 429)) {
              // Permanent HTTP 4xx error (403, 404, etc.): advance to next representation immediately
              break;
            }
            if (attempt < 3) {
              await Bun.sleep(1000 * attempt);
            }
          } catch {
            if (attempt === 3) {
              break;
            }
            await Bun.sleep(1000 * attempt);
          }
        }
        if (!resp || !resp.ok) {
          continue;
        }

        const buf = Buffer.from(await resp.arrayBuffer());
        const text = ext === '.gz' ? new TextDecoder().decode(Bun.gunzipSync(buf)) : buf.toString('utf-8');

        let currentPkg: Record<string, string> = {};
        for (const line of text.split('\n')) {
          const trimmed = line.trimEnd();
          if (!trimmed) {
            if (currentPkg.Package && currentPkg.Filename) {
              currentPkg.BaseUrl = baseUrl;
              addEntry(currentPkg.Package, currentPkg);
              if (currentPkg.Provides) {
                for (const prov of currentPkg.Provides.split(',')) {
                  const trimmedProv = prov.trim();
                  if (!trimmedProv) {
                    continue;
                  }
                  const match = trimmedProv.match(/^([a-zA-Z0-9+.-]+)(?:\s*\(\s*(=)\s*([^)]+)\))?/);
                  if (match) {
                    const pName = match[1];
                    const provVer = match[3] || '';
                    if (pName) {
                      addEntry(pName, {
                        ...currentPkg,
                        IsVirtual: 'true',
                        ProvidedVersion: provVer,
                      });
                    }
                  }
                }
              }
            }
            currentPkg = {};
          } else if (trimmed.includes(':') && !trimmed.startsWith(' ')) {
            const idx = trimmed.indexOf(':');
            currentPkg[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
          }
        }
        if (currentPkg.Package && currentPkg.Filename) {
          currentPkg.BaseUrl = baseUrl;
          addEntry(currentPkg.Package, currentPkg);
          if (currentPkg.Provides) {
            for (const prov of currentPkg.Provides.split(',')) {
              const trimmedProv = prov.trim();
              if (!trimmedProv) {
                continue;
              }
              const match = trimmedProv.match(/^([a-zA-Z0-9+.-]+)(?:\s*\(\s*(=)\s*([^)]+)\))?/);
              if (match) {
                const pName = match[1];
                const provVer = match[3] || '';
                if (pName) {
                  addEntry(pName, {
                    ...currentPkg,
                    IsVirtual: 'true',
                    ProvidedVersion: provVer,
                  });
                }
              }
            }
          }
        }
        break;
      } catch {}
    }
  }

  _PKG_INDICES[repoArch] = index;
  try {
    writeFileSync(cacheFile, JSON.stringify(index), 'utf-8');
  } catch {}
  return _PKG_INDICES[repoArch];
}

export function parseDepSpec(depSpec: string): [string, string | null] {
  const clean = depSpec.trim();
  for (const op of ['==', '>=', '<=', '=', '>', '<', '@']) {
    if (clean.includes(op)) {
      const parts = clean.split(op);
      return [parts[0].trim(), `${op}${parts[1].trim()}`];
    }
  }
  return [clean, null];
}

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, url: string) {
    super(`Download failed with status ${status}: ${url}`);
    this.status = status;
  }
}

export async function downloadFile(
  url: string,
  destPath: string,
  useAuth = false,
  extraHeaders?: Record<string, string>,
  maxRetries = 4,
): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const headers = useAuth ? getAuthHeaders(extraHeaders) : { 'User-Agent': USER_AGENT, ...extraHeaders };
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const resp = await fetch(url, { headers });
      if (!resp.ok) {
        const isTransient = resp.status === 429 || resp.status >= 500;
        if (isTransient && attempt < maxRetries) {
          const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
          console.warn(
            `Download of ${url} returned ${resp.status}; retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`,
          );
          await Bun.sleep(delay);
          continue;
        }
        throw new HttpError(resp.status, url);
      }
      const arr = await resp.arrayBuffer();
      writeFileSync(destPath, Buffer.from(arr));
      return;
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (lastError instanceof HttpError) {
        throw lastError;
      }
      if (attempt < maxRetries) {
        const delay = Math.min(1000 * 2 ** (attempt - 1), 8000);
        console.warn(
          `Download of ${url} encountered error (${lastError.message}); retrying in ${delay}ms (attempt ${attempt}/${maxRetries})...`,
        );
        await Bun.sleep(delay);
        continue;
      }
      throw lastError;
    }
  }

  throw lastError ?? new Error(`Download failed after ${maxRetries} attempts: ${url}`);
}

function extractDebToPrefix(debPath: string, prefixRoot: string): void {
  const extractTmp = join(tmpdir(), `deb_extract_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  rmSync(extractTmp, { recursive: true, force: true });
  mkdirSync(extractTmp, { recursive: true });
  try {
    const extractRes = spawnSync('dpkg-deb', ['-x', debPath, extractTmp], { encoding: 'utf-8' });
    if (extractRes.status !== 0) {
      throw new Error(`dpkg-deb failed to extract ${basename(debPath)}: ${extractRes.stderr || 'unknown error'}`);
    }

    const extractedUsr = join(extractTmp, 'data', 'data', 'com.termux', 'files', 'usr');
    if (existsSync(extractedUsr)) {
      const cpRes = spawnSync('cp', ['-a', `${extractedUsr}/.`, `${prefixRoot}/`], { encoding: 'utf-8' });
      if (cpRes.status !== 0) {
        throw new Error(`Failed to copy extracted usr into ${prefixRoot}: ${cpRes.stderr || 'unknown error'}`);
      }
    } else {
      const directUsr = join(extractTmp, 'usr');
      if (existsSync(directUsr)) {
        const cpRes = spawnSync('cp', ['-a', `${directUsr}/.`, `${prefixRoot}/`], { encoding: 'utf-8' });
        if (cpRes.status !== 0) {
          throw new Error(`Failed to copy direct usr into ${prefixRoot}: ${cpRes.stderr || 'unknown error'}`);
        }
      }
    }
  } finally {
    rmSync(extractTmp, { recursive: true, force: true });
  }
}

export function parseFilenameDebVersion(filename: string): string {
  const stem = basename(filename)
    .replace(/\.deb$/, '')
    .replace(/_(aarch64|arm64|x86_64|arm|i686|all)$/, '');
  const firstUnder = stem.indexOf('_');
  return firstUnder === -1 ? '' : stem.slice(firstUnder + 1).replace(/_/g, ':');
}

export function extractDebVersion(debPath: string): string {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Version'], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim();
    }
  } catch {}
  return parseFilenameDebVersion(debPath);
}

function recordOrExtractDeb(
  pkgName: string,
  debPath: string,
  prefixRoot: string,
  pendingDebs?: Map<string, string>,
): void {
  if (pendingDebs) {
    pendingDebs.set(pkgName, debPath);
  } else {
    extractDebToPrefix(debPath, prefixRoot);
  }
}

function extractDebDepends(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Depends'], { encoding: 'utf-8' });
    if (res.status === 0) {
      return res.stdout ? res.stdout.trim() : '';
    }
  } catch {}
  return null;
}

function extractDebProvides(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Provides'], { encoding: 'utf-8' });
    if (res.status === 0) {
      return res.stdout ? res.stdout.trim() : '';
    }
  } catch {}
  return null;
}

function getInstalledSystemVersion(pkgName: string): string | null {
  try {
    const res = spawnSync('dpkg-query', ['-W', '-f=${Version}', pkgName], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim() || null;
    }
  } catch {}
  return null;
}

export function recordConstraint(
  activeConstraints: Map<string, VersionConstraint[]>,
  pkgName: string,
  constraint?: VersionConstraint,
  source?: string,
): void {
  const list = activeConstraints.get(pkgName) || [];
  const exists = list.some(
    (c) =>
      c.operator === (constraint ? constraint.operator : '') &&
      c.version === (constraint ? constraint.version : '') &&
      c.source === source,
  );
  if (!exists) {
    if (constraint) {
      list.push({ ...constraint, source });
    } else {
      list.push({ operator: '', version: '', source });
    }
    activeConstraints.set(pkgName, list);
  }
}

export function retireCandidateConstraints(
  activeConstraints: Map<string, VersionConstraint[]>,
  candidate: string,
): void {
  const retiringSources = new Set<string>([candidate]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const [pkg, constraints] of activeConstraints.entries()) {
      if (retiringSources.has(pkg)) {
        continue;
      }
      if (constraints.length > 0 && constraints.every((c) => c.source && retiringSources.has(c.source))) {
        retiringSources.add(pkg);
        changed = true;
      }
    }
  }

  for (const [pkg, constraints] of activeConstraints.entries()) {
    const retained = constraints.filter((c) => !c.source || !retiringSources.has(c.source));
    if (retained.length !== constraints.length) {
      if (retained.length === 0) {
        activeConstraints.delete(pkg);
      } else {
        activeConstraints.set(pkg, retained);
      }
    }
  }
}

export async function resolvePackageDependencies(
  dependsStr: string | undefined,
  destdir: string,
  fetched: Set<string>,
  targetArch: string,
  repoArch: string,
  resolving: Set<string>,
  pendingDebs?: Map<string, string>,
  subpackageMap?: Record<string, string>,
  snapshotFetched?: Set<string>,
  snapshotPending?: Map<string, string> | null,
  selectedVersions: Map<string, string> = new Map<string, string>(),
  snapshotVersions?: Map<string, string> | null,
  activeConstraints: Map<string, VersionConstraint[]> = new Map<string, VersionConstraint[]>(),
  snapshotConstraints?: Map<string, VersionConstraint[]> | null,
  requester?: string,
): Promise<boolean> {
  if (!dependsStr) {
    return true;
  }
  const clauses = parseDependencyList(dependsStr);
  const filtered = filterDepsForArch(clauses, repoArch);
  for (const branch of filtered) {
    let branchSatisfied = false;
    for (const token of branch) {
      const cleanTokenName = token.name.split(':')[0].trim();
      if (['dpkg', 'apt', 'bash', 'termux-tools', 'command-not-found'].includes(cleanTokenName)) {
        const stagedVer = selectedVersions.get(cleanTokenName);
        if (stagedVer) {
          if (!token.versionConstraint || satisfiesVersionConstraint(stagedVer, token.versionConstraint)) {
            recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
            branchSatisfied = true;
            break;
          }
        } else {
          if (!token.versionConstraint) {
            recordConstraint(activeConstraints, cleanTokenName, undefined, requester);
            branchSatisfied = true;
            break;
          }
          const instVer = getInstalledSystemVersion(cleanTokenName);
          if (instVer && satisfiesVersionConstraint(instVer, token.versionConstraint)) {
            recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
            branchSatisfied = true;
            break;
          }
        }
      }
      if (resolving.has(cleanTokenName)) {
        const resolvingVer = selectedVersions.get(cleanTokenName);
        if (
          !token.versionConstraint ||
          (resolvingVer && satisfiesVersionConstraint(resolvingVer, token.versionConstraint))
        ) {
          recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
          branchSatisfied = true;
          break;
        }
        continue;
      }
      if (fetched.has(cleanTokenName)) {
        const cachedVer = selectedVersions.get(cleanTokenName);
        const existing = activeConstraints.get(cleanTokenName) || [];
        if (!token.versionConstraint || (cachedVer && satisfiesVersionConstraint(cachedVer, token.versionConstraint))) {
          recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
          branchSatisfied = true;
          break;
        }

        // If existing constraint has '=' and token requires different '=', cannot backtrack
        const allConstraints = [...existing, token.versionConstraint];
        const equalities = allConstraints.filter((c) => c.operator === '=');
        if (equalities.length > 1 && equalities.some((c) => c.version !== equalities[0].version)) {
          continue;
        }

        const snapshotConstraintsBeforeReplacement = new Map(
          Array.from(activeConstraints.entries()).map(([k, v]) => [k, [...v]]),
        );
        retireCandidateConstraints(activeConstraints, cleanTokenName);

        fetched.delete(cleanTokenName);
        selectedVersions.delete(cleanTokenName);
        const oldPending = pendingDebs?.get(cleanTokenName);
        if (pendingDebs) {
          pendingDebs.delete(cleanTokenName);
        }

        try {
          const depStr = formatDebianDependency([[token]]);
          const ok = await fetchSingleDep(
            depStr,
            destdir,
            fetched,
            targetArch,
            resolving,
            pendingDebs,
            subpackageMap,
            selectedVersions,
            activeConstraints,
            requester,
          );
          if (ok) {
            recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
            branchSatisfied = true;
            break;
          }
        } catch {}

        activeConstraints.clear();
        for (const [k, v] of snapshotConstraintsBeforeReplacement) {
          activeConstraints.set(k, [...v]);
        }
        fetched.add(cleanTokenName);
        if (cachedVer) {
          selectedVersions.set(cleanTokenName, cachedVer);
        }
        if (oldPending && pendingDebs) {
          pendingDebs.set(cleanTokenName, oldPending);
        }
        continue;
      }
      try {
        const depStr = formatDebianDependency([[token]]);
        const ok = await fetchSingleDep(
          depStr,
          destdir,
          fetched,
          targetArch,
          resolving,
          pendingDebs,
          subpackageMap,
          selectedVersions,
          activeConstraints,
          requester,
        );
        if (ok) {
          recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
          branchSatisfied = true;
          break;
        }
      } catch {}
    }
    if (!branchSatisfied) {
      if (snapshotFetched) {
        fetched.clear();
        for (const p of snapshotFetched) {
          fetched.add(p);
        }
      }
      if (snapshotPending && pendingDebs) {
        pendingDebs.clear();
        for (const [k, v] of snapshotPending) {
          pendingDebs.set(k, v);
        }
      }
      if (snapshotVersions) {
        selectedVersions.clear();
        for (const [k, v] of snapshotVersions) {
          selectedVersions.set(k, v);
        }
      }
      if (snapshotConstraints) {
        activeConstraints.clear();
        for (const [k, v] of snapshotConstraints) {
          activeConstraints.set(k, [...v]);
        }
      }
      return false;
    }
  }
  return true;
}

export async function fetchSingleDep(
  dep: string,
  destdir: string,
  fetched: Set<string>,
  targetArch: string = 'aarch64',
  resolving: Set<string> = new Set<string>(),
  pendingDebs?: Map<string, string>,
  subpackageMap?: Record<string, string>,
  selectedVersions: Map<string, string> = new Map<string, string>(),
  activeConstraints: Map<string, VersionConstraint[]> = new Map<string, VersionConstraint[]>(),
  requester?: string,
): Promise<boolean> {
  const parsedClauses = parseDependencyList(dep);
  const token = parsedClauses[0]?.[0];
  const pkgName = token ? token.name.split(':')[0].trim() : parseDepSpec(dep)[0].split(':')[0].trim();
  const constraint = token?.versionConstraint;

  const allConstraints = [...(activeConstraints.get(pkgName) || []), ...(constraint ? [constraint] : [])];

  if (resolving.has(pkgName)) {
    const resolvingVer = selectedVersions.get(pkgName);
    return !constraint || Boolean(resolvingVer && satisfiesVersionConstraint(resolvingVer, constraint));
  }
  if (fetched.has(pkgName)) {
    const cachedVer = selectedVersions.get(pkgName);
    return !constraint || Boolean(cachedVer && satisfiesVersionConstraint(cachedVer, constraint));
  }

  const isMappedSubpkg = Boolean(
    subpackageMap?.[pkgName] ||
    (pkgName.endsWith('-dev') && existsSync(join('pkg', pkgName.slice(0, -4), 'recipe.ts'))) ||
    ((pkgName.endsWith('-static') || pkgName.endsWith('-doc') || pkgName.endsWith('-man')) &&
      existsSync(join('pkg', pkgName.replace(/-(static|doc|man)$/, ''), 'recipe.ts'))),
  );

  if (
    !isMappedSubpkg &&
    !constraint &&
    (pkgName.endsWith('-static') || pkgName.endsWith('-doc') || pkgName.endsWith('-man'))
  ) {
    fetched.add(pkgName);
    return true;
  }

  const normArch = targetArch === 'arm64' ? 'aarch64' : (targetArch || 'aarch64').toLowerCase();
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';

  const prefixRoot = process.env.PREFIX || PREFIX;
  try {
    mkdirSync(prefixRoot, { recursive: true });
  } catch {}
  mkdirSync(destdir, { recursive: true });
  const outputDir = resolve('output');

  const snapshotFetched = new Set(fetched);
  const snapshotPending = pendingDebs ? new Map(pendingDebs) : null;
  const snapshotVersions = new Map(selectedVersions);
  const snapshotConstraints = new Map(Array.from(activeConstraints.entries()).map(([k, v]) => [k, [...v]]));

  const rollbackCandidate = (): void => {
    fetched.clear();
    for (const p of snapshotFetched) {
      fetched.add(p);
    }
    if (snapshotPending && pendingDebs) {
      pendingDebs.clear();
      for (const [k, v] of snapshotPending) {
        pendingDebs.set(k, v);
      }
    }
    if (snapshotVersions) {
      selectedVersions.clear();
      for (const [k, v] of snapshotVersions) {
        selectedVersions.set(k, v);
      }
    }
    if (snapshotConstraints) {
      activeConstraints.clear();
      for (const [k, v] of snapshotConstraints) {
        activeConstraints.set(k, [...v]);
      }
    }
  };

  // 1. Local artifacts
  const checkArtifacts = (dir: string) => {
    if (existsSync(dir)) {
      return readdirSync(dir)
        .filter(
          (f) =>
            f.startsWith(`${pkgName}_`) &&
            (f.endsWith(`_${repoArch}.deb`) ||
              (repoArch === 'aarch64' && f.endsWith('_arm64.deb')) ||
              f.endsWith('_all.deb')),
        )
        .map((f) => join(dir, f));
    }
    return [];
  };
  const localArts = [...checkArtifacts('artifacts'), ...checkArtifacts(outputDir)];
  for (const chosenDeb of localArts) {
    const debVer = extractDebVersion(chosenDeb);
    if (!debVer || !satisfiesAllConstraints(debVer, allConstraints)) {
      continue;
    }
    const debDeps = extractDebDepends(chosenDeb);
    if (debDeps === null) {
      console.warn(`::warning:: Corrupt control metadata in ${basename(chosenDeb)}, skipping candidate.`);
      continue;
    }
    console.log(`✓ Found local artifact for dependency '${pkgName}': ${basename(chosenDeb)}`);
    recordOrExtractDeb(pkgName, chosenDeb, prefixRoot, pendingDebs);
    fetched.add(pkgName);
    selectedVersions.set(pkgName, debVer);
    if (constraint) {
      recordConstraint(activeConstraints, pkgName, constraint, requester);
    }
    resolving.add(pkgName);
    const depsOk = await resolvePackageDependencies(
      debDeps,
      destdir,
      fetched,
      targetArch,
      repoArch,
      resolving,
      pendingDebs,
      subpackageMap,
      snapshotFetched,
      snapshotPending,
      selectedVersions,
      snapshotVersions,
      activeConstraints,
      snapshotConstraints,
      pkgName,
    );
    resolving.delete(pkgName);
    if (depsOk) {
      return true;
    }
    rollbackCandidate();
  }

  // 2. RepoExe GitHub releases
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const releaseOwner =
    subpackageMap?.[pkgName] ||
    (pkgName.endsWith('-dev') && existsSync(join('pkg', pkgName.slice(0, -4), 'recipe.ts'))
      ? pkgName.slice(0, -4)
      : pkgName);
  const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${releaseOwner}`;
  try {
    const resp = await fetch(apiUrl, { headers: getAuthHeaders() });
    if (resp.ok) {
      interface ReleaseAsset {
        name: string;
        url: string;
        browser_download_url: string;
      }
      const relData = (await resp.json()) as { assets?: ReleaseAsset[] };
      const debAssets = (relData.assets || []).filter(
        (a): a is ReleaseAsset =>
          typeof a?.name === 'string' &&
          a.name.startsWith(`${pkgName}_`) &&
          (a.name.endsWith(`_${repoArch}.deb`) ||
            (repoArch === 'aarch64' && a.name.endsWith('_arm64.deb')) ||
            a.name.endsWith('_all.deb')),
      );
      for (const debAsset of debAssets) {
        const assetVer = parseFilenameDebVersion(debAsset.name);
        if (!satisfiesAllConstraints(assetVer, allConstraints)) {
          continue;
        }
        const debPath = join(destdir, debAsset.name);
        const downloadUrl = debAsset.url || debAsset.browser_download_url;
        const extraHeaders = debAsset.url ? { Accept: 'application/octet-stream' } : undefined;
        try {
          await downloadFile(downloadUrl, debPath, true, extraHeaders);
        } catch {
          rmSync(debPath, { force: true });
          rollbackCandidate();
          continue;
        }
        const actualVer = extractDebVersion(debPath) || assetVer;
        if (!satisfiesAllConstraints(actualVer, allConstraints)) {
          rmSync(debPath, { force: true });
          rollbackCandidate();
          continue;
        }
        const debDeps = extractDebDepends(debPath);
        if (debDeps === null) {
          rmSync(debPath, { force: true });
          rollbackCandidate();
          continue;
        }
        recordOrExtractDeb(pkgName, debPath, prefixRoot, pendingDebs);
        fetched.add(pkgName);
        selectedVersions.set(pkgName, actualVer);
        if (constraint) {
          recordConstraint(activeConstraints, pkgName, constraint, requester);
        }
        resolving.add(pkgName);
        const depsOk = await resolvePackageDependencies(
          debDeps,
          destdir,
          fetched,
          targetArch,
          repoArch,
          resolving,
          pendingDebs,
          subpackageMap,
          snapshotFetched,
          snapshotPending,
          selectedVersions,
          snapshotVersions,
          activeConstraints,
          snapshotConstraints,
          pkgName,
        );
        resolving.delete(pkgName);
        if (depsOk) {
          return true;
        }
        rollbackCandidate();
        rmSync(debPath, { force: true });
      }
    }
  } catch {}

  // 3. Official Termux Upstream Mirrors
  resolving.add(pkgName);

  try {
    const index = await loadTermuxIndex(repoArch);
    const candidates = index[pkgName] || index[`lib${pkgName}`] || index[pkgName.replace(/^lib/, '')] || [];

    for (const pkgInfo of candidates) {
      const isVirtual = pkgInfo.IsVirtual === 'true';
      const concretePkg = pkgInfo.Package;
      if (concretePkg && activeConstraints.has(concretePkg)) {
        const concreteConstraints = activeConstraints.get(concretePkg)!;
        if (
          concreteConstraints.length > 0 &&
          pkgInfo.Version &&
          !satisfiesAllConstraints(pkgInfo.Version, concreteConstraints)
        ) {
          continue;
        }
      }
      const effectiveVer = isVirtual ? pkgInfo.ProvidedVersion : pkgInfo.Version;
      if (allConstraints.length > 0) {
        if (isVirtual && !effectiveVer) {
          continue;
        }
        if (effectiveVer && !satisfiesAllConstraints(effectiveVer, allConstraints)) {
          continue;
        }
      }

      let candidateCanonical: string | undefined;
      let addedResolving = false;
      if (pkgInfo.Package && pkgInfo.Package !== pkgName) {
        candidateCanonical = pkgInfo.Package;
        if (resolving.has(candidateCanonical)) {
          const stagedDeb = pendingDebs?.get(candidateCanonical);
          if (stagedDeb && existsSync(stagedDeb)) {
            const provText = extractDebProvides(stagedDeb);
            let matchedProvVer: string | undefined;
            if (provText) {
              for (const clause of parseDependencyList(provText)) {
                for (const provToken of clause) {
                  if (provToken.name.split(':')[0].trim() === pkgName) {
                    matchedProvVer = provToken.versionConstraint?.version || '';
                    break;
                  }
                }
                if (matchedProvVer !== undefined) {
                  break;
                }
              }
            }
            if (matchedProvVer !== undefined && satisfiesAllConstraints(matchedProvVer, allConstraints)) {
              recordOrExtractDeb(pkgName, stagedDeb, prefixRoot, pendingDebs);
              selectedVersions.set(pkgName, matchedProvVer);
              fetched.add(pkgName);
              recordConstraint(activeConstraints, pkgName, constraint, requester);
              return true;
            }
          }
          continue;
        }
        resolving.add(candidateCanonical);
        addedResolving = true;
      }
      const baseUrl = pkgInfo.BaseUrl;
      const debFilename = basename(pkgInfo.Filename);
      const debUrl = `${baseUrl}/${pkgInfo.Filename}`;
      let debDest = '';
      try {
        const resolverDownloadsDir = join(destdir, '.resolver_downloads');
        mkdirSync(resolverDownloadsDir, { recursive: true });
        const attemptKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
        debDest = join(resolverDownloadsDir, `${debFilename.replace(/\.deb$/, '')}_${attemptKey}.deb`);
        console.log(`⚡ Fetching Termux upstream dependency '${pkgName}' [${repoArch}] from ${debUrl}...`);
        try {
          await downloadFile(debUrl, debDest);
        } catch {
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }

        const checkDeb = spawnSync('dpkg-deb', ['-I', debDest]);
        if (checkDeb.status !== 0) {
          rmSync(debDest, { force: true });
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }
      } catch {
        if (candidateCanonical && addedResolving) {
          resolving.delete(candidateCanonical);
        }
        continue;
      }
      const concreteVer = pkgInfo.Version || extractDebVersion(debDest);
      if (candidateCanonical && activeConstraints.has(candidateCanonical)) {
        const concreteConstraints = activeConstraints.get(candidateCanonical)!;
        if (
          concreteConstraints.length > 0 &&
          concreteVer &&
          !satisfiesAllConstraints(concreteVer, concreteConstraints)
        ) {
          rmSync(debDest, { force: true });
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }
      }
      const upstreamVer = isVirtual ? effectiveVer : concreteVer;
      if (allConstraints.length > 0 && upstreamVer && !satisfiesAllConstraints(upstreamVer, allConstraints)) {
        rmSync(debDest, { force: true });
        if (candidateCanonical && addedResolving) {
          resolving.delete(candidateCanonical);
        }
        continue;
      }

      recordOrExtractDeb(pkgName, debDest, prefixRoot, pendingDebs);
      if (candidateCanonical) {
        recordOrExtractDeb(candidateCanonical, debDest, prefixRoot, pendingDebs);
      }
      selectedVersions.set(pkgName, upstreamVer);
      if (candidateCanonical) {
        selectedVersions.set(candidateCanonical, concreteVer);
      }
      if (constraint) {
        recordConstraint(activeConstraints, pkgName, constraint, requester);
      }

      // Recursively resolve dependencies
      const depsOk = await resolvePackageDependencies(
        pkgInfo.Depends || '',
        destdir,
        fetched,
        targetArch,
        repoArch,
        resolving,
        pendingDebs,
        subpackageMap,
        snapshotFetched,
        snapshotPending,
        selectedVersions,
        snapshotVersions,
        activeConstraints,
        snapshotConstraints,
        pkgName,
      );
      if (candidateCanonical && addedResolving) {
        resolving.delete(candidateCanonical);
      }
      if (depsOk) {
        fetched.add(pkgName);
        if (candidateCanonical) {
          fetched.add(candidateCanonical);
        }
        return true;
      }

      rollbackCandidate();
      rmSync(debDest, { force: true });
    }
  } catch (err: unknown) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`Warning: Failed to fetch upstream dependency '${pkgName}' [${repoArch}]: ${reason}`);
    rollbackCandidate();
  } finally {
    resolving.delete(pkgName);
  }

  return false;
}

export async function resolveAndFetchBuildDependencies(
  buildDeps: string[],
  destdir: string,
  targetArch: string = 'aarch64',
  subpackageMap?: Record<string, string>,
  rootPkgName?: string,
): Promise<void> {
  if (!buildDeps || buildDeps.length === 0) {
    return;
  }
  const concreteArch = targetArch === 'all' ? 'aarch64' : targetArch;
  console.log(`Resolving build dependencies [${concreteArch}]: ${buildDeps.join(', ')}`);
  const fetched = new Set<string>();
  const selectedVersions = new Map<string, string>();
  const sharedPendingArtifacts = new Map<string, string>();
  const activeConstraints = new Map<string, VersionConstraint[]>();

  const clauses = parseDependencyList(buildDeps);
  const filtered = filterDepsForArch(clauses, concreteArch);

  const rootRequester = rootPkgName ? `@root:${rootPkgName}` : '@root';

  const resolverDownloadsDir = join(destdir, '.resolver_downloads');
  try {
    for (const branch of filtered) {
      let branchSatisfied = false;
      for (const token of branch) {
        const cleanName = token.name.split(':')[0].trim();
        let success = false;
        const branchDebs = new Map(sharedPendingArtifacts);
        try {
          const depStr = formatDebianDependency([[token]]);
          success = await fetchSingleDep(
            depStr,
            destdir,
            fetched,
            concreteArch,
            new Set(),
            branchDebs,
            subpackageMap,
            selectedVersions,
            activeConstraints,
            rootRequester,
          );
        } catch (err: unknown) {
          const reason = err instanceof Error ? err.message : String(err);
          console.warn(`Warning: Error resolving dependency '${cleanName}' for ${concreteArch}: ${reason}`);
        }
        if (success) {
          recordConstraint(activeConstraints, cleanName, token.versionConstraint, rootRequester);
          sharedPendingArtifacts.clear();
          for (const [pkg, debPath] of branchDebs) {
            sharedPendingArtifacts.set(pkg, debPath);
          }
          branchSatisfied = true;
          break;
        }
      }
      if (!branchSatisfied) {
        const branchStr = branch.map((t) => t.name).join(' | ');
        throw new Error(`Missing required build dependency '${branchStr}' for ${concreteArch} and no artifact exists.`);
      }
    }

    const uniqueDebs = Array.from(new Set(sharedPendingArtifacts.values()));
    if (uniqueDebs.length > 0) {
      const stagingPrefix = join(destdir, `.prefix_staging_${Date.now()}`);
      mkdirSync(stagingPrefix, { recursive: true });
      try {
        for (const debPath of uniqueDebs) {
          extractDebToPrefix(debPath, stagingPrefix);
        }
        const cpRes = spawnSync('cp', ['-a', `${stagingPrefix}/.`, `${PREFIX}/`], { encoding: 'utf-8' });
        if (cpRes.status !== 0) {
          throw new Error(`Failed to copy staging prefix into ${PREFIX}: ${cpRes.stderr || 'unknown copy error'}`);
        }
      } finally {
        rmSync(stagingPrefix, { recursive: true, force: true });
      }
    }
  } finally {
    if (existsSync(resolverDownloadsDir)) {
      rmSync(resolverDownloadsDir, { recursive: true, force: true });
    }
  }
}
