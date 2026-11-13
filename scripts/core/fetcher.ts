import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { PREFIX } from '../utils/properties.ts';

export const TERMUX_REPOS: Array<[string, string]> = [
  ['https://packages-cf.termux.dev/apt/termux-main', 'dists/stable/main/binary-aarch64/Packages'],
  ['https://packages-cf.termux.dev/apt/termux-x11', 'dists/x11/main/binary-aarch64/Packages'],
  ['https://packages-cf.termux.dev/apt/termux-root', 'dists/root/stable/binary-aarch64/Packages'],
];

export const USER_AGENT =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

let _PKG_INDEX: Record<string, Record<string, string>> | null = null;

function getAuthHeaders(headers?: Record<string, string>): Record<string, string> {
  const res: Record<string, string> = { 'User-Agent': USER_AGENT, ...(headers || {}) };
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token && !res.Authorization) {
    res.Authorization = `Bearer ${token}`;
  }
  return res;
}

export async function checkExistingReleaseHash(pkgName: string, channel: string, targetHash: string): Promise<boolean> {
  if (!targetHash) return false;
  const tag = `${pkgName}@${channel}`;
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${tag}`;

  try {
    const resp = await fetch(apiUrl, { headers: getAuthHeaders(), signal: AbortSignal.timeout(5000) });
    if (!resp.ok) return false;
    const data = (await resp.json()) as any;

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
          const meta = (await assetResp.json()) as any;
          if (meta.state_hash === targetHash) return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

export async function loadTermuxIndex(): Promise<Record<string, Record<string, string>>> {
  if (_PKG_INDEX) return _PKG_INDEX;

  const cacheFile = join(tmpdir(), 'termux_apt_index.json');
  if (existsSync(cacheFile)) {
    try {
      _PKG_INDEX = JSON.parse(readFileSync(cacheFile, 'utf-8'));
      if (_PKG_INDEX) return _PKG_INDEX;
    } catch {}
  }

  const index: Record<string, Record<string, string>> = {};
  for (const [baseUrl, relPath] of TERMUX_REPOS) {
    for (const ext of ['.gz', '']) {
      try {
        const url = `${baseUrl}/${relPath}${ext}`;
        const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
        if (!resp.ok) continue;

        const buf = Buffer.from(await resp.arrayBuffer());
        const text = ext === '.gz' ? gunzipSync(buf).toString('utf-8') : buf.toString('utf-8');

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

  _PKG_INDEX = index;
  try {
    writeFileSync(cacheFile, JSON.stringify(index), 'utf-8');
  } catch {}
  return _PKG_INDEX;
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

async function downloadFile(url: string, destPath: string): Promise<void> {
  mkdirSync(dirname(destPath), { recursive: true });
  const resp = await fetch(url, { headers: getAuthHeaders() });
  if (!resp.ok) throw new Error(`Download failed with status ${resp.status}: ${url}`);
  const arr = await resp.arrayBuffer();
  writeFileSync(destPath, Buffer.from(arr));
}

function extractDebToPrefix(debPath: string, prefixRoot: string): void {
  const extractTmp = join(tmpdir(), `deb_extract_${Date.now()}_${Math.random().toString(36).slice(2)}`);
  rmSync(extractTmp, { recursive: true, force: true });
  mkdirSync(extractTmp, { recursive: true });
  spawnSync('dpkg-deb', ['-x', debPath, extractTmp]);

  const extractedUsr = join(extractTmp, 'data', 'data', 'com.termux', 'files', 'usr');
  if (existsSync(extractedUsr)) {
    spawnSync('cp', ['-a', `${extractedUsr}/.`, `${prefixRoot}/`]);
  } else {
    const directUsr = join(extractTmp, 'usr');
    if (existsSync(directUsr)) {
      spawnSync('cp', ['-a', `${directUsr}/.`, `${prefixRoot}/`]);
    }
  }
  rmSync(extractTmp, { recursive: true, force: true });
}

export async function fetchSingleDep(dep: string, destdir: string, fetched: Set<string>): Promise<boolean> {
  const [pkgName] = parseDepSpec(dep);
  if (fetched.has(pkgName)) return true;

  if (pkgName.endsWith('-static') || pkgName.endsWith('-doc') || pkgName.endsWith('-man')) {
    fetched.add(pkgName);
    return true;
  }

  const prefixRoot = PREFIX;
  mkdirSync(prefixRoot, { recursive: true });
  mkdirSync(destdir, { recursive: true });
  const outputDir = resolve('output');

  // 1. Local artifacts
  const checkArtifacts = (dir: string) => {
    if (existsSync(dir)) {
      return readdirSync(dir)
        .filter((f) => f.startsWith(pkgName) && f.endsWith('.deb'))
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
  const tag = `${pkgName}@latest`;
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${tag}`;
  try {
    const resp = await fetch(apiUrl, { headers: getAuthHeaders() });
    if (resp.ok) {
      const relData = (await resp.json()) as any;
      const debAsset = (relData.assets || []).find((a: any) => a.name?.endsWith('.deb'));
      if (debAsset) {
        const debPath = join(destdir, debAsset.name);
        await downloadFile(debAsset.browser_download_url, debPath);
        extractDebToPrefix(debPath, prefixRoot);
        fetched.add(pkgName);
        return true;
      }
    }
  } catch {}

  // 3. Official Termux Upstream Mirrors
  const index = await loadTermuxIndex();
  const pkgInfo = index[pkgName] || index[`lib${pkgName}`] || index[pkgName.replace(/^lib/, '')];

  if (pkgInfo) {
    const baseUrl = pkgInfo.BaseUrl;
    const debFilename = basename(pkgInfo.Filename);
    const debUrl = `${baseUrl}/${pkgInfo.Filename}`;
    const debDest = join(destdir, debFilename);
    console.log(`⚡ Fetching Termux upstream dependency '${pkgName}' from ${debUrl}...`);
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
          await fetchSingleDep(reqName, destdir, fetched);
        }
      }
    }
    return true;
  }

  return false;
}

export async function resolveAndFetchBuildDependencies(buildDeps: string[], destdir: string): Promise<void> {
  if (!buildDeps || buildDeps.length === 0) return;
  console.log(`Resolving build dependencies: ${buildDeps.join(', ')}`);
  const fetched = new Set<string>();

  for (const dep of buildDeps) {
    const success = await fetchSingleDep(dep, destdir, fetched);
    if (!success) {
      console.error(`::error:: Missing required build dependency '${dep}' and no artifact exists.`);
      process.exit(1);
    }
  }
}
