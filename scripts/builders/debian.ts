import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { PackageRecipe } from '../core/types.ts';
import { parseDependencyList, filterDepsForArch, formatDebianDependency } from '../core/dependencies.ts';

export const ARCH_MAP: Record<string, string> = {
  aarch64: 'aarch64',
  x86_64: 'x86_64',
  arm: 'arm',
  i686: 'i686',
};

export function formatDebianVersion(recipe: PackageRecipe): string {
  const verBody = recipe.revision > 0 ? `${recipe.version}-${recipe.revision}` : recipe.version;
  return recipe.epoch > 0 ? `${recipe.epoch}:${verBody}` : verBody;
}

export function formatDebianFilenameVersion(recipe: PackageRecipe): string {
  const verBody = recipe.revision > 0 ? `${recipe.version}-${recipe.revision}` : recipe.version;
  return recipe.epoch > 0 ? `${recipe.epoch}_${verBody}` : verBody;
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
  if (recipe.homepage) lines.push(`Homepage: ${recipe.homepage}`);

  const formatDepField = (rawList: string[]): string => {
    if (!rawList || rawList.length === 0) return '';
    const clauses = parseDependencyList(rawList);
    const filtered = filterDepsForArch(clauses, debArch);
    return formatDebianDependency(filtered);
  };

  const depends = formatDepField(recipe.deps);
  if (depends) lines.push(`Depends: ${depends}`);
  const recommends = formatDepField(recipe.recommends);
  if (recommends) lines.push(`Recommends: ${recommends}`);
  const suggests = formatDepField(recipe.suggests);
  if (suggests) lines.push(`Suggests: ${suggests}`);
  const conflicts = formatDepField(recipe.conflicts);
  if (conflicts) lines.push(`Conflicts: ${conflicts}`);
  const provides = formatDepField(recipe.provides);
  if (provides) lines.push(`Provides: ${provides}`);
  const replaces = formatDepField(recipe.replaces);
  if (replaces) lines.push(`Replaces: ${replaces}`);
  const breaks = formatDepField(recipe.breaks || []);
  if (breaks) lines.push(`Breaks: ${breaks}`);
  const enhances = formatDepField(recipe.enhances || []);
  if (enhances) lines.push(`Enhances: ${enhances}`);

  return lines.join('\n') + '\n';
}

export function prepareDebianDir(recipe: PackageRecipe, buildDir: string, pkgDir?: string): string {
  const stageDir = join(buildDir, 'stage');
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
      const targetScript = join(debianDir, script);
      writeFileSync(targetScript, content, 'utf-8');
      chmodSync(targetScript, 0o755);
    }
  }

  // conffiles: track configuration files under /data/data/com.termux/files/usr/etc/
  const conffilesPath = join(debianDir, 'conffiles');
  if (pkgDir && existsSync(join(pkgDir, 'conffiles'))) {
    writeFileSync(conffilesPath, readFileSync(join(pkgDir, 'conffiles'), 'utf-8'), 'utf-8');
    chmodSync(conffilesPath, 0o644);
  } else if (pkgDir && existsSync(join(pkgDir, 'DEBIAN', 'conffiles'))) {
    writeFileSync(conffilesPath, readFileSync(join(pkgDir, 'DEBIAN', 'conffiles'), 'utf-8'), 'utf-8');
    chmodSync(conffilesPath, 0o644);
  } else {
    const etcDir = join(stageDir, 'data', 'data', 'com.termux', 'files', 'usr', 'etc');
    if (existsSync(etcDir)) {
      const conffileEntries: string[] = [];
      const scanEtc = (dir: string) => {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            scanEtc(full);
          } else if (entry.isFile()) {
            const relPath = full.slice(stageDir.length);
            conffileEntries.push(relPath.startsWith('/') ? relPath : `/${relPath}`);
          }
        }
      };
      scanEtc(etcDir);
      if (conffileEntries.length > 0) {
        writeFileSync(conffilesPath, conffileEntries.join('\n') + '\n', 'utf-8');
        chmodSync(conffilesPath, 0o644);
      }
    }
  }

  // triggers: copy if present
  if (pkgDir && existsSync(join(pkgDir, 'triggers'))) {
    writeFileSync(join(debianDir, 'triggers'), readFileSync(join(pkgDir, 'triggers'), 'utf-8'), 'utf-8');
    chmodSync(join(debianDir, 'triggers'), 0o644);
  } else if (pkgDir && existsSync(join(pkgDir, 'DEBIAN', 'triggers'))) {
    writeFileSync(join(debianDir, 'triggers'), readFileSync(join(pkgDir, 'DEBIAN', 'triggers'), 'utf-8'), 'utf-8');
    chmodSync(join(debianDir, 'triggers'), 0o644);
  }

  return stageDir;
}

export function buildDeb(
  recipe: PackageRecipe,
  destdir: string,
  outputDir: string,
  targetArch: string = 'aarch64',
  pkgDir?: string,
): string {
  const buildPath = resolve(destdir);
  const outPath = resolve(outputDir);
  mkdirSync(outPath, { recursive: true });

  const stageDir = prepareDebianDir(recipe, buildPath, pkgDir);

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
        if (entry.name !== 'DEBIAN') countBytes(full);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        totalBytes += statSync(full).size;
      }
    }
  };
  countBytes(stageDir);
  const installedSizeKib = Math.ceil(totalBytes / 1024);

  const controlContent = generateControlFile(recipe, installedSizeKib);
  writeFileSync(join(stageDir, 'DEBIAN', 'control'), controlContent, 'utf-8');

  const filenameVer = formatDebianFilenameVersion(recipe);
  const rawArch = recipe.arch || targetArch;
  const arch = ARCH_MAP[rawArch] || rawArch;
  const debFilename = `${recipe.name}_${filenameVer}_${arch}.deb`;
  const debPath = join(outPath, debFilename);

  let res = spawnSync('dpkg-deb', ['--build', '-Zxz', '-z9', stageDir, debPath], {
    encoding: 'utf-8',
  });
  if (res.status !== 0) {
    res = spawnSync('dpkg-deb', ['--build', stageDir, debPath], { encoding: 'utf-8' });
    if (res.status !== 0) {
      throw new Error(`dpkg-deb failed for ${recipe.name}: ${res.stderr?.trim()}`);
    }
  }

  return debPath;
}

export function generateAptMetadata(outputDir: string, component: string = 'main', arch: string = 'aarch64'): void {
  const binaryDir = join(outputDir, 'dists', 'stable', component, `binary-${arch}`);
  mkdirSync(binaryDir, { recursive: true });

  const packagesPath = join(binaryDir, 'Packages');
  const entries: string[] = [];

  const debFiles = readdirSync(outputDir)
    .filter((f) => f.endsWith('.deb'))
    .sort();

  for (const debName of debFiles) {
    const debPath = join(outputDir, debName);
    const res = spawnSync('dpkg-deb', ['-f', debPath], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      const controlInfo = res.stdout.trim();
      const content = readFileSync(debPath);
      const size = content.length;
      const md5 = createHash('md5').update(content).digest('hex');
      const sha256 = createHash('sha256').update(content).digest('hex');
      entries.push(`${controlInfo}\nFilename: ${debName}\nSize: ${size}\nMD5sum: ${md5}\nSHA256: ${sha256}\n\n`);
    }
  }

  const packagesContent = entries.join('');
  writeFileSync(packagesPath, packagesContent, 'utf-8');
  writeFileSync(`${packagesPath}.gz`, gzipSync(Buffer.from(packagesContent, 'utf-8')));
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
        const sha256 = createHash('sha256').update(data).digest('hex');
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
    if (!existsSync(keyPath)) keyPath = 'repoexe.gpg';
    if (existsSync(keyPath)) {
      spawnSync('gpg', ['--import', keyPath]);
    }
  }

  spawnSync('gpg', ['--clearsign', '-o', join(distsDir, 'InRelease'), releasePath]);
  spawnSync('gpg', ['-abs', '-o', join(distsDir, 'Release.gpg'), releasePath]);
}
