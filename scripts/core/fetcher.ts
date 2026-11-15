import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

import { PREFIX } from '../utils/properties.ts';

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

const _PKG_INDICES: Record<string, Record<string, Record<string, string>>> = {};

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
  if (!targetHash) return false;
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${pkgName}`;

  try {
    const resp = await fetch(apiUrl, { headers: getAuthHeaders(), signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return false;
    const data = (await resp.json()) as {
      body?: string;
      assets?: Array<{ name: string; browser_download_url: string }>;
    };

    const debAssets = (data.assets || []).filter((a) => a.name.endsWith('.deb'));
    if (debAssets.length === 0) return false;

    if (targetArch && targetArch !== 'all') {
      const normArch = targetArch === 'arm64' ? 'aarch64' : targetArch.toLowerCase();
      const hasTargetArch = debAssets.some((a) => a.name.endsWith(`_${normArch}.deb`) || a.name.endsWith('_all.deb'));
      if (!hasTargetArch) return false;
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
          if (meta.state_hash === targetHash) return true;
        }
      }
    }
  } catch {}

  return false;
}

export async function loadTermuxIndex(targetArch: string = 'aarch64'): Promise<Record<string, Record<string, string>>> {
  const normArch = targetArch === 'arm64' ? 'aarch64' : (targetArch || 'aarch64').toLowerCase();
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';
  if (_PKG_INDICES[repoArch]) return _PKG_INDICES[repoArch];

  const cacheFile = join(tmpdir(), `termux_apt_index_${repoArch}.json`);
  if (existsSync(cacheFile)) {
    try {
      _PKG_INDICES[repoArch] = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      if (_PKG_INDICES[repoArch]) return _PKG_INDICES[repoArch];
    } catch {}
  }

  const index: Record<string, Record<string, string>> = {};
  for (const [baseUrl, relPath] of getTermuxRepos(repoArch)) {
    for (const ext of ['.gz', '']) {
      try {
        const url = `${baseUrl}/${relPath}${ext}`;
        const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
        if (!resp.ok) continue;

        const buf = Buffer.from(await resp.arrayBuffer());
        const text = ext === '.gz' ? new TextDecoder().decode(Bun.gunzipSync(buf)) : buf.toString('utf-8');

        let currentPkg: Record<string, string> = {};
        for (const line of text.split('\n')) {
          const trimmed = line.trimEnd();
          if (!trimmed) {
            if (currentPkg.Package && currentPkg.Filename) {
              currentPkg.BaseUrl = baseUrl;
              index[currentPkg.Package] = currentPkg;
              if (currentPkg.Provides) {
                for (const prov of currentPkg.Provides.split(',')) {
                  const pName = prov.trim().split(/\s+/)[0];
                  if (pName && !index[pName]) index[pName] = currentPkg;
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
          index[currentPkg.Package] = currentPkg;
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

async function downloadFile(
  url: string,
  destPath: string,
  useAuth = false,
  extraHeaders?: Record<string, string>,
): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const headers = useAuth ? getAuthHeaders(extraHeaders) : { 'User-Agent': USER_AGENT, ...extraHeaders };
  const resp = await fetch(url, { headers });
  if (!resp.ok) throw new Error(`Download failed with status ${resp.status}: ${url}`);
  const arr = await resp.arrayBuffer();
  writeFileSync(destPath, Buffer.from(arr));
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

export async function fetchSingleDep(
  dep: string,
  destdir: string,
  fetched: Set<string>,
  targetArch: string = 'aarch64',
): Promise<boolean> {
  const [pkgName] = parseDepSpec(dep);
  if (fetched.has(pkgName)) return true;

  if (pkgName.endsWith('-static') || pkgName.endsWith('-doc') || pkgName.endsWith('-man')) {
    fetched.add(pkgName);
    return true;
  }

  const normArch = targetArch === 'arm64' ? 'aarch64' : (targetArch || 'aarch64').toLowerCase();
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';

  const prefixRoot = PREFIX;
  mkdirSync(prefixRoot, { recursive: true });
  mkdirSync(destdir, { recursive: true });
  const outputDir = resolve('output');

  // 1. Local artifacts
  const checkArtifacts = (dir: string) => {
    if (existsSync(dir)) {
      return readdirSync(dir)
        .filter((f) => f.startsWith(pkgName) && (f.endsWith(`_${repoArch}.deb`) || f.endsWith('_all.deb')))
        .map((f) => join(dir, f));
    }
    return [];
  };
  const localArts = [...checkArtifacts('artifacts'), ...checkArtifacts(outputDir)];
  if (localArts.length > 0) {
    console.log(`✓ Found local artifact for dependency '${pkgName}': ${basename(localArts[0])}`);
    extractDebToPrefix(localArts[0], prefixRoot);
    fetched.add(pkgName);
    return true;
  }

  // 2. RepoExe GitHub releases
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${pkgName}`;
  try {
    const resp = await fetch(apiUrl, { headers: getAuthHeaders() });
    if (resp.ok) {
      interface ReleaseAsset {
        name: string;
        url: string;
        browser_download_url: string;
      }
      const relData = (await resp.json()) as { assets?: ReleaseAsset[] };
      const debAsset = (relData.assets || []).find(
        (a): a is ReleaseAsset =>
          typeof a?.name === 'string' && (a.name.endsWith(`_${repoArch}.deb`) || a.name.endsWith('_all.deb')),
      );
      if (debAsset) {
        const debPath = join(destdir, debAsset.name);
        const downloadUrl = debAsset.url || debAsset.browser_download_url;
        const extraHeaders = debAsset.url ? { Accept: 'application/octet-stream' } : undefined;
        await downloadFile(downloadUrl, debPath, true, extraHeaders);
        extractDebToPrefix(debPath, prefixRoot);
        fetched.add(pkgName);
        return true;
      }
    }
  } catch {}

  // 3. Official Termux Upstream Mirrors
  const index = await loadTermuxIndex(repoArch);
  const pkgInfo = index[pkgName] || index[`lib${pkgName}`] || index[pkgName.replace(/^lib/, '')];

  if (pkgInfo) {
    const baseUrl = pkgInfo.BaseUrl;
    const debFilename = basename(pkgInfo.Filename);
    const debUrl = `${baseUrl}/${pkgInfo.Filename}`;
    const debDest = join(destdir, debFilename);
    console.log(`⚡ Fetching Termux upstream dependency '${pkgName}' [${repoArch}] from ${debUrl}...`);
    await downloadFile(debUrl, debDest);
    extractDebToPrefix(debDest, prefixRoot);

    fetched.add(pkgName);
    if (pkgInfo.Package) fetched.add(pkgInfo.Package);

    // Recursively resolve dependencies
    const dependsStr = pkgInfo.Depends || '';
    if (dependsStr) {
      for (const req of dependsStr.split(',')) {
        const reqName = req.trim().split(/\s+/)[0].split(':')[0];
        if (
          reqName &&
          !['dpkg', 'apt', 'bash', 'termux-tools', 'command-not-found'].includes(reqName) &&
          !fetched.has(reqName)
        ) {
          await fetchSingleDep(reqName, destdir, fetched, targetArch);
        }
      }
    }
    return true;
  }

  return false;
}

export async function resolveAndFetchBuildDependencies(
  buildDeps: string[],
  destdir: string,
  targetArch: string = 'aarch64',
): Promise<void> {
  if (!buildDeps || buildDeps.length === 0) return;
  console.log(`Resolving build dependencies [${targetArch}]: ${buildDeps.join(', ')}`);
  const fetched = new Set<string>();

  for (const dep of buildDeps) {
    const success = await fetchSingleDep(dep, destdir, fetched, targetArch);
    if (!success) {
      console.error(`::error:: Missing required build dependency '${dep}' for ${targetArch} and no artifact exists.`);
      process.exit(1);
    }
  }
}
