import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

import {
  ARCH_MAP,
  buildDeb,
  formatDebianFilenameVersion,
  getPackageSourceDateEpoch,
  normalizeSourceDir,
} from '../builders/debian.ts';
import { setupBionicCompat } from '../core/compat.ts';
import { type DependencyToken, parseDependencyList, type VersionConstraint } from '../core/dependencies.ts';
import {
  checkExistingReleaseHash,
  loadTermuxIndex,
  parseFilenameDebVersion,
  resolveAndFetchBuildDependencies,
} from '../core/fetcher.ts';
import { computeStateHash, parseRecipe } from '../core/parser.ts';
import { getSubpackageNames } from '../core/subpkg.ts';
import type { PackageRecipe } from '../core/types.ts';
import { compareDebianVersions, formatDebianVersion, satisfiesVersionConstraint } from '../core/version.ts';
import { sanitizeStagingElfs } from '../sanitizer/elf.ts';
import { sanitizeShebangs } from '../sanitizer/shebang.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { auditRepositoryHealth } from '../utils/health.ts';

export function comparePatchFilenames(a: string, b: string): number {
  const diff = a.localeCompare(b, 'en-US-u-kn-true', { numeric: true });
  if (diff !== 0) {
    return diff;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export type SourceIdentityInput = Partial<Pick<PackageRecipe, 'source' | 'sha256' | 'patches'>> & {
  version: string;
};

export function resolveAndValidatePatches(
  recipe: Pick<PackageRecipe, 'name'> & Partial<Pick<PackageRecipe, 'patches'>>,
  pDir: string,
): string[] {
  const pFolder = join(pDir, 'patches');
  let patches: string[] = [];
  if (Array.isArray(recipe.patches) && recipe.patches.length > 0) {
    patches = recipe.patches.map((p) => (p.startsWith('patches/') ? p.slice(8) : p));
  } else if (existsSync(pFolder)) {
    patches = readdirSync(pFolder)
      .filter((name) => {
        const full = join(pFolder, name);
        return (name.endsWith('.patch') || name.endsWith('.diff')) && existsSync(full) && statSync(full).isFile();
      })
      .sort(comparePatchFilenames);
  }

  for (const patch of patches) {
    if (!/^\d{4}-[\w.-]+\.(patch|diff)$/.test(patch)) {
      throw new Error(
        `Invalid patch filename '${patch}' in '${recipe.name}'. Patches must follow strict 4-digit zero-padded numbering (e.g. '0001-fix.patch').`,
      );
    }
    const patchFile = join(pFolder, patch);
    if (!existsSync(patchFile) || !statSync(patchFile).isFile()) {
      throw new Error(`Patch file ${patchFile} not found for ${recipe.name}`);
    }
  }

  return patches;
}

export function computeSourceIdentity(recipe: SourceIdentityInput, pDir: string): string {
  const patches: string[] = [];
  const pf = join(pDir, 'patches');
  if (existsSync(pf)) {
    const entries = readdirSync(pf, { withFileTypes: true })
      .filter((e) => e.isFile() && (e.name.endsWith('.patch') || e.name.endsWith('.diff')))
      .map((e) => e.name)
      .sort(comparePatchFilenames);
    for (const f of entries) {
      const patchContent = readFileSync(join(pf, f));
      patches.push(`${f}:${new Bun.CryptoHasher('sha256').update(patchContent).digest('hex')}`);
    }
  }

  const selectedPatches = Array.isArray(recipe.patches) ? [...recipe.patches] : [];
  const selectedPatchHashes: string[] = [];
  for (const sp of selectedPatches) {
    const filename = sp.startsWith('patches/') ? sp.slice(8) : sp;
    const targetFile = join(pf, filename);
    if (existsSync(targetFile)) {
      const content = readFileSync(targetFile);
      selectedPatchHashes.push(`${filename}:${new Bun.CryptoHasher('sha256').update(content).digest('hex')}`);
    } else {
      selectedPatchHashes.push(sp);
    }
  }

  const identityData = {
    source: recipe.source ? recipe.source.replace(/\{version\}/g, recipe.version) : '',
    version: String(recipe.version || ''),
    sha256: String(recipe.sha256 || ''),
    patches,
    selected_patches: selectedPatchHashes,
  };
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(identityData)).digest('hex');
}

export function fetchAndPrepareSource(
  recipe: Partial<PackageRecipe> & { name: string; version: string },
  pDir: string,
  destdir: string,
  continueBuild: boolean = false,
  sourceEpoch?: number,
): string {
  if (!recipe.source) {
    return pDir;
  }

  const effectiveSourceEpoch = sourceEpoch ?? getPackageSourceDateEpoch(pDir);
  const srcUrl = recipe.source.replace(/\{version\}/g, recipe.version);
  const srcExtractDir = join(destdir, 'src');
  const readyFile = join(destdir, '.source_prepared.json');
  const currentIdentity = computeSourceIdentity(recipe, pDir);

  if (continueBuild && existsSync(srcExtractDir) && existsSync(readyFile)) {
    try {
      const marker = JSON.parse(readFileSync(readyFile, 'utf-8'));
      if (
        marker.identity === currentIdentity &&
        marker.sourceEpoch === effectiveSourceEpoch &&
        marker.workDir &&
        existsSync(marker.workDir)
      ) {
        console.log(`[${recipe.name}] Continuing build: reusing existing source directory at ${marker.workDir}...`);
        return marker.workDir;
      }
    } catch {}
  }

  if (existsSync(readyFile)) {
    rmSync(readyFile, { force: true });
  }

  if (existsSync(srcExtractDir)) {
    rmSync(srcExtractDir, { recursive: true, force: true });
  }
  mkdirSync(srcExtractDir, { recursive: true });
  console.log(`[${recipe.name}] Fetching source from ${srcUrl}...`);

  const isArchive = /\.(tar\.gz|tgz|tar\.xz|tar\.bz2|zip|crate|whl)$/i.test(srcUrl.split('#')[0]);
  let workDir = srcExtractDir;

  if (!isArchive && (srcUrl.endsWith('.git') || srcUrl.includes('.git#') || srcUrl.includes('#'))) {
    if (srcUrl.includes('#')) {
      const [repoUrl, ref] = srcUrl.split('#');
      if (ref.length === 40 && /^[0-9a-fA-F]+$/.test(ref)) {
        let res = spawnSync('git', ['init', srcExtractDir], { stdio: 'inherit' });
        if (res.status !== 0) {
          throw new Error(`git init failed for ${recipe.name}`);
        }
        res = spawnSync('git', ['-C', srcExtractDir, 'remote', 'add', 'origin', repoUrl], { stdio: 'inherit' });
        if (res.status !== 0) {
          throw new Error(`git remote add failed for ${recipe.name}`);
        }
        res = spawnSync('git', ['-C', srcExtractDir, 'fetch', '--depth', '1', 'origin', ref], { stdio: 'inherit' });
        if (res.status !== 0) {
          throw new Error(`git fetch failed for ${recipe.name}`);
        }
        res = spawnSync('git', ['-c', 'advice.detachedHead=false', '-C', srcExtractDir, 'checkout', 'FETCH_HEAD'], {
          stdio: 'inherit',
        });
        if (res.status !== 0) {
          throw new Error(`git checkout failed for ${recipe.name}`);
        }
      } else {
        const res = spawnSync(
          'git',
          ['-c', 'advice.detachedHead=false', 'clone', '--depth', '1', '--branch', ref, repoUrl, srcExtractDir],
          {
            stdio: 'inherit',
          },
        );
        if (res.status !== 0) {
          throw new Error(`git clone failed for ${recipe.name} from ${repoUrl}`);
        }
      }
    } else {
      const res = spawnSync(
        'git',
        ['-c', 'advice.detachedHead=false', 'clone', '--depth', '1', srcUrl, srcExtractDir],
        {
          stdio: 'inherit',
        },
      );
      if (res.status !== 0) {
        throw new Error(`git clone failed for ${recipe.name} from ${srcUrl}`);
      }
    }
  } else {
    const archivePath = join(destdir, 'source_archive');
    const curlRes = spawnSync('curl', ['-fsSL', '-A', 'Mozilla/5.0', '--retry', '5', srcUrl, '-o', archivePath], {
      stdio: 'inherit',
    });
    if (curlRes.status !== 0) {
      throw new Error(`Failed to download source archive for ${recipe.name} from ${srcUrl}`);
    }

    if (recipe.sha256) {
      const digest = new Bun.CryptoHasher('sha256').update(readFileSync(archivePath)).digest('hex');
      if (digest.toLowerCase() !== recipe.sha256.toLowerCase()) {
        throw new Error(`sha256 mismatch for ${recipe.name}: expected ${recipe.sha256}, got ${digest}`);
      }
    }

    let extractRes;
    if (srcUrl.endsWith('.zip') || srcUrl.includes('.zip')) {
      extractRes = spawnSync('unzip', ['-q', '-o', archivePath, '-d', srcExtractDir], { stdio: 'inherit' });
    } else {
      extractRes = spawnSync('tar', ['-xf', archivePath, '-C', srcExtractDir], { stdio: 'inherit' });
    }
    if (extractRes.status !== 0) {
      throw new Error(`Failed to extract source archive for ${recipe.name}`);
    }

    const items = readdirSync(srcExtractDir, { withFileTypes: true });
    if (items.length === 1 && items[0].isDirectory()) {
      workDir = join(srcExtractDir, items[0].name);
    }
  }

  // Apply patches if present
  const pFolder = join(pDir, 'patches');
  const patchesToRun = resolveAndValidatePatches(recipe as Pick<PackageRecipe, 'name' | 'patches'>, pDir);

  for (const patch of patchesToRun) {
    const patchFile = join(pFolder, patch);
    console.log(`⚡ Applying patch: ${patch}...`);
    const patchRes = spawnSync('patch', ['-p1', '-i', patchFile], {
      cwd: workDir,
      stdio: 'inherit',
    });
    if (patchRes.status !== 0) {
      throw new Error(`Failed to apply patch ${patch} for ${recipe.name}`);
    }
  }

  normalizeSourceDir(workDir, effectiveSourceEpoch);
  writeFileSync(
    readyFile,
    JSON.stringify({ identity: currentIdentity, workDir, sourceEpoch: effectiveSourceEpoch }, null, 2),
    'utf-8',
  );
  return workDir;
}

export function cleanupStagingDirs(destdir: string): void {
  if (!existsSync(destdir)) {
    return;
  }
  rmSync(join(destdir, '.compile_success'), { force: true });
  rmSync(join(destdir, '.stage_compiled'), { recursive: true, force: true });
  rmSync(join(destdir, 'stage'), { recursive: true, force: true });
  for (const entry of readdirSync(destdir)) {
    if (entry.startsWith('stage_')) {
      rmSync(join(destdir, entry), { recursive: true, force: true });
    }
  }
}

export function cleanupPackageOutputs(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string }),
  outputDir: string,
): void {
  if (!existsSync(outputDir)) {
    return;
  }
  const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);
  const targetPrefixes = [recipe.name, ...subpkgNames];

  for (const f of readdirSync(outputDir)) {
    for (const prefix of targetPrefixes) {
      const escaped = prefix.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
      if (new RegExp(`^${escaped}_.+_[^_]+\\.deb$`).test(f)) {
        rmSync(join(outputDir, f), { force: true });
        break;
      }
    }
  }
  rmSync(join(outputDir, `${recipe.name}_metadata.json`), { force: true });
}

export function stageValidatedOutputs(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string }),
  outputDir: string,
  validatedDir: string,
): void {
  mkdirSync(validatedDir, { recursive: true });
  if (!existsSync(outputDir)) {
    return;
  }

  const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);
  const targetPrefixes = [recipe.name, ...subpkgNames];

  const filenameVer = recipe.version
    ? formatDebianFilenameVersion({ version: recipe.version, revision: recipe.revision, epoch: recipe.epoch })
    : undefined;

  const filesToCopy: string[] = [];
  for (const file of readdirSync(outputDir)) {
    if (file.endsWith('.deb')) {
      const noExt = file.slice(0, -4);
      const lastUnderscore = noExt.lastIndexOf('_');
      if (lastUnderscore > 0) {
        const firstUnderscore = noExt.indexOf('_');
        if (firstUnderscore > 0 && firstUnderscore < lastUnderscore) {
          const pkg = noExt.slice(0, firstUnderscore);
          const ver = noExt.slice(firstUnderscore + 1, lastUnderscore);
          if (targetPrefixes.includes(pkg)) {
            if (!filenameVer || ver === filenameVer) {
              filesToCopy.push(file);
            }
          }
        }
      }
    } else if (file.endsWith('_metadata.json') || file === 'metadata.json') {
      const pkg = file === 'metadata.json' ? recipe.name : file.replace(/_metadata\.json$/, '');
      if (targetPrefixes.includes(pkg) || pkg === recipe.name) {
        filesToCopy.push(file);
      }
    }
  }

  if (filesToCopy.length === 0) {
    return;
  }

  const parentDir = resolve(validatedDir, '..');
  const tmpPromoDir = mkdtempSync(join(parentDir, '.promo.tmp-'));
  const promoted: string[] = [];

  try {
    for (const file of filesToCopy) {
      copyFileSync(join(outputDir, file), join(tmpPromoDir, file));
    }
    for (const file of filesToCopy) {
      const src = join(tmpPromoDir, file);
      const dst = join(validatedDir, file);
      renameSync(src, dst);
      promoted.push(dst);
    }
  } catch (err) {
    for (const dst of promoted) {
      try {
        rmSync(dst, { force: true });
      } catch {}
    }
    throw err;
  } finally {
    if (existsSync(tmpPromoDir)) {
      rmSync(tmpPromoDir, { recursive: true, force: true });
    }
  }
}

async function hasUsablePublishedOrLocalArtifact(
  pkgName: string,
  arch: string,
  constraint?: VersionConstraint,
  ownerPkg?: string,
): Promise<boolean> {
  const normArch = arch === 'arm64' ? 'aarch64' : (arch || 'aarch64').toLowerCase();
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';
  const outDir = resolve('output');
  const artDir = resolve('artifacts');
  for (const dir of [artDir, outDir]) {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const f of files) {
        if (f.startsWith(`${pkgName}_`) && (f.endsWith(`_${repoArch}.deb`) || f.endsWith('_all.deb'))) {
          const ver = parseFilenameDebVersion(f);
          if (satisfiesVersionConstraint(ver, constraint)) {
            return true;
          }
        }
      }
    }
  }
  const repoSlug = process.env.GITHUB_REPOSITORY || `${process.env.REPO_OWNER || 'SjnExe'}/RepoExe`;
  const releaseTag = ownerPkg || pkgName;
  const apiUrl = `https://api.github.com/repos/${repoSlug}/releases/tags/${releaseTag}`;
  try {
    const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
    const headers: Record<string, string> = {
      'User-Agent': 'RepoExe-Build/1.0',
    };
    if (token) {
      headers.Authorization = `token ${token}`;
    }
    const resp = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(4000) });
    if (resp.ok) {
      const data = (await resp.json()) as { assets?: Array<{ name: string }> };
      const debAssets = (data.assets || []).filter((a) => a.name.endsWith('.deb'));
      for (const a of debAssets) {
        if (a.name.startsWith(`${pkgName}_`) && (a.name.endsWith(`_${repoArch}.deb`) || a.name.endsWith('_all.deb'))) {
          const ver = parseFilenameDebVersion(a.name);
          if (satisfiesVersionConstraint(ver, constraint)) {
            return true;
          }
        }
      }
    }
  } catch {}

  try {
    const index = await loadTermuxIndex(repoArch);
    const candidates = index[pkgName] || index[`lib${pkgName}`] || index[pkgName.replace(/^lib/, '')] || [];
    for (const cand of candidates) {
      const ver = cand.IsVirtual === 'true' ? cand.ProvidedVersion : cand.Version;
      if (ver && satisfiesVersionConstraint(ver, constraint)) {
        return true;
      }
    }
  } catch {}

  return false;
}

function setupCompilerWrappers(
  destdir: string,
  workDir: string,
  repoRoot: string,
): { wrapperDir: string; hasSpaces: boolean } {
  const hasSpaces = [workDir, destdir, repoRoot].some((p) => p.includes(' '));
  const wrapperDir = join(destdir, '.wrappers');
  mkdirSync(wrapperDir, { recursive: true });

  const compilers = ['cc', 'c++', 'gcc', 'g++', 'clang', 'clang++'];

  for (const cmd of compilers) {
    const scriptPath = join(wrapperDir, cmd);
    const mapArg1 = `'-ffile-prefix-map=${workDir.replace(/'/g, `'\\''`)}=.'`;
    const mapArg2 = `'-ffile-prefix-map=${destdir.replace(/'/g, `'\\''`)}=.'`;
    const mapArg3 = `'-ffile-prefix-map=${repoRoot.replace(/'/g, `'\\''`)}=/repoexe'`;

    const content = `#!/bin/sh
SELF="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
SELFDIR="$(dirname "$SELF")"
BIN="$(basename "$0")"

OLD_IFS="$IFS"
IFS=":"
TARGET=""
for dir in $PATH; do
  if [ "$dir" != "$SELFDIR" ] && [ -x "$dir/$BIN" ]; then
    TARGET="$dir/$BIN"
    break
  fi
done
IFS="$OLD_IFS"

if [ -z "$TARGET" ]; then
  TARGET="/usr/bin/$BIN"
fi

exec "$TARGET" \\
  ${mapArg1} \\
  ${mapArg2} \\
  ${mapArg3} \\
  "$@"
`;
    writeFileSync(scriptPath, content, { mode: 0o755 });
  }

  return { wrapperDir, hasSpaces };
}

export async function executePack(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string; version: string }),
  pkgDir: string,
  destdir: string,
  outputDir: string,
): Promise<void> {
  const supportedFormats = new Set(['apt']);
  const fmts = recipe.formats || ['apt'];
  for (const fmt of fmts) {
    if (!supportedFormats.has(fmt)) {
      throw new Error(`Unsupported package format '${fmt}' for ${recipe.name}. Supported format: apt.`);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  cleanupPackageOutputs(recipe, outputDir);

  const stageDir = join(destdir, 'stage');

  sanitizeStagingElfs(stageDir);
  sanitizeShebangs(stageDir);

  buildDeb(recipe as PackageRecipe, destdir, outputDir, recipe.arch, pkgDir);

  const meta = {
    name: recipe.name,
    version: recipe.version,
    revision: recipe.revision,
    arch: recipe.arch,
    state_hash: recipe.state_hash || '',
  };
  const metaContent = JSON.stringify(meta, null, 2);
  await Bun.write(join(outputDir, `${recipe.name}_metadata.json`), metaContent);
}

export function executeTest(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string }),
  destdir?: string,
  outputDir?: string,
): void {
  const testCmd = recipe.phases?.test || `${recipe.name} --version || ${recipe.name} --help`;
  console.log(`Running smoke test for ${recipe.name}: ${testCmd}`);

  const localOutputDir = outputDir ? resolve(outputDir) : resolve('output');
  const hostWorkspace = process.env.GITHUB_WORKSPACE || resolve('.');

  const hasDockerSocket = existsSync('/var/run/docker.sock');

  if (hasDockerSocket) {
    const owner = (process.env.REPO_OWNER || 'sjnexe').toLowerCase();
    const rawArch = (recipe.arch || 'aarch64').toLowerCase();
    const debArch = ARCH_MAP[rawArch] || rawArch;
    const filenameVer = recipe.version
      ? formatDebianFilenameVersion({ version: recipe.version, revision: recipe.revision, epoch: recipe.epoch })
      : 'unknown';
    const targetDeb = `${recipe.name}_${filenameVer}_${debArch}.deb`;
    const escapedCmd = testCmd.replace(/'/g, "'\\''");

    const testArch = rawArch === 'all' ? (process.env.TARGET_ARCH || 'aarch64').toLowerCase() : rawArch;
    const testerDebArch = ARCH_MAP[testArch] || testArch;
    const archKey = `TESTER_IMAGE_${testArch.toUpperCase()}`;
    const testerImage = process.env[archKey] || process.env.TESTER_IMAGE || `ghcr.io/${owner}/repoexe-tester:latest`;
    const containerPkgDir = '/data/data/com.termux/files/usr/tmp/repoexe-pkg';

    const testStagingDir = mkdtempSync(join(localOutputDir, `.test-stage-${recipe.name}-`));

    try {
      const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);
      const stagedDebs = new Set<string>();

      if (existsSync(localOutputDir)) {
        interface LocalDebInfo {
          filename: string;
          srcDeb: string;
          pkgName: string;
          version: string;
          arch: string;
          depends: DependencyToken[][];
          provides: Array<{ name: string; versionConstraint?: VersionConstraint }>;
        }
        const localDebsByName = new Map<string, LocalDebInfo[]>();
        const localDebsByFilename = new Map<string, LocalDebInfo>();

        for (const f of readdirSync(localOutputDir)) {
          if (!f.endsWith('.deb')) {
            continue;
          }
          const srcDeb = join(localOutputDir, f);
          try {
            const ctrlRes = spawnSync('dpkg-deb', ['-f', srcDeb], { encoding: 'utf-8' });
            if (ctrlRes.status === 0 && ctrlRes.stdout) {
              const text = ctrlRes.stdout;
              const pkgMatch = text.match(/^Package:\s*(.+)$/im);
              const pkgName = pkgMatch ? pkgMatch[1].trim() : '';
              if (!pkgName) {
                continue;
              }

              const verMatch = text.match(/^Version:\s*(.+)$/im);
              const version = verMatch ? verMatch[1].trim() : '';
              const archMatch = text.match(/^Architecture:\s*(.+)$/im);
              const arch = archMatch ? archMatch[1].trim() : '';

              const provMatch = text.match(/^Provides:\s*(.+)$/im);
              const depMatch = text.match(/^Depends:\s*(.+)$/im);

              const depends: DependencyToken[][] = [];
              if (depMatch && depMatch[1].trim()) {
                depends.push(...parseDependencyList(depMatch[1].trim()));
              }

              const provides: Array<{ name: string; versionConstraint?: VersionConstraint }> = [{ name: pkgName }];
              if (provMatch && provMatch[1].trim()) {
                for (const clause of parseDependencyList(provMatch[1].trim())) {
                  for (const token of clause) {
                    provides.push({
                      name: token.name.split(':')[0].trim(),
                      versionConstraint: token.versionConstraint,
                    });
                  }
                }
              }

              const info: LocalDebInfo = { filename: f, srcDeb, pkgName, version, arch, depends, provides };
              localDebsByFilename.set(f, info);
              for (const p of provides) {
                const list = localDebsByName.get(p.name) || [];
                list.push(info);
                localDebsByName.set(p.name, list);
              }
            }
          } catch {}
        }

        const depQueue: DependencyToken[][] = [];
        const expectedControlVer = recipe.version
          ? formatDebianVersion({ version: recipe.version, epoch: recipe.epoch, revision: recipe.revision })
          : '';

        // 1. Stage the target package and its child subpackages matching the current version
        for (const p of [recipe.name, ...subpkgNames]) {
          const list = localDebsByName.get(p) || [];
          for (const deb of list) {
            if (
              deb.pkgName === p &&
              (!recipe.version || deb.version === expectedControlVer || deb.version === filenameVer)
            ) {
              if (!stagedDebs.has(deb.filename)) {
                copyFileSync(deb.srcDeb, join(testStagingDir, deb.filename));
                stagedDebs.add(deb.filename);
                for (const clause of deb.depends) {
                  depQueue.push(clause);
                }
              }
            }
          }
        }

        // Also add explicit recipe.deps and subpackage deps
        if (Array.isArray(recipe.deps)) {
          depQueue.push(...parseDependencyList(recipe.deps));
        }
        if (recipe.subpackages && typeof recipe.subpackages === 'object') {
          for (const subDef of Object.values(recipe.subpackages)) {
            if (typeof subDef === 'object' && Array.isArray((subDef as any).deps)) {
              depQueue.push(...parseDependencyList((subDef as any).deps));
            }
          }
        }

        // 2. Resolve clauses by picking compatible archives
        const processedClauses = new Set<string>();
        while (depQueue.length > 0) {
          const clause = depQueue.shift()!;
          const clauseKey = clause
            .map(
              (t) =>
                `${t.name}${t.versionConstraint ? t.versionConstraint.operator + t.versionConstraint.version : ''}`,
            )
            .join('|');
          if (processedClauses.has(clauseKey)) {
            continue;
          }
          processedClauses.add(clauseKey);

          // Check if already satisfied by any currently staged deb
          let satisfied = false;
          for (const token of clause) {
            const reqName = token.name.split(':')[0].trim();
            const constraint = token.versionConstraint;
            for (const debFilename of stagedDebs) {
              const info = localDebsByFilename.get(debFilename);
              if (info) {
                const matchedProv = info.provides.find((p) => p.name === reqName);
                if (matchedProv) {
                  const effVer = reqName === info.pkgName ? info.version : matchedProv.versionConstraint?.version || '';
                  if (satisfiesVersionConstraint(effVer, constraint)) {
                    satisfied = true;
                    break;
                  }
                }
              }
            }
            if (satisfied) {
              break;
            }
          }

          if (satisfied) {
            continue;
          }

          // Find candidate that satisfies constraint
          for (const token of clause) {
            const reqName = token.name.split(':')[0].trim();
            const constraint = token.versionConstraint;
            const candidates = (localDebsByName.get(reqName) || []).filter((cand) => {
              if (cand.arch !== 'all' && cand.arch !== testerDebArch && cand.arch !== debArch) {
                return false;
              }
              const matchedProv = cand.provides.find((p) => p.name === reqName);
              const effVer = reqName === cand.pkgName ? cand.version : matchedProv?.versionConstraint?.version || '';
              return satisfiesVersionConstraint(effVer, constraint);
            });

            if (candidates.length > 0) {
              candidates.sort((a, b) => compareDebianVersions(b.version, a.version));
              const selected = candidates[0];
              if (!stagedDebs.has(selected.filename)) {
                try {
                  copyFileSync(selected.srcDeb, join(testStagingDir, selected.filename));
                  stagedDebs.add(selected.filename);
                  for (const childClause of selected.depends) {
                    depQueue.push(childClause);
                  }
                } catch {}
              }
              break;
            }
          }
        }
      }

      if (recipe.version && !existsSync(join(testStagingDir, targetDeb))) {
        throw new Error(
          `Target smoke-test archive '${targetDeb}' for ${recipe.name} was not staged in ${testStagingDir}`,
        );
      }

      const relStagingDir = relative(resolve('.'), testStagingDir);
      const hostStagingDir = relStagingDir.startsWith('..') ? testStagingDir : join(hostWorkspace, relStagingDir);

      const installTargetCmd = recipe.version
        ? `if [ -f "${containerPkgDir}/${targetDeb}" ]; then dpkg -i --force-architecture --force-depends "${containerPkgDir}/${targetDeb}" && INSTALLED=1; else echo "::error:: Target package ${targetDeb} missing from container staging dir!"; exit 1; fi`
        : `if [ -f "${containerPkgDir}/${targetDeb}" ]; then dpkg -i --force-architecture --force-depends "${containerPkgDir}/${targetDeb}" && INSTALLED=1; elif ls ${containerPkgDir}/${recipe.name}_*.deb 1>/dev/null 2>&1; then for f in ${containerPkgDir}/${recipe.name}_*.deb; do if [ -f "$f" ]; then dpkg -i --force-architecture --force-depends "$f" && INSTALLED=1; fi; done; fi`;

      // Sibling & target package installer with explicit exit verification
      const installCommands = [
        'set -e',
        'INSTALLED=0',
        // Install sibling runtime dependencies matching host architecture before target install
        `for sib in ${containerPkgDir}/*_${testerDebArch}.deb ${containerPkgDir}/*_all.deb; do if [ -f "$sib" ] && [ "$(basename "$sib")" != "${targetDeb}" ]; then dpkg -i --force-architecture --force-depends "$sib" || true; fi; done`,
        // Install declared child subpackage artifacts of target (strictly checked without ignoring failure)
        ...(subpkgNames.length > 0
          ? [
              `for sub in ${subpkgNames.map((s) => `"${containerPkgDir}/${s}"_*.deb`).join(' ')}; do if ls $sub 1>/dev/null 2>&1; then for sf in $sub; do if [ -f "$sf" ]; then dpkg -i --force-architecture --force-depends "$sf"; fi; done; fi; done`,
            ]
          : []),
        // Install target Debian package directly with dpkg
        installTargetCmd,
        `if [ "$INSTALLED" -eq 0 ]; then echo "::error:: Target package artifact for ${recipe.name} could not be installed for smoke testing!"; exit 1; fi`,
        'chmod +x ${PREFIX:-/data/data/com.termux/files/usr}/bin/* 2>/dev/null || true',
        `timeout 120s sh -c '${escapedCmd}'`,
      ];

      const installAndTest = installCommands.join('; ');

      console.log(`Executing container smoke test via ${testerImage} (${rawArch})...`);
      const dockerArgs = [
        'run',
        '--rm',
        '--volume',
        `${hostStagingDir}:${containerPkgDir}:ro`,
        '--workdir',
        '/data/data/com.termux/files/home',
        '-e',
        'PREFIX=/data/data/com.termux/files/usr',
        '-e',
        'PATH=/data/data/com.termux/files/usr/bin:/bin:/usr/bin',
        '-e',
        'LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib',
        '-e',
        'HOME=/data/data/com.termux/files/home',
        '-e',
        `TARGET_ARCH=${rawArch}`,
        testerImage,
        'sh',
        '-c',
        installAndTest,
      ];

      const res = spawnSync('docker', dockerArgs, { stdio: 'inherit', timeout: 150_000 });
      if (res.status !== 0) {
        if (res.status === 124) {
          throw new Error(`Smoke test timed out after 120s under emulation for ${recipe.name}`);
        } else if (res.status === 132 || res.status === 139) {
          throw new Error(`QEMU emulation crash (signal ${res.status}) executing ${recipe.name}`);
        }
        throw new Error(`Smoke test failed with exit code ${res.status} for ${recipe.name}`);
      }
      console.log(`✓ Smoke test passed in container for ${recipe.name}`);
      return;
    } finally {
      rmSync(testStagingDir, { recursive: true, force: true });
    }
  }

  // Fallback: Local execution on native Termux device (with sibling stage discovery)
  const targetBins: string[] = [];
  const targetLibs: string[] = [];
  if (destdir && existsSync(destdir)) {
    try {
      for (const entry of readdirSync(destdir)) {
        if (entry === 'stage' || entry.startsWith('stage_')) {
          const bPath = join(destdir, entry, 'data', 'data', 'com.termux', 'files', 'usr');
          const binDir = join(bPath, 'bin');
          const libDir = join(bPath, 'lib');
          if (existsSync(binDir)) {
            targetBins.push(binDir);
          }
          if (existsSync(libDir)) {
            targetLibs.push(libDir);
          }
        }
      }
    } catch {}
  }

  const buildDir = resolve('build');
  const siblingBins: string[] = [];
  const siblingLibs: string[] = [];
  const targetBuildBase = destdir ? basename(destdir) : '';
  if (existsSync(buildDir)) {
    for (const b of readdirSync(buildDir)) {
      if (b === targetBuildBase) {
        continue;
      }
      const packageBuildDir = join(buildDir, b);
      try {
        if (!statSync(packageBuildDir).isDirectory()) {
          continue;
        }
        for (const entry of readdirSync(packageBuildDir)) {
          if (entry === 'stage' || entry.startsWith('stage_')) {
            const bPath = join(packageBuildDir, entry, 'data', 'data', 'com.termux', 'files', 'usr');
            const binDir = join(bPath, 'bin');
            const libDir = join(bPath, 'lib');
            if (existsSync(binDir)) {
              siblingBins.push(binDir);
            }
            if (existsSync(libDir)) {
              siblingLibs.push(libDir);
            }
          }
        }
      } catch {}
    }
  }

  const env = {
    ...process.env,
    PREFIX: process.env.PREFIX || '/data/data/com.termux/files/usr',
    PATH: [...targetBins, ...siblingBins, process.env.PATH].filter(Boolean).join(':'),
    LD_LIBRARY_PATH: [...targetLibs, ...siblingLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  };
  const res = spawnSync('sh', ['-c', testCmd], { stdio: 'inherit', env, timeout: 60_000, killSignal: 'SIGKILL' });
  if (res.status !== 0) {
    throw new Error(`Smoke test failed with exit code ${res.status} for ${recipe.name}`);
  }
  console.log(`✓ Smoke test passed locally for ${recipe.name}`);
}

export async function simulateDryRun(
  recipe: PackageRecipe,
  pDir: string,
  _destdir: string,
  outputDir: string,
  command: string = 'build',
  force: boolean = false,
): Promise<void> {
  console.log(`\n============================================================`);
  console.log(`🔍 [DRY-RUN SIMULATION] ${recipe.name} (${command.toUpperCase()})`);
  console.log(`============================================================`);

  console.log(`📦 Package:       ${recipe.name}`);
  console.log(`🔖 Version:       ${recipe.version}`);
  console.log(`🔄 Revision:      ${recipe.revision}`);
  console.log(`⏳ Epoch:         ${recipe.epoch}`);
  console.log(`🏛️ Architecture:  ${recipe.arch || 'aarch64'}`);
  console.log(`📁 Formats:       ${(recipe.formats || ['apt']).join(', ')}`);
  if (recipe.description) {
    console.log(`📝 Description:   ${recipe.description}`);
  }
  if (recipe.homepage) {
    console.log(`🌐 Homepage:      ${recipe.homepage}`);
  }

  const stateHash = recipe.state_hash || '';
  console.log(`🔑 State Hash:    ${stateHash ? stateHash.slice(0, 16) + '...' : '(none)'}`);
  if (!force && stateHash && (await checkExistingReleaseHash(recipe.name, stateHash, recipe.arch))) {
    console.log(`⚡ Release State:  MATCHED EXISTING RELEASE (would skip without --force)`);
  } else {
    console.log(`⚡ Release State:  NEEDS BUILD (state hash differs or --force specified)`);
  }

  const buildDeps = recipe.build_deps || [];
  const runDeps = recipe.deps || [];
  console.log(`🔧 Build Deps:    ${buildDeps.length > 0 ? buildDeps.join(', ') : '(none)'}`);
  console.log(`🔗 Runtime Deps:  ${runDeps.length > 0 ? runDeps.join(', ') : '(none)'}`);

  if (recipe.source) {
    const srcUrl = recipe.source.replace(/\{version\}/g, recipe.version);
    console.log(`🌐 Source URL:    ${srcUrl}`);
    console.log(`🛡️ Source SHA256: ${recipe.sha256 || '(unspecified)'}`);
  } else {
    console.log(`🌐 Source:        (local files only)`);
  }

  const patchesToApply = resolveAndValidatePatches(recipe, pDir);
  console.log(`⚡ Patches:       ${patchesToApply.length > 0 ? patchesToApply.join(', ') : '(none)'}`);

  console.log(`🛠️ Build Phases:`);
  for (const phase of ['prepare', 'configure', 'make', 'install']) {
    const cmd = recipe.phases?.[phase];
    if (cmd) {
      console.log(`   - [${phase}]: ${cmd}`);
    } else {
      console.log(`   - [${phase}]: (skipped)`);
    }
  }

  console.log(`🎯 Expected Artifacts:`);
  const rawArch = (recipe.arch || 'aarch64').toLowerCase();
  const debArch = ARCH_MAP[rawArch] || rawArch;
  const filenameVer = formatDebianFilenameVersion(recipe);
  const fmts = recipe.formats || ['apt'];

  if (fmts.includes('apt')) {
    console.log(`   - apt:    ${recipe.name}_${filenameVer}_${debArch}.deb`);
    if (recipe.subpackages) {
      for (const [subKey, subDef] of Object.entries(recipe.subpackages)) {
        if (!subDef) {
          continue;
        }
        const emittedName = typeof subDef === 'object' && subDef?.name ? subDef.name : subKey;
        const subArchRaw = (typeof subDef === 'object' && subDef?.arch ? subDef.arch : rawArch).toLowerCase();
        const subDebArch = ARCH_MAP[subArchRaw] || subArchRaw;
        console.log(`   - apt:    ${emittedName}_${filenameVer}_${subDebArch}.deb`);
      }
    }
  }
  console.log(`   - meta:   ${recipe.name}_metadata.json`);

  const testCmd = recipe.phases?.test || `${recipe.name} --version || ${recipe.name} --help`;
  console.log(`🧪 Smoke Test:   ${testCmd}`);
  console.log(`📂 Output Dir:   ${outputDir}`);
  console.log(`============================================================`);
  console.log(`✓ Dry-run simulation finished for ${recipe.name} (${command}).`);
  console.log(`============================================================\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  let command = args[0];
  let startIndex = 1;

  if (!command || command === '-h' || command === '--help' || command === 'help') {
    console.log('RepoExe Build System CLI (Bun/TypeScript)');
    console.log('Usage: bun run build [command] <package...> [options]');
    console.log('Commands: build (default), compile, pack, test, check, info');
    return;
  }

  const pkgDir = resolve('pkg');

  if (command === 'check') {
    auditRepositoryHealth(pkgDir);
    return;
  }

  const KNOWN_COMMANDS = new Set(['build', 'compile', 'pack', 'test', 'info']);
  if (!KNOWN_COMMANDS.has(command)) {
    command = 'build';
    startIndex = 0;
  }

  if (KNOWN_COMMANDS.has(command)) {
    const rawTargets: string[] = [];
    let force = false;
    let dryRun = false;
    let targetArch: string | undefined = undefined;
    let outputDirOverride: string | undefined = undefined;
    let skipDeps = false;
    let continueBuild = false;
    let cleanBuild = false;
    let formatOverride: string | undefined = undefined;
    let quiet = false;

    for (let i = startIndex; i < args.length; i++) {
      const arg = args[i];
      if ((arg === '-a' || arg === '--arch') && args[i + 1]) {
        targetArch = args[++i];
      } else if ((arg === '-o' || arg === '--output') && args[i + 1]) {
        outputDirOverride = args[++i];
      } else if (arg === '-f' || arg === '--force') {
        force = true;
      } else if (arg === '-d' || arg === '-n' || arg === '--dry-run') {
        dryRun = true;
      } else if (arg === '-s' || arg === '--skip-deps') {
        skipDeps = true;
      } else if (arg === '-c' || arg === '--continue') {
        continueBuild = true;
      } else if (arg === '-C' || arg === '--clean') {
        cleanBuild = true;
      } else if (arg === '--format' && args[i + 1]) {
        formatOverride = args[++i];
      } else if (arg === '-q' || arg === '--quiet') {
        quiet = true;
      } else if (!arg.startsWith('-')) {
        rawTargets.push(arg);
      }
    }

    if (rawTargets.length === 0) {
      console.error(
        `Usage: bun run scripts/cli/build.ts ${command} <package...> [options]\n\n` +
          `Options:\n` +
          `  -a, --arch <arch>    Target architecture override (aarch64, arm, x86_64, all)\n` +
          `  -o, --output <dir>   Package output directory (default: output/)\n` +
          `  -f, --force          Force build even if state_hash matches existing release\n` +
          `  -d, --dry-run        Detailed simulation mode without modifying files\n` +
          `  -s, --skip-deps      Skip downloading and resolving build dependencies\n` +
          `  -c, --continue       Continue build reusing existing source directory\n` +
          `  -C, --clean          Clean build destination directory before starting\n` +
          `  --format <formats>   Filter formats (apt)\n` +
          `  -q, --quiet          Quiet output mode`,
      );
      process.exit(1);
    }

    const VALID_FORMATS = new Set(['apt']);
    const VALID_ARCHES = new Set(['aarch64', 'arm', 'x86_64', 'i686', 'all', 'arm64', 'amd64', 'i386']);
    if (targetArch) {
      const norm = targetArch.toLowerCase();
      if (!VALID_ARCHES.has(norm)) {
        console.error(
          `Error: Unsupported target architecture '${targetArch}'. Must be one of: aarch64, arm, x86_64, i686, all.`,
        );
        process.exit(1);
      }
      targetArch = norm === 'arm64' ? 'aarch64' : norm === 'amd64' ? 'x86_64' : norm === 'i386' ? 'i686' : norm;
    }
    let parsedFormats: string[] | undefined;
    if (formatOverride !== undefined) {
      const candidates = formatOverride
        .split(',')
        .map((f: string) => f.trim().toLowerCase())
        .filter(Boolean);
      if (candidates.length === 0 || candidates.some((f) => !VALID_FORMATS.has(f))) {
        console.error(`Error: Invalid format override '${formatOverride}'. Supported format: apt.`);
        process.exit(1);
      }
      parsedFormats = candidates;
    }

    const dag = new DependencyGraph(pkgDir);
    const availablePkgs = Object.keys(dag.recipes);

    let targetNames: string[] = [];
    if (rawTargets.includes('all')) {
      targetNames = availablePkgs;
    } else {
      for (const t of rawTargets) {
        const baseName = basename(t);
        if (availablePkgs.includes(baseName)) {
          targetNames.push(baseName);
        } else if (existsSync(t)) {
          targetNames.push(baseName);
        } else {
          console.error(`Error: Unknown target package '${t}'.`);
          process.exit(1);
        }
      }
    }

    const sortedTargets = dag.resolveBuildOrder(targetNames);
    const failedTargets = new Set<string>();

    for (const pkgName of sortedTargets) {
      const pkgPath = join(pkgDir, pkgName);
      const pDir = existsSync(pkgPath) ? pkgPath : resolve(pkgName);
      const recipe = parseRecipe(pDir);

      if (targetArch && recipe.arch !== 'all') {
        recipe.arch = targetArch;
        recipe.arches = [targetArch];
      }
      if (parsedFormats) {
        recipe.formats = [...parsedFormats];
      }
      if (targetArch || parsedFormats) {
        recipe.state_hash = computeStateHash(recipe, pDir);
      }

      const destdir = resolve(join('build', `build_${recipe.name}`));
      const outputDir = outputDirOverride ? resolve(outputDirOverride) : resolve('output');
      const stageDir = join(destdir, 'stage');

      if (command === 'info' || dryRun) {
        await simulateDryRun(recipe, pDir, destdir, outputDir, command, force);
        continue;
      }

      // Check if any build or runtime dependency of this package failed in the current batch
      if (!skipDeps) {
        const depClauses = dag.getRecipeDepTargets(recipe, recipe.arch);
        let hasUnsatisfiableDep = false;
        for (const clause of depClauses) {
          if (clause.length > 0 && clause.every((t) => failedTargets.has(t.owner))) {
            let usableCandidateExists = false;
            for (const target of clause) {
              if (
                await hasUsablePublishedOrLocalArtifact(
                  target.name,
                  recipe.arch,
                  target.versionConstraint,
                  target.owner,
                )
              ) {
                usableCandidateExists = true;
                break;
              }
            }
            if (!usableCandidateExists) {
              const clauseDesc = clause.map((t) => t.name).join(' | ');
              console.error(
                `::error:: Skipping ${recipe.name}: dependency '${clauseDesc}' failed in this batch and has no usable published candidate.`,
              );
              hasUnsatisfiableDep = true;
              break;
            }
          }
        }
        if (hasUnsatisfiableDep) {
          failedTargets.add(recipe.name);
          cleanupStagingDirs(destdir);
          cleanupPackageOutputs(recipe, outputDir);
          continue;
        }
      }

      if (cleanBuild && existsSync(destdir)) {
        rmSync(destdir, { recursive: true, force: true });
      }

      if (command === 'compile' || command === 'build') {
        if (
          !force &&
          recipe.state_hash &&
          (await checkExistingReleaseHash(recipe.name, recipe.state_hash, recipe.arch))
        ) {
          if (!quiet) {
            console.log(`⏭️ Skipping ${recipe.name}: state_hash unchanged.`);
          }
          continue;
        }

        try {
          mkdirSync(destdir, { recursive: true });
          cleanupStagingDirs(destdir);
          mkdirSync(stageDir, { recursive: true });

          // 1. Setup bionic compat if available
          try {
            setupBionicCompat(recipe.arch);
          } catch (err) {
            console.error(`Warning: setupBionicCompat failed: ${err instanceof Error ? err.message : String(err)}`);
          }

          // 2. Fetch build dependencies
          if (!skipDeps && recipe.build_deps && recipe.build_deps.length > 0) {
            await resolveAndFetchBuildDependencies(
              recipe.build_deps,
              destdir,
              recipe.arch,
              dag.subpackageMap,
              recipe.name,
            );
          }

          const sourceEpochNum = getPackageSourceDateEpoch(pDir);
          const sourceEpoch = String(sourceEpochNum);

          // 3. Fetch source and apply patches
          const workDir = fetchAndPrepareSource(recipe, pDir, destdir, continueBuild, sourceEpochNum);

          // 4. Staging directories & environment
          const prefixDir = '/data/data/com.termux/files/usr';
          try {
            mkdirSync(join(prefixDir, 'lib'), { recursive: true });
            writeFileSync(join(prefixDir, 'lib', 'libpthread.so'), 'INPUT(-lc)\n');
            writeFileSync(join(prefixDir, 'lib', 'libpthread.a'), 'INPUT(-lc)\n');
          } catch {}

          const repoRoot = resolve('.');
          const { wrapperDir, hasSpaces } = setupCompilerWrappers(destdir, workDir, repoRoot);
          const prefixMap = hasSpaces
            ? ''
            : `-ffile-prefix-map=${workDir}=. -ffile-prefix-map=${destdir}=. -ffile-prefix-map=${repoRoot}=/repoexe`;

          let rustFlagsTokens: string[] = [];
          if (process.env.CARGO_ENCODED_RUSTFLAGS) {
            rustFlagsTokens = process.env.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean);
          } else if (process.env.RUSTFLAGS) {
            rustFlagsTokens = process.env.RUSTFLAGS.trim().split(/\s+/).filter(Boolean);
          }
          rustFlagsTokens.push(`--remap-path-prefix=${workDir}=.`);
          const cargoEncodedRustflags = rustFlagsTokens.join('\x1f');

          const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
            PATH: `${wrapperDir}:${process.env.PATH || ''}`,
            TMPDIR: process.env.TMPDIR || tmpdir(),
            TARGET_ARCH: recipe.arch,
            DESTDIR: stageDir,
            PREFIX: prefixDir,
            RECIPE_DIR: resolve(pDir),
            RECIPE_VERSION: recipe.version,
            RECIPE_EPOCH: String(recipe.epoch),
            RECIPE_NDK: recipe.ndk || 'default',
            SOURCE_DATE_EPOCH: sourceEpoch,
            ZERO_AR_DATE: '1',
            LC_ALL: 'C.UTF-8',
            LANG: 'C.UTF-8',
            TZ: 'UTC',
            PYTHONHASHSEED: '0',
            PYTHONDONTWRITEBYTECODE: '1',
            XZ_OPT: '-T1',
            CFLAGS: `${process.env.CFLAGS || ''} ${prefixMap} -Wno-error=date-time`.trim(),
            CXXFLAGS: `${process.env.CXXFLAGS || ''} ${prefixMap} -Wno-error=date-time`.trim(),
            CARGO_ENCODED_RUSTFLAGS: cargoEncodedRustflags,
            RUSTFLAGS: `${process.env.RUSTFLAGS || ''} --remap-path-prefix=${workDir}=.`.trim(),
            GOFLAGS: `${process.env.GOFLAGS || ''} -trimpath`.trim(),
            PKG_CONFIG_DIR: '',
            PKG_CONFIG_LIBDIR: `${prefixDir}/lib/pkgconfig:${prefixDir}/share/pkgconfig`,
            PKG_CONFIG_PATH: `${prefixDir}/lib/pkgconfig:${prefixDir}/share/pkgconfig`,
            PKG_CONFIG_SYSROOT_DIR: '',
          };

          // 5. Run compile phases inside workDir
          for (const phase of ['prepare', 'configure', 'make', 'install']) {
            const cmd = recipe.phases[phase];
            if (cmd) {
              if (!quiet) {
                console.log(`[${recipe.name}] Running ${phase} phase...`);
              }
              const res = spawnSync('sh', ['-c', cmd], { stdio: 'inherit', env, cwd: workDir });
              if (res.status !== 0) {
                throw new Error(`${phase} phase failed for ${recipe.name}`);
              }
            }
          }

          // 6. Copy static files/ if present
          const filesDir = join(pDir, 'files');
          if (existsSync(filesDir)) {
            const prefixDest = join(stageDir, 'data', 'data', 'com.termux', 'files', 'usr');
            mkdirSync(prefixDest, { recursive: true });
            const cpRes = spawnSync('cp', ['-a', `${filesDir}/.`, `${prefixDest}/`]);
            if (cpRes.status !== 0) {
              throw new Error(`Failed to copy static files from ${filesDir} to ${prefixDest}`);
            }
          }

          writeFileSync(join(destdir, '.compile_success'), 'ok', 'utf-8');

          if (command === 'build') {
            await executePack(recipe, pDir, destdir, outputDir);
            executeTest(recipe, destdir, outputDir);
            stageValidatedOutputs(recipe, outputDir, resolve('output_validated'));
          }
        } catch (err) {
          console.error(`::error:: [${recipe.name}] Build failed: ${err instanceof Error ? err.message : String(err)}`);
          cleanupStagingDirs(destdir);
          cleanupPackageOutputs(recipe, outputDir);
          failedTargets.add(recipe.name);
        }
      } else if (command === 'pack') {
        if (
          !existsSync(stageDir) &&
          existsSync(join(destdir, '.compile_success')) &&
          existsSync(join(destdir, '.stage_compiled'))
        ) {
          try {
            cpSync(join(destdir, '.stage_compiled'), stageDir, { recursive: true, verbatimSymlinks: true });
          } catch {}
        }
        if (!existsSync(stageDir) || !existsSync(join(destdir, '.compile_success'))) {
          if (!existsSync(stageDir)) {
            console.warn(`::warning:: stage_dir ${stageDir} does not exist for pack (${recipe.name}).`);
          } else {
            console.warn(`::warning:: Skipping pack for ${recipe.name}: compilation was not successful.`);
          }
          continue;
        }
        try {
          await executePack(recipe, pDir, destdir, outputDir);
        } catch (err) {
          console.error(`::error:: [${recipe.name}] Pack failed: ${err instanceof Error ? err.message : String(err)}`);
          cleanupPackageOutputs(recipe, outputDir);
          failedTargets.add(recipe.name);
        }
      } else if (command === 'test') {
        const metadataFile = join(outputDir, `${recipe.name}_metadata.json`);
        if (!existsSync(stageDir) && !existsSync(metadataFile)) {
          if (!quiet) {
            console.log(`Notice: Neither stage_dir nor package output exist for test (${recipe.name}).`);
          }
          continue;
        }
        try {
          executeTest(recipe, destdir, outputDir);
          stageValidatedOutputs(recipe, outputDir, resolve('output_validated'));
        } catch (err) {
          console.error(
            `::error:: [${recipe.name}] Smoke test failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          cleanupStagingDirs(destdir);
          cleanupPackageOutputs(recipe, outputDir);
          failedTargets.add(recipe.name);
        }
      }
    }

    if (failedTargets.size > 0) {
      console.error(
        `::error:: Build batch completed with failure(s) for package(s): ${Array.from(failedTargets).join(', ')}`,
      );
      process.exit(1);
    }
  } else {
    console.log('RepoExe Build System CLI (Bun/TypeScript)');
    console.log('Commands: check, build, compile, pack, test, info');
  }
}

if (import.meta.main) {
  main();
}
