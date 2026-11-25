import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  closeSync,
  existsSync,
  lstatSync,
  lutimesSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

import { safeRenameSync } from '../core/compat.ts';
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
import {
  compareDebianVersions,
  formatDebianFilenameVersion,
  formatDebianVersion,
  satisfiesVersionConstraint,
} from '../core/version.ts';
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

export function formatDebianDescription(description?: string): string {
  const raw = (description || 'RepoExe package').replace(/\r\n/g, '\n').trimEnd();
  const lines = raw.split('\n');
  const first = lines[0]?.trim() || 'RepoExe package';
  if (lines.length === 1) {
    return first;
  }
  const rest = lines.slice(1).map((line) => (line.trim() === '' ? ' .' : ` ${line}`));
  return [first, ...rest].join('\n');
}

export function buildDebianTags(recipe: Pick<PackageRecipe, 'interface' | 'tags'>): string[] {
  const tagSet = new Set<string>();
  const iface = recipe.interface;
  if (iface === 'cli') {
    tagSet.add('interface::commandline');
  } else if (iface === 'tui') {
    tagSet.add('interface::text-mode');
  } else if (iface === 'gui') {
    tagSet.add('interface::graphical');
  } else if (iface === 'both') {
    tagSet.add('interface::commandline');
    tagSet.add('interface::graphical');
  }
  if (Array.isArray(recipe.tags)) {
    for (const t of recipe.tags) {
      const trimmed = t.trim();
      if (trimmed) {
        tagSet.add(trimmed);
      }
    }
  }
  return Array.from(tagSet);
}

export function generateControlFile(recipe: PackageRecipe, installedSizeKib?: number): string {
  const versionStr = formatDebianVersion(recipe);
  const debArch = ARCH_MAP[recipe.arch] || recipe.arch;

  const lines = [
    `Package: ${recipe.name}`,
    `Version: ${versionStr}`,
    `Architecture: ${debArch}`,
    `Maintainer: ${recipe.maintainer || 'SjnExe'}`,
  ];

  if (recipe.section) {
    lines.push(`Section: ${recipe.section}`);
  }
  lines.push(`Priority: ${recipe.priority || 'optional'}`);

  const tags = buildDebianTags(recipe);
  if (tags.length > 0) {
    lines.push(`Tag: ${tags.join(', ')}`);
  }

  lines.push(`Description: ${formatDebianDescription(recipe.description)}`);

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
        if (token.multiArch === 'native') {
          throw new Error(
            `Invalid dependency '${token.name}:native' in package '${recipe.name}': ':native' architecture qualifier is only valid in source Build-Depends, not binary relationship fields.`,
          );
        }
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

export function getPackageSourceDateEpoch(
  pkgDir?: string,
  repoRoot: string = resolve('.'),
): number {
  if (process.env.SOURCE_DATE_EPOCH !== undefined && process.env.SOURCE_DATE_EPOCH.trim() !== '') {
    const raw = process.env.SOURCE_DATE_EPOCH.trim();
    if (/^\d+$/.test(raw)) {
      const val = parseInt(raw, 10);
      if (Number.isSafeInteger(val) && val >= 0) {
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
          if (
            n === 4 &&
            magic[0] === 0x7f &&
            magic[1] === 0x45 &&
            magic[2] === 0x4c &&
            magic[3] === 0x46
          ) {
            const cleanRes = spawnSync(cleaner, ['--api-level', '24', full], { encoding: 'utf-8' });
            if (cleanRes.status !== 0 || cleanRes.error) {
              const err =
                cleanRes.error?.message ||
                cleanRes.stderr?.trim() ||
                `exit code ${cleanRes.status}`;
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
            const isScript = ['preinst', 'postinst', 'prerm', 'postrm', 'config'].includes(
              entry.name,
            );
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

export const ALLOWED_MAINTAINER_SCRIPTS = new Set([
  'preinst',
  'postinst',
  'prerm',
  'postrm',
  'config',
]);

const PERL_SYNTAX_MOCK_CONTENT =
  'package RepoExePerlSyntaxMock;\n' +
  'unshift @INC, sub {\n' +
  '  my ($self, $file) = @_;\n' +
  '  if ($file =~ m{^Debconf/}) {\n' +
  "    return \\(<<'EOF');\n" +
  'package Debconf::Client::ConfModule;\n' +
  'our @ISA = qw(Exporter);\n' +
  'our @EXPORT = qw(\n' +
  '  capb get set reset input beginblock endblock go gettitle settitle title\n' +
  '  stop x_loadtemplatefile version fget fset metaget register unregister\n' +
  '  purge previous clear visible progress data\n' +
  ');\n' +
  'our @EXPORT_OK = @EXPORT;\n' +
  'our %EXPORT_TAGS = (all => \\@EXPORT);\n' +
  'sub import {\n' +
  '  my $pkg = shift;\n' +
  '  my $callpkg = caller;\n' +
  "  no strict 'refs';\n" +
  '  my @symbols = @_ ? @_ : @EXPORT;\n' +
  '  for my $sym (@symbols) {\n' +
  "    if ($sym eq ':all') {\n" +
  '      *{"${callpkg}::$_"} = sub { 0 } for @EXPORT;\n' +
  '    } else {\n' +
  '      my $name = $sym;\n' +
  '      $name =~ s/^://;\n' +
  '      *{"${callpkg}::${name}"} = sub { 0 };\n' +
  '    }\n' +
  '  }\n' +
  '}\n' +
  'sub AUTOLOAD { 0 }\n' +
  '1;\n' +
  'EOF\n' +
  '  }\n' +
  '  return undef;\n' +
  '};\n' +
  '1;\n';

export function validateMaintainerScript(
  scriptName: string,
  content: string,
  pkgName: string,
): void {
  if (!ALLOWED_MAINTAINER_SCRIPTS.has(scriptName)) {
    throw new Error(
      `Invalid maintainer script '${scriptName}' in package '${pkgName}'. Allowed scripts: ${Array.from(ALLOWED_MAINTAINER_SCRIPTS).join(', ')}.`,
    );
  }
  if (!content.trim()) {
    return;
  }
  if (!content.startsWith('#!')) {
    throw new Error(
      `Maintainer script '${scriptName}' in package '${pkgName}' is missing a shebang line (must start with '#!').`,
    );
  }

  // Parse interpreter from shebang to select syntax validation mode
  const firstLine = content.split('\n')[0].trim();
  const match = firstLine.match(/^#!\s*(?:\S*\/)?([a-zA-Z0-9._-]+)(?:\s+.*)?$/);
  let rawInterpreter = match ? match[1] : '';
  if (rawInterpreter === 'env') {
    const envMatch = firstLine.match(/^#!\s*(?:\S*\/)?env\s+(?:-\S+\s+)*([a-zA-Z0-9._-]+)/);
    rawInterpreter = envMatch ? envMatch[1] : '';
  }

  let checkRes: ReturnType<typeof spawnSync> | null = null;
  if (rawInterpreter === 'sh' || rawInterpreter === 'dash' || rawInterpreter === 'ash') {
    checkRes = spawnSync('sh', ['-n'], { input: content, encoding: 'utf-8', timeout: 10_000 });
  } else if (rawInterpreter === 'bash') {
    checkRes = spawnSync('bash', ['-n'], { input: content, encoding: 'utf-8', timeout: 10_000 });
    if (checkRes.error && (checkRes.error as NodeJS.ErrnoException).code === 'ENOENT') {
      checkRes = spawnSync('sh', ['-n'], { input: content, encoding: 'utf-8', timeout: 10_000 });
    }
  } else if (rawInterpreter === 'perl') {
    const sandboxDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'repoexe_perl_sandbox-'));
    try {
      const mockFile = join(sandboxDir, 'RepoExePerlSyntaxMock.pm');
      writeFileSync(mockFile, PERL_SYNTAX_MOCK_CONTENT, 'utf-8');
      checkRes = spawnSync('perl', ['-I' + sandboxDir, '-MRepoExePerlSyntaxMock', '-c', '-'], {
        input: content,
        encoding: 'utf-8',
        timeout: 10_000,
        cwd: sandboxDir,
        env: {
          PATH: process.env.PATH || '/usr/bin:/bin',
          TMPDIR: sandboxDir,
        },
      });
    } finally {
      try {
        rmSync(sandboxDir, { recursive: true, force: true });
      } catch {}
    }
    // perl -c executes `use` and BEGIN; suppress only isolated host-setup failures or missing modules,
    // while preserving independent compilation errors (syntax errors, undeclared variables under strict).
    if (checkRes.status !== 0) {
      const stderr = String(checkRes.stderr || '');
      const hasCompilationError =
        /syntax error|Global symbol .+ requires explicit package name|Bareword .+ not allowed|compilation errors/i.test(
          stderr,
        );
      if (
        !hasCompilationError &&
        (/Can't locate .+ in @INC/.test(stderr) ||
          /debconf: /i.test(stderr) ||
          /DbDriver/i.test(stderr) ||
          /ConfModule\.pm/i.test(stderr))
      ) {
        checkRes = null;
      }
    }
  } else if (rawInterpreter === 'python' || rawInterpreter === 'python3') {
    checkRes = spawnSync(
      'python3',
      ['-c', "import sys; compile(sys.stdin.read(), '<maintainer-script>', 'exec')"],
      {
        input: content,
        encoding: 'utf-8',
        timeout: 10_000,
      },
    );
  }

  if (checkRes) {
    if (checkRes.error) {
      if ((checkRes.error as NodeJS.ErrnoException).code === 'ETIMEDOUT') {
        throw new Error(
          `Syntax validation timed out for maintainer script '${scriptName}' in package '${pkgName}'`,
        );
      }
      return;
    }
    if (checkRes.status !== 0) {
      const errMsg = checkRes.stderr
        ? String(checkRes.stderr).trim()
        : `syntax error (exit code ${checkRes.status})`;
      throw new Error(
        `Syntax validation failed for maintainer script '${scriptName}' in package '${pkgName}': ${errMsg}`,
      );
    }
  }
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

  // Maintainer scripts: preinst, postinst, prerm, postrm, config
  if (recipe.maintainer_scripts) {
    for (const script of Object.keys(recipe.maintainer_scripts)) {
      if (!ALLOWED_MAINTAINER_SCRIPTS.has(script)) {
        throw new Error(
          `Invalid maintainer script '${script}' in package '${recipe.name}'. Allowed scripts: ${Array.from(ALLOWED_MAINTAINER_SCRIPTS).join(', ')}.`,
        );
      }
    }
  }

  const packagingTrackerFile = join(
    dirname(stageDir),
    `.${basename(stageDir)}_packaging_scripts.json`,
  );
  if (existsSync(packagingTrackerFile)) {
    try {
      const prevGenerated = JSON.parse(readFileSync(packagingTrackerFile, 'utf-8'));
      if (Array.isArray(prevGenerated)) {
        for (const s of prevGenerated) {
          if (typeof s === 'string') {
            const p = join(debianDir, s);
            if (existsSync(p)) {
              unlinkSync(p);
            }
          }
        }
      }
    } catch {}
    try {
      unlinkSync(packagingTrackerFile);
    } catch {}
  }

  const newlyGeneratedScripts: string[] = [];
  const maintainerScripts = ['preinst', 'postinst', 'prerm', 'postrm', 'config'];
  for (const script of maintainerScripts) {
    const targetScript = join(debianDir, script);
    let content: string | undefined;
    if (recipe.maintainer_scripts && typeof recipe.maintainer_scripts[script] === 'string') {
      content = recipe.maintainer_scripts[script];
      newlyGeneratedScripts.push(script);
    } else if (pkgDir) {
      const scriptPath = join(pkgDir, script);
      const debianScriptPath = join(pkgDir, 'DEBIAN', script);
      if (existsSync(scriptPath)) {
        content = readFileSync(scriptPath, 'utf-8');
        newlyGeneratedScripts.push(script);
      } else if (existsSync(debianScriptPath)) {
        content = readFileSync(debianScriptPath, 'utf-8');
        newlyGeneratedScripts.push(script);
      }
    }
    if (!content && script === 'config' && existsSync(targetScript)) {
      content = readFileSync(targetScript, 'utf-8');
    }
    if (content) {
      validateMaintainerScript(script, content, recipe.name);
      writeFileSync(targetScript, content, 'utf-8');
      chmodSync(targetScript, 0o755);
    } else if (existsSync(targetScript)) {
      unlinkSync(targetScript);
    }
  }
  if (newlyGeneratedScripts.length > 0) {
    try {
      writeFileSync(packagingTrackerFile, JSON.stringify(newlyGeneratedScripts), 'utf-8');
    } catch {}
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
      throw new Error(
        `Conffile '${trimmed}' declared in conffiles does not exist in stage or any subpackage stage.`,
      );
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
    try {
      rmSync(target, { recursive: true, force: false });
    } catch (err: unknown) {
      if ((err as { code?: string }).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  // Automated shebang and ELF cleaning before measuring Installed-Size
  sanitizeShebangs(stageDir);
  cleanStageElfs(stageDir);

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

  // Stage normalization after control write so DEBIAN/control gets its mode and mtime
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
  targetArch?: string,
  pkgDir?: string,
  sourceEpochOverride?: number,
): string[] {
  const resolvedArch = targetArch || recipe.arch || 'aarch64';
  const effectiveRecipe =
    targetArch && recipe.arch !== 'all' ? { ...recipe, arch: targetArch } : recipe;
  const buildPath = resolve(destdir);
  const outPath = resolve(outputDir);
  mkdirSync(outPath, { recursive: true });

  const stageDir = join(buildPath, 'stage');
  const sourceEpoch =
    sourceEpochOverride !== undefined ? sourceEpochOverride : getPackageSourceDateEpoch(pkgDir);

  // Split subpackages before preparing parent Debian control & conffiles
  const subSplits = splitSubpackages(effectiveRecipe, stageDir, buildPath, resolvedArch);

  // Validate control metadata upfront for all subpackages (including non-producers)
  const emittedSubs: typeof subSplits = [];
  const skippedSubs: typeof subSplits = [];
  for (const sub of subSplits) {
    generateControlFile(sub.recipe); // Enforces Invariants 1 & 2 on every shard, including non-producers
    if (
      sub.recipe.arch === 'all' &&
      sub.recipe.producer_arch &&
      normalizeArch(sub.recipe.producer_arch) !== 'all' &&
      resolvedArch &&
      normalizeArch(sub.recipe.producer_arch) !== normalizeArch(resolvedArch)
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
  const parentDeb = assembleSingleDeb(
    effectiveRecipe,
    parentStageDir,
    outPath,
    resolvedArch,
    sourceEpoch,
  );
  const allDebs: string[] = [parentDeb];
  for (const sub of emittedSubs) {
    allDebs.push(assembleSingleDeb(sub.recipe, sub.stageDir, outPath, resolvedArch, sourceEpoch));
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
  targetArch?: string,
  pkgDir?: string,
  sourceEpoch?: number,
): string {
  const debs = buildAllDebs(recipe, destdir, outputDir, targetArch, pkgDir, sourceEpoch);
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
  component: string;
  provides: ParsedProvideEntry[];
  /** Value of the Multi-Arch control field, e.g. "allowed", "foreign", "same". */
  multiArch?: string;
}

export interface AptMetadataContext {
  allCandidates: CandidateDeb[];
  activePools: Map<string, CandidateDeb[]>;
  emittedNames: Set<string>;
  components: Set<string>;
}

export function buildAptMetadataContext(
  outputDir: string,
  packagesDir: string = join(process.cwd(), 'pkg'),
): AptMetadataContext {
  const debFiles = existsSync(outputDir)
    ? readdirSync(outputDir)
        .filter((f) => f.endsWith('.deb'))
        .sort()
    : [];

  const emittedNames = new Set<string>();
  const pkgComponentMap = new Map<string, string>();
  if (existsSync(packagesDir)) {
    const graph = new DependencyGraph(packagesDir);
    for (const [name, rec] of Object.entries(graph.recipes)) {
      emittedNames.add(name);
      pkgComponentMap.set(name, rec.component || 'main');
    }
    for (const [name, parentName] of Object.entries(graph.subpackageMap)) {
      emittedNames.add(name);
      const parentRec = graph.recipes[parentName];
      const subDef = parentRec?.subpackages?.[name];
      pkgComponentMap.set(name, subDef?.component || parentRec?.component || 'main');
    }
    for (const name of Object.keys(graph.providersMap)) {
      emittedNames.add(name);
    }
  }

  const allCandidates: CandidateDeb[] = [];

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
        (!CANONICAL_ARCHES.has(normalizeArch(declaredArch)) ||
          normalizeArch(declaredArch) !== normalizeArch(debArch))
      ) {
        continue;
      }
      const effectiveArch = declaredArch;
      const pkgName = extractDebianField(controlInfo, 'Package') || debName.split('_')[0];
      const pkgVersion =
        extractDebianField(controlInfo, 'Version') || parseFilenameDebVersion(debName);
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
      const component = pkgComponentMap.get(pkgName) || 'main';
      const cand: CandidateDeb = {
        debName,
        debArch: effectiveArch,
        controlInfo,
        debPath,
        pkgName,
        pkgVersion,
        component,
        provides,
        multiArch,
      };
      allCandidates.push(cand);
    }
  }

  const versionCache = new Map<string, boolean>();
  const allArches = new Set<string>();
  for (const c of allCandidates) {
    if (c.debArch !== 'all' && c.debArch !== 'unknown') {
      allArches.add(normalizeArch(c.debArch));
    }
  }
  for (const ca of ['aarch64', 'arm', 'i686', 'x86_64']) {
    allArches.add(ca);
  }

  const activePools = new Map<string, CandidateDeb[]>();
  for (const a of allArches) {
    activePools.set(
      a,
      allCandidates.filter((c) => {
        const norm = c.debArch === 'all' ? 'all' : normalizeArch(c.debArch);
        return norm === 'all' || norm === a || c.debArch === 'unknown';
      }),
    );
  }

  let changed = true;
  while (changed) {
    changed = false;

    for (const evalArch of allArches) {
      const currentPool = activePools.get(evalArch) || [];
      const nextPool: CandidateDeb[] = [];

      const nativePool = currentPool;
      const allActive = Array.from(new Set(Array.from(activePools.values()).flat()));
      const foreignCandidates = allActive.filter(
        (c) => c.multiArch === 'foreign' && c.debArch !== 'all' && !nativePool.includes(c),
      );
      const unqualifiedPool = [...nativePool, ...foreignCandidates];

      for (const cand of currentPool) {
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
          nextPool.push(cand);
          continue;
        }
        const clauses = parseDependencyList(rawClauses);
        const filtered = filterDepsForArch(clauses, evalArch);

        const isRepoExeOwnedOrProvided = (depName: string): boolean =>
          emittedNames.has(depName) ||
          existsSync(join(packagesDir, depName)) ||
          allCandidates.some(
            (c) => c.pkgName === depName || c.provides.some((p) => p.name === depName),
          );

        const clauseOptions: Array<{ hasExternal: boolean; localCands: CandidateDeb[] }> = [];
        let hasImpossibleClause = false;

        for (const clause of filtered) {
          let hasExternal = false;
          const localSet = new Set<CandidateDeb>();

          for (const tok of clause) {
            const depName = tok.name.split(':')[0].trim();
            let matchedLocal = false;
            let searchCandidates: CandidateDeb[];

            if (tok.multiArch === 'native') {
              throw new Error(
                `Invalid binary dependency '${tok.name}:native' in '${cand.pkgName}': ':native' qualifier is forbidden in binary packages.`,
              );
            } else if (tok.multiArch && tok.multiArch !== 'any') {
              const targetDepArch = normalizeArch(tok.multiArch);
              const targetPool = activePools.get(targetDepArch) || [];
              searchCandidates = targetPool.filter(
                (c) => c.debArch === 'all' || normalizeArch(c.debArch) === targetDepArch,
              );
            } else if (tok.multiArch === 'any') {
              searchCandidates = allActive.filter((c) => c.multiArch === 'allowed');
            } else {
              searchCandidates = unqualifiedPool;
            }

            for (const c of searchCandidates) {
              if (tok.multiArch === 'any') {
                if (c.multiArch !== 'allowed') {
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
          clauseOptions.sort((a, b) => a.localCands.length - b.localCands.length);
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
              const choiceArch = choice.debArch === 'all' ? 'all' : normalizeArch(choice.debArch);
              const lockstepConflict = [...selectedConcrete.values()].some((sel) => {
                if (sel.pkgName !== choice.pkgName) {
                  return false;
                }
                const selArch = sel.debArch === 'all' ? 'all' : normalizeArch(sel.debArch);
                if (selArch !== choiceArch) {
                  return !(
                    sel.multiArch === 'same' &&
                    choice.multiArch === 'same' &&
                    compareDebianVersions(sel.pkgVersion, choice.pkgVersion) === 0
                  );
                }
                return false;
              });
              if (lockstepConflict) {
                continue;
              }
              const existing = selectedConcrete.get(choiceKey);
              if (existing) {
                if (
                  existing.pkgVersion !== choice.pkgVersion ||
                  existing.debName !== choice.debName
                ) {
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
          nextPool.push(cand);
        } else {
          changed = true;
        }
      }
      activePools.set(evalArch, nextPool);
    }
  }

  const components = new Set<string>(['main']);
  for (const cand of allCandidates) {
    components.add(cand.component || 'main');
  }

  return { allCandidates, activePools, emittedNames, components };
}

function writeIndexWithByHash(baseDir: string, filename: string, data: Buffer): void {
  const filePath = join(baseDir, filename);
  writeFileSync(filePath, data);
  const sha256 = new Bun.CryptoHasher('sha256').update(data).digest('hex');
  const byHashDir = join(baseDir, 'by-hash', 'SHA256');
  mkdirSync(byHashDir, { recursive: true });
  writeFileSync(join(byHashDir, sha256), data);
}

export function generateAptMetadata(
  outputDir: string,
  component: string = 'main',
  arch: string = 'aarch64',
  packagesDir: string = join(process.cwd(), 'pkg'),
  context?: AptMetadataContext,
): void {
  const binaryDir = join(outputDir, 'dists', 'stable', component, `binary-${arch}`);
  mkdirSync(binaryDir, { recursive: true });

  const entries: string[] = [];

  const ctx = context || buildAptMetadataContext(outputDir, packagesDir);
  const targetNormArch = normalizeArch(arch);
  const finalTargetPool = ctx.activePools.get(targetNormArch) || [];
  const activeCandidates = finalTargetPool.filter((cand) => {
    if ((cand.component || 'main') !== component) {
      return false;
    }
    const matchesArch =
      cand.debArch === 'all' ||
      normalizeArch(cand.debArch) === 'all' ||
      normalizeArch(cand.debArch) === targetNormArch ||
      cand.debArch === 'unknown';
    return matchesArch && isDebArchCompatible(cand.debArch, arch);
  });

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
  const pkgsBuffer = Buffer.from(packagesContent, 'utf-8');
  writeIndexWithByHash(binaryDir, 'Packages', pkgsBuffer);

  const gzBuffer = Buffer.from(Bun.gzipSync(pkgsBuffer));
  writeIndexWithByHash(binaryDir, 'Packages.gz', gzBuffer);

  const xzRes = spawnSync('xz', ['-c'], { input: pkgsBuffer });
  if (xzRes.status === 0 && xzRes.stdout) {
    writeIndexWithByHash(binaryDir, 'Packages.xz', Buffer.from(xzRes.stdout));
  }

  // Differential repository index generation (pdiff format)
  const diffDir = join(binaryDir, 'Packages.diff');
  mkdirSync(diffDir, { recursive: true });
  const pkgsSha256 = new Bun.CryptoHasher('sha256').update(pkgsBuffer).digest('hex');
  const pkgsSize = pkgsBuffer.length;
  const diffIndexContent = [
    `SHA256-Current: ${pkgsSha256} ${pkgsSize}`,
    `SHA256-History:`,
    `SHA256-Patches:`,
    '',
  ].join('\n');
  writeIndexWithByHash(diffDir, 'Index', Buffer.from(diffIndexContent, 'utf-8'));
}

export function generateReleaseFile(
  outputDir: string,
  suite: string = 'stable',
  component: string | string[] = 'main',
  requireSigned = false,
): void {
  const distsDir = join(outputDir, 'dists', suite);
  mkdirSync(distsDir, { recursive: true });
  const releasePath = join(distsDir, 'Release');
  const componentList = Array.isArray(component)
    ? Array.from(new Set(component)).sort()
    : [component || 'main'];

  const arches = new Set<string>();
  const fileEntries: string[] = [];

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === 'by-hash') {
        continue;
      }
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (
        entry.name === 'Packages' ||
        entry.name === 'Packages.gz' ||
        entry.name === 'Packages.xz' ||
        (entry.name === 'Index' && full.includes('Packages.diff'))
      ) {
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
    `Components: ${componentList.join(' ')}`,
    `Acquire-By-Hash: yes`,
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
    const importRes = spawnSync('gpg', ['--status-fd', '1', '--import'], {
      input: gpgPrivKey,
      encoding: 'utf-8',
    });
    if (importRes.status === 0 && importRes.stdout) {
      const match = importRes.stdout.match(/\[GNUPG:\]\s+IMPORT_OK\s+\d+\s+([0-9A-Fa-f]{16,40})/);
      if (match) {
        signingKeyFingerprint = match[1];
      }
    }
    if (!signingKeyFingerprint) {
      throw new Error(
        'GPG_PRIVATE_KEY is set but key import or signing fingerprint extraction failed.',
      );
    }
  } else {
    let keyPath = 'scripts/repoexe.gpg';
    if (!existsSync(keyPath)) {
      keyPath = 'repoexe.gpg';
    }
    if (existsSync(keyPath)) {
      const importRes = spawnSync('gpg', ['--status-fd', '1', '--import', keyPath], {
        encoding: 'utf-8',
      });
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

  const isSigningRequired =
    requireSigned ||
    Boolean(process.env.GPG_PRIVATE_KEY) ||
    process.env.REQUIRE_APT_SIGNING === 'true';
  if (isSigningRequired && !signingKeyFingerprint) {
    throw new Error('APT signing is required but no signing key fingerprint could be resolved.');
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

  try {
    const signClearRes = spawnSync('gpg', clearArgs);
    const signDetachedRes = spawnSync('gpg', detachedArgs);

    let hasInRelease = false;
    if (signClearRes.status === 0 && existsSync(tmpInRelease)) {
      safeRenameSync(tmpInRelease, inReleasePath);
      hasInRelease = true;
    }

    let hasReleaseGpg = false;
    if (signDetachedRes.status === 0 && existsSync(tmpReleaseGpg)) {
      safeRenameSync(tmpReleaseGpg, releaseGpgPath);
      hasReleaseGpg = true;
    }

    if (isSigningRequired && !hasInRelease && !hasReleaseGpg) {
      throw new Error(
        'Failed to sign APT Release file: gpg signing produced neither InRelease nor Release.gpg.',
      );
    }
  } finally {
    if (existsSync(tmpInRelease)) {
      try {
        rmSync(tmpInRelease, { force: true });
      } catch {}
    }
    if (existsSync(tmpReleaseGpg)) {
      try {
        rmSync(tmpReleaseGpg, { force: true });
      } catch {}
    }
  }
}
