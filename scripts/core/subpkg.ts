import {
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { normalizeArch } from './dependencies.ts';
import type { PackageRecipe } from './types.ts';
import { formatDebianVersion } from './version.ts';

export interface SplitResult {
  recipe: PackageRecipe;
  stageDir: string;
}

export function getSubpackageNames(recipe: Pick<Partial<PackageRecipe>, 'subpackages'> & { name?: string }): string[] {
  return Object.entries(recipe.subpackages ?? {}).map(([key, def]) => {
    if (typeof def === 'object' && def?.name) {
      return def.name;
    }
    const defStr = def as unknown as string;
    if (defStr === 'auto:dev') {
      return recipe.name ? `${recipe.name}-dev` : `${key}-dev`;
    }
    if (defStr === 'auto:doc') {
      return recipe.name ? `${recipe.name}-doc` : `${key}-doc`;
    }
    return key;
  });
}

/** Clean up empty parent directories left behind after moving files */
function removeEmptyParentDirs(dir: string, baseDir: string): void {
  let curr = dir;
  while (curr !== baseDir && curr.startsWith(baseDir)) {
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

interface CompiledPattern {
  clean: string;
  glob: Bun.Glob;
  prefixMatch?: string;
  dirMatch?: string;
}

function compilePatterns(patterns: string[]): CompiledPattern[] {
  return patterns.map((pat) => {
    let clean = pat.startsWith('/') ? pat.slice(1) : pat;
    if (clean.startsWith('data/data/com.termux/files/usr/')) {
      clean = clean.slice('data/data/com.termux/files/usr/'.length);
    } else if (clean.startsWith('usr/')) {
      clean = clean.slice('usr/'.length);
    }
    let prefixMatch: string | undefined;
    let dirMatch: string | undefined;
    if (clean.endsWith('/**')) {
      prefixMatch = clean.slice(0, -3);
    } else if (clean.endsWith('/')) {
      dirMatch = clean;
    }
    return {
      clean,
      glob: new Bun.Glob(clean),
      prefixMatch,
      dirMatch,
    };
  });
}

/** Matches a relative path against an array of compiled patterns (globs or subpaths). */
function matchPatterns(relPath: string, patterns: CompiledPattern[]): boolean {
  for (const p of patterns) {
    if (p.glob.match(relPath)) {
      return true;
    }
    if (p.prefixMatch !== undefined) {
      if (relPath === p.prefixMatch || relPath.startsWith(p.prefixMatch + '/')) {
        return true;
      }
    } else if (p.dirMatch !== undefined) {
      if (relPath.startsWith(p.dirMatch) || relPath === p.dirMatch.slice(0, -1)) {
        return true;
      }
    }
  }
  return false;
}

export function copyTreePreservingLinks(src: string, dest: string): void {
  mkdirSync(dest, { recursive: true });
  const seenInodes = new Map<string, string>(); // dev:ino -> destPath

  const copyDir = (srcDir: string, destDir: string): void => {
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);

      if (entry.isDirectory()) {
        mkdirSync(destPath, { recursive: true });
        copyDir(srcPath, destPath);
      } else if (entry.isSymbolicLink()) {
        const target = readlinkSync(srcPath);
        symlinkSync(target, destPath);
      } else {
        const stat = statSync(srcPath);
        if (stat.nlink > 1) {
          const key = `${stat.dev}:${stat.ino}`;
          if (seenInodes.has(key)) {
            try {
              linkSync(seenInodes.get(key)!, destPath);
            } catch {
              copyFileSync(srcPath, destPath);
            }
          } else {
            copyFileSync(srcPath, destPath);
            seenInodes.set(key, destPath);
          }
        } else {
          copyFileSync(srcPath, destPath);
        }
      }
    }
  };

  copyDir(src, dest);
}

export function splitSubpackages(
  parentRecipe: PackageRecipe,
  parentStageOrDest: string,
  destdir?: string,
  targetArch?: string,
  copyTreeFn: (src: string, dest: string) => void = copyTreePreservingLinks,
): SplitResult[] {
  let actualStageDir = parentStageOrDest;
  let actualDestDir = destdir || parentStageOrDest;

  if (!destdir) {
    if (existsSync(join(parentStageOrDest, 'stage'))) {
      actualStageDir = join(parentStageOrDest, 'stage');
      actualDestDir = parentStageOrDest;
    } else {
      actualStageDir = parentStageOrDest;
      actualDestDir = dirname(parentStageOrDest);
    }
  }

  const effectiveTargetArch = targetArch || parentRecipe.arch || 'aarch64';
  const normTarget = effectiveTargetArch === 'all' ? 'all' : normalizeArch(effectiveTargetArch);
  const CANONICAL_ARCHES = new Set(['aarch64', 'arm', 'x86_64', 'i686', 'all']);
  if (parentRecipe.subpackages) {
    for (const [subKey, subDef] of Object.entries(parentRecipe.subpackages)) {
      if (typeof subDef === 'object' && subDef) {
        const subName = subDef.name || subKey;
        const rawSubArch = subDef.arch || (parentRecipe.arch === 'all' ? 'all' : effectiveTargetArch);
        const subArch = rawSubArch === 'all' ? 'all' : normalizeArch(rawSubArch);
        if (!CANONICAL_ARCHES.has(subArch)) {
          throw new Error(`Unsupported architecture '${rawSubArch}' for subpackage '${subName}'`);
        }
        if (subArch !== 'all' && normTarget !== 'all' && subArch !== normTarget) {
          throw new Error(
            `Subpackage '${subName}' declares architecture '${rawSubArch}', which does not match compiled target architecture '${effectiveTargetArch}'.`,
          );
        }
      }
    }
  }

  const compiledStageDir = join(actualDestDir, '.stage_compiled');

  const restoreFromSnapshot = (): void => {
    if (!existsSync(compiledStageDir)) {
      return;
    }
    const tmpRestore = join(actualDestDir, `.stage_restore.tmp-${Date.now()}`);
    rmSync(tmpRestore, { recursive: true, force: true });
    let restored = false;
    try {
      copyTreeFn(compiledStageDir, tmpRestore);
      rmSync(actualStageDir, { recursive: true, force: true });
      renameSync(tmpRestore, actualStageDir);
      restored = true;
    } finally {
      if (!restored && existsSync(tmpRestore)) {
        rmSync(tmpRestore, { recursive: true, force: true });
      }
    }
  };

  if (!parentRecipe.subpackages || Object.keys(parentRecipe.subpackages).length === 0) {
    if (existsSync(compiledStageDir)) {
      restoreFromSnapshot();
    }
    if (existsSync(actualDestDir)) {
      for (const ent of readdirSync(actualDestDir)) {
        const full = join(actualDestDir, ent);
        if (ent.startsWith('stage_') && full !== actualStageDir) {
          rmSync(full, { recursive: true, force: true });
        }
      }
    }
    return [];
  }

  const results: SplitResult[] = [];

  if (existsSync(compiledStageDir)) {
    restoreFromSnapshot();
  } else if (existsSync(actualStageDir)) {
    const tmpSnapshot = join(actualDestDir, `.stage_compiled.tmp-${Date.now()}`);
    rmSync(tmpSnapshot, { recursive: true, force: true });
    let renameSucceeded = false;
    try {
      copyTreeFn(actualStageDir, tmpSnapshot);
      renameSync(tmpSnapshot, compiledStageDir);
      renameSucceeded = true;
    } finally {
      if (!renameSucceeded && existsSync(tmpSnapshot)) {
        rmSync(tmpSnapshot, { recursive: true, force: true });
      }
    }
  }

  if (existsSync(actualDestDir)) {
    for (const ent of readdirSync(actualDestDir)) {
      const full = join(actualDestDir, ent);
      if (ent.startsWith('stage_') && full !== actualStageDir) {
        rmSync(full, { recursive: true, force: true });
      }
    }
  }

  const basePrefix = join(actualStageDir, 'data', 'data', 'com.termux', 'files', 'usr');
  const searchRoot = existsSync(basePrefix) ? basePrefix : actualStageDir;

  const subpackageEntries = Object.entries(parentRecipe.subpackages).map(([subKey, subDef]) => ({
    subKey,
    subDef,
    subName: subDef.name || subKey,
    compiledPatterns: compilePatterns(subDef.include),
    subStageDir: join(actualDestDir, `stage_${subDef.name || subKey}`),
    matchedFiles: [] as string[],
  }));

  for (const entry of subpackageEntries) {
    mkdirSync(entry.subStageDir, { recursive: true });
  }

  // Scan searchRoot once and assign each file to the first matching subpackage (first-wins)
  if (existsSync(searchRoot)) {
    const glob = new Bun.Glob('**/*');
    for (const rel of glob.scanSync({ cwd: searchRoot, dot: true, onlyFiles: false })) {
      const fullPath = join(searchRoot, rel);
      try {
        const lstat = lstatSync(fullPath);
        if (lstat.isFile() || lstat.isSymbolicLink()) {
          for (const sub of subpackageEntries) {
            if (matchPatterns(rel, sub.compiledPatterns)) {
              sub.matchedFiles.push(rel);
              break; // First-wins ownership order
            }
          }
        }
      } catch {}
    }
  }

  for (const { subDef, subName, subStageDir, matchedFiles } of subpackageEntries) {
    // Move matched files to subStageDir
    for (const rel of matchedFiles) {
      const srcFile = join(searchRoot, rel);
      const targetRel = relative(actualStageDir, srcFile);
      const destFile = join(subStageDir, targetRel);
      mkdirSync(dirname(destFile), { recursive: true });
      renameSync(srcFile, destFile);
      removeEmptyParentDirs(dirname(srcFile), actualStageDir);
    }

    // Wire dependencies
    const subDeps = [...(subDef.deps || [])];
    const parentVer = formatDebianVersion(parentRecipe);
    const parentDepMode = subDef.parent_dep || 'exact';

    if (parentDepMode === 'exact') {
      const depClause = `${parentRecipe.name} (= ${parentVer})`;
      const filtered = subDeps.filter((d) => d !== parentRecipe.name && d !== depClause);
      filtered.unshift(depClause);
      subDeps.length = 0;
      subDeps.push(...filtered);
    } else if (parentDepMode === 'same-version') {
      const depClause = `${parentRecipe.name} (>= ${parentVer})`;
      const filtered = subDeps.filter((d) => d !== parentRecipe.name && d !== depClause);
      filtered.unshift(depClause);
      subDeps.length = 0;
      subDeps.push(...filtered);
    } else if (parentDepMode !== 'none' && typeof parentDepMode === 'string') {
      subDeps.unshift(parentDepMode);
    }

    const rawSubArch = subDef.arch || (parentRecipe.arch === 'all' ? 'all' : effectiveTargetArch);
    const subArch = rawSubArch === 'all' ? 'all' : normalizeArch(rawSubArch);
    if (!CANONICAL_ARCHES.has(subArch)) {
      throw new Error(`Unsupported architecture '${rawSubArch}' for subpackage '${subName}'`);
    }

    const subRecipe: PackageRecipe = {
      name: subName,
      version: parentRecipe.version,
      epoch: parentRecipe.epoch,
      revision: parentRecipe.revision,
      arch: subArch,
      arches: subDef.arch === 'all' ? ['all'] : parentRecipe.arches,
      description: subDef.description || `${subName} subpackage for ${parentRecipe.name}`,
      license: parentRecipe.license,
      homepage: parentRecipe.homepage,
      maintainer: parentRecipe.maintainer,
      uploaders: parentRecipe.uploaders,
      component: parentRecipe.component,
      build_system: parentRecipe.build_system,
      source: parentRecipe.source,
      sha256: parentRecipe.sha256,
      formats: [...parentRecipe.formats],
      build_deps: [],
      deps: subDeps,
      recommends: subDef.recommends ? [...subDef.recommends] : [],
      suggests: subDef.suggests ? [...subDef.suggests] : [],
      conflicts: subDef.conflicts ? [...subDef.conflicts] : [],
      provides: subDef.provides ? [...subDef.provides] : [],
      replaces: subDef.replaces ? [...subDef.replaces] : [],
      breaks: [],
      enhances: [],
      resources: parentRecipe.resources,
      heavy_build: false,
      cache: parentRecipe.cache,
      auto_update: false,
      update_strategy: null,
      custom_update_cmd: null,
      patches: [],
      cflags: null,
      cxxflags: null,
      ldflags: null,
      phases: {},
      vars: {},
      env: {},
      toolchains: {},
      state_hash: parentRecipe.state_hash,
    };

    results.push({ recipe: subRecipe, stageDir: subStageDir });
  }

  return results;
}
