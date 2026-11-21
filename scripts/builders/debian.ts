import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';

import {
  CANONICAL_ARCHES,
  filterDepsForArch,
  formatDebianDependency,
  isDebArchCompatible,
  normalizeArch,
  parseDependencyList,
} from '../core/dependencies.ts';
import { parseFilenameDebVersion } from '../core/fetcher.ts';
import { ensureTreeRemovable, splitSubpackages } from '../core/subpkg.ts';
import type { PackageRecipe } from '../core/types.ts';
import { formatDebianFilenameVersion, formatDebianVersion, satisfiesVersionConstraint } from '../core/version.ts';
import { sanitizeStagingElfs } from '../sanitizer/elf.ts';
import { sanitizeShebangs } from '../sanitizer/shebang.ts';
import { DependencyGraph } from '../utils/dag.ts';

export { formatDebianFilenameVersion, formatDebianVersion };

export const ARCH_MAP: Record<string, string> = {
  aarch64: 'aarch64',
  x86_64: 'x86_64',
  arm: 'arm',
  i686: 'i686',
};

export function extractDebArch(filename: string): string {
  const match = filename.match(/_(aarch64|arm64|x86_64|arm|i686|all)\.deb$/);
  if (match) {
    return match[1] === 'arm64' ? 'aarch64' : match[1];
  }
  const stripped = filename.endsWith('.deb') ? filename.slice(0, -4) : filename;
  if (stripped.endsWith('_x86_64')) {
    return 'x86_64';
  }
  const lastUnderscore = stripped.lastIndexOf('_');
  return lastUnderscore !== -1 ? stripped.slice(lastUnderscore + 1) : 'unknown';
}

export function getDebMultiArch(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Multi-Arch'], { encoding: 'utf-8' });
    if (res.status === 0 && typeof res.stdout === 'string') {
      return res.stdout.trim().toLowerCase();
    }
  } catch {}
  return null;
}

export function generateControlFile(recipe: PackageRecipe, installedSizeKib?: number): string {
  const versionStr = formatDebianVersion(recipe);
  const debArch = ARCH_MAP[recipe.arch] || recipe.arch;

  const lines = [
    `Package: ${recipe.name}`,
    `Version: ${versionStr}`,
    `Architecture: ${debArch}`,
    `Maintainer: ${recipe.maintainer || 'SjnExe'}`,
    `Description: ${recipe.description || 'RepoExe package'}`,
  ];

  if (installedSizeKib !== undefined) {
    lines.push(`Installed-Size: ${installedSizeKib}`);
  }
  if (recipe.homepage) {
    lines.push(`Homepage: ${recipe.homepage}`);
  }
  const ma =
    (recipe as { multiarch?: string; multi_arch?: string })['multiarch'] ||
    (recipe as { multiarch?: string; multi_arch?: string })['multi_arch'];
  if (ma) {
    lines.push(`Multi-Arch: ${ma}`);
  }

  const formatDepField = (rawList: string[], isProvides = false): string => {
    if (!rawList || rawList.length === 0) {
      return '';
    }
    const clauses = parseDependencyList(rawList);
    for (const clause of clauses) {
      if (isProvides && clause.length > 1) {
        throw new Error(
          `Invalid Provides '${clause.map((t) => t.name).join(' | ')}' in ${recipe.name}: Debian policy does not permit alternatives ('|') in Provides.`,
        );
      }
      for (const token of clause) {
        if (debArch === 'all' && token.architectures && token.architectures.length > 0) {
          throw new Error(
            `Package '${recipe.name}' has architecture 'all' but declares architecture-restricted relationship '${token.name} [${token.architectures.join(' ')}]'.`,
          );
        }
        if (isProvides && token.versionConstraint && token.versionConstraint.operator !== '=') {
          throw new Error(
            `Invalid Provides '${token.name} (${token.versionConstraint.operator} ${token.versionConstraint.version})' in ${recipe.name}: Debian policy permits only '='.`,
          );
        }
      }
    }
    return formatDebianDependency(filterDepsForArch(clauses, debArch));
  };

  const depends = formatDepField(recipe.deps);
  if (depends) {
    lines.push(`Depends: ${depends}`);
  }
  const recommends = formatDepField(recipe.recommends);
  if (recommends) {
    lines.push(`Recommends: ${recommends}`);
  }
  const suggests = formatDepField(recipe.suggests);
  if (suggests) {
    lines.push(`Suggests: ${suggests}`);
  }
  const conflicts = formatDepField(recipe.conflicts);
  if (conflicts) {
    lines.push(`Conflicts: ${conflicts}`);
  }
  const provides = formatDepField(recipe.provides, true);
  if (provides) {
    lines.push(`Provides: ${provides}`);
  }
  const replaces = formatDepField(recipe.replaces);
  if (replaces) {
    lines.push(`Replaces: ${replaces}`);
  }
  const breaks = formatDepField(recipe.breaks || []);
  if (breaks) {
    lines.push(`Breaks: ${breaks}`);
  }
  const enhances = formatDepField(recipe.enhances || []);
  if (enhances) {
    lines.push(`Enhances: ${enhances}`);
  }

  return lines.join('\n') + '\n';
}

export function getPackageSourceDateEpoch(pkgDir?: string, repoRoot: string = resolve('.')): number {
  if (process.env.SOURCE_DATE_EPOCH !== undefined && process.env.SOURCE_DATE_EPOCH.trim() !== '') {
    const raw = process.env.SOURCE_DATE_EPOCH.trim();
    if (/^\d+$/.test(raw)) {
      const val = parseInt(raw, 10);
      if (!isNaN(val) && val >= 0) {
        return val;
      }
    }
  }

  const isShallow =
    spawnSync('git', ['rev-parse', '--is-shallow-repository'], {
      cwd: repoRoot,
      encoding: 'utf-8',
    }).stdout?.trim() === 'true';

  if (isShallow) {
    throw new Error(
      'Shallow git repository checkout detected with incomplete commit history. Run `git fetch --unshallow` or set SOURCE_DATE_EPOCH to ensure reproducible archive builds.',
    );
  }

  if (pkgDir && existsSync(pkgDir)) {
    const relPkg = relative(repoRoot, pkgDir);
    const res = spawnSync('git', ['log', '-1', '--pretty=%ct', '--', relPkg], {
      cwd: repoRoot,
      encoding: 'utf-8',
    });
    if (res.status === 0 && res.stdout?.trim()) {
      const val = parseInt(res.stdout.trim(), 10);
      if (!isNaN(val) && val > 0) {
        return val;
      }
    }
  }
  const headRes = spawnSync('git', ['log', '-1', '--pretty=%ct'], {
    cwd: repoRoot,
    encoding: 'utf-8',
  });
  if (headRes.status === 0 && headRes.stdout?.trim()) {
    const val = parseInt(headRes.stdout.trim(), 10);
    if (!isNaN(val) && val > 0) {
      return val;
    }
  }
  return 1704067200; // 2024-01-01 00:00:00 UTC fallback
}

export function cleanStageElfs(stageDir: string, cleanerBin?: string): void {
  sanitizeStagingElfs(stageDir);
  const whichRes = spawnSync('which', ['termux-elf-cleaner'], { encoding: 'utf-8' });
  const cleaner =
    cleanerBin !== undefined
      ? cleanerBin
      : whichRes.status === 0 && whichRes.stdout?.trim()
        ? whichRes.stdout.trim()
        : existsSync('/data/data/com.termux/files/usr/bin/termux-elf-cleaner')
          ? '/data/data/com.termux/files/usr/bin/termux-elf-cleaner'
          : null;
  if (!cleaner) {
    return;
  }
  const glob = new Bun.Glob('**/*');
  for (const rel of glob.scanSync({ cwd: stageDir, dot: true })) {
    const full = join(stageDir, rel);
    try {
      if (lstatSync(full).isFile()) {
        const fd = openSync(full, 'r');
        try {
          const magic = Buffer.alloc(4);
          const n = readSync(fd, magic, 0, 4, 0);
          if (n === 4 && magic[0] === 0x7f && magic[1] === 0x45 && magic[2] === 0x4c && magic[3] === 0x46) {
            const cleanRes = spawnSync(cleaner, ['--api-level', '24', full], { encoding: 'utf-8' });
            if (cleanRes.status !== 0 || cleanRes.error) {
              const err = cleanRes.error?.message || cleanRes.stderr?.trim() || `exit code ${cleanRes.status}`;
              throw new Error(`termux-elf-cleaner failed on '${full}': ${err}`);
            }
          }
        } finally {
          closeSync(fd);
        }
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.message.includes('termux-elf-cleaner failed')) {
        throw err;
      }
    }
  }
}

export function normalizeSourceDir(srcDir: string, epoch: number): void {
  if (!existsSync(srcDir)) {
    return;
  }
  const traverse = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      try {
        const lstat = lstatSync(full);
        if (lstat.isSymbolicLink()) {
          try {
            lutimesSync(full, epoch, epoch);
          } catch {}
          continue;
        }
        if (lstat.isDirectory()) {
          traverse(full);
          try {
            utimesSync(full, epoch, epoch);
          } catch {}
        } else if (lstat.isFile()) {
          try {
            utimesSync(full, epoch, epoch);
          } catch {}
        }
      } catch {}
    }
  };
  traverse(srcDir);
  try {
    utimesSync(srcDir, epoch, epoch);
  } catch {}
}

export function normalizeStageDir(stageDir: string, epoch: number): void {
  const traverse = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      try {
        const lstat = lstatSync(full);
        if (lstat.isSymbolicLink()) {
          try {
            lutimesSync(full, epoch, epoch);
          } catch {}
          continue;
        }
        const relParts = relative(stageDir, full).split(sep);
        const isDebianDir = relParts[0] === 'DEBIAN';
        if (lstat.isDirectory()) {
          if (isDebianDir) {
            chmodSync(full, 0o755);
          }
          traverse(full);
          try {
            utimesSync(full, epoch, epoch);
          } catch {}
        } else if (lstat.isFile()) {
          if (isDebianDir && relParts.length > 1) {
            const isScript = ['preinst', 'postinst', 'prerm', 'postrm', 'config'].includes(entry.name);
            chmodSync(full, isScript ? 0o755 : 0o644);
          }
          try {
            utimesSync(full, epoch, epoch);
          } catch {}
        }
      } catch {}
    }
  };
  traverse(stageDir);
  try {
    chmodSync(stageDir, 0o755);
    utimesSync(stageDir, epoch, epoch);
  } catch {}
}

export function prepareDebianDir(
  recipe: PackageRecipe,
  buildDir: string,
  pkgDir?: string,
  overrideStageDir?: string,
  conffilesSourceDir?: string,
): string {
  const stageDir = overrideStageDir || join(buildDir, 'stage');
  const debianDir = join(stageDir, 'DEBIAN');
  mkdirSync(debianDir, { recursive: true });
  chmodSync(debianDir, 0o755);

  const controlContent = generateControlFile(recipe);
  const controlFile = join(debianDir, 'control');
  writeFileSync(controlFile, controlContent, 'utf-8');
  chmodSync(controlFile, 0o644);

  // Maintainer scripts: preinst, postinst, prerm, postrm
  const maintainerScripts = ['preinst', 'postinst', 'prerm', 'postrm'];
  for (const script of maintainerScripts) {
    const targetScript = join(debianDir, script);
    let content: string | undefined;
    if (recipe.maintainer_scripts && typeof recipe.maintainer_scripts[script] === 'string') {
      content = recipe.maintainer_scripts[script];
    } else if (pkgDir) {
      const scriptPath = join(pkgDir, script);
      const debianScriptPath = join(pkgDir, 'DEBIAN', script);
      if (existsSync(scriptPath)) {
        content = readFileSync(scriptPath, 'utf-8');
      } else if (existsSync(debianScriptPath)) {
        content = readFileSync(debianScriptPath, 'utf-8');
      }
    }
    if (content) {
      writeFileSync(targetScript, content, 'utf-8');
      chmodSync(targetScript, 0o755);
    } else if (existsSync(targetScript)) {
      unlinkSync(targetScript);
    }
  }

  // conffiles: track configuration files under /data/data/com.termux/files/usr/etc/
  const conffilesPath = join(debianDir, 'conffiles');
  let conffilesContent: string | undefined;
  const cfDir = conffilesSourceDir || pkgDir;
  let rawExplicitConffiles: string[] = [];
  if (cfDir && existsSync(join(cfDir, 'conffiles'))) {
    rawExplicitConffiles = readFileSync(join(cfDir, 'conffiles'), 'utf-8').split('\n');
  } else if (cfDir && existsSync(join(cfDir, 'DEBIAN', 'conffiles'))) {
    rawExplicitConffiles = readFileSync(join(cfDir, 'DEBIAN', 'conffiles'), 'utf-8').split('\n');
  }

  const allStages = [stageDir];
  if (buildDir && existsSync(buildDir)) {
    for (const ent of readdirSync(buildDir)) {
      if (ent.startsWith('stage_') || ent === 'stage') {
        const stagePath = join(buildDir, ent);
        if (!allStages.includes(stagePath)) {
          allStages.push(stagePath);
        }
      }
    }
  }

  const conffileEntries = new Set<string>();
  for (const line of rawExplicitConffiles) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }
    const match = trimmed.match(/^remove-on-upgrade\s+(.+)$/);
    if (match) {
      if (!conffilesSourceDir) {
        conffileEntries.add(`remove-on-upgrade ${match[1]}`);
      }
      continue;
    }
    const rel = trimmed.replace(/^\/+/, '');
    const entryExists = (dir: string): boolean => {
      try {
        lstatSync(join(dir, rel));
        return true;
      } catch {
        return false;
      }
    };
    const existsAnywhere = allStages.some(entryExists);
    if (!existsAnywhere) {
      throw new Error(`Conffile '${trimmed}' declared in conffiles does not exist in stage or any subpackage stage.`);
    }
    if (entryExists(stageDir)) {
      conffileEntries.add(trimmed.startsWith('/') ? trimmed : `/${trimmed}`);
    }
  }

  if (rawExplicitConffiles.length === 0) {
    const etcDir = join(stageDir, 'data', 'data', 'com.termux', 'files', 'usr', 'etc');
    if (existsSync(etcDir)) {
      const scanEtc = (dir: string): void => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            scanEtc(full);
          } else if (entry.isFile()) {
            const relPath = relative(stageDir, full).replace(/\\/g, '/');
            conffileEntries.add(relPath.startsWith('/') ? relPath : `/${relPath}`);
          }
        }
      };
      scanEtc(etcDir);
    }
  }

  if (conffileEntries.size > 0) {
    conffilesContent = Array.from(conffileEntries).sort().join('\n') + '\n';
  }

  if (conffilesContent) {
    writeFileSync(conffilesPath, conffilesContent, 'utf-8');
    chmodSync(conffilesPath, 0o644);
  } else if (existsSync(conffilesPath)) {
    unlinkSync(conffilesPath);
  }

  // triggers: copy if present
  const triggersPath = join(debianDir, 'triggers');
  let triggersContent: string | undefined;
  if (pkgDir && existsSync(join(pkgDir, 'triggers'))) {
    triggersContent = readFileSync(join(pkgDir, 'triggers'), 'utf-8');
  } else if (pkgDir && existsSync(join(pkgDir, 'DEBIAN', 'triggers'))) {
    triggersContent = readFileSync(join(pkgDir, 'DEBIAN', 'triggers'), 'utf-8');
  }
  if (triggersContent) {
    writeFileSync(triggersPath, triggersContent, 'utf-8');
    chmodSync(triggersPath, 0o644);
  } else if (existsSync(triggersPath)) {
    unlinkSync(triggersPath);
  }

  // Normalize maintainer script shebangs in DEBIAN directory
  sanitizeShebangs(debianDir);

  return stageDir;
}

function assembleSingleDeb(
  recipe: PackageRecipe,
  stageDir: string,
  outPath: string,
  targetArch: string,
  sourceEpoch: number,
): string {
  // Exclude unwanted __init__.py, recipe.ts, or pkg.yml from deb roots per AGENTS.md constraint
  const unwantedRootFiles = ['__init__.py', 'recipe.ts', 'pkg.yml'];
  for (const unwanted of unwantedRootFiles) {
    const target = join(stageDir, unwanted);
    if (existsSync(target)) {
      spawnSync('rm', ['-f', target]);
    }
  }

  // Calculate Installed-Size in KiB
  let totalBytes = 0;
  const countBytes = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'DEBIAN') {
          countBytes(full);
        }
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        totalBytes += statSync(full).size;
      }
    }
  };
  countBytes(stageDir);
  const installedSizeKib = Math.ceil(totalBytes / 1024);

  const controlContent = generateControlFile(recipe, installedSizeKib);
  writeFileSync(join(stageDir, 'DEBIAN', 'control'), controlContent, 'utf-8');

  // Automated ELF cleaning and stage normalization
  cleanStageElfs(stageDir);
  normalizeStageDir(stageDir, sourceEpoch);

  const filenameVer = formatDebianFilenameVersion(recipe);
  const rawArch = recipe.arch || targetArch;
  const arch = ARCH_MAP[rawArch] || rawArch;
  const debFilename = `${recipe.name}_${filenameVer}_${arch}.deb`;
  const debPath = join(outPath, debFilename);

  const dpkgEnv: Record<string, string> = {
    ...process.env,
    SOURCE_DATE_EPOCH: String(sourceEpoch),
    DPKG_DEB_THREADS_MAX: '1',
  };

  const dpkgArgs = ['--build', '--root-owner-group'];
  if (checkDpkgThreadsMaxSupport()) {
    dpkgArgs.push('--threads-max=1');
  }
  dpkgArgs.push('-Zxz', '-z6', stageDir, debPath);
  const res = spawnSync('dpkg-deb', dpkgArgs, {
    encoding: 'utf-8',
    env: dpkgEnv,
  });

  if (res.status !== 0) {
    throw new Error(`dpkg-deb failed for ${recipe.name}: ${res.stderr?.trim()}`);
  }

  return debPath;
}

export function buildAllDebs(
  recipe: PackageRecipe,
  destdir: string,
  outputDir: string,
  targetArch: string = 'aarch64',
  pkgDir?: string,
): string[] {
  const effectiveRecipe = targetArch && recipe.arch !== 'all' ? { ...recipe, arch: targetArch } : recipe;
  const buildPath = resolve(destdir);
  const outPath = resolve(outputDir);
  mkdirSync(outPath, { recursive: true });

  const stageDir = join(buildPath, 'stage');
  const sourceEpoch = getPackageSourceDateEpoch(pkgDir);

  // Split subpackages before preparing parent Debian control & conffiles
  const subSplits = splitSubpackages(effectiveRecipe, stageDir, buildPath, targetArch);

  // Validate control metadata upfront for all subpackages (including non-producers)
  const emittedSubs: typeof subSplits = [];
  const skippedSubs: typeof subSplits = [];
  for (const sub of subSplits) {
    generateControlFile(sub.recipe); // Enforces Invariants 1 & 2 on every shard, including non-producers
    if (
      sub.recipe.arch === 'all' &&
      sub.recipe.producer_arch &&
      normalizeArch(sub.recipe.producer_arch) !== 'all' &&
      targetArch &&
      normalizeArch(sub.recipe.producer_arch) !== normalizeArch(targetArch)
    ) {
      skippedSubs.push(sub);
    } else {
      emittedSubs.push(sub);
    }
  }

  // Keep skipped non-producer stages intact until parent & all emitted subpackages finish conffile validation
  const parentStageDir = prepareDebianDir(effectiveRecipe, buildPath, pkgDir, stageDir);
  for (const sub of emittedSubs) {
    prepareDebianDir(sub.recipe, buildPath, undefined, sub.stageDir, pkgDir);
  }

  // Remove skipped non-producer stages only after complete split conffile validation succeeds
  for (const sub of skippedSubs) {
    ensureTreeRemovable(sub.stageDir);
    rmSync(sub.stageDir, { recursive: true, force: true });
  }

  // Assemble parent and emitted subpackage debs
  const parentDeb = assembleSingleDeb(effectiveRecipe, parentStageDir, outPath, targetArch, sourceEpoch);
  const allDebs: string[] = [parentDeb];
  for (const sub of emittedSubs) {
    allDebs.push(assembleSingleDeb(sub.recipe, sub.stageDir, outPath, targetArch, sourceEpoch));
  }

  return allDebs;
}

let dpkgSupportsThreadsMax: boolean | null = null;
function checkDpkgThreadsMaxSupport(): boolean {
  if (dpkgSupportsThreadsMax !== null) {
    return dpkgSupportsThreadsMax;
  }
  try {
    const res = spawnSync('dpkg-deb', ['--help'], { encoding: 'utf-8' });
    dpkgSupportsThreadsMax = Boolean(res.stdout && res.stdout.includes('--threads-max'));
  } catch {
    dpkgSupportsThreadsMax = false;
  }
  return dpkgSupportsThreadsMax;
}

export function buildDeb(
  recipe: PackageRecipe,
  destdir: string,
  outputDir: string,
  targetArch: string = 'aarch64',
  pkgDir?: string,
): string {
  const debs = buildAllDebs(recipe, destdir, outputDir, targetArch, pkgDir);
  return debs[0];
}

export function extractDebianField(control: string, field: string): string | undefined {
  const lines = control.split(/\r?\n/);
  let inField = false;
  const fieldLines: string[] = [];
  const prefix = `${field.toLowerCase()}:`;
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
}

interface ParsedProvideEntry {
  name: string;
  version?: string;
}

interface CandidateDeb {
  debName: string;
  debArch: string;
  controlInfo: string;
  debPath: string;
  pkgName: string;
  pkgVersion: string;
  provides: ParsedProvideEntry[];
  /** Value of the Multi-Arch control field, e.g. "allowed", "foreign", "same". */
  multiArch?: string;
}

export function generateAptMetadata(
  outputDir: string,
  component: string = 'main',
  arch: string = 'aarch64',
  packagesDir: string = join(process.cwd(), 'pkg'),
): void {
  const binaryDir = join(outputDir, 'dists', 'stable', component, `binary-${arch}`);
  mkdirSync(binaryDir, { recursive: true });

  const packagesPath = join(binaryDir, 'Packages');
  const entries: string[] = [];

  const debFiles = readdirSync(outputDir)
    .filter((f) => f.endsWith('.deb'))
    .sort();

  const emittedNames = new Set<string>();
  if (existsSync(packagesDir)) {
    try {
      const graph = new DependencyGraph(packagesDir);
      for (const name of Object.keys(graph.recipes)) {
        emittedNames.add(name);
      }
      for (const name of Object.keys(graph.subpackageMap)) {
        emittedNames.add(name);
      }
      for (const name of Object.keys(graph.providersMap)) {
        emittedNames.add(name);
      }
    } catch {}
  }

  const allCandidates: CandidateDeb[] = [];
  const initialCandidates: CandidateDeb[] = [];

  for (const debName of debFiles) {
    const debPath = join(outputDir, debName);
    const res = spawnSync('dpkg-deb', ['-f', debPath], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      const controlInfo = res.stdout.trim();
      const declaredArch = extractDebianField(controlInfo, 'Architecture') || '';

      if (!declaredArch || !CANONICAL_ARCHES.has(normalizeArch(declaredArch))) {
        continue;
      }
      const debArch = extractDebArch(debName);
      if (
        debArch !== 'unknown' &&
        (!CANONICAL_ARCHES.has(normalizeArch(declaredArch)) || !isDebArchCompatible(declaredArch, debArch))
      ) {
        continue;
      }
      const effectiveArch = declaredArch;
      const pkgName = extractDebianField(controlInfo, 'Package') || debName.split('_')[0];
      const pkgVersion = extractDebianField(controlInfo, 'Version') || parseFilenameDebVersion(debName);
      const provides: ParsedProvideEntry[] = [];
      const provVal = extractDebianField(controlInfo, 'Provides');
      if (provVal) {
        for (const provClause of parseDependencyList([provVal])) {
          for (const provTok of provClause) {
            const pName = provTok.name.split(':')[0].trim();
            if (pName) {
              provides.push({ name: pName, version: provTok.versionConstraint?.version });
            }
          }
        }
      }
      const multiArch = extractDebianField(controlInfo, 'Multi-Arch') || undefined;
      const cand: CandidateDeb = {
        debName,
        debArch: effectiveArch,
        controlInfo,
        debPath,
        pkgName,
        pkgVersion,
        provides,
        multiArch,
      };
      allCandidates.push(cand);

      const matchesArch =
        debArch === 'all' ||
        normalizeArch(debArch) === 'all' ||
        normalizeArch(debArch) === normalizeArch(arch) ||
        debArch === 'unknown';
      if (matchesArch && isDebArchCompatible(declaredArch, arch)) {
        initialCandidates.push(cand);
      }
    }
  }

  // Multi-pass dependency pruning for candidates:
  // If a package depends on a RepoExe-owned package, ensure that dependency is available for this arch.
  // External packages (like bash) are not required to be in outputDir.
  const versionCache = new Map<string, boolean>();
  let activeCandidates = [...initialCandidates];
  const prunedCandidates = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    const nextCandidates: CandidateDeb[] = [];

    for (const cand of activeCandidates) {
      const depVal = extractDebianField(cand.controlInfo, 'Depends');
      const preDepVal = extractDebianField(cand.controlInfo, 'Pre-Depends');
      const rawClauses: string[] = [];
      if (depVal) {
        rawClauses.push(depVal);
      }
      if (preDepVal) {
        rawClauses.push(preDepVal);
      }
      if (rawClauses.length === 0) {
        nextCandidates.push(cand);
        continue;
      }
      const clauses = parseDependencyList(rawClauses);
      const filtered = filterDepsForArch(clauses, arch);

      const isRepoExeOwnedOrProvided = (depName: string): boolean =>
        emittedNames.has(depName) ||
        existsSync(join(packagesDir, depName)) ||
        allCandidates.some((c) => c.pkgName === depName || c.provides.some((p) => p.name === depName));

      const clauseOptions: Array<{ hasExternal: boolean; localCands: CandidateDeb[] }> = [];
      let hasImpossibleClause = false;

      for (const clause of filtered) {
        let hasExternal = false;
        const localSet = new Set<CandidateDeb>();

        for (const tok of clause) {
          const depName = tok.name.split(':')[0].trim();
          let matchedLocal = false;
          const searchCandidates =
            tok.multiArch && tok.multiArch !== 'any'
              ? (normalizeArch(tok.multiArch) === normalizeArch(arch)
                  ? activeCandidates
                  : allCandidates.filter((c) => !prunedCandidates.has(c.debName))
                ).filter((c) => c.debArch === 'all' || normalizeArch(c.debArch) === normalizeArch(tok.multiArch!))
              : tok.multiArch === 'any'
                ? allCandidates.filter(
                    (c) => !prunedCandidates.has(c.debName) && (c.multiArch === 'allowed' || c.debArch === 'all'),
                  )
                : activeCandidates;

          for (const c of searchCandidates) {
            // For :any qualifier, APT requires the candidate to declare Multi-Arch: allowed (or Architecture: all).
            if (tok.multiArch === 'any') {
              if (c.multiArch !== 'allowed' && c.debArch !== 'all') {
                continue;
              }
            }
            if (c.pkgName === depName) {
              if (satisfiesVersionConstraint(c.pkgVersion, tok.versionConstraint, versionCache)) {
                localSet.add(c);
                matchedLocal = true;
              }
            } else {
              const provMatches = c.provides.some((p) => {
                if (p.name !== depName) {
                  return false;
                }
                if (!tok.versionConstraint) {
                  return true;
                }
                if (!p.version) {
                  return false;
                }
                return satisfiesVersionConstraint(p.version, tok.versionConstraint, versionCache);
              });
              if (provMatches) {
                localSet.add(c);
                matchedLocal = true;
              }
            }
          }
          if (!matchedLocal && !isRepoExeOwnedOrProvided(depName)) {
            hasExternal = true;
          }
        }

        if (!hasExternal && localSet.size === 0) {
          hasImpossibleClause = true;
          break;
        }
        if (!hasExternal) {
          clauseOptions.push({ hasExternal: false, localCands: Array.from(localSet) });
        }
      }

      let allSatisfied = !hasImpossibleClause;
      if (allSatisfied && clauseOptions.length > 0) {
        // Order most-constrained clauses first to prune inconsistent concrete versions immediately
        clauseOptions.sort((a, b) => a.localCands.length - b.localCands.length);
        // Seed solver with the candidate under evaluation so dependency checks account for the archive itself
        const seedKey = `${cand.pkgName}:${cand.debArch === 'all' ? 'all' : normalizeArch(cand.debArch)}`;
        const selectedConcrete = new Map<string, CandidateDeb>([[seedKey, cand]]);
        let steps = 0;
        let budgetExhausted = false;
        const MAX_SOLVER_STEPS = 10000;

        const solve = (idx: number): boolean => {
          if (idx >= clauseOptions.length) {
            return true;
          }
          if (++steps > MAX_SOLVER_STEPS) {
            budgetExhausted = true;
            return false;
          }
          const opts = clauseOptions[idx].localCands;
          for (const choice of opts) {
            const choiceKey = `${choice.pkgName}:${choice.debArch === 'all' ? 'all' : normalizeArch(choice.debArch)}`;
            const existing = selectedConcrete.get(choiceKey);
            if (existing) {
              if (existing.pkgVersion !== choice.pkgVersion || existing.debName !== choice.debName) {
                continue;
              }
              if (solve(idx + 1)) {
                return true;
              }
            } else {
              selectedConcrete.set(choiceKey, choice);
              if (solve(idx + 1)) {
                return true;
              }
              selectedConcrete.delete(choiceKey);
            }
          }
          return false;
        };

        allSatisfied = solve(0) || budgetExhausted;
      }

      if (allSatisfied) {
        nextCandidates.push(cand);
      } else {
        changed = true;
        prunedCandidates.add(cand.debName);
      }
    }
    activeCandidates = nextCandidates;
  }

  for (const cand of activeCandidates) {
    const content = readFileSync(cand.debPath);
    const size = content.length;
    const md5 = new Bun.CryptoHasher('md5').update(content).digest('hex');
    const sha256 = new Bun.CryptoHasher('sha256').update(content).digest('hex');
    entries.push(
      `${cand.controlInfo}\nFilename: ${cand.debName}\nSize: ${size}\nMD5sum: ${md5}\nSHA256: ${sha256}\n\n`,
    );
  }

  const packagesContent = entries.join('');
  writeFileSync(packagesPath, packagesContent, 'utf-8');
  writeFileSync(`${packagesPath}.gz`, Bun.gzipSync(Buffer.from(packagesContent, 'utf-8')));
}

export function generateReleaseFile(
  outputDir: string,
  suite: string = 'stable',
  component: string = 'main',
  requireSigned = false,
): void {
  const distsDir = join(outputDir, 'dists', suite);
  mkdirSync(distsDir, { recursive: true });
  const releasePath = join(distsDir, 'Release');

  const arches = new Set<string>();
  const fileEntries: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.name === 'Packages' || entry.name === 'Packages.gz') {
        const relPath = relative(distsDir, full).replace(/\\/g, '/');
        for (const p of relPath.split('/')) {
          if (p.startsWith('binary-')) {
            arches.add(p.replace('binary-', ''));
          }
        }
        const data = readFileSync(full);
        const sha256 = new Bun.CryptoHasher('sha256').update(data).digest('hex');
        fileEntries.push(` ${sha256} ${data.length} ${relPath}`);
      }
    }
  };
  walk(distsDir);

  const archStr = Array.from(arches).sort().join(' ') || 'aarch64';
  const dateStr = new Date().toUTCString();

  const releaseContent = [
    `Origin: RepoExe`,
    `Date: ${dateStr}`,
    `Label: RepoExe`,
    `Suite: ${suite}`,
    `Codename: ${suite}`,
    `Architectures: ${archStr}`,
    `Components: ${component}`,
    `Description: RepoExe Package Repository`,
    `SHA256:`,
    ...fileEntries.sort(),
    '',
  ].join('\n');

  writeFileSync(releasePath, releaseContent, 'utf-8');

  // GPG signing
  const gpgPrivKey = process.env.GPG_PRIVATE_KEY;
  let signingKeyFingerprint: string | undefined;
  if (gpgPrivKey) {
    const importRes = spawnSync('gpg', ['--status-fd', '1', '--import'], { input: gpgPrivKey, encoding: 'utf-8' });
    if (importRes.status === 0 && importRes.stdout) {
      const match = importRes.stdout.match(/\[GNUPG:\]\s+IMPORT_OK\s+\d+\s+([0-9A-Fa-f]{16,40})/);
      if (match) {
        signingKeyFingerprint = match[1];
      }
    }
  } else {
    let keyPath = 'scripts/repoexe.gpg';
    if (!existsSync(keyPath)) {
      keyPath = 'repoexe.gpg';
    }
    if (existsSync(keyPath)) {
      const importRes = spawnSync('gpg', ['--status-fd', '1', '--import', keyPath], { encoding: 'utf-8' });
      if (importRes.status === 0 && importRes.stdout) {
        const match = importRes.stdout.match(/\[GNUPG:\]\s+IMPORT_OK\s+\d+\s+([0-9A-Fa-f]{16,40})/);
        if (match) {
          signingKeyFingerprint = match[1];
        }
      }
    }
  }

  const inReleasePath = join(distsDir, 'InRelease');
  const releaseGpgPath = join(distsDir, 'Release.gpg');
  if (existsSync(inReleasePath)) {
    rmSync(inReleasePath, { force: true });
  }
  if (existsSync(releaseGpgPath)) {
    rmSync(releaseGpgPath, { force: true });
  }

  const tmpInRelease = join(distsDir, `.InRelease.tmp.${Date.now()}`);
  const tmpReleaseGpg = join(distsDir, `.Release.gpg.tmp.${Date.now()}`);

  const clearArgs = ['--clearsign'];
  const detachedArgs = ['-abs'];
  if (signingKeyFingerprint) {
    clearArgs.push('--local-user', signingKeyFingerprint);
    detachedArgs.push('--local-user', signingKeyFingerprint);
  }
  clearArgs.push('-o', tmpInRelease, releasePath);
  detachedArgs.push('-o', tmpReleaseGpg, releasePath);

  const signClearRes = spawnSync('gpg', clearArgs);
  const signDetachedRes = spawnSync('gpg', detachedArgs);

  let hasInRelease = false;
  if (signClearRes.status === 0 && existsSync(tmpInRelease)) {
    renameSync(tmpInRelease, inReleasePath);
    hasInRelease = true;
  } else if (existsSync(tmpInRelease)) {
    rmSync(tmpInRelease, { force: true });
  }

  let hasReleaseGpg = false;
  if (signDetachedRes.status === 0 && existsSync(tmpReleaseGpg)) {
    renameSync(tmpReleaseGpg, releaseGpgPath);
    hasReleaseGpg = true;
  } else if (existsSync(tmpReleaseGpg)) {
    rmSync(tmpReleaseGpg, { force: true });
  }

  if (
    (requireSigned || Boolean(process.env.GPG_PRIVATE_KEY) || process.env.REQUIRE_APT_SIGNING === 'true') &&
    !hasInRelease &&
    !hasReleaseGpg
  ) {
    throw new Error('Failed to sign APT Release file: gpg signing produced neither InRelease nor Release.gpg.');
  }
}
