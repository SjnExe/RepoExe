import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

import {
  ARCH_MAP,
  buildDeb,
  extractDebArch,
  formatDebianFilenameVersion,
  getPackageSourceDateEpoch,
} from '../builders/debian.ts';
import { safeRenameSync, setupBionicCompat } from '../core/compat.ts';
import {
  CANONICAL_ARCHES,
  type DependencyToken,
  filterDepsForArch,
  isDebArchCompatible,
  normalizeArch,
  parseDependencyList,
  type VersionConstraint,
} from '../core/dependencies.ts';
import {
  checkExistingReleaseHash,
  loadTermuxIndex,
  parseFilenameDebVersion,
  resolveAndFetchBuildDependencies,
} from '../core/fetcher.ts';
import { computeStateHash, parseRecipe } from '../core/parser.ts';
import {
  copyTreePreservingLinks,
  ensureTreeRemovable,
  getSubpackageNames,
  resolveChildProducerArch,
} from '../core/subpkg.ts';
import type { PackageRecipe, SubpackageDefinition } from '../core/types.ts';
import {
  compareDebianVersions,
  formatDebianVersion,
  satisfiesVersionConstraint,
} from '../core/version.ts';
import { collectExternalNeededSonames, sanitizeStagingElfs } from '../sanitizer/elf.ts';
import { sanitizeShebangs } from '../sanitizer/shebang.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { auditRepositoryHealth } from '../utils/health.ts';
import { getBuildArch, PREFIX } from '../utils/properties.ts';

export function comparePatchFilenames(a: string, b: string): number {
  const diff = a.localeCompare(b, 'en-US-u-kn-true', { numeric: true });
  if (diff !== 0) {
    return diff;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

export type SourceIdentityInput = Partial<
  Pick<PackageRecipe, 'name' | 'source' | 'sha256' | 'patches'>
> & {
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
    for (const name of readdirSync(pFolder)) {
      if (name.endsWith('.patch') || name.endsWith('.diff')) {
        const full = join(pFolder, name);
        if (!statSync(full).isFile()) {
          throw new Error(`Patch entry '${name}' in '${pFolder}' is not a regular file.`);
        }
        patches.push(name);
      }
    }
  }

  patches.sort(comparePatchFilenames);

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

export function snapshotPatches(
  recipe: Pick<PackageRecipe, 'name'> & Partial<Pick<PackageRecipe, 'patches'>>,
  pDir: string,
): Map<string, Buffer> {
  const snapshots = new Map<string, Buffer>();
  const pf = join(pDir, 'patches');
  if (existsSync(pf) || (Array.isArray(recipe.patches) && recipe.patches.length > 0)) {
    const validPatches = resolveAndValidatePatches(
      { name: recipe.name || 'unknown', patches: recipe.patches },
      pDir,
    );
    for (const f of validPatches) {
      snapshots.set(f, readFileSync(join(pf, f)));
    }
  }
  return snapshots;
}

export function computeSourceIdentity(
  recipe: SourceIdentityInput,
  pDir: string,
  preloadedSnapshots?: Map<string, Buffer>,
): string {
  const patches: string[] = [];
  const pf = join(pDir, 'patches');
  const snapshots =
    preloadedSnapshots ||
    (existsSync(pf)
      ? snapshotPatches({ name: recipe.name || 'unknown', patches: recipe.patches }, pDir)
      : new Map<string, Buffer>());
  for (const [f, patchContent] of snapshots.entries()) {
    patches.push(`${f}:${new Bun.CryptoHasher('sha256').update(patchContent).digest('hex')}`);
  }

  const selectedPatches = Array.isArray(recipe.patches) ? [...recipe.patches] : [];
  const selectedPatchHashes: string[] = [];
  for (const sp of selectedPatches) {
    const filename = sp.startsWith('patches/') ? sp.slice(8) : sp;
    const content = snapshots.get(filename);
    if (content) {
      selectedPatchHashes.push(
        `${filename}:${new Bun.CryptoHasher('sha256').update(content).digest('hex')}`,
      );
    } else {
      const targetFile = join(pf, filename);
      if (existsSync(targetFile)) {
        const fileContent = readFileSync(targetFile);
        selectedPatchHashes.push(
          `${filename}:${new Bun.CryptoHasher('sha256').update(fileContent).digest('hex')}`,
        );
      } else {
        selectedPatchHashes.push(sp);
      }
    }
  }

  const rawSources =
    (recipe as Partial<PackageRecipe>).sources &&
    (recipe as Partial<PackageRecipe>).sources!.length > 0
      ? (recipe as Partial<PackageRecipe>).sources!
      : recipe.source
        ? [recipe.source]
        : [];
  const expandedSources = rawSources.map((s: string) => s.replace(/\{version\}/g, recipe.version));
  const rawMirrors = (recipe as Partial<PackageRecipe>).mirrors || [];
  const expandedMirrors = rawMirrors.map((m: string) => m.replace(/\{version\}/g, recipe.version));

  const identityData = {
    source: recipe.source ? recipe.source.replace(/\{version\}/g, recipe.version) : '',
    sources: expandedSources,
    mirrors: expandedMirrors,
    version: String(recipe.version || ''),
    sha256: String(recipe.sha256 || ''),
    patches,
    selected_patches: selectedPatchHashes,
  };
  return new Bun.CryptoHasher('sha256').update(JSON.stringify(identityData)).digest('hex');
}

function isGithubHttpsUrl(urlStr: string): boolean {
  try {
    const u = new URL(urlStr);
    return (
      u.protocol === 'https:' && (u.hostname === 'github.com' || u.hostname === 'api.github.com')
    );
  } catch {
    return false;
  }
}

function isZipArchive(filePath: string): boolean {
  try {
    const fd = openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(4);
      const bytesRead = readSync(fd, buf, 0, 4, 0);
      if (bytesRead >= 4 && buf[0] === 0x50 && buf[1] === 0x4b) {
        return (
          (buf[2] === 0x03 && buf[3] === 0x04) ||
          (buf[2] === 0x05 && buf[3] === 0x06) ||
          (buf[2] === 0x07 && buf[3] === 0x08)
        );
      }
      return false;
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
}

export function fetchAndPrepareSource(
  recipe: Partial<PackageRecipe> & { name: string; version: string },
  pDir: string,
  destdir: string,
  continueBuild: boolean = false,
  sourceEpoch?: number,
): string {
  const patchSnapshots = snapshotPatches(recipe, pDir);
  const rawSources =
    recipe.sources && recipe.sources.length > 0
      ? recipe.sources
      : recipe.source
        ? [recipe.source]
        : [];
  if (rawSources.length === 0) {
    return pDir;
  }

  const effectiveSourceEpoch = sourceEpoch ?? getPackageSourceDateEpoch(pDir);
  const srcExtractDir = join(destdir, 'src');
  const readyFile = join(destdir, '.source_prepared.json');
  const currentIdentity = computeSourceIdentity(recipe, pDir, patchSnapshots);

  if (continueBuild && existsSync(srcExtractDir) && existsSync(readyFile)) {
    try {
      const marker = JSON.parse(readFileSync(readyFile, 'utf-8'));
      if (
        marker.identity === currentIdentity &&
        marker.sourceEpoch === effectiveSourceEpoch &&
        marker.workDir &&
        existsSync(marker.workDir)
      ) {
        console.log(
          `[${recipe.name}] Continuing build: reusing existing source directory at ${marker.workDir}...`,
        );
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

  const candidateUrls: string[] = [];
  const addCandidate = (url: string): void => {
    const formatted = url.replace(/\{version\}/g, recipe.version);
    if (!candidateUrls.includes(formatted)) {
      candidateUrls.push(formatted);
    }
  };

  for (const s of rawSources) {
    addCandidate(s);
  }
  for (const m of recipe.mirrors || []) {
    addCandidate(m);
  }

  // Automatic well-known mirror expansions
  for (const u of [...candidateUrls]) {
    const gnuMatch = u.match(/^https?:\/\/(?:ftp|ftpmirror)\.gnu\.org\/gnu\/(.*)$/);
    if (gnuMatch) {
      addCandidate(`https://ftpmirror.gnu.org/gnu/${gnuMatch[1]}`);
      addCandidate(`https://ftp.gnu.org/gnu/${gnuMatch[1]}`);
      addCandidate(`https://mirrors.kernel.org/gnu/${gnuMatch[1]}`);
    }
    const sfMatch = u.match(/^https?:\/\/downloads\.sourceforge\.net\/(.*)$/);
    if (sfMatch) {
      addCandidate(`https://versaweb.dl.sourceforge.net/${sfMatch[1]}`);
    }
  }

  const ghToken = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  let workDir = srcExtractDir;
  let successfulUrl = '';

  for (const srcUrl of candidateUrls) {
    const isArchive = /\.(tar\.gz|tgz|tar\.xz|tar\.bz2|zip|crate|whl)$/i.test(srcUrl.split('#')[0]);

    if (
      !isArchive &&
      (srcUrl.endsWith('.git') || srcUrl.includes('.git#') || srcUrl.includes('#'))
    ) {
      console.log(`[${recipe.name}] Fetching source via git from ${srcUrl}...`);
      if (existsSync(srcExtractDir)) {
        rmSync(srcExtractDir, { recursive: true, force: true });
      }
      mkdirSync(srcExtractDir, { recursive: true });

      const gitExtraArgs: string[] = ['-c', 'advice.detachedHead=false'];
      if (ghToken && isGithubHttpsUrl(srcUrl.split('#')[0])) {
        const basicAuth = Buffer.from(`x-access-token:${ghToken}`).toString('base64');
        gitExtraArgs.push(
          '-c',
          `http.https://github.com/.extraheader=AUTHORIZATION: basic ${basicAuth}`,
        );
      }

      let gitSuccess = false;
      if (srcUrl.includes('#')) {
        const [repoUrl, ref] = srcUrl.split('#');
        if (ref.length === 40 && /^[0-9a-fA-F]+$/.test(ref)) {
          let res = spawnSync('git', ['init', srcExtractDir], { stdio: 'inherit' });
          if (res.status === 0) {
            res = spawnSync('git', ['-C', srcExtractDir, 'remote', 'add', 'origin', repoUrl], {
              stdio: 'inherit',
            });
            if (res.status === 0) {
              res = spawnSync(
                'git',
                [...gitExtraArgs, '-C', srcExtractDir, 'fetch', '--depth', '1', 'origin', ref],
                {
                  stdio: 'inherit',
                },
              );
              if (res.status === 0) {
                res = spawnSync(
                  'git',
                  [
                    '-c',
                    'advice.detachedHead=false',
                    '-C',
                    srcExtractDir,
                    'checkout',
                    'FETCH_HEAD',
                  ],
                  {
                    stdio: 'inherit',
                  },
                );
                if (res.status === 0) {
                  gitSuccess = true;
                }
              }
            }
          }
        } else {
          const res = spawnSync(
            'git',
            [...gitExtraArgs, 'clone', '--depth', '1', '--branch', ref, repoUrl, srcExtractDir],
            {
              stdio: 'inherit',
            },
          );
          if (res.status === 0) {
            gitSuccess = true;
          }
        }
      } else {
        const res = spawnSync(
          'git',
          [...gitExtraArgs, 'clone', '--depth', '1', srcUrl, srcExtractDir],
          {
            stdio: 'inherit',
          },
        );
        if (res.status === 0) {
          gitSuccess = true;
        }
      }
      if (gitSuccess) {
        successfulUrl = srcUrl;
        break;
      }
      if (existsSync(srcExtractDir)) {
        rmSync(srcExtractDir, { recursive: true, force: true });
      }
      console.warn(
        `[${recipe.name}] Git fetch failed from ${srcUrl}, trying alternative mirrors...`,
      );
    } else {
      console.log(`[${recipe.name}] Downloading source archive from ${srcUrl}...`);
      const archivePath = join(destdir, 'source_archive');
      if (existsSync(archivePath)) {
        rmSync(archivePath, { force: true });
      }

      const curlArgs = [
        '-fsSL',
        '-A',
        'Mozilla/5.0',
        '--connect-timeout',
        '20',
        '--max-time',
        '600',
        '--retry',
        '3',
      ];
      if (ghToken && isGithubHttpsUrl(srcUrl)) {
        curlArgs.push('-H', `Authorization: Bearer ${ghToken}`);
      }
      curlArgs.push(srcUrl, '-o', archivePath);

      const curlRes = spawnSync('curl', curlArgs, { stdio: 'inherit' });
      if (curlRes.status !== 0) {
        console.warn(
          `[${recipe.name}] Curl download failed from ${srcUrl} (status ${curlRes.status}), trying next mirror...`,
        );
        if (existsSync(archivePath)) {
          rmSync(archivePath, { force: true });
        }
        continue;
      }

      if (recipe.sha256) {
        const digest = new Bun.CryptoHasher('sha256')
          .update(readFileSync(archivePath))
          .digest('hex');
        if (digest.toLowerCase() !== recipe.sha256.toLowerCase()) {
          console.warn(
            `[${recipe.name}] sha256 mismatch from ${srcUrl}: expected ${recipe.sha256}, got ${digest}. Trying next mirror...`,
          );
          if (existsSync(archivePath)) {
            rmSync(archivePath, { force: true });
          }
          continue;
        }
      }

      // Extract archive and verify success before accepting candidate
      if (existsSync(srcExtractDir)) {
        ensureTreeRemovable(srcExtractDir);
        rmSync(srcExtractDir, { recursive: true, force: true });
      }
      mkdirSync(srcExtractDir, { recursive: true });

      let extractRes;
      if (isZipArchive(archivePath)) {
        extractRes = spawnSync('unzip', ['-q', '-o', archivePath, '-d', srcExtractDir], {
          stdio: 'inherit',
        });
      } else {
        extractRes = spawnSync('tar', ['-xf', archivePath, '-C', srcExtractDir], {
          stdio: 'inherit',
        });
      }

      if (extractRes.status !== 0) {
        console.warn(
          `[${recipe.name}] Failed to extract source archive from ${srcUrl}, trying next mirror...`,
        );
        if (existsSync(srcExtractDir)) {
          ensureTreeRemovable(srcExtractDir);
          rmSync(srcExtractDir, { recursive: true, force: true });
        }
        if (existsSync(archivePath)) {
          rmSync(archivePath, { force: true });
        }
        continue;
      }

      successfulUrl = srcUrl;
      const items = readdirSync(srcExtractDir, { withFileTypes: true });
      if (items.length === 1 && items[0].isDirectory()) {
        workDir = join(srcExtractDir, items[0].name);
      }
      break;
    }
  }

  if (!successfulUrl) {
    throw new Error(
      `Failed to download source archive for ${recipe.name}. Tried URLs:\n  ${candidateUrls.join('\n  ')}`,
    );
  }

  // Apply patches strictly from the pre-hashed in-memory snapshot
  for (const [patch, patchBytes] of patchSnapshots.entries()) {
    console.log(`⚡ Applying patch: ${patch}...`);
    const patchRes = spawnSync('patch', ['-p1'], {
      cwd: workDir,
      input: patchBytes,
      stdio: ['pipe', 'inherit', 'inherit'],
    });
    if (patchRes.status !== 0) {
      throw new Error(`Failed to apply patch ${patch} for ${recipe.name}`);
    }
  }

  writeFileSync(
    readyFile,
    JSON.stringify(
      { identity: currentIdentity, workDir, sourceEpoch: effectiveSourceEpoch },
      null,
      2,
    ),
    'utf-8',
  );
  return workDir;
}

export interface CompileStamp {
  status: 'ok';
  arch: string;
  concrete_arch?: string;
  state_hash: string;
  version: string;
  revision: number;
  epoch: number;
  source_date_epoch?: number;
  compile_duration_sec?: number;
}

export function buildCompileStamp(
  recipe: Pick<PackageRecipe, 'arch' | 'state_hash' | 'version' | 'revision' | 'epoch'>,
  sourceDateEpoch?: number,
  concreteBuildArch?: string,
  compileDurationSec?: number,
): CompileStamp {
  const rawArch = recipe.arch || 'aarch64';
  const normArch = rawArch === 'all' ? 'all' : normalizeArch(rawArch);
  const concrete = concreteBuildArch ? normalizeArch(concreteBuildArch) : undefined;
  return {
    status: 'ok',
    arch: normArch,
    concrete_arch: normArch === 'all' ? concrete || 'aarch64' : concrete,
    state_hash: recipe.state_hash || '',
    version: String(recipe.version || ''),
    revision: Number(recipe.revision ?? 0),
    epoch: Number(recipe.epoch ?? 0),
    source_date_epoch: sourceDateEpoch !== undefined ? Number(sourceDateEpoch) : undefined,
    ...(compileDurationSec !== undefined ? { compile_duration_sec: compileDurationSec } : {}),
  };
}

export function validateCompileStamp(
  destdir: string,
  recipe: Pick<PackageRecipe, 'arch' | 'state_hash' | 'version' | 'revision' | 'epoch'>,
  expectedSourceEpoch?: number,
  expectedConcreteArch?: string,
): { valid: boolean; archMismatch: boolean; reason?: string } {
  const stampPath = join(destdir, '.compile_success');
  if (!existsSync(stampPath)) {
    return { valid: false, archMismatch: false, reason: 'missing .compile_success stamp' };
  }
  const expected = buildCompileStamp(recipe, expectedSourceEpoch, expectedConcreteArch);
  try {
    const parsed = JSON.parse(readFileSync(stampPath, 'utf-8')) as Partial<CompileStamp>;
    if (!parsed || parsed.status !== 'ok' || typeof parsed.arch !== 'string') {
      return {
        valid: false,
        archMismatch: false,
        reason: 'unrecognized or legacy .compile_success format',
      };
    }
    const recordedArch = parsed.arch === 'all' ? 'all' : normalizeArch(parsed.arch);
    if (recordedArch !== expected.arch) {
      return {
        valid: false,
        archMismatch: true,
        reason: `compiled stage architecture '${recordedArch}' does not match requested architecture '${expected.arch}'`,
      };
    }
    if (recordedArch === 'all' && expectedConcreteArch) {
      const normExpectedConcrete = normalizeArch(expectedConcreteArch);
      const recordedConcrete = parsed.concrete_arch
        ? normalizeArch(parsed.concrete_arch)
        : undefined;
      if (recordedConcrete && recordedConcrete !== normExpectedConcrete) {
        return {
          valid: false,
          archMismatch: true,
          reason: `compiled stage concrete architecture '${recordedConcrete}' does not match requested concrete architecture '${normExpectedConcrete}'`,
        };
      }
    }
    if (
      parsed.state_hash !== expected.state_hash ||
      parsed.version !== expected.version ||
      Number(parsed.revision ?? 0) !== expected.revision ||
      Number(parsed.epoch ?? 0) !== expected.epoch
    ) {
      return {
        valid: false,
        archMismatch: false,
        reason: 'compiled stage identity does not match current recipe state',
      };
    }
    if (
      expectedSourceEpoch !== undefined &&
      parsed.source_date_epoch !== undefined &&
      Number(parsed.source_date_epoch) !== Number(expectedSourceEpoch)
    ) {
      return {
        valid: false,
        archMismatch: false,
        reason: `compiled source epoch '${parsed.source_date_epoch}' does not match pack epoch '${expectedSourceEpoch}'`,
      };
    }
    return { valid: true, archMismatch: false };
  } catch {
    return { valid: false, archMismatch: false, reason: 'invalid .compile_success stamp' };
  }
}

export function buildCargoRustflagsEnv(
  baseEnv: Record<string, string | undefined>,
  workDir: string,
): { CARGO_ENCODED_RUSTFLAGS?: string; deleteRustflags: boolean } {
  if (baseEnv.CARGO_ENCODED_RUSTFLAGS !== undefined) {
    const tokens = baseEnv.CARGO_ENCODED_RUSTFLAGS.split('\x1f').filter(Boolean);
    if (!tokens.some((t) => t.startsWith('--remap-path-prefix='))) {
      tokens.push(`--remap-path-prefix=${workDir}=.`);
    }
    return { CARGO_ENCODED_RUSTFLAGS: tokens.join('\x1f'), deleteRustflags: false };
  }
  return { deleteRustflags: false };
}

export function cleanupStagingDirs(destdir: string): void {
  if (!existsSync(destdir)) {
    return;
  }
  rmSync(join(destdir, '.compile_success'), { force: true });
  const targets = [join(destdir, '.stage_compiled'), join(destdir, 'stage')];
  for (const entry of readdirSync(destdir)) {
    if (entry.startsWith('stage_')) {
      targets.push(join(destdir, entry));
    }
  }
  for (const target of targets) {
    if (existsSync(target)) {
      ensureTreeRemovable(target);
      rmSync(target, { recursive: true, force: true });
    }
  }
}

export function cleanupPackageOutputs(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string }),
  outputDir: string,
  targetArch?: string,
): void {
  if (!existsSync(outputDir)) {
    return;
  }
  const concreteArch = targetArch || recipe.arch;
  const findSubDef = (pkgName: string): SubpackageDefinition | undefined => {
    if (!recipe.subpackages || typeof recipe.subpackages !== 'object') {
      return undefined;
    }
    for (const [key, def] of Object.entries(recipe.subpackages)) {
      if (!def || typeof def !== 'object') {
        continue;
      }
      const emitted = (def as SubpackageDefinition).name || key;
      if (emitted === pkgName) {
        return def as SubpackageDefinition;
      }
    }
    return undefined;
  };

  const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);
  const producedSubpkgs = subpkgNames.filter((name) => {
    const subDef = findSubDef(name);
    if (!subDef) {
      return true;
    }
    const subArch = subDef.arch || recipe.arch || 'aarch64';
    if (subArch === 'all') {
      const producer = resolveChildProducerArch(recipe as PackageRecipe, subDef);
      if (
        concreteArch &&
        normalizeArch(producer) !== 'all' &&
        normalizeArch(producer) !== normalizeArch(concreteArch)
      ) {
        return false;
      }
    }
    return true;
  });
  const targetPrefixArches = new Map<string, string>();
  const parentDebArch =
    recipe.arch === 'all' ? 'all' : normalizeArch(concreteArch || recipe.arch || 'aarch64');
  targetPrefixArches.set(recipe.name, parentDebArch);

  for (const name of producedSubpkgs) {
    const subDef = findSubDef(name);
    const subArch =
      subDef?.arch === 'all'
        ? 'all'
        : normalizeArch(subDef?.arch || concreteArch || recipe.arch || 'aarch64');
    targetPrefixArches.set(name, subArch);
  }

  for (const f of readdirSync(outputDir)) {
    if (!f.endsWith('.deb')) {
      continue;
    }
    const underIdx = f.indexOf('_');
    if (underIdx === -1) {
      continue;
    }
    const pkgName = f.slice(0, underIdx);
    const expectedArch = targetPrefixArches.get(pkgName);
    if (expectedArch && extractDebArch(f) === expectedArch) {
      try {
        rmSync(join(outputDir, f), { recursive: true, force: true });
      } catch {}
    }
  }
  try {
    rmSync(join(outputDir, `${recipe.name}_metadata.json`), { recursive: true, force: true });
    const metaArch = recipe.arch
      ? recipe.arch === 'all'
        ? 'all'
        : normalizeArch(recipe.arch)
      : 'aarch64';
    rmSync(join(outputDir, `${recipe.name}_${metaArch}_metadata.json`), {
      recursive: true,
      force: true,
    });
  } catch {}
}

export function stageValidatedOutputs(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string }),
  outputDir: string,
  validatedDir: string,
  testedArtifacts?: string[],
  renameFn: (oldPath: string, newPath: string) => void = safeRenameSync,
): void {
  mkdirSync(validatedDir, { recursive: true });
  if (testedArtifacts !== undefined && testedArtifacts.length === 0) {
    return;
  }
  const testedSet = testedArtifacts ? new Set(testedArtifacts) : null;
  if (testedSet && testedSet.size > 0) {
    for (const file of testedSet) {
      if (!existsSync(join(outputDir, file))) {
        throw new Error(
          `Incomplete tested artifact set for promotion: '${file}' was tested but is missing in outputDir '${outputDir}'.`,
        );
      }
    }
  }
  if (!existsSync(outputDir)) {
    return;
  }

  const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);
  const targetPrefixes = [recipe.name, ...subpkgNames];

  const expectedDebVersion = recipe.version
    ? formatDebianVersion(recipe as PackageRecipe)
    : undefined;

  const filesToCopy: string[] = [];
  for (const file of readdirSync(outputDir)) {
    if (file.endsWith('.deb')) {
      if (testedSet) {
        if (testedSet.has(file)) {
          filesToCopy.push(file);
        }
      } else {
        const firstUnderscore = file.indexOf('_');
        if (firstUnderscore > 0) {
          const pkg = file.slice(0, firstUnderscore);
          if (targetPrefixes.includes(pkg)) {
            const ver = parseFilenameDebVersion(file);
            if (!expectedDebVersion || ver === expectedDebVersion) {
              filesToCopy.push(file);
            }
          }
        }
      }
    } else if (file.endsWith('_metadata.json') || file === 'metadata.json') {
      const base = file === 'metadata.json' ? recipe.name : file.replace(/_metadata\.json$/, '');
      let candidatePkg = base;
      const expectedPkg = targetPrefixes.find(
        (p) =>
          base === p ||
          (base.startsWith(`${p}_`) &&
            CANONICAL_ARCHES.has(normalizeArch(base.slice(p.length + 1)))),
      );
      if (expectedPkg) {
        candidatePkg = expectedPkg;
      } else {
        const match = base.match(
          /^(.*?)(?:_(aarch64|arm64|x86_64|amd64|arm|armhf|armel|armv7|i686|i386|all))?$/i,
        );
        if (match && match[2] && CANONICAL_ARCHES.has(normalizeArch(match[2]))) {
          candidatePkg = match[1];
        }
      }
      if (targetPrefixes.includes(candidatePkg) || candidatePkg === recipe.name) {
        if (testedArtifacts !== undefined) {
          try {
            const metaRaw = readFileSync(join(outputDir, file), 'utf-8');
            const metaParsed = JSON.parse(metaRaw);
            if (metaParsed && typeof metaParsed === 'object' && metaParsed.archive_digest) {
              const metaArch = metaParsed.arch
                ? metaParsed.arch === 'all'
                  ? 'all'
                  : normalizeArch(metaParsed.arch)
                : 'aarch64';
              const metaName = metaParsed.name || candidatePkg;
              const matchesTested = testedArtifacts.some((testedDeb) => {
                const tPath = join(outputDir, testedDeb);
                if (!existsSync(tPath)) {
                  return false;
                }
                const tArch = extractDebArch(testedDeb);
                const normTArch = tArch === 'all' ? 'all' : normalizeArch(tArch);
                if (normTArch !== metaArch) {
                  return false;
                }
                const tName = testedDeb.split('_')[0];
                if (tName !== metaName) {
                  return false;
                }
                const actualDigest = createHash('sha256').update(readFileSync(tPath)).digest('hex');
                return actualDigest === metaParsed.archive_digest;
              });
              if (matchesTested) {
                filesToCopy.push(file);
              }
            }
          } catch {}
        } else {
          filesToCopy.push(file);
        }
      }
    }
  }

  filesToCopy.sort();

  if (filesToCopy.length === 0) {
    return;
  }

  const parentDir = resolve(validatedDir, '..');
  let tmpPromoDir: string | null = null;
  let backupDir: string | null = null;
  const replacedFiles = new Map<string, string>(); // dst -> backupPath
  const promoted: string[] = [];
  let committed = false;

  try {
    tmpPromoDir = mkdtempSync(join(parentDir, '.promo.tmp-'));
    backupDir = mkdtempSync(join(parentDir, '.promo.backup-'));
    for (const file of filesToCopy) {
      copyFileSync(join(outputDir, file), join(tmpPromoDir, file));
    }
    // Backup any existing file in validatedDir that will be overwritten
    for (const file of filesToCopy) {
      const dst = join(validatedDir, file);
      if (existsSync(dst)) {
        const backupDst = join(backupDir, file);
        copyFileSync(dst, backupDst);
        replacedFiles.set(dst, backupDst);
      }
    }
    for (const file of filesToCopy) {
      const src = join(tmpPromoDir, file);
      const dst = join(validatedDir, file);
      renameFn(src, dst);
      promoted.push(dst);
    }
    committed = true;
  } catch (err) {
    // Rollback: restore backed up destination files or remove newly promoted ones
    for (const dst of promoted) {
      try {
        const backup = replacedFiles.get(dst);
        if (backup && existsSync(backup)) {
          renameFn(backup, dst);
          replacedFiles.delete(dst);
        } else {
          rmSync(dst, { recursive: true, force: true });
        }
      } catch (rErr) {
        console.error(
          `::error:: Rollback restore failed for ${dst}: ${rErr instanceof Error ? rErr.message : String(rErr)}`,
        );
      }
    }
    for (const [dst, backup] of Array.from(replacedFiles.entries())) {
      try {
        if (existsSync(backup) && !existsSync(dst)) {
          renameFn(backup, dst);
          replacedFiles.delete(dst);
        }
      } catch (rErr) {
        console.error(
          `::error:: Rollback restore failed for ${dst}: ${rErr instanceof Error ? rErr.message : String(rErr)}`,
        );
      }
    }
    throw err;
  } finally {
    if (tmpPromoDir && existsSync(tmpPromoDir)) {
      try {
        rmSync(tmpPromoDir, { recursive: true, force: true });
      } catch {}
    }
    if (backupDir && existsSync(backupDir)) {
      if (committed || replacedFiles.size === 0) {
        try {
          rmSync(backupDir, { recursive: true, force: true });
        } catch {}
      } else {
        console.warn(
          `::warning:: Preserving unrestored backups in ${backupDir}:`,
          Array.from(replacedFiles.values()),
        );
      }
    }
  }
}

async function hasUsablePublishedOrLocalArtifact(
  pkgName: string,
  arch: string,
  constraint?: VersionConstraint,
  ownerPkg?: string,
  customOutputDirs?: string[],
): Promise<boolean> {
  const normArch = arch === 'arm64' ? 'aarch64' : (arch || 'aarch64').toLowerCase();
  const repoArch = ['aarch64', 'arm', 'x86_64', 'i686'].includes(normArch) ? normArch : 'aarch64';
  const outDir = resolve('output');
  const artDir = resolve('artifacts');
  const searchDirs = [...(customOutputDirs || []).map((d) => resolve(d)), artDir, outDir];
  const uniqueDirs = Array.from(new Set(searchDirs));
  for (const dir of uniqueDirs) {
    if (existsSync(dir)) {
      const files = readdirSync(dir);
      for (const f of files) {
        if (f.endsWith('.deb') && isDebArchCompatible(f, repoArch)) {
          if (f.startsWith(`${pkgName}_`)) {
            const ver = parseFilenameDebVersion(f);
            if (satisfiesVersionConstraint(ver, constraint)) {
              return true;
            }
          }
          try {
            const debPath = join(dir, f);
            const res = spawnSync('dpkg-deb', ['-f', debPath, 'Provides'], { encoding: 'utf-8' });
            if (res.status === 0 && res.stdout) {
              for (const clause of parseDependencyList([res.stdout.trim()])) {
                for (const tok of clause) {
                  if (tok.name.split(':')[0].trim() === pkgName) {
                    const provVer = tok.versionConstraint?.version;
                    if (!constraint) {
                      return true;
                    }
                    if (provVer && satisfiesVersionConstraint(provVer, constraint)) {
                      return true;
                    }
                  }
                }
              }
            }
          } catch {}
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
      const data = (await resp.json()) as {
        assets?: Array<{ name: string; provides?: string[] | string }>;
      };
      const debAssets = (data.assets || []).filter((a) => a.name.endsWith('.deb'));
      for (const a of debAssets) {
        if (!isDebArchCompatible(a.name, repoArch)) {
          continue;
        }
        if (a.name.startsWith(`${pkgName}_`)) {
          const ver = parseFilenameDebVersion(a.name);
          if (satisfiesVersionConstraint(ver, constraint)) {
            return true;
          }
        }
        const aProvides = (a as { provides?: string[] | string }).provides;
        if (aProvides) {
          const provList = Array.isArray(aProvides) ? aProvides : [aProvides];
          for (const clause of parseDependencyList(provList)) {
            for (const tok of clause) {
              if (tok.name.split(':')[0].trim() === pkgName) {
                const provVer = tok.versionConstraint?.version;
                if (!constraint) {
                  return true;
                }
                if (provVer && satisfiesVersionConstraint(provVer, constraint)) {
                  return true;
                }
              }
            }
          }
        }
      }
    }
  } catch {}

  try {
    const index = await loadTermuxIndex(repoArch);
    const candidates =
      index[pkgName] || index[`lib${pkgName}`] || index[pkgName.replace(/^lib/, '')] || [];
    for (const cand of candidates) {
      const ver = (cand.IsVirtual === 'true' ? cand.ProvidedVersion : cand.Version) ?? '';
      if (satisfiesVersionConstraint(ver, constraint)) {
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

  const rawPath = process.env.PATH || '';
  const pathDirs = rawPath.split(':').filter(Boolean);
  const commandExistsOnPath = (cmd: string): boolean => {
    for (const d of pathDirs) {
      const full = join(d, cmd);
      try {
        const st = statSync(full);
        if (st.isFile() && (st.mode & 0o111) !== 0) {
          return true;
        }
      } catch {}
    }
    return false;
  };

  const compilers = ['cc', 'c++', 'gcc', 'g++', 'clang', 'clang++', 'rustc'];

  for (const cmd of compilers) {
    if (!commandExistsOnPath(cmd)) {
      continue;
    }
    const scriptPath = join(wrapperDir, cmd);
    const mapArg1 = `'-ffile-prefix-map=${workDir.replace(/'/g, `'\\''`)}=.'`;
    const mapArg2 = `'-ffile-prefix-map=${destdir.replace(/'/g, `'\\''`)}=.'`;
    const mapArg3 = `'-ffile-prefix-map=${repoRoot.replace(/'/g, `'\\''`)}=/repoexe'`;

    let content: string;
    if (cmd === 'rustc') {
      content = `#!/bin/sh
SELF="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
SELFDIR="$(dirname "$SELF")"
BIN="$(basename "$0")"

OLD_IFS="$IFS"
IFS=":"
TARGET=""
for dir in $PATH; do
  CAND_DIR="$(readlink -f "$dir" 2>/dev/null || realpath "$dir" 2>/dev/null || echo "$dir")"
  CAND_BIN="$(readlink -f "$dir/$BIN" 2>/dev/null || realpath "$dir/$BIN" 2>/dev/null || echo "$dir/$BIN")"
  if [ "$CAND_DIR" != "$SELFDIR" ] && [ "$dir" != "$SELFDIR" ] && [ "$CAND_BIN" != "$SELF" ] && [ -x "$dir/$BIN" ]; then
    TARGET="$dir/$BIN"
    break
  fi
done
IFS="$OLD_IFS"

if [ -z "$TARGET" ]; then
  TARGET="/usr/bin/$BIN"
fi

remapArg="--remap-path-prefix=${workDir.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}=."
hasRemap=0
for arg in "$@"; do
  case "$arg" in
    --remap-path-prefix=*) hasRemap=1 ;;
  esac
done
if [ "$hasRemap" -eq 1 ]; then
  exec "$TARGET" "$@"
else
  exec "$TARGET" "$@" "$remapArg"
fi
`;
    } else {
      content = `#!/bin/sh
SELF="$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")"
SELFDIR="$(dirname "$SELF")"
BIN="$(basename "$0")"

OLD_IFS="$IFS"
IFS=":"
TARGET=""
for dir in $PATH; do
  CAND_DIR="$(readlink -f "$dir" 2>/dev/null || realpath "$dir" 2>/dev/null || echo "$dir")"
  CAND_BIN="$(readlink -f "$dir/$BIN" 2>/dev/null || realpath "$dir/$BIN" 2>/dev/null || echo "$dir/$BIN")"
  if [ "$CAND_DIR" != "$SELFDIR" ] && [ "$dir" != "$SELFDIR" ] && [ "$CAND_BIN" != "$SELF" ] && [ -x "$dir/$BIN" ]; then
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
    }
    writeFileSync(scriptPath, content, { mode: 0o755 });
  }

  return { wrapperDir, hasSpaces };
}

export async function executePack(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string; version: string }),
  pkgDir: string,
  destdir: string,
  outputDir: string,
  sourceEpoch?: number,
): Promise<void> {
  const packStartMs = Date.now();
  const supportedFormats = new Set(['apt']);
  const fmts = recipe.formats || ['apt'];
  for (const fmt of fmts) {
    if (!supportedFormats.has(fmt)) {
      throw new Error(
        `Unsupported package format '${fmt}' for ${recipe.name}. Supported format: apt.`,
      );
    }
  }

  mkdirSync(outputDir, { recursive: true });

  const stageDir = join(destdir, 'stage');

  sanitizeStagingElfs(stageDir);
  sanitizeShebangs(stageDir);

  const tmpPackDir = mkdtempSync(join(outputDir, '.tmp-pack-'));
  try {
    const builtDeb = buildDeb(
      recipe as PackageRecipe,
      destdir,
      tmpPackDir,
      recipe.arch,
      pkgDir,
      sourceEpoch,
    );

    let archiveDigest: string | undefined;
    if (builtDeb && existsSync(builtDeb)) {
      archiveDigest = createHash('sha256').update(readFileSync(builtDeb)).digest('hex');
    }

    let compileDurationSec = 0;
    try {
      const stampPath = join(destdir, '.compile_success');
      if (existsSync(stampPath)) {
        const stamp = JSON.parse(readFileSync(stampPath, 'utf-8')) as {
          compile_duration_sec?: number;
        };
        if (
          typeof stamp.compile_duration_sec === 'number' &&
          Number.isFinite(stamp.compile_duration_sec)
        ) {
          compileDurationSec = stamp.compile_duration_sec;
        }
      }
    } catch {}
    const packDurationSec = Math.max(1, Math.round((Date.now() - packStartMs) / 1000));
    const totalBuildDurationSec = Math.max(1, Math.round(compileDurationSec + packDurationSec));

    const metaArch = recipe.arch
      ? recipe.arch === 'all'
        ? 'all'
        : normalizeArch(recipe.arch)
      : 'aarch64';
    const neededSonames = collectExternalNeededSonames(stageDir);
    const depVersions: Record<string, string> = {};
    const depArch = metaArch === 'all' ? 'aarch64' : metaArch;
    const rawDepClauses = Array.isArray(recipe.deps)
      ? filterDepsForArch(parseDependencyList(recipe.deps), depArch)
      : [];
    const termuxCachePath = join(
      process.env.TMPDIR || tmpdir(),
      `termux_apt_index_v3_${depArch}.json`,
    );
    if (
      rawDepClauses.length > 0 &&
      process.env.REPOEXE_OFFLINE !== '1' &&
      (process.env.CI === 'true' || existsSync(termuxCachePath))
    ) {
      try {
        const termuxIndex = await loadTermuxIndex(depArch);
        for (const group of rawDepClauses) {
          for (const token of group) {
            const depName = token.name;
            if (!depName || depVersions[depName]) {
              continue;
            }
            const entries = termuxIndex[depName];
            if (!entries || entries.length === 0) {
              continue;
            }
            let bestVer = '';
            for (const entry of entries) {
              const ver = entry.Version || '';
              if (ver && (!bestVer || compareDebianVersions(ver, bestVer) > 0)) {
                bestVer = ver;
              }
            }
            if (bestVer) {
              depVersions[depName] = bestVer;
            }
          }
        }
      } catch {}
    }

    const meta = {
      name: recipe.name,
      version: recipe.version,
      revision: recipe.revision,
      arch: recipe.arch,
      state_hash: recipe.state_hash || '',
      build_duration_sec: totalBuildDurationSec,
      build_durations: { [metaArch]: totalBuildDurationSec },
      ...(neededSonames.length > 0 ? { needed_sonames: { [metaArch]: neededSonames } } : {}),
      ...(Object.keys(depVersions).length > 0 ? { dep_versions: { [metaArch]: depVersions } } : {}),
      ...(archiveDigest ? { archive_digest: archiveDigest } : {}),
    };
    const metaContent = JSON.stringify(meta, null, 2);
    await Bun.write(join(tmpPackDir, `${recipe.name}_${metaArch}_metadata.json`), metaContent);

    // Assembly succeeded; now replace previous outputs in outputDir with rollback guarantee
    const backupDir = mkdtempSync(join(outputDir, '.tmp-backup-'));
    const backedUpFiles: Array<{ name: string; backupPath: string }> = [];
    const concreteArch = recipe.arch;
    const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);
    const findSubDef = (pkgName: string): SubpackageDefinition | undefined => {
      if (!recipe.subpackages || typeof recipe.subpackages !== 'object') {
        return undefined;
      }
      for (const [key, def] of Object.entries(recipe.subpackages)) {
        if (!def || typeof def !== 'object') {
          continue;
        }
        const emitted = (def as SubpackageDefinition).name || key;
        if (emitted === pkgName) {
          return def as SubpackageDefinition;
        }
      }
      return undefined;
    };
    const producedSubpkgs = subpkgNames.filter((name) => {
      const subDef = findSubDef(name);
      if (!subDef) {
        return true;
      }
      const subArch = subDef.arch || recipe.arch || 'aarch64';
      if (subArch === 'all') {
        const producer = resolveChildProducerArch(recipe as PackageRecipe, subDef);
        if (
          concreteArch &&
          normalizeArch(producer) !== 'all' &&
          normalizeArch(producer) !== normalizeArch(concreteArch)
        ) {
          return false;
        }
      }
      return true;
    });
    const targetPrefixArches = new Map<string, string>();
    const parentDebArch =
      recipe.arch === 'all' ? 'all' : normalizeArch(concreteArch || recipe.arch || 'aarch64');
    targetPrefixArches.set(recipe.name, parentDebArch);
    for (const name of producedSubpkgs) {
      const subDef = findSubDef(name);
      const subArch =
        subDef?.arch === 'all'
          ? 'all'
          : normalizeArch(subDef?.arch || concreteArch || recipe.arch || 'aarch64');
      targetPrefixArches.set(name, subArch);
    }

    const movedFiles: string[] = [];
    let replacementSucceeded = false;
    try {
      for (const f of readdirSync(outputDir)) {
        if (f.startsWith('.tmp-')) {
          continue;
        }
        let shouldBackup = false;
        if (f.endsWith('.deb')) {
          const underIdx = f.indexOf('_');
          if (underIdx !== -1) {
            const pkgName = f.slice(0, underIdx);
            const expectedArch = targetPrefixArches.get(pkgName);
            if (expectedArch && extractDebArch(f) === expectedArch) {
              shouldBackup = true;
            }
          }
        } else if (
          f === `${recipe.name}_metadata.json` ||
          f === `${recipe.name}_${metaArch}_metadata.json`
        ) {
          shouldBackup = true;
        }
        if (shouldBackup) {
          const oldPath = join(outputDir, f);
          const bPath = join(backupDir, f);
          safeRenameSync(oldPath, bPath);
          backedUpFiles.push({ name: f, backupPath: bPath });
        }
      }

      for (const f of readdirSync(tmpPackDir)) {
        const src = join(tmpPackDir, f);
        const dst = join(outputDir, f);
        safeRenameSync(src, dst);
        movedFiles.push(dst);
      }
      replacementSucceeded = true;
    } catch (moveErr) {
      for (const dst of movedFiles) {
        try {
          rmSync(dst, { force: true });
        } catch {}
      }
      for (let i = backedUpFiles.length - 1; i >= 0; i--) {
        const b = backedUpFiles[i];
        try {
          safeRenameSync(b.backupPath, join(outputDir, b.name));
          backedUpFiles.splice(i, 1);
        } catch {}
      }
      throw moveErr;
    } finally {
      if (replacementSucceeded) {
        try {
          rmSync(backupDir, { recursive: true, force: true });
        } catch {}
      } else {
        try {
          if (readdirSync(backupDir).length === 0) {
            rmSync(backupDir, { recursive: true, force: true });
          }
        } catch {}
      }
    }
  } finally {
    try {
      rmSync(tmpPackDir, { recursive: true, force: true });
    } catch {}
  }
}

export function resolveTestArch(rawArch?: string, explicitBuildArch?: string): string {
  const normalized = (rawArch || 'aarch64').toLowerCase();
  return normalized === 'all'
    ? (explicitBuildArch || process.env.TARGET_ARCH || 'aarch64').toLowerCase()
    : normalized;
}

export function executeTest(
  recipe: PackageRecipe | (Partial<PackageRecipe> & { name: string }),
  destdir?: string,
  outputDir?: string,
  explicitBuildArch?: string,
): string[] {
  const testCmd = recipe.phases?.test || `${recipe.name} --version || ${recipe.name} --help`;
  console.log(`Running smoke test for ${recipe.name}: ${testCmd}`);

  const localOutputDir = outputDir ? resolve(outputDir) : resolve('output');
  const hostWorkspace = process.env.GITHUB_WORKSPACE || resolve('.');
  const rawArch = (recipe.arch || 'aarch64').toLowerCase();
  const debArch = ARCH_MAP[rawArch] || rawArch;
  const filenameVer = recipe.version
    ? formatDebianFilenameVersion({
        version: recipe.version,
        revision: recipe.revision,
        epoch: recipe.epoch,
      })
    : 'unknown';
  const targetDeb = `${recipe.name}_${filenameVer}_${debArch}.deb`;

  const getSubExpectedArch = (pkgName: string): string => {
    if (pkgName === recipe.name) {
      return debArch;
    }
    if (recipe.subpackages && typeof recipe.subpackages === 'object') {
      for (const [sKey, sDef] of Object.entries(recipe.subpackages)) {
        if (sDef) {
          const emittedName = typeof sDef === 'object' && sDef?.name ? sDef.name : sKey;
          if (emittedName === pkgName) {
            if (typeof sDef === 'object' && sDef.arch) {
              const norm = normalizeArch(sDef.arch);
              return norm === 'all' ? 'all' : norm;
            }
            return debArch;
          }
        }
      }
    }
    return debArch;
  };

  const isDesignatedProducerForChild = (pkgName: string): boolean => {
    const sExpectedArch = getSubExpectedArch(pkgName);
    if (sExpectedArch !== 'all') {
      return true;
    }
    let subDef: SubpackageDefinition | undefined;
    if (recipe.subpackages && typeof recipe.subpackages === 'object') {
      for (const [sKey, sVal] of Object.entries(recipe.subpackages)) {
        if (sVal && typeof sVal === 'object') {
          const emitted = sVal.name || sKey;
          if (emitted === pkgName) {
            subDef = sVal;
            break;
          }
        }
      }
    }
    const designatedProducer = resolveChildProducerArch(recipe, subDef);
    return normalizeArch(debArch) === designatedProducer;
  };

  const hasDockerSocket =
    process.env.REPOEXE_TEST_BACKEND !== 'native' && existsSync('/var/run/docker.sock');

  if (hasDockerSocket) {
    const owner = (process.env.REPO_OWNER || 'sjnexe').toLowerCase();
    const escapedCmd = testCmd.replace(/'/g, "'\\''");

    const testArch = resolveTestArch(rawArch, explicitBuildArch);
    const testerDebArch = ARCH_MAP[testArch] || testArch;
    const archKey = `TESTER_IMAGE_${testArch.toUpperCase()}`;
    const testerImage =
      process.env[archKey] || process.env.TESTER_IMAGE || `ghcr.io/${owner}/repoexe-tester:latest`;
    const containerPkgDir = '/data/data/com.termux/files/usr/tmp/repoexe-pkg';

    const testStagingDir = mkdtempSync(join(localOutputDir, `.test-stage-${recipe.name}-`));

    try {
      const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);
      const stagedDebs = new Set<string>();
      const stagedConcretePkg = new Map<string, string>(); // concretePkgName:arch -> stagedFilename
      const targetDebMap = new Map<string, string>(); // pkgName -> stagedFilename
      const getStageKey = (name: string, arch: string): string =>
        `${name}:${arch === 'all' ? 'all' : normalizeArch(arch)}`;
      const selectedPreDepDebs = new Set<string>();
      const clauseSelectedArchive = new Map<DependencyToken[], string>();
      const getExpectedArchForPkg = getSubExpectedArch;

      interface LocalDebInfo {
        filename: string;
        srcDeb: string;
        pkgName: string;
        version: string;
        arch: string;
        multiArch?: string;
        depends: DependencyToken[][];
        preDepends: DependencyToken[][];
        provides: Array<{ name: string; versionConstraint?: VersionConstraint }>;
      }
      const localDebsByName = new Map<string, LocalDebInfo[]>();
      const localDebsByFilename = new Map<string, LocalDebInfo>();

      if (existsSync(localOutputDir)) {
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

              const extractField = (fieldName: string): string => {
                const lines = text.split(/\r?\n/);
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
                return fieldLines.join(' ').trim();
              };

              const provStr = extractField('Provides');
              const depStr = extractField('Depends');
              const preDepStr = extractField('Pre-Depends');
              const maStr = extractField('Multi-Arch');
              const multiArch = maStr ? maStr.toLowerCase() : undefined;

              const depends: DependencyToken[][] = [];
              if (depStr) {
                depends.push(...parseDependencyList(depStr));
              }
              const preDepends: DependencyToken[][] = [];
              if (preDepStr) {
                preDepends.push(...parseDependencyList(preDepStr));
              }

              const provides: Array<{ name: string; versionConstraint?: VersionConstraint }> = [
                { name: pkgName },
              ];
              if (provStr) {
                for (const clause of parseDependencyList(provStr)) {
                  for (const token of clause) {
                    provides.push({
                      name: token.name.split(':')[0].trim(),
                      versionConstraint: token.versionConstraint,
                    });
                  }
                }
              }

              const info: LocalDebInfo = {
                filename: f,
                srcDeb,
                pkgName,
                version,
                arch,
                multiArch,
                depends,
                preDepends,
                provides,
              };
              localDebsByFilename.set(f, info);
              for (const p of provides) {
                const list = localDebsByName.get(p.name) || [];
                list.push(info);
                localDebsByName.set(p.name, list);
              }
            }
          } catch {}
        }

        interface DepQueueItem {
          clause: DependencyToken[];
          isPreDep: boolean;
          declaringArch: string;
        }
        const depQueue: DepQueueItem[] = [];
        const expectedControlVer = recipe.version
          ? formatDebianVersion({
              version: recipe.version,
              epoch: recipe.epoch,
              revision: recipe.revision,
            })
          : '';
        const fixedPackages = new Set([
          recipe.name,
          ...subpkgNames.filter((name) => isDesignatedProducerForChild(name)),
        ]);

        // 1. Stage the target package and its child subpackages matching the current version and arch
        for (const p of [recipe.name, ...subpkgNames]) {
          if (p !== recipe.name && !isDesignatedProducerForChild(p)) {
            continue;
          }
          const expectedArch = getExpectedArchForPkg(p);
          const list = localDebsByName.get(p) || [];
          const matching = list.filter((deb) => {
            if (deb.pkgName !== p) {
              return false;
            }
            if (
              recipe.version &&
              deb.version !== expectedControlVer &&
              deb.version !== filenameVer
            ) {
              return false;
            }
            if (expectedArch === 'all') {
              return deb.arch === 'all';
            }
            return normalizeArch(deb.arch) === normalizeArch(expectedArch);
          });
          if (matching.length > 0) {
            matching.sort((a, b) => compareDebianVersions(b.version, a.version));
            const deb = matching[0];
            if (!stagedDebs.has(deb.filename)) {
              copyFileSync(deb.srcDeb, join(testStagingDir, deb.filename));
              stagedDebs.add(deb.filename);
              stagedConcretePkg.set(getStageKey(deb.pkgName, deb.arch), deb.filename);
              targetDebMap.set(deb.pkgName, deb.filename);
              const declaringArch = deb.arch === 'all' ? testerDebArch : normalizeArch(deb.arch);
              for (const clause of deb.preDepends) {
                depQueue.push({ clause, isPreDep: true, declaringArch });
              }
              for (const clause of deb.depends) {
                depQueue.push({ clause, isPreDep: false, declaringArch });
              }
            }
          }
        }

        // Also add explicit recipe.deps and subpackage deps
        const recipeDeclaringArch = debArch === 'all' ? testerDebArch : normalizeArch(debArch);
        if (Array.isArray(recipe.deps)) {
          for (const clause of filterDepsForArch(parseDependencyList(recipe.deps), testArch)) {
            depQueue.push({ clause, isPreDep: false, declaringArch: recipeDeclaringArch });
          }
        }
        if (recipe.subpackages && typeof recipe.subpackages === 'object') {
          for (const [subKey, subDef] of Object.entries(recipe.subpackages)) {
            const subName = typeof subDef === 'object' && subDef?.name ? subDef.name : subKey;
            if (!isDesignatedProducerForChild(subName)) {
              continue;
            }
            if (
              typeof subDef === 'object' &&
              subDef !== null &&
              !Array.isArray(subDef) &&
              Array.isArray((subDef as { deps?: string[] }).deps)
            ) {
              const rawSubArch = (subDef as SubpackageDefinition).arch;
              const subDeclaringArch =
                rawSubArch === 'all'
                  ? testerDebArch
                  : rawSubArch
                    ? normalizeArch(rawSubArch)
                    : recipeDeclaringArch;
              for (const clause of filterDepsForArch(
                parseDependencyList((subDef as { deps: string[] }).deps),
                testArch,
              )) {
                depQueue.push({ clause, isPreDep: false, declaringArch: subDeclaringArch });
              }
            }
          }
        }

        // 2. Resolve clauses by picking compatible archives satisfying combined constraints
        const processedClauses = new Set<string>();

        while (depQueue.length > 0) {
          const item = depQueue.shift()!;
          const clause = item.clause;
          const clauseKey = `${item.isPreDep ? 'PRE:' : ''}${item.declaringArch}:${clause
            .map(
              (t) =>
                `${t.name}${t.multiArch ? ':' + (t.multiArch === 'any' ? 'any' : normalizeArch(t.multiArch)) : ''}${t.versionConstraint ? t.versionConstraint.operator + t.versionConstraint.version : ''}`,
            )
            .join('|')}`;
          if (processedClauses.has(clauseKey)) {
            continue;
          }
          processedClauses.add(clauseKey);

          // Check if already satisfied by any currently staged deb
          let satisfied = false;
          for (const token of clause) {
            const reqName = token.name.split(':')[0].trim();
            const constraint = token.versionConstraint;
            const reqExplicitArch =
              token.multiArch && token.multiArch !== 'any'
                ? normalizeArch(token.multiArch)
                : undefined;
            for (const debFilename of stagedDebs) {
              const info = localDebsByFilename.get(debFilename);
              if (info) {
                if (token.multiArch === 'any') {
                  if (info.multiArch !== 'allowed') {
                    continue;
                  }
                } else if (
                  reqExplicitArch &&
                  info.arch !== 'all' &&
                  normalizeArch(info.arch) !== reqExplicitArch
                ) {
                  continue;
                } else if (
                  !reqExplicitArch &&
                  info.arch !== 'all' &&
                  normalizeArch(info.arch) !== item.declaringArch &&
                  info.multiArch !== 'foreign'
                ) {
                  continue;
                }
                const matchedProv = info.provides.find((p) => p.name === reqName);
                if (matchedProv) {
                  const effVer =
                    reqName === info.pkgName
                      ? info.version
                      : matchedProv.versionConstraint?.version || '';
                  if (satisfiesVersionConstraint(effVer, constraint)) {
                    satisfied = true;
                    clauseSelectedArchive.set(clause, debFilename);
                    if (item.isPreDep) {
                      selectedPreDepDebs.add(debFilename);
                    }
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

          // Find candidate that satisfies ALL applicable constraints for the package
          for (const token of clause) {
            const reqName = token.name.split(':')[0].trim();
            const allReqConstraints: VersionConstraint[] = [];
            if (token.versionConstraint) {
              allReqConstraints.push(token.versionConstraint);
            }
            const reqArchQual = token.multiArch
              ? token.multiArch === 'any'
                ? ':any'
                : normalizeArch(token.multiArch)
              : '';
            for (const qItem of depQueue) {
              const qClause = qItem.clause;
              if (qClause.length === 1 && qItem.declaringArch === item.declaringArch) {
                const qTok = qClause[0];
                const qArchQual = qTok.multiArch
                  ? qTok.multiArch === 'any'
                    ? ':any'
                    : normalizeArch(qTok.multiArch)
                  : '';
                if (
                  qTok.name.split(':')[0].trim() === reqName &&
                  qArchQual === reqArchQual &&
                  qTok.versionConstraint
                ) {
                  allReqConstraints.push(qTok.versionConstraint);
                }
              }
            }

            const reqExplicitArch =
              token.multiArch && token.multiArch !== 'any'
                ? normalizeArch(token.multiArch)
                : undefined;
            const candidates = (localDebsByName.get(reqName) || []).filter((cand) => {
              if (token.multiArch === 'any') {
                if (cand.multiArch !== 'allowed') {
                  return false;
                }
              } else if (reqExplicitArch) {
                if (cand.arch !== 'all' && normalizeArch(cand.arch) !== reqExplicitArch) {
                  return false;
                }
              } else if (
                cand.arch !== 'all' &&
                normalizeArch(cand.arch) !== item.declaringArch &&
                cand.multiArch !== 'foreign'
              ) {
                return false;
              }
              if (fixedPackages.has(cand.pkgName)) {
                const fixedStaged = stagedConcretePkg.get(getStageKey(cand.pkgName, cand.arch));
                if (!fixedStaged || cand.filename !== fixedStaged) {
                  return false;
                }
              }
              const matchedProv = cand.provides.find((p) => p.name === reqName);
              const effVer =
                reqName === cand.pkgName
                  ? cand.version
                  : matchedProv?.versionConstraint?.version || '';
              return allReqConstraints.every((c) => satisfiesVersionConstraint(effVer, c));
            });

            if (candidates.length > 0) {
              candidates.sort((a, b) => compareDebianVersions(b.version, a.version));
              let candidateStaged = false;
              for (const selected of candidates) {
                const candKey = getStageKey(selected.pkgName, selected.arch);
                const prevStaged = stagedConcretePkg.get(candKey);
                if (
                  prevStaged &&
                  prevStaged !== selected.filename &&
                  fixedPackages.has(selected.pkgName)
                ) {
                  continue;
                }
                if (!stagedDebs.has(selected.filename)) {
                  try {
                    copyFileSync(selected.srcDeb, join(testStagingDir, selected.filename));
                    stagedDebs.add(selected.filename);
                    if (item.isPreDep) {
                      selectedPreDepDebs.add(selected.filename);
                    }
                    if (prevStaged && prevStaged !== selected.filename) {
                      try {
                        rmSync(join(testStagingDir, prevStaged), { force: true });
                        stagedDebs.delete(prevStaged);
                        selectedPreDepDebs.delete(prevStaged);
                      } catch {}
                    }
                    stagedConcretePkg.set(candKey, selected.filename);
                    targetDebMap.set(selected.pkgName, selected.filename);
                    const childDeclaringArch =
                      selected.arch === 'all' ? item.declaringArch : normalizeArch(selected.arch);
                    for (const childClause of selected.preDepends) {
                      depQueue.push({
                        clause: childClause,
                        isPreDep: true,
                        declaringArch: childDeclaringArch,
                      });
                    }
                    for (const childClause of selected.depends) {
                      depQueue.push({
                        clause: childClause,
                        isPreDep: false,
                        declaringArch: childDeclaringArch,
                      });
                    }
                    candidateStaged = true;
                    clauseSelectedArchive.set(clause, selected.filename);
                    break;
                  } catch (copyErr) {
                    console.warn(`Failed to stage candidate ${selected.filename}:`, copyErr);
                    continue;
                  }
                } else {
                  if (item.isPreDep) {
                    selectedPreDepDebs.add(selected.filename);
                  }
                  candidateStaged = true;
                  clauseSelectedArchive.set(clause, selected.filename);
                  break;
                }
              }
              if (candidateStaged) {
                break;
              }
            }
          }
        }
      }

      const actualTargetDeb = targetDebMap.get(recipe.name) || targetDeb;
      if (recipe.version && !existsSync(join(testStagingDir, actualTargetDeb))) {
        throw new Error(
          `Target smoke-test archive '${actualTargetDeb}' for ${recipe.name} was not staged in ${testStagingDir}`,
        );
      }
      const actualChildDebs: string[] = [];
      if (recipe.version && subpkgNames.length > 0) {
        for (const sName of subpkgNames) {
          if (!isDesignatedProducerForChild(sName)) {
            continue;
          }
          const sExpectedArch = getExpectedArchForPkg(sName);
          const expectedChildDeb = `${sName}_${filenameVer}_${sExpectedArch}.deb`;
          const actualChildDeb = targetDebMap.get(sName) || expectedChildDeb;
          if (!existsSync(join(testStagingDir, actualChildDeb))) {
            throw new Error(
              `Declared child smoke-test archive '${actualChildDeb}' for ${sName} was not staged in ${testStagingDir}`,
            );
          }
          actualChildDebs.push(actualChildDeb);
        }
      }

      const relStagingDir = relative(resolve('.'), testStagingDir);
      const hostStagingDir = relStagingDir.startsWith('..')
        ? testStagingDir
        : join(hostWorkspace, relStagingDir);

      const quoteShell = (str: string): string => `'${str.replace(/'/g, `'\\''`)}'`;
      const targetDebPathLiteral = quoteShell(`${containerPkgDir}/${actualTargetDeb}`);

      const installTargetCmd = recipe.version
        ? `if [ -f ${targetDebPathLiteral} ]; then dpkg -i --force-architecture --force-depends ${targetDebPathLiteral} && INSTALLED=1; else echo "::error:: Target package ${actualTargetDeb} missing from container staging dir!"; exit 1; fi`
        : `if [ -f ${targetDebPathLiteral} ]; then dpkg -i --force-architecture --force-depends ${targetDebPathLiteral} && INSTALLED=1; elif ls ${containerPkgDir}/${recipe.name}_*.deb 1>/dev/null 2>&1; then for f in ${containerPkgDir}/${recipe.name}_*.deb; do if [ -f "$f" ]; then dpkg -i --force-architecture --force-depends "$f" && INSTALLED=1; fi; done; fi`;

      const installDebs = Array.from(new Set([...stagedDebs, ...actualChildDebs, actualTargetDeb]));
      const preDebs = installDebs.filter((d) => selectedPreDepDebs.has(d));
      const normalDebs = installDebs.filter((d) => !selectedPreDepDebs.has(d));

      // Build dependency graph among staged runtime dependencies so prerequisites are installed before dependents
      const depGraph = new Map<string, Set<string>>();
      for (const d of installDebs) {
        depGraph.set(d, new Set<string>());
        const info = localDebsByFilename.get(d);
        if (info) {
          const allClauses = [...info.preDepends, ...info.depends];
          for (const clause of allClauses) {
            let chosen: string | undefined = clauseSelectedArchive.get(clause);
            if (!chosen || chosen === d || !installDebs.includes(chosen)) {
              chosen = undefined;
              for (const tok of clause) {
                const reqName = tok.name.split(':')[0].trim();
                const targetMatch = targetDebMap.get(reqName);
                if (targetMatch && targetMatch !== d && installDebs.includes(targetMatch)) {
                  chosen = targetMatch;
                  break;
                }
                for (const other of installDebs) {
                  if (other === d) {
                    continue;
                  }
                  const otherInfo = localDebsByFilename.get(other);
                  if (
                    otherInfo &&
                    otherInfo.provides.some((p: { name: string }) => p.name === reqName)
                  ) {
                    const otherPreDeps = otherInfo.preDepends.flatMap((cl) =>
                      cl.map((t) => t.name.split(':')[0].trim()),
                    );
                    if (otherPreDeps.includes(info.pkgName)) {
                      continue;
                    }
                    chosen = other;
                    break;
                  }
                }
                if (chosen) {
                  break;
                }
              }
            }
            if (chosen && chosen !== d) {
              depGraph.get(d)!.add(chosen);
            }
          }
        }
      }

      const orderedInstallDebs: string[] = [];
      const visitedDeps = new Set<string>();
      const visitingDeps = new Set<string>();

      const visitDep = (node: string): void => {
        if (visitedDeps.has(node)) {
          return;
        }
        if (visitingDeps.has(node)) {
          return; // Cycle detected, break gracefully
        }
        visitingDeps.add(node);
        const prereqs = depGraph.get(node) || new Set<string>();
        for (const req of prereqs) {
          visitDep(req);
        }
        visitingDeps.delete(node);
        visitedDeps.add(node);
        orderedInstallDebs.push(node);
      };

      for (const d of preDebs) {
        visitDep(d);
      }
      for (const d of normalDebs) {
        visitDep(d);
      }

      // Sibling & target package installer with explicit exit verification
      const installCommands = [
        'set -e',
        'INSTALLED=0',
        ...(orderedInstallDebs.length > 0
          ? [
              `for deb in ${orderedInstallDebs.map((d) => quoteShell(`${containerPkgDir}/${d}`)).join(' ')}; do if [ ! -f "$deb" ]; then echo "::error:: Package archive $deb missing in container!"; exit 1; fi; done`,
              `dpkg -i --force-architecture --force-depends ${orderedInstallDebs.map((d) => quoteShell(`${containerPkgDir}/${d}`)).join(' ')}`,
              `for deb in ${orderedInstallDebs.map((d) => quoteShell(`${containerPkgDir}/${d}`)).join(' ')}; do if [ "$deb" = ${targetDebPathLiteral} ]; then INSTALLED=1; fi; done`,
            ]
          : []),
        `if [ "$INSTALLED" -eq 0 ]; then ${installTargetCmd}; fi`,
        `if [ "$INSTALLED" -eq 0 ]; then echo "::error:: Target package artifact for ${recipe.name} could not be installed for smoke testing!"; exit 1; fi`,
        `timeout 120s sh -c '${escapedCmd}'`,
      ];

      const installAndTest = installCommands.join('; ');

      console.log(`Executing container smoke test via ${testerImage} (${testArch})...`);
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
        `TARGET_ARCH=${testArch}`,
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
      const testedArtifacts: string[] = [actualTargetDeb, ...actualChildDebs];
      return testedArtifacts;
    } finally {
      rmSync(testStagingDir, { recursive: true, force: true });
    }
  }

  // Fallback: Local execution on native Termux device.
  // Always validate built archives first so returned filenames strictly match tested archives;
  // keep stage-only validation separate (returns [] so stale archives are never promoted).
  const targetBins: string[] = [];
  const targetLibs: string[] = [];
  let isolatedTempPrefix: string | null = null;
  let archiveExtractedPrefix: string | undefined;
  const testedArtifacts: string[] = [];
  let testedFromArchives = false;
  let matchingStageFound = false;

  const subpkgNames = getSubpackageNames(recipe as Pick<Partial<PackageRecipe>, 'subpackages'>);

  const validateArchiveControl = (
    archivePath: string,
    expectedPkg: string,
    expectedVersion: string,
    expectedArch: string,
  ): void => {
    const ctrlRes = spawnSync('dpkg-deb', ['-f', archivePath], { encoding: 'utf-8' });
    if (ctrlRes.status !== 0 || !ctrlRes.stdout) {
      throw new Error(
        `Failed to read control metadata from '${archivePath}' for smoke testing: ${ctrlRes.stderr?.trim() || 'exit code ' + ctrlRes.status}`,
      );
    }
    const text = ctrlRes.stdout;
    const pkgMatch = text.match(/^Package:\s*(.+)$/im);
    const actualPkg = pkgMatch ? pkgMatch[1].trim() : '';
    if (actualPkg !== expectedPkg) {
      throw new Error(
        `Archive '${basename(archivePath)}' control Package '${actualPkg}' does not match expected '${expectedPkg}'`,
      );
    }
    const verMatch = text.match(/^Version:\s*(.+)$/im);
    const actualVer = verMatch ? verMatch[1].trim() : '';
    if (expectedVersion && actualVer !== expectedVersion) {
      throw new Error(
        `Archive '${basename(archivePath)}' control Version '${actualVer}' does not match expected '${expectedVersion}'`,
      );
    }
    const archMatch = text.match(/^Architecture:\s*(.+)$/im);
    const actualArch = archMatch ? archMatch[1].trim() : '';
    if (expectedArch === 'all') {
      if (actualArch !== 'all') {
        throw new Error(
          `Architecture-independent archive '${basename(archivePath)}' must declare 'Architecture: all', found '${actualArch}'`,
        );
      }
    } else {
      if (normalizeArch(actualArch) !== normalizeArch(expectedArch)) {
        throw new Error(
          `Archive '${basename(archivePath)}' control Architecture '${actualArch}' is incompatible with expected '${expectedArch}'`,
        );
      }
    }
  };

  const expVersion = recipe.version
    ? formatDebianVersion({
        version: recipe.version,
        epoch: recipe.epoch,
        revision: recipe.revision,
      })
    : '';

  const findMatchingArchive = (
    pkgName: string,
    expectedVersion: string,
    expectedArch: string,
  ): string | undefined => {
    if (!existsSync(localOutputDir)) {
      return undefined;
    }
    const files = readdirSync(localOutputDir).filter(
      (f) => f.endsWith('.deb') && !f.startsWith('.tmp-'),
    );
    for (const f of files) {
      const underIdx = f.indexOf('_');
      if (underIdx === -1) {
        continue;
      }
      const pName = f.slice(0, underIdx);
      if (pName !== pkgName) {
        continue;
      }
      const fullPath = join(localOutputDir, f);
      try {
        validateArchiveControl(fullPath, pkgName, expectedVersion, expectedArch);
        return fullPath;
      } catch {}
    }
    return undefined;
  };

  const selectedTargetDebPath = findMatchingArchive(recipe.name, expVersion, debArch);
  const selectedChildDebPaths = new Map<string, string>();
  const missingChildNames: string[] = [];
  for (const sName of subpkgNames) {
    if (!isDesignatedProducerForChild(sName)) {
      continue;
    }
    const sArch = getSubExpectedArch(sName);
    const childPath = findMatchingArchive(sName, expVersion, sArch);
    if (childPath) {
      selectedChildDebPaths.set(sName, childPath);
    } else {
      missingChildNames.push(sName);
    }
  }

  if (selectedTargetDebPath) {
    if (missingChildNames.length > 0) {
      throw new Error(
        `Incomplete archive set for ${recipe.name} in ${localOutputDir}: missing declared child archive(s): ${missingChildNames.join(', ')}`,
      );
    }

    isolatedTempPrefix = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'smoke-isolated-'));
    try {
      const unpackRes = spawnSync('dpkg-deb', ['-x', selectedTargetDebPath, isolatedTempPrefix], {
        encoding: 'utf-8',
      });
      if (unpackRes.status !== 0) {
        throw new Error(
          `Failed to unpack target archive '${basename(selectedTargetDebPath)}' for smoke testing: ${unpackRes.stderr?.trim() || 'exit code ' + unpackRes.status}`,
        );
      }
      testedArtifacts.push(basename(selectedTargetDebPath));
      for (const cPath of selectedChildDebPaths.values()) {
        const cRes = spawnSync('dpkg-deb', ['-x', cPath, isolatedTempPrefix], {
          encoding: 'utf-8',
        });
        if (cRes.status !== 0) {
          throw new Error(
            `Failed to unpack child archive '${basename(cPath)}' for smoke testing: ${cRes.stderr?.trim() || 'exit code ' + cRes.status}`,
          );
        }
        testedArtifacts.push(basename(cPath));
      }
      testedFromArchives = true;
      matchingStageFound = true;
      for (const candidateBase of [
        join(isolatedTempPrefix, 'data', 'data', 'com.termux', 'files', 'usr'),
        join(isolatedTempPrefix, 'usr'),
        isolatedTempPrefix,
      ]) {
        const binDir = join(candidateBase, 'bin');
        const libDir = join(candidateBase, 'lib');
        if (existsSync(binDir) || existsSync(libDir)) {
          if (!archiveExtractedPrefix) {
            archiveExtractedPrefix = candidateBase;
          }
        }
        if (existsSync(binDir)) {
          targetBins.push(binDir);
        }
        if (existsSync(libDir)) {
          targetLibs.push(libDir);
        }
      }
      if (!archiveExtractedPrefix) {
        archiveExtractedPrefix = join(
          isolatedTempPrefix,
          'data',
          'data',
          'com.termux',
          'files',
          'usr',
        );
      }
    } catch (extractErr) {
      if (isolatedTempPrefix) {
        try {
          ensureTreeRemovable(isolatedTempPrefix);
          rmSync(isolatedTempPrefix, { recursive: true, force: true });
        } catch {}
        isolatedTempPrefix = null;
      }
      throw extractErr;
    }
  } else if (destdir && existsSync(destdir)) {
    // Stage-only smoke testing (no built archive to validate or promote)
    try {
      for (const entry of readdirSync(destdir)) {
        if (entry === 'stage' || entry.startsWith('stage_')) {
          if (entry.startsWith('stage_')) {
            const subName = entry.slice('stage_'.length);
            if (!isDesignatedProducerForChild(subName)) {
              continue;
            }
          }
          matchingStageFound = true;
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

  if (!matchingStageFound) {
    throw new Error(
      `Cannot validate ${recipe.name}: no matching staged payload or testable archive found in ${localOutputDir}`,
    );
  }

  try {
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
              const bPath = join(
                packageBuildDir,
                entry,
                'data',
                'data',
                'com.termux',
                'files',
                'usr',
              );
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

    let testArgs: string[] = ['-c', testCmd];
    if (!recipe.phases?.test) {
      let foundBin: string | null = null;
      for (const bDir of targetBins) {
        const candidate = join(bDir, recipe.name);
        if (existsSync(candidate)) {
          foundBin = candidate;
          break;
        }
      }
      if (!foundBin && testedFromArchives) {
        throw new Error(
          `Smoke test failed: default executable '${recipe.name}' was not found in extracted payload of ${recipe.name}`,
        );
      }
      if (foundBin) {
        testArgs = ['-c', '"$1" --version || "$1" --help', 'sh', foundBin];
      }
    }

    const env = {
      ...process.env,
      PREFIX:
        testedFromArchives && archiveExtractedPrefix
          ? archiveExtractedPrefix
          : process.env.PREFIX || '/data/data/com.termux/files/usr',
      PATH: [...targetBins, ...siblingBins, process.env.PATH].filter(Boolean).join(':'),
      LD_LIBRARY_PATH: [...targetLibs, ...siblingLibs, process.env.LD_LIBRARY_PATH]
        .filter(Boolean)
        .join(':'),
    };
    const res = spawnSync('sh', testArgs, {
      stdio: 'inherit',
      env,
      timeout: 60_000,
      killSignal: 'SIGKILL',
    });
    if (res.status !== 0) {
      throw new Error(`Smoke test failed with exit code ${res.status} for ${recipe.name}`);
    }
    if (testedFromArchives) {
      console.log(`✓ Smoke test passed locally for ${recipe.name}`);
      return testedArtifacts;
    }
    console.log(`✓ Stage-only smoke test passed locally for ${recipe.name} (no archives promoted)`);
    return [];
  } finally {
    if (isolatedTempPrefix) {
      try {
        ensureTreeRemovable(isolatedTempPrefix);
        rmSync(isolatedTempPrefix, { recursive: true, force: true });
      } catch {}
      isolatedTempPrefix = null;
    }
  }
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
  if (
    !force &&
    stateHash &&
    (await checkExistingReleaseHash(recipe.name, stateHash, recipe.arch, recipe))
  ) {
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
  console.log(
    `⚡ Patches:       ${patchesToApply.length > 0 ? patchesToApply.join(', ') : '(none)'}`,
  );

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
      const normDebArch = debArch === 'all' ? 'all' : normalizeArch(debArch);

      for (const [subKey, subDef] of Object.entries(recipe.subpackages)) {
        if (!subDef) {
          continue;
        }
        const isAutoDoc = (subDef as unknown) === 'auto:doc';
        const isAutoDev = (subDef as unknown) === 'auto:dev';
        const isAutoStatic = (subDef as unknown) === 'auto:static';
        const emittedName = isAutoDoc
          ? `${recipe.name}-doc`
          : isAutoDev
            ? `${recipe.name}-dev`
            : isAutoStatic
              ? `${recipe.name}-static`
              : typeof subDef === 'object' && subDef?.name
                ? subDef.name
                : subKey;
        const subArchRaw = (
          isAutoDoc ? 'all' : typeof subDef === 'object' && subDef?.arch ? subDef.arch : rawArch
        ).toLowerCase();
        const subDebArch = subArchRaw === 'all' ? 'all' : normalizeArch(subArchRaw);
        const childProducer = resolveChildProducerArch(
          recipe,
          typeof subDef === 'object' && subDef ? (subDef as SubpackageDefinition) : undefined,
        );
        if (subDebArch === 'all' && normDebArch !== 'all' && normDebArch !== childProducer) {
          continue;
        }
        console.log(`   - apt:    ${emittedName}_${filenameVer}_${subDebArch}.deb`);
      }
    }
  }
  const metaArch = recipe.arch
    ? recipe.arch === 'all'
      ? 'all'
      : normalizeArch(recipe.arch)
    : 'aarch64';
  console.log(`   - meta:   ${recipe.name}_${metaArch}_metadata.json`);

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
    const VALID_ARCHES = new Set([
      'aarch64',
      'arm',
      'x86_64',
      'i686',
      'all',
      'arm64',
      'amd64',
      'i386',
    ]);
    if (targetArch) {
      const norm = targetArch.toLowerCase();
      if (!VALID_ARCHES.has(norm)) {
        console.error(
          `Error: Unsupported target architecture '${targetArch}'. Must be one of: aarch64, arm, x86_64, i686, all.`,
        );
        process.exit(1);
      }
      targetArch =
        norm === 'arm64'
          ? 'aarch64'
          : norm === 'amd64'
            ? 'x86_64'
            : norm === 'i386'
              ? 'i686'
              : norm;
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

    const includeChildRuntimeDeps = command === 'build' || command === 'test';
    const sortedTargets = dag.resolveBuildOrder(targetNames, targetArch, includeChildRuntimeDeps);
    const failedTargets = new Set<string>();
    const succeededTargets = new Set<string>();
    const pendingQueue = [...sortedTargets];
    const pendingSet = new Set(pendingQueue);
    let deferralsSinceProgress = 0;

    while (pendingQueue.length > 0) {
      const pkgName = pendingQueue.shift()!;
      pendingSet.delete(pkgName);

      const pkgPath = join(pkgDir, pkgName);
      const pDir = existsSync(pkgPath) ? pkgPath : resolve(pkgName);
      const recipe = parseRecipe(pDir);

      if (targetArch && recipe.arch !== 'all') {
        recipe.arch = targetArch;
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
      const concreteBuildArch =
        recipe.arch === 'all'
          ? targetArch && targetArch !== 'all'
            ? targetArch
            : 'aarch64'
          : recipe.arch || targetArch || 'aarch64';

      if (command === 'info' || dryRun) {
        await simulateDryRun(recipe, pDir, destdir, outputDir, command, force);
        deferralsSinceProgress = 0;
        continue;
      }

      // Check if any build or runtime dependency of this package failed in the current batch
      if (!skipDeps && command !== 'pack') {
        const checkRuntimeDeps = command !== 'compile';
        const checkBuildDeps = command !== 'test';
        const depClauses = dag.getRecipeDepTargets(
          recipe,
          concreteBuildArch,
          includeChildRuntimeDeps,
          undefined,
          false,
          checkRuntimeDeps,
          checkBuildDeps,
          true,
        );
        let shouldDefer = false;
        let hasUnsatisfiableDep = false;

        for (const clause of depClauses) {
          if (clause.length === 0 || !clause.some((t) => failedTargets.has(t.owner))) {
            continue;
          }
          // If another compatible owner in the clause already succeeded in this batch, clause is satisfied
          const hasSucceededOwner = clause.some(
            (t) =>
              succeededTargets.has(t.owner) &&
              dag.canOwnerSatisfyDep(
                t.owner,
                t.name,
                t.versionConstraint,
                undefined,
                concreteBuildArch,
              ) &&
              dag.ownerProducesDep(t.owner, t.name, concreteBuildArch, t.versionConstraint),
          );
          if (hasSucceededOwner) {
            continue;
          }
          // If a compatible provider/alternative is still pending in this batch, defer consumer so it can build first
          const hasPendingCompatible = clause.some(
            (t) =>
              pendingSet.has(t.owner) &&
              !failedTargets.has(t.owner) &&
              dag.canOwnerSatisfyDep(
                t.owner,
                t.name,
                t.versionConstraint,
                undefined,
                concreteBuildArch,
              ),
          );
          if (hasPendingCompatible && deferralsSinceProgress < pendingQueue.length) {
            shouldDefer = true;
            break;
          }

          let usableCandidateExists = false;
          for (const target of clause) {
            const probeArch =
              target.multiArch && target.multiArch !== 'any'
                ? target.multiArch === 'native'
                  ? getBuildArch()
                  : normalizeArch(target.multiArch)
                : concreteBuildArch;
            if (
              await hasUsablePublishedOrLocalArtifact(
                target.name,
                probeArch,
                target.versionConstraint,
                target.owner,
                [outputDir],
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

        if (shouldDefer) {
          pendingQueue.push(pkgName);
          pendingSet.add(pkgName);
          deferralsSinceProgress++;
          continue;
        }

        if (hasUnsatisfiableDep) {
          failedTargets.add(recipe.name);
          deferralsSinceProgress = 0;
          try {
            cleanupStagingDirs(destdir);
          } catch (cleanErr) {
            console.warn(
              `::warning:: Failed to cleanup staging dirs for ${recipe.name}: ${cleanErr}`,
            );
          }
          continue;
        }
      }

      deferralsSinceProgress = 0;

      if (cleanBuild && existsSync(destdir)) {
        ensureTreeRemovable(destdir);
        rmSync(destdir, { recursive: true, force: true });
      }

      if (command === 'compile' || command === 'build') {
        if (
          !force &&
          recipe.state_hash &&
          (await checkExistingReleaseHash(recipe.name, recipe.state_hash, recipe.arch, recipe))
        ) {
          if (!quiet) {
            console.log(`⏭️ Skipping ${recipe.name}: state_hash unchanged.`);
          }
          succeededTargets.add(recipe.name);
          continue;
        }

        let packCompleted = false;
        const pkgCompileStartMs = Date.now();
        try {
          mkdirSync(destdir, { recursive: true });
          cleanupStagingDirs(destdir);
          mkdirSync(stageDir, { recursive: true });

          const sourceEpochNum = getPackageSourceDateEpoch(pDir);
          const sourceEpoch = String(sourceEpochNum);

          // 1. Setup bionic compat if available
          try {
            setupBionicCompat(concreteBuildArch);
          } catch (err) {
            console.error(
              `Warning: setupBionicCompat failed: ${err instanceof Error ? err.message : String(err)}`,
            );
          }

          // 2. Fetch build dependencies
          if (!skipDeps) {
            const isIsolatedPrefix = Boolean(
              process.env.PREFIX &&
              resolve(process.env.PREFIX) !== resolve('/data/data/com.termux/files/usr'),
            );
            await resolveAndFetchBuildDependencies(
              recipe.build_deps || [],
              destdir,
              concreteBuildArch,
              dag.subpackageMap,
              recipe.name,
              [outputDir, 'artifacts', 'output'],
              isIsolatedPrefix,
            );
          }

          // 3. Fetch source and apply patches
          const workDir = fetchAndPrepareSource(
            recipe,
            pDir,
            destdir,
            continueBuild,
            sourceEpochNum,
          );

          // 4. Staging directories & environment
          const prefixDir = process.env.PREFIX || PREFIX;
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

          const rustEnv = buildCargoRustflagsEnv(process.env, workDir);

          const env: Record<string, string> = {
            ...(process.env as Record<string, string>),
            PATH: `${wrapperDir}:${process.env.PATH || ''}`,
            TMPDIR: process.env.TMPDIR || tmpdir(),
            TARGET_ARCH: concreteBuildArch,
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
            ...(rustEnv.CARGO_ENCODED_RUSTFLAGS !== undefined
              ? { CARGO_ENCODED_RUSTFLAGS: rustEnv.CARGO_ENCODED_RUSTFLAGS }
              : {}),
            GOFLAGS: `${process.env.GOFLAGS || ''} -trimpath`.trim(),
            PKG_CONFIG_DIR: '',
            PKG_CONFIG_LIBDIR: `${prefixDir}/lib/pkgconfig:${prefixDir}/share/pkgconfig`,
            PKG_CONFIG_PATH: `${prefixDir}/lib/pkgconfig:${prefixDir}/share/pkgconfig`,
            PKG_CONFIG_SYSROOT_DIR: '',
          };
          if (rustEnv.deleteRustflags) {
            delete env.RUSTFLAGS;
          }

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

          const compileDurationSec = Math.max(
            1,
            Math.round((Date.now() - pkgCompileStartMs) / 1000),
          );
          writeFileSync(
            join(destdir, '.compile_success'),
            JSON.stringify(
              buildCompileStamp(recipe, sourceEpochNum, concreteBuildArch, compileDurationSec),
            ),
            'utf-8',
          );

          packCompleted = false;
          if (command === 'build') {
            await executePack(recipe, pDir, destdir, outputDir, sourceEpochNum);
            packCompleted = true;
            const testedArtifacts = executeTest(
              recipe,
              destdir,
              outputDir,
              recipe.arch === 'all' && targetArch && targetArch !== 'all' ? targetArch : undefined,
            );
            stageValidatedOutputs(recipe, outputDir, resolve('output_validated'), testedArtifacts);
          }
          succeededTargets.add(recipe.name);
        } catch (err) {
          console.error(
            `::error:: [${recipe.name}] Build failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          failedTargets.add(recipe.name);
          try {
            cleanupStagingDirs(destdir);
          } catch (cleanErr) {
            console.warn(
              `::warning:: Failed to cleanup staging dirs for ${recipe.name}: ${cleanErr}`,
            );
          }
          if (packCompleted) {
            try {
              cleanupPackageOutputs(recipe, outputDir);
            } catch (cleanErr) {
              console.warn(
                `::warning:: Failed to cleanup package outputs for ${recipe.name}: ${cleanErr}`,
              );
            }
          }
        }
      } else if (command === 'pack') {
        if (
          !existsSync(stageDir) &&
          !force &&
          recipe.state_hash &&
          (await checkExistingReleaseHash(recipe.name, recipe.state_hash, recipe.arch, recipe))
        ) {
          if (!quiet) {
            console.log(`⏭️ Skipping pack for ${recipe.name}: state_hash unchanged.`);
          }
          succeededTargets.add(recipe.name);
          continue;
        }
        let currentEpoch: number;
        try {
          currentEpoch = getPackageSourceDateEpoch(pDir);
        } catch (epochErr) {
          console.error(
            `::error:: [${recipe.name}] Pack failed to obtain package epoch: ${epochErr instanceof Error ? epochErr.message : String(epochErr)}`,
          );
          failedTargets.add(recipe.name);
          continue;
        }
        const concretePackArch =
          targetArch && targetArch !== 'all'
            ? targetArch
            : recipe.arch === 'all'
              ? 'aarch64'
              : normalizeArch(recipe.arch || 'aarch64');
        const stampCheck = validateCompileStamp(destdir, recipe, currentEpoch, concretePackArch);
        if (!stampCheck.valid) {
          console.error(
            `::error:: [${recipe.name}] Pack failed: ${stampCheck.reason || 'compilation was not successful'}. Recompile for the requested target before packing.`,
          );
          failedTargets.add(recipe.name);
          continue;
        }
        if (!existsSync(stageDir) && existsSync(join(destdir, '.stage_compiled'))) {
          const tmpRestoreDir = `${stageDir}.tmp-restore-${Date.now()}`;
          try {
            copyTreePreservingLinks(join(destdir, '.stage_compiled'), tmpRestoreDir);
            safeRenameSync(tmpRestoreDir, stageDir);
          } catch (restoreErr) {
            console.error(
              `::error:: [${recipe.name}] Failed to restore stage directory: ${restoreErr instanceof Error ? restoreErr.message : String(restoreErr)}`,
            );
            failedTargets.add(recipe.name);
            try {
              if (existsSync(tmpRestoreDir)) {
                ensureTreeRemovable(tmpRestoreDir);
                rmSync(tmpRestoreDir, { recursive: true, force: true });
              }
            } catch (cleanupErr) {
              console.error(
                `::warning:: [${recipe.name}] Failed to clean up tmpRestoreDir ${tmpRestoreDir}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
              );
            }
            try {
              if (existsSync(stageDir)) {
                ensureTreeRemovable(stageDir);
                rmSync(stageDir, { recursive: true, force: true });
              }
            } catch (cleanupErr) {
              console.error(
                `::warning:: [${recipe.name}] Failed to clean up stageDir ${stageDir}: ${cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr)}`,
              );
            }
            continue;
          }
        }
        if (!existsSync(stageDir)) {
          console.warn(
            `::warning:: stage_dir ${stageDir} does not exist for pack (${recipe.name}).`,
          );
          failedTargets.add(recipe.name);
          continue;
        }
        try {
          await executePack(recipe, pDir, destdir, outputDir, currentEpoch);
          succeededTargets.add(recipe.name);
        } catch (err) {
          console.error(
            `::error:: [${recipe.name}] Pack failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          failedTargets.add(recipe.name);
        }
      } else if (command === 'test') {
        const metaArch = recipe.arch
          ? recipe.arch === 'all'
            ? 'all'
            : normalizeArch(recipe.arch)
          : 'aarch64';
        const metadataFile = join(outputDir, `${recipe.name}_${metaArch}_metadata.json`);
        const legacyMetaFile = join(outputDir, `${recipe.name}_metadata.json`);
        const filenameVer = recipe.version
          ? formatDebianFilenameVersion({
              version: recipe.version,
              revision: recipe.revision,
              epoch: recipe.epoch,
            })
          : 'unknown';
        const rawArch = (recipe.arch || 'aarch64').toLowerCase();
        const debArch = ARCH_MAP[rawArch] || rawArch;
        const targetDebPath = join(outputDir, `${recipe.name}_${filenameVer}_${debArch}.deb`);
        const hasArchive =
          existsSync(targetDebPath) ||
          (existsSync(outputDir) &&
            readdirSync(outputDir).some(
              (f) => f.startsWith(`${recipe.name}_`) && f.endsWith('.deb'),
            ));

        if (
          !existsSync(stageDir) &&
          !existsSync(metadataFile) &&
          !existsSync(legacyMetaFile) &&
          !hasArchive
        ) {
          if (!quiet) {
            console.log(
              `Notice: Neither stage_dir nor package output exist for test (${recipe.name}).`,
            );
          } else {
            console.log(`[SMOKE_TEST_SKIPPED] ${recipe.name}`);
          }
          continue;
        }
        try {
          const testedArtifacts = executeTest(
            recipe,
            destdir,
            outputDir,
            recipe.arch === 'all' && targetArch && targetArch !== 'all' ? targetArch : undefined,
          );
          stageValidatedOutputs(recipe, outputDir, resolve('output_validated'), testedArtifacts);
          succeededTargets.add(recipe.name);
        } catch (err) {
          console.error(
            `::error:: [${recipe.name}] Smoke test failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          failedTargets.add(recipe.name);
          try {
            cleanupStagingDirs(destdir);
          } catch (cleanErr) {
            console.warn(
              `::warning:: Failed to cleanup staging dirs for ${recipe.name}: ${cleanErr}`,
            );
          }
          try {
            cleanupPackageOutputs(recipe, outputDir);
          } catch (cleanErr) {
            console.warn(
              `::warning:: Failed to cleanup package outputs for ${recipe.name}: ${cleanErr}`,
            );
          }
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
