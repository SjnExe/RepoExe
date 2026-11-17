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
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { filterDepsForArch, formatDebianDependency, parseDependencyList } from '../core/dependencies.ts';
import { parseFilenameDebVersion } from '../core/fetcher.ts';
import { splitSubpackages } from '../core/subpkg.ts';
import type { PackageRecipe } from '../core/types.ts';
import { formatDebianFilenameVersion, formatDebianVersion, satisfiesVersionConstraint } from '../core/version.ts';
import { sanitizeStagingElfs } from '../sanitizer/elf.ts';
import { sanitizeShebangs } from '../sanitizer/shebang.ts';

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

  const formatDepField = (rawList: string[]): string => {
    if (!rawList || rawList.length === 0) {
      return '';
    }
    const clauses = parseDependencyList(rawList);
    const filtered = filterDepsForArch(clauses, debArch);
    return formatDebianDependency(filtered);
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
  const provides = formatDepField(recipe.provides);
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

  if (isShallow && (!process.env.SOURCE_DATE_EPOCH || process.env.SOURCE_DATE_EPOCH.trim() === '')) {
    throw new Error(
      'Shallow git repository checkout detected with incomplete commit history. Run `git fetch --unshallow` or set SOURCE_DATE_EPOCH to ensure reproducible archive builds.',
    );
  }

  if (pkgDir && existsSync(pkgDir)) {
    const relPkg = relative(repoRoot, pkgDir);
    const res = spawnSync('git', ['log', '-1', '--pretty=%ct', relPkg], {
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
    sanitizeStagingElfs(stageDir);
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
        if (lstat.isDirectory()) {
          chmodSync(full, 0o755);
          traverse(full);
          try {
            utimesSync(full, epoch, epoch);
          } catch {}
        } else if (lstat.isFile()) {
          const rel = relative(stageDir, full);
          const normRel = rel.replace(/\\/g, '/').replace(/^\.\//, '');
          const isBinDir = /^(?:usr\/|data\/data\/com\.termux\/files\/usr\/)?(?:bin|sbin|libexec)\//.test(normRel);
          const isExec = (lstat.mode & 0o111) !== 0 || isBinDir || normRel.endsWith('.so') || normRel.includes('.so.');
          chmodSync(full, isExec ? 0o755 : 0o644);
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
    const parts = trimmed.split(/\s+/);
    if (parts[0] === 'remove-on-upgrade' && parts.length > 1) {
      if (!conffilesSourceDir) {
        conffileEntries.add(`remove-on-upgrade ${parts.slice(1).join(' ')}`);
      }
      continue;
    }
    const rel = trimmed.replace(/^\/+/, '');
    const existsAnywhere = allStages.some((s) => existsSync(join(s, rel)));
    if (!existsAnywhere) {
      throw new Error(`Conffile '${trimmed}' declared in conffiles does not exist in stage or any subpackage stage.`);
    }
    if (existsSync(join(stageDir, rel))) {
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
            const relPath = full.slice(stageDir.length);
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
  dpkgArgs.push('-Zxz', '-z9', stageDir, debPath);
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
  const buildPath = resolve(destdir);
  const outPath = resolve(outputDir);
  mkdirSync(outPath, { recursive: true });

  const stageDir = join(buildPath, 'stage');
  const sourceEpoch = getPackageSourceDateEpoch(pkgDir);

  // Split subpackages before preparing parent Debian control & conffiles
  const subSplits = splitSubpackages(recipe, stageDir, buildPath, targetArch);

  // Prepare parent DEBIAN control & conffiles on remaining stage
  const parentStageDir = prepareDebianDir(recipe, buildPath, pkgDir, stageDir);

  // Assemble parent deb
  const parentDeb = assembleSingleDeb(recipe, parentStageDir, outPath, targetArch, sourceEpoch);
  const allDebs: string[] = [parentDeb];

  // Assemble each subpackage deb
  for (const sub of subSplits) {
    prepareDebianDir(sub.recipe, buildPath, undefined, sub.stageDir, pkgDir);
    const subDeb = assembleSingleDeb(sub.recipe, sub.stageDir, outPath, targetArch, sourceEpoch);
    allDebs.push(subDeb);
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

export function generateAptMetadata(outputDir: string, component: string = 'main', arch: string = 'aarch64'): void {
  const binaryDir = join(outputDir, 'dists', 'stable', component, `binary-${arch}`);
  mkdirSync(binaryDir, { recursive: true });

  const packagesPath = join(binaryDir, 'Packages');
  const entries: string[] = [];

  const debFiles = readdirSync(outputDir)
    .filter((f) => f.endsWith('.deb'))
    .sort();

  interface CandidateDeb {
    debName: string;
    debArch: string;
    controlInfo: string;
    debPath: string;
  }

  const initialCandidates: CandidateDeb[] = [];

  for (const debName of debFiles) {
    const debArch = extractDebArch(debName);
    const matchesArch =
      debArch === 'all' ||
      debArch === arch ||
      (arch === 'aarch64' && debArch === 'arm64') ||
      (arch === 'arm64' && debArch === 'aarch64');
    if (!matchesArch && debArch !== 'unknown') {
      continue;
    }

    const debPath = join(outputDir, debName);
    const res = spawnSync('dpkg-deb', ['-f', debPath], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      const controlInfo = res.stdout.trim();
      let effectiveArch = debArch;
      if (debArch === 'unknown') {
        const archMatch = controlInfo.match(/^Architecture:\s*(.+)$/m);
        const pkgArch = archMatch ? archMatch[1].trim() : '';
        const matchesPkgArch =
          pkgArch === 'all' ||
          pkgArch === arch ||
          (arch === 'aarch64' && pkgArch === 'arm64') ||
          (arch === 'arm64' && pkgArch === 'aarch64');
        if (!matchesPkgArch) {
          continue;
        }
        effectiveArch = pkgArch;
      }
      initialCandidates.push({ debName, debArch: effectiveArch, controlInfo, debPath });
    }
  }

  // Multi-pass dependency pruning for 'all' packages:
  // If an 'all' package depends on a RepoExe-owned package, ensure that RepoExe dependency is available for this arch.
  // External packages (like bash) are not required to be in outputDir.
  let activeCandidates = [...initialCandidates];
  let changed = true;
  while (changed) {
    changed = false;
    const nextCandidates: CandidateDeb[] = [];

    for (const cand of activeCandidates) {
      if (cand.debArch !== 'all') {
        nextCandidates.push(cand);
        continue;
      }
      const depMatch = cand.controlInfo.match(/^Depends:\s*(.+)$/m);
      if (!depMatch || !depMatch[1]) {
        nextCandidates.push(cand);
        continue;
      }
      const clauses = parseDependencyList([depMatch[1]]);
      const filtered = filterDepsForArch(clauses, arch);
      const allSatisfied = filtered.every((clause) =>
        clause.some((tok) => {
          const depName = tok.name.split(':')[0].trim();
          const isRepoExeOwned =
            existsSync(join(process.cwd(), 'pkg', depName)) || debFiles.some((f) => f.split('_')[0] === depName);
          if (!isRepoExeOwned) {
            return true; // Upstream Termux dependency, resolved by APT
          }
          return activeCandidates.some((c) => {
            const fPkg = c.debName.split('_')[0];
            if (fPkg !== depName) {
              return false;
            }
            const fVer = parseFilenameDebVersion(c.debName);
            return satisfiesVersionConstraint(fVer, tok.versionConstraint);
          });
        }),
      );
      if (allSatisfied) {
        nextCandidates.push(cand);
      } else {
        changed = true;
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

export function generateReleaseFile(outputDir: string, suite: string = 'stable', component: string = 'main'): void {
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
    ...fileEntries,
    '',
  ].join('\n');

  writeFileSync(releasePath, releaseContent, 'utf-8');

  // GPG signing
  const gpgPrivKey = process.env.GPG_PRIVATE_KEY;
  if (gpgPrivKey) {
    spawnSync('gpg', ['--import'], { input: gpgPrivKey, encoding: 'utf-8' });
  } else {
    let keyPath = 'scripts/repoexe.gpg';
    if (!existsSync(keyPath)) {
      keyPath = 'repoexe.gpg';
    }
    if (existsSync(keyPath)) {
      spawnSync('gpg', ['--import', keyPath]);
    }
  }

  spawnSync('gpg', ['--clearsign', '-o', join(distsDir, 'InRelease'), releasePath]);
  spawnSync('gpg', ['-abs', '-o', join(distsDir, 'Release.gpg'), releasePath]);
}
