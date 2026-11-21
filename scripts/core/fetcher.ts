import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

import { PREFIX } from '../utils/properties.ts';
import {
  CANONICAL_ARCHES,
  filterDepsForArch,
  formatDebianDependency,
  isDebArchCompatible,
  normalizeArch,
  parseDependencyList,
  type VersionConstraint,
} from './dependencies.ts';
import { ensureTreeRemovable, getSubpackageNames } from './subpkg.ts';
import type { PackageRecipe } from './types.ts';
import {
  compareDebianVersions,
  formatDebianFilenameVersion,
  satisfiesAllConstraints,
  satisfiesVersionConstraint,
} from './version.ts';

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

export type ReleaseSkipRecipe = Pick<
  PackageRecipe,
  'name' | 'version' | 'revision' | 'epoch' | 'arch' | 'arches' | 'subpackages'
>;

export async function checkExistingReleaseHash(
  pkgName: string,
  targetHash: string,
  targetArch?: string,
  recipe?: ReleaseSkipRecipe,
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

    const hasMatchingDeb = (expectedPkg: string, expectedArch: string, expectedVer?: string): boolean => {
      const normExpected = expectedArch === 'all' ? 'all' : normalizeArch(expectedArch);
      return debAssets.some((a) => {
        if (!a.name.endsWith('.deb')) {
          return false;
        }
        if (expectedVer !== undefined) {
          if (normExpected === 'all') {
            return a.name === `${expectedPkg}_${expectedVer}_all.deb`;
          }
          if (normExpected === 'aarch64') {
            return (
              a.name === `${expectedPkg}_${expectedVer}_aarch64.deb` ||
              a.name === `${expectedPkg}_${expectedVer}_arm64.deb`
            );
          }
          return a.name === `${expectedPkg}_${expectedVer}_${normExpected}.deb`;
        }
        if (!a.name.startsWith(`${expectedPkg}_`)) {
          return false;
        }
        if (normExpected === 'all') {
          return a.name.endsWith('_all.deb');
        }
        return a.name.endsWith(`_${normExpected}.deb`) || (normExpected === 'aarch64' && a.name.endsWith('_arm64.deb'));
      });
    };

    if (recipe) {
      const effectiveTarget = targetArch
        ? targetArch === 'all'
          ? 'all'
          : normalizeArch(targetArch)
        : recipe.arch === 'all'
          ? 'all'
          : normalizeArch(recipe.arch || 'aarch64');
      const expectedVer = formatDebianFilenameVersion(recipe);
      const parentExpectedArch = recipe.arch === 'all' ? 'all' : effectiveTarget;

      if (!hasMatchingDeb(recipe.name, parentExpectedArch, expectedVer)) {
        return false;
      }

      if (recipe.subpackages && typeof recipe.subpackages === 'object') {
        const parentArches =
          recipe.arches && recipe.arches.length > 0
            ? recipe.arches.map((a) => (a === 'all' ? 'all' : normalizeArch(a)))
            : [recipe.arch === 'all' ? 'all' : normalizeArch(recipe.arch || 'aarch64')];
        const concreteParentArches = parentArches.filter((a) => a !== 'all');
        const designatedProducer =
          concreteParentArches.length === 0
            ? 'all'
            : concreteParentArches.includes('aarch64')
              ? 'aarch64'
              : concreteParentArches[0];

        const subNames = getSubpackageNames(recipe);
        const subEntries = Object.entries(recipe.subpackages);
        for (let idx = 0; idx < subEntries.length; idx++) {
          const [, subDef] = subEntries[idx];
          const subName = subNames[idx];
          if (!subDef || !subName) {
            continue;
          }
          const isAutoDoc = (subDef as unknown) === 'auto:doc';
          const rawSubArch = isAutoDoc
            ? 'all'
            : typeof subDef === 'object' && subDef.arch
              ? subDef.arch
              : parentExpectedArch;
          const subArch = rawSubArch === 'all' ? 'all' : normalizeArch(rawSubArch);
          const childProducer =
            typeof subDef === 'object' && subDef.producer_arch
              ? normalizeArch(subDef.producer_arch)
              : designatedProducer;
          if (subArch === 'all') {
            if (effectiveTarget === 'all' || effectiveTarget === childProducer) {
              if (!hasMatchingDeb(subName, 'all', expectedVer)) {
                return false;
              }
            }
          } else {
            if (!hasMatchingDeb(subName, subArch, expectedVer)) {
              return false;
            }
          }
        }
      }
    } else if (targetArch) {
      const hasTargetArch = debAssets.some((a) => {
        const base = a.name.slice(0, a.name.lastIndexOf('.deb'));
        const parts = base.split('_');
        if (parts.length < 3) {
          return false;
        }
        const assetPkg = parts[0];
        if (assetPkg !== pkgName) {
          return false;
        }
        return isDebArchCompatible(a.name, targetArch);
      });
      if (!hasTargetArch) {
        return false;
      }
    }

    const body = (data.body || '').trim();
    if (body) {
      try {
        const remoteMeta = JSON.parse(body);
        if (typeof remoteMeta === 'object' && remoteMeta !== null) {
          if (remoteMeta.partial) {
            return false;
          }
          if (remoteMeta.state_hash === targetHash) {
            return true;
          }
        }
      } catch {}
    }

    const hasAuth = Boolean(process.env.GITHUB_TOKEN || process.env.GH_TOKEN);
    for (const asset of (data.assets || []) as Array<{ name?: string; browser_download_url?: string; url?: string }>) {
      if (asset.name === 'metadata.json' || asset.name === `${pkgName}_metadata.json`) {
        const downloadUrl = hasAuth && asset.url ? asset.url : asset.browser_download_url;
        if (!downloadUrl) {
          continue;
        }
        const headers = hasAuth ? { ...getAuthHeaders(), Accept: 'application/octet-stream' } : getAuthHeaders();
        const assetResp = await fetch(downloadUrl, { headers });
        if (assetResp.ok) {
          const meta = (await assetResp.json()) as { state_hash?: string; partial?: boolean };
          if (!meta.partial && meta.state_hash === targetHash) {
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
  const normArch = normalizeArch(targetArch || 'aarch64');
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

  const index: Record<string, Record<string, string>[]> = Object.create(null);
  const addEntry = (key: string, entry: Record<string, string>): void => {
    if (!index[key]) {
      index[key] = [];
    }
    index[key].push(entry);
  };

  let allReposLoaded = true;
  for (const [baseUrl, relPath] of getTermuxRepos(repoArch)) {
    let repoLoaded = false;
    for (const ext of ['.gz', '']) {
      try {
        const url = `${baseUrl}/${relPath}${ext}`;
        let text: string | null = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const timeoutSignal = AbortSignal.timeout(30000);
            const resp = await fetch(url, { headers: { 'User-Agent': USER_AGENT }, signal: timeoutSignal });
            if (resp.status === 404 || (resp.status >= 400 && resp.status < 500 && resp.status !== 429)) {
              // Permanent HTTP 4xx error (403, 404, etc.): advance to next representation immediately
              break;
            }
            if (!resp.ok) {
              if (attempt < 3) {
                await Bun.sleep(1000 * attempt);
              }
              continue;
            }
            const buf = Buffer.from(await resp.arrayBuffer());
            text = ext === '.gz' ? new TextDecoder().decode(Bun.gunzipSync(buf)) : buf.toString('utf-8');
            break;
          } catch {
            if (attempt === 3) {
              break;
            }
            await Bun.sleep(1000 * attempt);
          }
        }
        if (!text) {
          continue;
        }

        const recordStanza = (stanza: Record<string, string>, bUrl: string): void => {
          if (!stanza.Package || !stanza.Filename) {
            return;
          }
          stanza.BaseUrl = bUrl;
          addEntry(stanza.Package, stanza);
          if (!stanza.Provides) {
            return;
          }
          for (const prov of stanza.Provides.split(',')) {
            const match = prov.trim().match(/^([a-zA-Z0-9+.-]+)(?::[a-zA-Z0-9_-]+)?(?:\s*\(\s*=\s*([^)\s]+)\s*\))?$/);
            if (match?.[1]) {
              addEntry(match[1], { ...stanza, IsVirtual: 'true', ProvidedVersion: (match[2] || '').trim() });
            }
          }
        };

        let currentPkg: Record<string, string> = {};
        for (const line of text.split('\n')) {
          const trimmed = line.trimEnd();
          if (!trimmed) {
            recordStanza(currentPkg, baseUrl);
            currentPkg = {};
          } else if (trimmed.includes(':') && !trimmed.startsWith(' ')) {
            const idx = trimmed.indexOf(':');
            currentPkg[trimmed.slice(0, idx).trim()] = trimmed.slice(idx + 1).trim();
          }
        }
        recordStanza(currentPkg, baseUrl);
        repoLoaded = true;
        break;
      } catch {}
    }
    if (!repoLoaded) {
      allReposLoaded = false;
    }
  }

  if (allReposLoaded) {
    _PKG_INDICES[repoArch] = index;
    try {
      writeFileSync(cacheFile, JSON.stringify(index), 'utf-8');
    } catch {}
    return _PKG_INDICES[repoArch];
  }
  return index;
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
      const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
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

const DEP_OWNERSHIP_MANIFEST = '.repoexe_dep_ownership.json';
const PROTECTED_PREFIX_DIRS = new Set(['bin', 'lib', 'include', 'share', 'etc', 'var', 'tmp', 'libexec']);

interface DepOwnershipEntry {
  version: string;
  files: string[];
  hashes?: Record<string, string>;
}

export function computeFileFingerprint(filePath: string): string | null {
  try {
    const st = lstatSync(filePath);
    if (st.isSymbolicLink()) {
      return `symlink:${readlinkSync(filePath)}`;
    }
    if (st.isFile()) {
      const hasher = createHash('sha256');
      hasher.update(readFileSync(filePath));
      return `sha256:${hasher.digest('hex')}`;
    }
    return null;
  } catch {
    return null;
  }
}

function collectRelativePayloadEntries(rootDir: string): string[] {
  const files: string[] = [];
  if (!existsSync(rootDir)) {
    return files;
  }
  const walk = (dir: string): void => {
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      const st = lstatSync(full);
      if (st.isDirectory() && !st.isSymbolicLink()) {
        walk(full);
      } else {
        const rel = relative(rootDir, full);
        files.push(process.platform === 'win32' ? rel.replace(/\\/g, '/') : rel);
      }
    }
  };
  walk(rootDir);
  return files.sort();
}

function extractDebToStagingDir(debPath: string, stagingRoot: string): string[] {
  const extractTmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'deb_extract_'));
  try {
    const extractRes = spawnSync('dpkg-deb', ['-x', debPath, extractTmp], { encoding: 'utf-8' });
    if (extractRes.status !== 0) {
      throw new Error(`dpkg-deb failed to extract ${basename(debPath)}: ${extractRes.stderr || 'unknown error'}`);
    }

    const extractedUsr = join(extractTmp, 'data', 'data', 'com.termux', 'files', 'usr');
    const sourceUsr = existsSync(extractedUsr) ? extractedUsr : join(extractTmp, 'usr');
    if (!existsSync(sourceUsr)) {
      return [];
    }

    const relFiles = collectRelativePayloadEntries(sourceUsr);
    const cpRes = spawnSync('cp', ['-a', `${sourceUsr}/.`, `${stagingRoot}/`], { encoding: 'utf-8' });
    if (cpRes.status !== 0) {
      throw new Error(`Failed to copy extracted usr into ${stagingRoot}: ${cpRes.stderr || 'unknown error'}`);
    }
    return relFiles;
  } finally {
    ensureTreeRemovable(extractTmp);
    rmSync(extractTmp, { recursive: true, force: true });
  }
}

function extractDebToPrefix(debPath: string, prefixRoot: string): void {
  extractDebToStagingDir(debPath, prefixRoot);
}

function pruneEmptyPrefixParents(startDir: string, prefixRoot: string): void {
  let curr = startDir;
  const resolvedRoot = resolve(prefixRoot);
  while (resolve(curr) !== resolvedRoot && !relative(resolvedRoot, curr).startsWith('..')) {
    const rel = relative(resolvedRoot, curr).replace(/\\/g, '/');
    if (PROTECTED_PREFIX_DIRS.has(rel)) {
      break;
    }
    try {
      if (readdirSync(curr).length === 0) {
        rmdirSync(curr);
        curr = dirname(curr);
      } else {
        break;
      }
    } catch {
      break;
    }
  }
}

export function installDebsToPrefix(
  uniqueDebs: string[],
  effectivePrefix: string,
  stagingBaseDir: string,
  pruneUnselected = false,
): void {
  if (uniqueDebs.length === 0 && (!pruneUnselected || !existsSync(effectivePrefix))) {
    return;
  }
  mkdirSync(effectivePrefix, { recursive: true });
  const manifestPath = join(effectivePrefix, DEP_OWNERSHIP_MANIFEST);
  let manifest: Record<string, DepOwnershipEntry> = Object.create(null);
  if (existsSync(manifestPath)) {
    try {
      const parsed = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        manifest = Object.assign(Object.create(null), parsed);
      }
    } catch {}
  }

  const stagingPrefix = mkdtempSync(join(stagingBaseDir, '.prefix_staging_'));
  try {
    const batchPackages = new Map<string, DepOwnershipEntry>();
    for (const debPath of uniqueDebs) {
      const pkgName = extractDebPackage(debPath) || basename(debPath).split('_')[0];
      const pkgVer = extractDebVersion(debPath);
      const relFiles = extractDebToStagingDir(debPath, stagingPrefix);
      const existing = batchPackages.get(pkgName);
      if (existing) {
        existing.files = Array.from(new Set([...existing.files, ...relFiles])).sort();
        existing.version = pkgVer;
      } else {
        batchPackages.set(pkgName, { version: pkgVer, files: relFiles });
      }
    }

    for (const entry of batchPackages.values()) {
      entry.hashes = {};
      for (const rel of entry.files) {
        const fp = computeFileFingerprint(join(stagingPrefix, rel));
        if (fp) {
          entry.hashes[rel] = fp;
        }
      }
    }

    // Track files already tracked by manifest vs. newly added to avoid deleting unrelated pre-existing base files
    const allManifestFiles = new Set<string>();
    for (const entry of Object.values(manifest)) {
      for (const f of entry.files || []) {
        allManifestFiles.add(f);
      }
    }

    // Remove files dropped by superseded versions or unselected packages while preserving files owned by any selected dependency
    const staleFilesToRemove: Array<{ pkgName: string; rel: string }> = [];
    for (const [pkgName, newEntry] of batchPackages.entries()) {
      const prevEntry = manifest[pkgName];
      if (!prevEntry || !Array.isArray(prevEntry.files) || prevEntry.files.length === 0) {
        continue;
      }
      const newFileSet = new Set(newEntry.files);
      const otherOwnedFiles = new Set<string>();
      for (const [otherPkg, otherEntry] of Object.entries(manifest)) {
        if (otherPkg !== pkgName && !batchPackages.has(otherPkg)) {
          for (const f of otherEntry.files || []) {
            otherOwnedFiles.add(f);
          }
        }
      }
      for (const [otherPkg, otherEntry] of batchPackages.entries()) {
        if (otherPkg !== pkgName) {
          for (const f of otherEntry.files) {
            otherOwnedFiles.add(f);
          }
        }
      }

      for (const oldRel of prevEntry.files) {
        if (!newFileSet.has(oldRel) && !otherOwnedFiles.has(oldRel)) {
          staleFilesToRemove.push({ pkgName, rel: oldRel });
        }
      }
    }

    // Remove payloads owned by unselected packages left by earlier targets when pruning requested
    const unselectedPkgsToRemove: string[] = [];
    if (pruneUnselected) {
      const batchOwnedFiles = new Set<string>();
      for (const entry of batchPackages.values()) {
        for (const f of entry.files) {
          batchOwnedFiles.add(f);
        }
      }
      for (const [manifestPkg, manifestEntry] of Object.entries(manifest)) {
        if (!batchPackages.has(manifestPkg)) {
          unselectedPkgsToRemove.push(manifestPkg);
          for (const rel of manifestEntry.files || []) {
            if (!batchOwnedFiles.has(rel)) {
              staleFilesToRemove.push({ pkgName: manifestPkg, rel });
            }
          }
        }
      }
    }

    // Clear type-changing wholly-managed paths before copying to prevent cp overwrite errors.
    // Unmanaged paths or paths needed by other packages are protected: collisions reject installation.
    const backedUpCollisions: Array<{ dstPath: string; backupPath: string }> = [];
    const unrestoredBackups: Array<{ dstPath: string; backupPath: string }> = [];
    let backupDir: string | null = null;

    const retainedOtherFiles = new Set<string>();
    for (const [mPkg, mEntry] of Object.entries(manifest)) {
      if (!batchPackages.has(mPkg) && (!pruneUnselected || !unselectedPkgsToRemove.includes(mPkg))) {
        for (const f of mEntry.files || []) {
          retainedOtherFiles.add(f);
        }
      }
    }

    const getContainedManagedFiles = (dir: string, pkgName: string): string[] => {
      const result: string[] = [];
      try {
        for (const ent of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, ent.name);
          if (ent.isDirectory() && !ent.isSymbolicLink()) {
            result.push(...getContainedManagedFiles(full, pkgName));
          } else {
            result.push(relative(effectivePrefix, full));
          }
        }
      } catch (e: unknown) {
        if (e instanceof Error && e.message.startsWith('Cannot install')) {
          throw e;
        }
        throw new Error(`Cannot install '${pkgName}': cannot inspect destination directory '${dir}'.`);
      }
      return result;
    };

    const restoreCollisions = (): void => {
      for (const { dstPath, backupPath } of [...backedUpCollisions].reverse()) {
        try {
          if (existsSync(backupPath)) {
            mkdirSync(dirname(dstPath), { recursive: true });
            renameSync(backupPath, dstPath);
          }
        } catch {
          unrestoredBackups.push({ dstPath, backupPath });
        }
      }
    };

    const approvedDirToFileReplacements = new Set<string>();
    const plannedMoves: Array<{ dstPath: string; rel: string }> = [];
    const seenMoveDsts = new Set<string>();
    for (const [pkgName, entry] of batchPackages.entries()) {
      for (const rel of entry.files) {
        const srcPath = join(stagingPrefix, rel);
        const dstPath = join(effectivePrefix, rel);
        try {
          const srcStat = lstatSync(srcPath);
          const dstStat = lstatSync(dstPath);
          if (srcStat.isDirectory() !== dstStat.isDirectory()) {
            if (dstStat.isDirectory()) {
              const liveFiles = getContainedManagedFiles(dstPath, pkgName);
              for (const lf of liveFiles) {
                if (!allManifestFiles.has(lf) || retainedOtherFiles.has(lf)) {
                  throw new Error(
                    `Cannot install '${pkgName}': destination directory '${dstPath}' contains unmanaged or required files ('${lf}').`,
                  );
                }
                const liveFullPath = join(effectivePrefix, lf);
                const liveFp = computeFileFingerprint(liveFullPath);
                let recordedFp: string | undefined;
                for (const mEntry of Object.values(manifest)) {
                  if (mEntry?.hashes && mEntry.hashes[lf]) {
                    recordedFp = mEntry.hashes[lf];
                    break;
                  }
                }
                if (!recordedFp || !liveFp || recordedFp !== liveFp) {
                  throw new Error(
                    `Cannot install '${pkgName}': destination directory '${dstPath}' contains modified or unverified files ('${lf}').`,
                  );
                }
              }
              approvedDirToFileReplacements.add(rel);
            } else {
              if (!allManifestFiles.has(rel) || retainedOtherFiles.has(rel)) {
                throw new Error(
                  `Cannot install '${pkgName}': destination file '${dstPath}' is unmanaged or required by another package.`,
                );
              }
              const liveFp = computeFileFingerprint(dstPath);
              let recordedFp: string | undefined;
              for (const mEntry of Object.values(manifest)) {
                if (mEntry?.hashes && mEntry.hashes[rel]) {
                  recordedFp = mEntry.hashes[rel];
                  break;
                }
              }
              if (!recordedFp || !liveFp || recordedFp !== liveFp) {
                throw new Error(
                  `Cannot install '${pkgName}': destination file '${dstPath}' is modified or unverified.`,
                );
              }
            }
            if (!seenMoveDsts.has(dstPath)) {
              seenMoveDsts.add(dstPath);
              plannedMoves.push({ dstPath, rel });
            }
          }
        } catch (e: unknown) {
          if (e instanceof Error && e.message.startsWith('Cannot install')) {
            throw e;
          }
        }
      }
    }

    // Record only files that either did not exist before or were already managed by RepoExe
    const newlyTrackedByPkg = new Map<string, DepOwnershipEntry>();
    for (const [pkgName, entry] of batchPackages.entries()) {
      const prevSet = new Set(manifest[pkgName]?.files || []);
      const ownedFiles = entry.files.filter((rel) => {
        if (approvedDirToFileReplacements.has(rel) || prevSet.has(rel) || allManifestFiles.has(rel)) {
          return true;
        }
        try {
          lstatSync(join(effectivePrefix, rel));
          return false; // Pre-existing unmanaged file in PREFIX; do not claim deletion ownership
        } catch {
          return true;
        }
      });
      const ownedHashes: Record<string, string> = {};
      if (entry.hashes) {
        for (const rel of ownedFiles) {
          if (entry.hashes[rel]) {
            ownedHashes[rel] = entry.hashes[rel];
          }
        }
      }
      newlyTrackedByPkg.set(pkgName, { version: entry.version, files: ownedFiles, hashes: ownedHashes });
    }

    try {
      try {
        if (plannedMoves.length > 0) {
          mkdirSync(effectivePrefix, { recursive: true });
          backupDir = mkdtempSync(join(effectivePrefix, '.collision_backup_'));
          for (const { dstPath, rel } of plannedMoves) {
            const backupPath = join(backupDir, rel);
            mkdirSync(dirname(backupPath), { recursive: true });
            renameSync(dstPath, backupPath);
            backedUpCollisions.push({ dstPath, backupPath });
          }
        }

        const stagingEntries = existsSync(stagingPrefix) ? readdirSync(stagingPrefix) : [];
        if (stagingEntries.length > 0) {
          const cpSources = stagingEntries.map((e) => join(stagingPrefix, e));
          const cpRes = spawnSync('cp', ['-a', ...cpSources, `${effectivePrefix}/`], { encoding: 'utf-8' });
          if (cpRes.status !== 0) {
            restoreCollisions();
            throw new Error(
              `Failed to copy staging prefix into ${effectivePrefix}: ${cpRes.stderr || 'unknown copy error'}`,
            );
          }
        }
      } catch (err) {
        restoreCollisions();
        throw err;
      }
    } finally {
      if (backupDir && existsSync(backupDir)) {
        if (unrestoredBackups.length > 0) {
          console.warn(
            `::warning:: Could not restore collision backup(s) during rollback; retaining backup at: ${backupDir} (${unrestoredBackups.map((u) => u.dstPath).join(', ')})`,
          );
        } else {
          ensureTreeRemovable(backupDir);
          rmSync(backupDir, { recursive: true, force: true });
        }
      }
    }

    // Remove stale files from superseded dependency versions only after copy succeeds
    const failedRemovalRelsByPkg = new Map<string, string[]>();
    for (const { pkgName, rel: oldRel } of staleFilesToRemove) {
      const targetPath = join(effectivePrefix, oldRel);
      try {
        try {
          lstatSync(targetPath);
        } catch {
          // Already absent
          continue;
        }
        // Pruning never deletes a tracked file that another installer has modified/replaced
        const expectedHash = manifest[pkgName]?.hashes?.[oldRel];
        if (expectedHash) {
          const currentHash = computeFileFingerprint(targetPath);
          if (currentHash !== expectedHash) {
            continue;
          }
        }
        rmSync(targetPath, { force: true });
        try {
          lstatSync(targetPath);
          console.warn(`::warning:: Failed to remove stale dependency file '${targetPath}' for package '${pkgName}'`);
          failedRemovalRelsByPkg.set(pkgName, [...(failedRemovalRelsByPkg.get(pkgName) || []), oldRel]);
        } catch {
          pruneEmptyPrefixParents(dirname(targetPath), effectivePrefix);
        }
      } catch (rmErr) {
        console.warn(
          `::warning:: Failed to remove stale dependency file '${targetPath}' for package '${pkgName}': ${rmErr instanceof Error ? rmErr.message : String(rmErr)}`,
        );
        failedRemovalRelsByPkg.set(pkgName, [...(failedRemovalRelsByPkg.get(pkgName) || []), oldRel]);
      }
    }

    for (const [pkgName, entry] of newlyTrackedByPkg.entries()) {
      const failedRels = failedRemovalRelsByPkg.get(pkgName) || [];
      const combinedFiles = Array.from(new Set([...entry.files, ...failedRels]));
      const existingHashes = manifest[pkgName]?.hashes || {};
      const combinedHashes: Record<string, string> = {};
      for (const rel of failedRels) {
        if (existingHashes[rel]) {
          combinedHashes[rel] = existingHashes[rel];
        }
      }
      if (entry.hashes) {
        Object.assign(combinedHashes, entry.hashes);
      }
      manifest[pkgName] = {
        ...entry,
        files: combinedFiles,
        hashes: Object.keys(combinedHashes).length > 0 ? combinedHashes : entry.hashes,
      };
    }
    for (const unselectedPkg of unselectedPkgsToRemove) {
      const failedRels = failedRemovalRelsByPkg.get(unselectedPkg);
      if (failedRels && failedRels.length > 0) {
        const existingHashes = manifest[unselectedPkg]?.hashes || {};
        const retainedHashes: Record<string, string> = {};
        for (const rel of failedRels) {
          if (existingHashes[rel]) {
            retainedHashes[rel] = existingHashes[rel];
          }
        }
        manifest[unselectedPkg] = {
          version: manifest[unselectedPkg]?.version || 'unknown',
          files: failedRels,
          hashes: Object.keys(retainedHashes).length > 0 ? retainedHashes : undefined,
        };
      } else {
        delete manifest[unselectedPkg];
      }
    }
    const tmpManifestPath = `${manifestPath}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    writeFileSync(tmpManifestPath, JSON.stringify(manifest, null, 2), 'utf-8');
    renameSync(tmpManifestPath, manifestPath);
  } finally {
    ensureTreeRemovable(stagingPrefix);
    rmSync(stagingPrefix, { recursive: true, force: true });
  }
}

export function parseFilenameDebVersion(filename: string): string {
  const stem = basename(filename)
    .replace(/\.deb$/, '')
    .replace(/_(aarch64|arm64|x86_64|amd64|arm|armhf|armel|armv7|i686|i386|all)$/i, '');
  const firstUnder = stem.indexOf('_');
  return firstUnder === -1 ? '' : stem.slice(firstUnder + 1).replace(/_/g, ':');
}

export function extractDebControlVersion(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Version'], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      const v = res.stdout.trim();
      return v || null;
    }
  } catch {}
  return null;
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
    const res = spawnSync('dpkg-deb', ['-f', debPath], { encoding: 'utf-8' });
    if (res.status === 0 && typeof res.stdout === 'string') {
      const control = res.stdout;
      const extractField = (fieldName: string): string | undefined => {
        const lines = control.split(/\r?\n/);
        let inField = false;
        const fieldLines: string[] = [];
        const prefix = `${fieldName.toLowerCase()}:`;
        for (const line of lines) {
          if (!inField) {
            if (line.toLowerCase().startsWith(prefix)) {
              inField = true;
              fieldLines.push(line.slice(prefix.length).trim());
            }
          } else {
            if (/^[ \t]/.test(line)) {
              fieldLines.push(line.trim());
            } else {
              break;
            }
          }
        }
        if (!inField) {
          return undefined;
        }
        return fieldLines.join(' ').trim();
      };
      const depVal = extractField('Depends');
      const preDepVal = extractField('Pre-Depends');
      const parts: string[] = [];
      if (depVal) {
        parts.push(depVal);
      }
      if (preDepVal) {
        parts.push(preDepVal);
      }
      return parts.join(', ');
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

function extractDebPackage(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Package'], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim() || null;
    }
  } catch {}
  return null;
}

function extractDebArchitecture(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Architecture'], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      return res.stdout.trim() || null;
    }
  } catch {}
  return null;
}

function extractDebArch(debPath: string): string {
  const ctrlArch = extractDebArchitecture(debPath);
  if (ctrlArch) {
    return ctrlArch;
  }
  const m = basename(debPath).match(/_([a-zA-Z0-9]+)\.deb$/);
  return m ? m[1] : 'unknown';
}

function getInstalledSystemVersion(pkgName: string): string | null {
  try {
    const res = spawnSync('dpkg-query', ['-W', '-f=${Status}\t${Version}', pkgName], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      const [statusPart, verPart] = res.stdout.trim().split('\t');
      if (statusPart && verPart) {
        const words = statusPart.trim().split(/\s+/);
        if (words[2] === 'installed' && verPart.trim()) {
          return verPart.trim();
        }
      }
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
  // 1. Identify active root packages: requirements originating from outside activeConstraints (or without source)
  const reachable = new Set<string>();
  const queue: string[] = [];

  for (const [pkg, constraints] of activeConstraints.entries()) {
    if (pkg === candidate) {
      continue;
    }
    const hasActiveRoot = constraints.some(
      (c) => !c.source || (c.source !== candidate && !activeConstraints.has(c.source)),
    );
    if (hasActiveRoot) {
      reachable.add(pkg);
      queue.push(pkg);
    }
  }

  // 2. BFS: propagate reachability through constraints
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const [pkg, constraints] of activeConstraints.entries()) {
      if (pkg === candidate || reachable.has(pkg)) {
        continue;
      }
      if (constraints.some((c) => c.source === current)) {
        reachable.add(pkg);
        queue.push(pkg);
      }
    }
  }

  // 3. Any package not reachable from active roots is retiring
  const retiringSources = new Set<string>([candidate]);
  for (const pkg of activeConstraints.keys()) {
    if (!reachable.has(pkg)) {
      retiringSources.add(pkg);
    }
  }

  // 4. Filter constraints to remove retiring sources and prune empty entries
  for (const [pkg, constraints] of activeConstraints.entries()) {
    const retained = constraints.filter((c) => !c.source || !retiringSources.has(c.source));
    if (retained.length === 0) {
      activeConstraints.delete(pkg);
    } else {
      activeConstraints.set(pkg, retained);
    }
  }
}

export function pruneOrphanedPending(
  candidate: string,
  activeConstraints: Map<string, VersionConstraint[]>,
  fetched: Set<string>,
  selectedVersions: Map<string, string>,
  resolving: Set<string>,
  pendingDebs?: Map<string, string>,
): void {
  if (!pendingDebs) {
    return;
  }
  const liveDebs = new Set([...activeConstraints.keys(), ...resolving].map((k) => pendingDebs.get(k)).filter(Boolean));
  for (const [p, debPath] of Array.from(pendingDebs.entries())) {
    if (p !== candidate && !activeConstraints.has(p) && !resolving.has(p) && !liveDebs.has(debPath)) {
      pendingDebs.delete(p);
      fetched.delete(p);
      selectedVersions.delete(p);
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
  customArtifactDirs?: string[],
  artifactCache: Map<string, string[]> = new Map<string, string[]>(),
): Promise<boolean> {
  if (!dependsStr) {
    return true;
  }
  const isDirectCaller = !pendingDebs;
  const effectivePending = pendingDebs || new Map<string, string>();
  const clauses = parseDependencyList(dependsStr);
  const filtered = filterDepsForArch(clauses, repoArch);

  const restoreLocal = (
    snapF: Set<string>,
    snapV: Map<string, string>,
    snapP: Map<string, string> | null,
    snapC: Map<string, VersionConstraint[]>,
  ): void => {
    fetched.clear();
    for (const f of snapF) {
      fetched.add(f);
    }
    selectedVersions.clear();
    for (const [k, v] of snapV) {
      selectedVersions.set(k, v);
    }
    if (snapP) {
      effectivePending.clear();
      for (const [k, v] of snapP) {
        effectivePending.set(k, v);
      }
    }
    activeConstraints.clear();
    for (const [k, v] of snapC) {
      activeConstraints.set(k, [...v]);
    }
  };

  let backtrackSteps = 0;
  let budgetExhausted = false;
  const MAX_BACKTRACK_STEPS = 256;

  const solveClauseIndex = async (clauseIdx: number): Promise<boolean> => {
    if (clauseIdx >= filtered.length) {
      return true;
    }

    const branch = filtered[clauseIdx];
    let candidateAttempt = 0;
    for (const token of branch) {
      if (candidateAttempt > 0) {
        if (++backtrackSteps > MAX_BACKTRACK_STEPS) {
          budgetExhausted = true;
          return false;
        }
      }
      candidateAttempt++;
      const cleanTokenName = token.name.split(':')[0].trim();
      const snapF = new Set(fetched);
      const snapV = new Map(selectedVersions);
      const snapP = new Map(effectivePending);
      const snapC = new Map(Array.from(activeConstraints.entries()).map(([k, v]) => [k, [...v]]));

      let tokenOk = false;

      if (['dpkg', 'apt', 'bash', 'termux-tools', 'command-not-found'].includes(cleanTokenName)) {
        const stagedVer = selectedVersions.get(cleanTokenName);
        if (stagedVer) {
          if (!token.versionConstraint || satisfiesVersionConstraint(stagedVer, token.versionConstraint)) {
            recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
            tokenOk = true;
          }
        } else if (!token.versionConstraint) {
          recordConstraint(activeConstraints, cleanTokenName, undefined, requester);
          tokenOk = true;
        } else {
          const instVer = getInstalledSystemVersion(cleanTokenName);
          if (instVer && satisfiesVersionConstraint(instVer, token.versionConstraint)) {
            recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
            tokenOk = true;
          }
        }
      }

      const reqExplicitArch = token.multiArch && token.multiArch !== 'any' ? normalizeArch(token.multiArch) : undefined;
      const reqExpectedArch = reqExplicitArch || (repoArch === 'all' ? undefined : normalizeArch(repoArch));

      if (!tokenOk && resolving.has(cleanTokenName)) {
        const resolvingDeb = effectivePending.get(cleanTokenName);
        let archOk = true;
        if (resolvingDeb && reqExpectedArch) {
          const debArch = normalizeArch(extractDebArch(resolvingDeb));
          if (debArch !== 'all' && debArch !== reqExpectedArch) {
            archOk = false;
          }
        }
        const resolvingVer = selectedVersions.get(cleanTokenName);
        if (
          archOk &&
          (!token.versionConstraint ||
            (resolvingVer && satisfiesVersionConstraint(resolvingVer, token.versionConstraint)))
        ) {
          recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
          tokenOk = true;
        } else {
          restoreLocal(snapF, snapV, snapP, snapC);
          continue;
        }
      }

      if (!tokenOk && fetched.has(cleanTokenName)) {
        const cachedVer = selectedVersions.get(cleanTokenName);
        const cachedDeb = effectivePending.get(cleanTokenName);
        let archOk = true;
        if (cachedDeb && reqExpectedArch) {
          const debArch = normalizeArch(extractDebArch(cachedDeb));
          if (debArch !== 'all' && debArch !== reqExpectedArch) {
            archOk = false;
          }
        }
        const existing = activeConstraints.get(cleanTokenName) || [];
        if (
          archOk &&
          (!token.versionConstraint || (cachedVer && satisfiesVersionConstraint(cachedVer, token.versionConstraint)))
        ) {
          recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
          tokenOk = true;
        } else if (!archOk) {
          restoreLocal(snapF, snapV, snapP, snapC);
          continue;
        } else {
          const allConstraints = [...existing, ...(token.versionConstraint ? [token.versionConstraint] : [])];
          const equalities = allConstraints.filter((c) => c?.operator === '=');
          if (equalities.length > 1 && equalities.some((c) => c?.version !== equalities[0]?.version)) {
            restoreLocal(snapF, snapV, snapP, snapC);
            continue;
          }

          retireCandidateConstraints(activeConstraints, cleanTokenName);
          pruneOrphanedPending(
            cleanTokenName,
            activeConstraints,
            fetched,
            selectedVersions,
            resolving,
            effectivePending,
          );

          const oldPending = effectivePending.get(cleanTokenName);
          const affectedAliases = oldPending
            ? Array.from(effectivePending.entries())
                .filter(
                  ([k, v]) => v === oldPending && k !== cleanTokenName && (activeConstraints.get(k)?.length ?? 0) > 0,
                )
                .map(([k]) => k)
            : [];
          for (const alias of affectedAliases) {
            fetched.delete(alias);
            selectedVersions.delete(alias);
            effectivePending.delete(alias);
          }

          fetched.delete(cleanTokenName);
          selectedVersions.delete(cleanTokenName);
          effectivePending.delete(cleanTokenName);

          try {
            const depStr = formatDebianDependency([[token]]);
            const ok = await fetchSingleDep(
              depStr,
              destdir,
              fetched,
              targetArch,
              resolving,
              effectivePending,
              subpackageMap,
              selectedVersions,
              activeConstraints,
              requester,
              customArtifactDirs,
              artifactCache,
            );
            if (ok) {
              const newPending = effectivePending.get(cleanTokenName);
              let aliasesOk = true;
              if (newPending && affectedAliases.length > 0) {
                const newProvides = extractDebProvides(newPending);
                for (const alias of affectedAliases) {
                  let aliasProvVer: string | undefined;
                  let isProvided = false;
                  if (newProvides) {
                    for (const clause of parseDependencyList(newProvides)) {
                      for (const tok of clause) {
                        if (tok.name.split(':')[0].trim() === alias) {
                          aliasProvVer = tok.versionConstraint?.version || '';
                          isProvided = true;
                          break;
                        }
                      }
                      if (isProvided) {
                        break;
                      }
                    }
                  }
                  const aliasConstraints = activeConstraints.get(alias) || [];
                  if (isProvided && satisfiesAllConstraints(aliasProvVer || '', aliasConstraints)) {
                    effectivePending.set(alias, newPending);
                    fetched.add(alias);
                    if (aliasProvVer) {
                      selectedVersions.set(alias, aliasProvVer);
                    }
                  } else {
                    const aliasOk = await fetchSingleDep(
                      alias,
                      destdir,
                      fetched,
                      targetArch,
                      resolving,
                      effectivePending,
                      subpackageMap,
                      selectedVersions,
                      activeConstraints,
                      requester,
                      customArtifactDirs,
                      artifactCache,
                    );
                    if (!aliasOk) {
                      aliasesOk = false;
                      break;
                    }
                  }
                }
              }
              if (aliasesOk) {
                recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
                tokenOk = true;
              }
            }
          } catch {}
        }
      } else if (!tokenOk) {
        try {
          const depStr = formatDebianDependency([[token]]);
          const depTargetArch = reqExpectedArch || targetArch;
          const ok = await fetchSingleDep(
            depStr,
            destdir,
            fetched,
            depTargetArch,
            resolving,
            effectivePending,
            subpackageMap,
            selectedVersions,
            activeConstraints,
            requester,
            customArtifactDirs,
            artifactCache,
          );
          if (ok) {
            recordConstraint(activeConstraints, cleanTokenName, token.versionConstraint, requester);
            tokenOk = true;
          }
        } catch {}
      }

      if (tokenOk) {
        if (await solveClauseIndex(clauseIdx + 1)) {
          return true;
        }
        if (++backtrackSteps > MAX_BACKTRACK_STEPS) {
          budgetExhausted = true;
          restoreLocal(snapF, snapV, snapP, snapC);
          return false;
        }
      }

      restoreLocal(snapF, snapV, snapP, snapC);
    }

    return false;
  };

  const solved = await solveClauseIndex(0);
  if (budgetExhausted) {
    console.warn(
      `Warning: Dependency resolution backtracking budget of ${MAX_BACKTRACK_STEPS} steps exhausted for '${requester}'.`,
    );
  }
  if (solved) {
    if (isDirectCaller && effectivePending.size > 0) {
      const prefixRoot = process.env.PREFIX || PREFIX;
      try {
        installDebsToPrefix(Array.from(new Set(effectivePending.values())), prefixRoot, destdir);
      } catch {
        if (snapshotFetched) {
          fetched.clear();
          for (const p of snapshotFetched) {
            fetched.add(p);
          }
        }
        if (snapshotPending) {
          effectivePending.clear();
          for (const [k, v] of snapshotPending) {
            effectivePending.set(k, v);
          }
        }
        if (snapshotVersions) {
          selectedVersions.clear();
          for (const [k, v] of snapshotVersions) {
            selectedVersions.set(k, v);
          }
        }
        return false;
      }
    }
    return true;
  }

  if (snapshotFetched) {
    fetched.clear();
    for (const p of snapshotFetched) {
      fetched.add(p);
    }
  }
  if (snapshotPending) {
    effectivePending.clear();
    for (const [k, v] of snapshotPending) {
      effectivePending.set(k, v);
    }
    if (pendingDebs) {
      pendingDebs.clear();
      for (const [k, v] of snapshotPending) {
        pendingDebs.set(k, v);
      }
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

/**
 * Fetches a single dependency (local artifact, GitHub release, or upstream Termux repo).
 *
 * @param dep Dependency specification string (e.g. 'pkg (>= 1.0)', 'pkg:arm', or 'pkg:any').
 * @param destdir Destination directory to unpack or download deb archives into.
 * @param fetched Set of package names already fetched.
 * @param targetArch Target architecture. When set to 'all', resolves through concrete architecture fallback (defaults
 *   to 'aarch64').
 * @param resolving Set of package names currently being recursively resolved.
 * @param pendingDebs Map of package/alias name to staged deb path.
 * @param subpackageMap Mapping of subpackage name to parent recipe name.
 * @param selectedVersions Map of package name to selected version.
 * @param activeConstraints Map of package name to active version constraints.
 * @param requester Name of the package requesting this dependency.
 * @param customArtifactDirs Optional custom directories to search for local artifacts.
 * @param artifactCache Optional cache of sorted local artifacts per directory and architecture.
 */
export async function fetchSingleDep(
  dep: string,
  destdir: string,
  fetched: Set<string> = new Set<string>(),
  targetArch: string = 'aarch64',
  resolving: Set<string> = new Set<string>(),
  pendingDebs?: Map<string, string>,
  subpackageMap?: Record<string, string>,
  selectedVersions: Map<string, string> = new Map<string, string>(),
  activeConstraints: Map<string, VersionConstraint[]> = new Map<string, VersionConstraint[]>(),
  requester?: string,
  customArtifactDirs?: string[],
  artifactCache?: Map<string, string[]>,
): Promise<boolean> {
  const isDirectCaller = !pendingDebs;
  const effectivePending = pendingDebs || new Map<string, string>();

  const prefixRoot = process.env.PREFIX || PREFIX;
  try {
    mkdirSync(prefixRoot, { recursive: true });
  } catch {}
  mkdirSync(destdir, { recursive: true });

  const commitSuccess = (): boolean => {
    if (isDirectCaller && effectivePending.size > 0) {
      try {
        installDebsToPrefix(Array.from(new Set(effectivePending.values())), prefixRoot, destdir);
      } catch {
        if (snapshotFetched) {
          fetched.clear();
          for (const p of snapshotFetched) {
            fetched.add(p);
          }
        }
        if (snapshotPending) {
          effectivePending.clear();
          for (const [k, v] of snapshotPending) {
            effectivePending.set(k, v);
          }
        }
        if (snapshotVersions) {
          selectedVersions.clear();
          for (const [k, v] of snapshotVersions) {
            selectedVersions.set(k, v);
          }
        }
        return false;
      }
    }
    return true;
  };

  const parsedClauses = parseDependencyList(dep);
  const token = parsedClauses[0]?.[0];
  const pkgName = token ? token.name.split(':')[0].trim() : parseDepSpec(dep)[0].split(':')[0].trim();
  const constraint = token?.versionConstraint;
  const explicitArch = token?.multiArch && token.multiArch !== 'any' ? normalizeArch(token.multiArch) : undefined;
  const effectiveArch = explicitArch || targetArch;

  let allConstraints = [...(activeConstraints.get(pkgName) || []), ...(constraint ? [constraint] : [])];

  if (resolving.has(pkgName)) {
    if (effectivePending.size > 0 && !effectivePending.has(pkgName)) {
      return false;
    }
    const resolvingDeb = effectivePending.get(pkgName);
    if (resolvingDeb && explicitArch) {
      const resolvingArch = normalizeArch(extractDebArch(resolvingDeb));
      if (resolvingArch !== 'all' && resolvingArch !== explicitArch) {
        return false;
      }
    }
    const resolvingVer = selectedVersions.get(pkgName);
    return !constraint || Boolean(resolvingVer && satisfiesVersionConstraint(resolvingVer, constraint));
  }

  let rollbackRevision: (() => void) | undefined;
  let affectedAliases: string[] = [];

  if (fetched.has(pkgName)) {
    const cachedVer = selectedVersions.get(pkgName);
    const cachedDeb = effectivePending.get(pkgName);
    let archCompatible = true;
    if (cachedDeb && explicitArch) {
      const cachedArch = normalizeArch(extractDebArch(cachedDeb));
      if (cachedArch !== 'all' && cachedArch !== explicitArch) {
        archCompatible = false;
      }
    }
    if (archCompatible && (!constraint || (cachedVer && satisfiesVersionConstraint(cachedVer, constraint)))) {
      recordConstraint(activeConstraints, pkgName, constraint, requester);
      return commitSuccess();
    }
    if (!archCompatible) {
      return false;
    }

    const equalities = allConstraints.filter((c) => c.operator === '=');
    if (equalities.length > 1 && equalities.some((c) => c.version !== equalities[0].version)) {
      return false;
    }

    const oldDebPath = effectivePending.get(pkgName);
    affectedAliases = oldDebPath
      ? Array.from(effectivePending.entries())
          .filter(([k, v]) => v === oldDebPath && k !== pkgName)
          .map(([k]) => k)
      : [];
    const oldAliasVers = new Map<string, string>();
    for (const alias of affectedAliases) {
      const v = selectedVersions.get(alias);
      if (v) {
        oldAliasVers.set(alias, v);
      }
      fetched.delete(alias);
      selectedVersions.delete(alias);
      effectivePending.delete(alias);
    }

    fetched.delete(pkgName);
    selectedVersions.delete(pkgName);
    effectivePending.delete(pkgName);
    const snapshotConstraintsBeforeRetirement = new Map(
      Array.from(activeConstraints.entries()).map(([k, v]) => [k, [...v]]),
    );
    const snapshotPendingBeforeRetirement = new Map(effectivePending);
    const snapshotFetchedBeforeRetirement = new Set(fetched);
    const snapshotVersionsBeforeRetirement = new Map(selectedVersions);

    retireCandidateConstraints(activeConstraints, pkgName);
    pruneOrphanedPending(pkgName, activeConstraints, fetched, selectedVersions, resolving, effectivePending);
    allConstraints = [...(activeConstraints.get(pkgName) || []), ...(constraint ? [constraint] : [])];

    rollbackRevision = (): void => {
      activeConstraints.clear();
      for (const [k, v] of snapshotConstraintsBeforeRetirement) {
        activeConstraints.set(k, [...v]);
      }
      effectivePending.clear();
      for (const [k, v] of snapshotPendingBeforeRetirement) {
        effectivePending.set(k, v);
      }
      fetched.clear();
      for (const f of snapshotFetchedBeforeRetirement) {
        fetched.add(f);
      }
      selectedVersions.clear();
      for (const [k, v] of snapshotVersionsBeforeRetirement) {
        selectedVersions.set(k, v);
      }
      fetched.add(pkgName);
      if (cachedVer) {
        selectedVersions.set(pkgName, cachedVer);
      }
      if (oldDebPath) {
        effectivePending.set(pkgName, oldDebPath);
      }
      for (const alias of affectedAliases) {
        fetched.add(alias);
        const v = oldAliasVers.get(alias);
        if (v) {
          selectedVersions.set(alias, v);
        }
        if (oldDebPath) {
          effectivePending.set(alias, oldDebPath);
        }
      }
    };
  }

  const isMappedSubpkg = Boolean(
    subpackageMap?.[pkgName] ||
    (pkgName.endsWith('-dev') && existsSync(join('pkg', pkgName.slice(0, -4), 'recipe.ts'))) ||
    ((pkgName.endsWith('-static') || pkgName.endsWith('-doc') || pkgName.endsWith('-man')) &&
      existsSync(join('pkg', pkgName.replace(/-(static|doc|man)$/, ''), 'recipe.ts'))),
  );

  const hasActiveVersionPredicate = allConstraints.some((c) => Boolean(c.operator && c.version));
  if (
    !isMappedSubpkg &&
    !hasActiveVersionPredicate &&
    (pkgName.endsWith('-static') || pkgName.endsWith('-doc') || pkgName.endsWith('-man'))
  ) {
    fetched.add(pkgName);
    return commitSuccess();
  }

  const normArch = normalizeArch(effectiveArch || 'aarch64');
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';
  const outputDir = resolve('output');

  const snapshotFetched = new Set(fetched);
  const snapshotPending = new Map(effectivePending);
  const snapshotVersions = new Map(selectedVersions);
  const snapshotConstraints = new Map(Array.from(activeConstraints.entries()).map(([k, v]) => [k, [...v]]));

  const rollbackCandidate = (): void => {
    fetched.clear();
    for (const p of snapshotFetched) {
      fetched.add(p);
    }
    effectivePending.clear();
    for (const [k, v] of snapshotPending) {
      effectivePending.set(k, v);
    }
    selectedVersions.clear();
    for (const [k, v] of snapshotVersions) {
      selectedVersions.set(k, v);
    }
    activeConstraints.clear();
    for (const [k, v] of snapshotConstraints) {
      activeConstraints.set(k, [...v]);
    }
  };

  const commitCandidate = async (newDebPath?: string): Promise<boolean> => {
    if (newDebPath && affectedAliases.length > 0) {
      const newProvides = extractDebProvides(newDebPath);
      for (const alias of affectedAliases) {
        let aliasProvVer: string | undefined;
        let isProvided = false;
        if (newProvides) {
          for (const clause of parseDependencyList(newProvides)) {
            for (const tok of clause) {
              if (tok.name.split(':')[0].trim() === alias) {
                aliasProvVer = tok.versionConstraint?.version || '';
                isProvided = true;
                break;
              }
            }
            if (isProvided) {
              break;
            }
          }
        }
        const aliasConstraints = activeConstraints.get(alias) || [];
        if (isProvided && satisfiesAllConstraints(aliasProvVer || '', aliasConstraints)) {
          effectivePending.set(alias, newDebPath);
          fetched.add(alias);
          if (aliasProvVer) {
            selectedVersions.set(alias, aliasProvVer);
          }
        } else {
          const aliasOk = await fetchSingleDep(
            alias,
            destdir,
            fetched,
            targetArch,
            resolving,
            effectivePending,
            subpackageMap,
            selectedVersions,
            activeConstraints,
            requester,
            customArtifactDirs,
          );
          if (!aliasOk) {
            return false;
          }
        }
      }
    }
    return commitSuccess();
  };

  try {
    // 1. Local artifacts
    const checkArtifacts = (dir: string): string[] => {
      try {
        if (existsSync(dir) && lstatSync(dir).isDirectory()) {
          const cacheKey = `${dir}:${repoArch}`;
          if (artifactCache?.has(cacheKey)) {
            return artifactCache.get(cacheKey)!;
          }
          const files = readdirSync(dir).filter((f) => f.endsWith('.deb') && isDebArchCompatible(f, repoArch));
          files.sort((a, b) => {
            const verA = parseFilenameDebVersion(a);
            const verB = parseFilenameDebVersion(b);
            const vCmp = compareDebianVersions(verB, verA); // descending version order
            if (vCmp !== 0) {
              return vCmp;
            }
            return a.localeCompare(b); // deterministic filename tie-breaker
          });
          const result = files.map((f) => join(dir, f));
          artifactCache?.set(cacheKey, result);
          return result;
        }
      } catch {}
      return [];
    };
    const localDirs = customArtifactDirs !== undefined ? customArtifactDirs : ['artifacts', outputDir];
    const localArts = localDirs.flatMap((dir) => checkArtifacts(dir));
    for (const chosenDeb of localArts) {
      const debControlArch = extractDebArchitecture(chosenDeb);
      if (
        debControlArch &&
        (!CANONICAL_ARCHES.has(normalizeArch(debControlArch)) || !isDebArchCompatible(debControlArch, repoArch))
      ) {
        continue;
      }
      if (
        explicitArch &&
        debControlArch &&
        debControlArch !== 'all' &&
        normalizeArch(debControlArch) !== explicitArch
      ) {
        continue;
      }
      const debPkg = extractDebPackage(chosenDeb);
      let matchedVersion: string | undefined;
      let isVirtualMatch = false;

      if (debPkg === pkgName) {
        matchedVersion = extractDebVersion(chosenDeb);
      } else {
        const debProvides = extractDebProvides(chosenDeb);
        if (debProvides) {
          for (const provClause of parseDependencyList(debProvides)) {
            for (const provTok of provClause) {
              const provName = provTok.name.split(':')[0].trim();
              if (provName === pkgName) {
                isVirtualMatch = true;
                matchedVersion = provTok.versionConstraint?.version || '';
                break;
              }
            }
            if (isVirtualMatch) {
              break;
            }
          }
        }
      }

      if (!debPkg || matchedVersion === undefined) {
        continue;
      }
      if (!satisfiesAllConstraints(matchedVersion, allConstraints)) {
        continue;
      }
      const concreteVer = extractDebVersion(chosenDeb);
      if (!concreteVer) {
        continue;
      }
      if (isVirtualMatch) {
        const concreteConstraints = activeConstraints.get(debPkg) || [];
        if (!satisfiesAllConstraints(concreteVer, concreteConstraints)) {
          continue;
        }
        if (selectedVersions.has(debPkg) && selectedVersions.get(debPkg) !== concreteVer) {
          continue;
        }
      }
      const debDeps = extractDebDepends(chosenDeb);
      if (debDeps === null) {
        console.warn(`::warning:: Corrupt control metadata in ${basename(chosenDeb)}, skipping candidate.`);
        continue;
      }
      console.log(`✓ Found local artifact for dependency '${pkgName}': ${basename(chosenDeb)}`);
      recordOrExtractDeb(pkgName, chosenDeb, prefixRoot, effectivePending);
      fetched.add(pkgName);
      selectedVersions.set(pkgName, matchedVersion);
      if (isVirtualMatch) {
        fetched.add(debPkg);
        selectedVersions.set(debPkg, concreteVer);
        effectivePending.set(debPkg, chosenDeb);
        resolving.add(debPkg);
      }
      recordConstraint(activeConstraints, pkgName, constraint, requester);
      resolving.add(pkgName);
      const depsOk = await resolvePackageDependencies(
        debDeps,
        destdir,
        fetched,
        targetArch,
        repoArch,
        resolving,
        effectivePending,
        subpackageMap,
        snapshotFetched,
        snapshotPending,
        selectedVersions,
        snapshotVersions,
        activeConstraints,
        snapshotConstraints,
        pkgName,
        customArtifactDirs,
        artifactCache,
      );
      resolving.delete(pkgName);
      if (isVirtualMatch) {
        resolving.delete(debPkg);
      }
      if (depsOk) {
        const ok = await commitCandidate(chosenDeb);
        if (ok) {
          return true;
        }
        rollbackCandidate();
      }
      rollbackCandidate();
    }

    // 2. RepoExe GitHub releases
    const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
    const releaseOwner =
      subpackageMap && subpackageMap[pkgName]
        ? subpackageMap[pkgName]
        : pkgName.endsWith('-dev') && existsSync(join('pkg', pkgName.slice(0, -4), 'recipe.ts'))
          ? pkgName.slice(0, -4)
          : pkgName;
    const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${releaseOwner}`;
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
          typeof a?.name === 'string' && a.name.startsWith(`${pkgName}_`) && isDebArchCompatible(a.name, repoArch),
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
        const debPkg = extractDebPackage(debPath);
        if (debPkg && debPkg !== pkgName) {
          rmSync(debPath, { force: true });
          rollbackCandidate();
          continue;
        }
        const debControlArch = extractDebArchitecture(debPath);
        if (
          debControlArch &&
          (!CANONICAL_ARCHES.has(normalizeArch(debControlArch)) || !isDebArchCompatible(debControlArch, repoArch))
        ) {
          rmSync(debPath, { force: true });
          rollbackCandidate();
          continue;
        }
        if (
          explicitArch &&
          debControlArch &&
          debControlArch !== 'all' &&
          normalizeArch(debControlArch) !== explicitArch
        ) {
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
        effectivePending.set(pkgName, debPath);
        fetched.add(pkgName);
        selectedVersions.set(pkgName, actualVer);
        recordConstraint(activeConstraints, pkgName, constraint, requester);
        resolving.add(pkgName);
        const depsOk = await resolvePackageDependencies(
          debDeps,
          destdir,
          fetched,
          targetArch,
          repoArch,
          resolving,
          effectivePending,
          subpackageMap,
          snapshotFetched,
          snapshotPending,
          selectedVersions,
          snapshotVersions,
          activeConstraints,
          snapshotConstraints,
          pkgName,
          customArtifactDirs,
          artifactCache,
        );
        resolving.delete(pkgName);
        if (depsOk) {
          const ok = await commitCandidate(debPath);
          if (ok) {
            return true;
          }
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
    const candidates = index[pkgName] || [];

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
      const hasActualVersionConstraint = allConstraints.some((c) => Boolean(c.operator && c.version));
      if (hasActualVersionConstraint) {
        if (isVirtual && !effectiveVer) {
          continue;
        }
        if (effectiveVer && !satisfiesAllConstraints(effectiveVer, allConstraints)) {
          continue;
        }
      } else if (effectiveVer && allConstraints.length > 0) {
        if (!satisfiesAllConstraints(effectiveVer, allConstraints)) {
          continue;
        }
      }

      let candidateCanonical: string | undefined;
      let addedResolving = false;
      if (pkgInfo.Package && pkgInfo.Package !== pkgName) {
        candidateCanonical = pkgInfo.Package;
        if (resolving.has(candidateCanonical)) {
          const stagedDeb = effectivePending.get(candidateCanonical);
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
              recordOrExtractDeb(pkgName, stagedDeb, prefixRoot, effectivePending);
              selectedVersions.set(pkgName, matchedProvVer);
              fetched.add(pkgName);
              recordConstraint(activeConstraints, pkgName, constraint, requester);
              return commitSuccess();
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
      const actualPkg = extractDebPackage(debDest);
      const expectedPkg = candidateCanonical || pkgName;
      if (actualPkg && actualPkg !== expectedPkg) {
        rmSync(debDest, { force: true });
        if (candidateCanonical && addedResolving) {
          resolving.delete(candidateCanonical);
        }
        continue;
      }
      const actualControlArch = extractDebArchitecture(debDest);
      if (
        actualControlArch &&
        (!CANONICAL_ARCHES.has(normalizeArch(actualControlArch)) || !isDebArchCompatible(actualControlArch, repoArch))
      ) {
        rmSync(debDest, { force: true });
        if (candidateCanonical && addedResolving) {
          resolving.delete(candidateCanonical);
        }
        continue;
      }
      if (
        explicitArch &&
        actualControlArch &&
        actualControlArch !== 'all' &&
        normalizeArch(actualControlArch) !== explicitArch
      ) {
        rmSync(debDest, { force: true });
        if (candidateCanonical && addedResolving) {
          resolving.delete(candidateCanonical);
        }
        continue;
      }

      const concreteVer = pkgInfo.Version || extractDebVersion(debDest);
      if (candidateCanonical && activeConstraints.has(candidateCanonical)) {
        const concreteConstraints = activeConstraints.get(candidateCanonical)!;
        const controlVer = extractDebControlVersion(debDest);
        if (
          concreteConstraints.length > 0 &&
          (!controlVer || !satisfiesAllConstraints(controlVer, concreteConstraints))
        ) {
          rmSync(debDest, { force: true });
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }
      }

      let provVer: string | undefined;
      const actualVer = extractDebVersion(debDest);
      if (isVirtual) {
        const actualProvides = extractDebProvides(debDest);
        let providesMatches = false;
        if (actualProvides) {
          for (const clause of parseDependencyList(actualProvides)) {
            for (const provToken of clause) {
              if (provToken.name.split(':')[0].trim() === pkgName) {
                provVer = provToken.versionConstraint?.version || '';
                providesMatches = true;
                break;
              }
            }
            if (providesMatches) {
              break;
            }
          }
        }
        if (!providesMatches) {
          rmSync(debDest, { force: true });
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }
        const hasVersionPredicate = allConstraints.some((c) => Boolean(c.operator && c.version));
        if (!provVer && hasVersionPredicate) {
          rmSync(debDest, { force: true });
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }
        if (provVer && !satisfiesAllConstraints(provVer, allConstraints)) {
          rmSync(debDest, { force: true });
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }
      } else {
        if (!actualVer || !satisfiesAllConstraints(actualVer, allConstraints)) {
          rmSync(debDest, { force: true });
          if (candidateCanonical && addedResolving) {
            resolving.delete(candidateCanonical);
          }
          continue;
        }
      }

      const validatedVer = isVirtual ? provVer || '' : actualVer || concreteVer;
      if (allConstraints.length > 0 && validatedVer && !satisfiesAllConstraints(validatedVer, allConstraints)) {
        rmSync(debDest, { force: true });
        if (candidateCanonical && addedResolving) {
          resolving.delete(candidateCanonical);
        }
        continue;
      }

      const debDeps = extractDebDepends(debDest);
      if (debDeps === null) {
        console.warn(`::warning:: Corrupt control metadata in downloaded ${basename(debDest)}, skipping candidate.`);
        rmSync(debDest, { force: true });
        if (candidateCanonical && addedResolving) {
          resolving.delete(candidateCanonical);
        }
        continue;
      }

      // If candidateCanonical was already selected with a different archive, verify compatibility
      if (candidateCanonical && effectivePending) {
        const existingCanonicalDeb = effectivePending.get(candidateCanonical);
        if (existingCanonicalDeb && existingCanonicalDeb !== debDest) {
          const canonicalConstraints = activeConstraints.get(candidateCanonical) || [];
          const canonicalVer = actualVer || concreteVer;
          if (
            canonicalConstraints.length > 0 &&
            canonicalVer &&
            !satisfiesAllConstraints(canonicalVer, canonicalConstraints)
          ) {
            rmSync(debDest, { force: true });
            if (addedResolving) {
              resolving.delete(candidateCanonical);
            }
            continue;
          }

          const replacementProvides = extractDebProvides(debDest);
          let allAliasesValid = true;
          const aliasesToRedirect = new Map<string, string>();

          for (const [k, v] of effectivePending.entries()) {
            if (v === existingCanonicalDeb && k !== candidateCanonical) {
              let aliasProvVer: string | undefined;
              let isProvided = false;
              if (replacementProvides) {
                for (const clause of parseDependencyList(replacementProvides)) {
                  for (const tok of clause) {
                    if (tok.name.split(':')[0].trim() === k) {
                      aliasProvVer = tok.versionConstraint?.version || '';
                      isProvided = true;
                      break;
                    }
                  }
                  if (isProvided) {
                    break;
                  }
                }
              }
              const aliasConstraints = activeConstraints.get(k) || [];
              const hasVersionPredicate = aliasConstraints.some((c) => Boolean(c.operator && c.version));
              if (
                !isProvided ||
                (!aliasProvVer && hasVersionPredicate) ||
                (aliasProvVer && !satisfiesAllConstraints(aliasProvVer, aliasConstraints))
              ) {
                allAliasesValid = false;
                break;
              }
              aliasesToRedirect.set(k, aliasProvVer || '');
            }
          }

          if (!allAliasesValid) {
            rmSync(debDest, { force: true });
            if (addedResolving) {
              resolving.delete(candidateCanonical);
            }
            continue;
          }

          for (const [alias, aliasProvVer] of aliasesToRedirect.entries()) {
            effectivePending.set(alias, debDest);
            if (aliasProvVer) {
              selectedVersions.set(alias, aliasProvVer);
            }
          }
          effectivePending.set(candidateCanonical, debDest);
        }
      }

      recordOrExtractDeb(pkgName, debDest, prefixRoot, effectivePending);
      if (candidateCanonical) {
        recordOrExtractDeb(candidateCanonical, debDest, prefixRoot, effectivePending);
      }
      selectedVersions.set(pkgName, validatedVer);
      if (candidateCanonical) {
        selectedVersions.set(candidateCanonical, actualVer || concreteVer);
      }
      recordConstraint(activeConstraints, pkgName, constraint, requester);

      // Recursively resolve dependencies
      const depsOk = await resolvePackageDependencies(
        debDeps,
        destdir,
        fetched,
        targetArch,
        repoArch,
        resolving,
        effectivePending,
        subpackageMap,
        snapshotFetched,
        snapshotPending,
        selectedVersions,
        snapshotVersions,
        activeConstraints,
        snapshotConstraints,
        pkgName,
        customArtifactDirs,
        artifactCache,
      );
      if (candidateCanonical && addedResolving) {
        resolving.delete(candidateCanonical);
      }
      if (depsOk) {
        fetched.add(pkgName);
        if (candidateCanonical) {
          fetched.add(candidateCanonical);
        }
        const ok = await commitCandidate(debDest);
        if (ok) {
          return true;
        }
        rollbackCandidate();
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

  if (rollbackRevision) {
    rollbackRevision();
  }
  return false;
}

export async function resolveAndFetchBuildDependencies(
  buildDeps: string[],
  destdir: string,
  targetArch: string = 'aarch64',
  subpackageMap?: Record<string, string>,
  rootPkgName?: string,
  customArtifactDirs?: string[],
): Promise<void> {
  const concreteArch = targetArch === 'all' ? 'aarch64' : targetArch;
  const effectivePrefix = process.env.PREFIX || PREFIX;
  mkdirSync(destdir, { recursive: true });
  const clauses = buildDeps && buildDeps.length > 0 ? parseDependencyList(buildDeps) : [];
  const filtered = filterDepsForArch(clauses, concreteArch);

  if (filtered.length === 0) {
    installDebsToPrefix([], effectivePrefix, destdir, true);
    return;
  }
  console.log(`Resolving build dependencies [${concreteArch}]: ${buildDeps.join(', ')}`);
  const fetched = new Set<string>();
  const selectedVersions = new Map<string, string>();
  const sharedPendingArtifacts = new Map<string, string>();
  const activeConstraints = new Map<string, VersionConstraint[]>();

  const rootRequester = rootPkgName ? `@root:${rootPkgName}` : '@root';

  const resolverDownloadsDir = join(destdir, '.resolver_downloads');
  let deepestFailureBranch = '';
  let deepestFailureIdx = -1;

  const restoreState = (
    snapFetched: Set<string>,
    snapVersions: Map<string, string>,
    snapPending: Map<string, string>,
    snapConstraints: Map<string, VersionConstraint[]>,
  ): void => {
    fetched.clear();
    for (const f of snapFetched) {
      fetched.add(f);
    }
    selectedVersions.clear();
    for (const [k, v] of snapVersions) {
      selectedVersions.set(k, v);
    }
    sharedPendingArtifacts.clear();
    for (const [k, v] of snapPending) {
      sharedPendingArtifacts.set(k, v);
    }
    activeConstraints.clear();
    for (const [k, v] of snapConstraints) {
      activeConstraints.set(k, [...v]);
    }
  };

  let backtrackSteps = 0;
  let budgetExhausted = false;
  const MAX_BACKTRACK_STEPS = 256;
  const sharedArtifactCache = new Map<string, string[]>();

  const solveClauses = async (clauseIdx: number): Promise<boolean> => {
    if (clauseIdx >= filtered.length) {
      return true;
    }

    const branch = filtered[clauseIdx];
    let candidateAttempt = 0;
    for (const token of branch) {
      if (candidateAttempt > 0) {
        if (++backtrackSteps > MAX_BACKTRACK_STEPS) {
          budgetExhausted = true;
          return false;
        }
      }
      candidateAttempt++;
      const cleanName = token.name.split(':')[0].trim();
      const snapFetched = new Set(fetched);
      const snapVersions = new Map(selectedVersions);
      const snapPending = new Map(sharedPendingArtifacts);
      const snapConstraints = new Map(Array.from(activeConstraints.entries()).map(([k, v]) => [k, [...v]]));

      let success = false;
      try {
        const depStr = formatDebianDependency([[token]]);
        success = await fetchSingleDep(
          depStr,
          destdir,
          fetched,
          concreteArch,
          new Set(),
          sharedPendingArtifacts,
          subpackageMap,
          selectedVersions,
          activeConstraints,
          rootRequester,
          customArtifactDirs,
          sharedArtifactCache,
        );
      } catch (err: unknown) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`Warning: Error resolving dependency '${cleanName}' for ${concreteArch}: ${reason}`);
      }

      if (success) {
        recordConstraint(activeConstraints, cleanName, token.versionConstraint, rootRequester);
        if (await solveClauses(clauseIdx + 1)) {
          return true;
        }
        if (++backtrackSteps > MAX_BACKTRACK_STEPS) {
          budgetExhausted = true;
          restoreState(snapFetched, snapVersions, snapPending, snapConstraints);
          return false;
        }
      }

      restoreState(snapFetched, snapVersions, snapPending, snapConstraints);
    }

    if (clauseIdx >= deepestFailureIdx) {
      deepestFailureIdx = clauseIdx;
      deepestFailureBranch = branch.map((t) => t.name).join(' | ');
    }
    return false;
  };

  try {
    mkdirSync(destdir, { recursive: true });
    const resolved = await solveClauses(0);
    if (budgetExhausted) {
      throw new Error(`Dependency resolution backtracking budget exceeded (${MAX_BACKTRACK_STEPS} steps).`);
    }
    if (!resolved) {
      const branchStr = deepestFailureBranch || filtered[0]?.map((t) => t.name).join(' | ') || buildDeps.join(', ');
      throw new Error(`Missing required build dependency '${branchStr}' for ${concreteArch} and no artifact exists.`);
    }

    const uniqueDebs = Array.from(new Set(sharedPendingArtifacts.values()));
    installDebsToPrefix(uniqueDebs, effectivePrefix, destdir, true);
  } finally {
    if (existsSync(resolverDownloadsDir)) {
      ensureTreeRemovable(resolverDownloadsDir);
      rmSync(resolverDownloadsDir, { recursive: true, force: true });
    }
  }
}
