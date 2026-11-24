import {
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readlinkSync,
  readSync,
  realpathSync,
  rmdirSync,
  rmSync,
  statSync,
  symlinkSync,
} from 'node:fs';
import { dirname, join, relative } from 'node:path';

import { safeRenameSync } from './compat.ts';
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
    if (defStr === 'auto:static') {
      return recipe.name ? `${recipe.name}-static` : `${key}-static`;
    }
    return key;
  });
}

export function ensureTreeRemovable(dir: string): void {
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    return;
  }
  if (!st.isDirectory()) {
    return;
  }
  try {
    chmodSync(dir, 0o700);
  } catch {}
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.isDirectory() && !ent.isSymbolicLink()) {
      ensureTreeRemovable(join(dir, ent.name));
    }
  }
}

/** Clean up empty parent directories left behind after moving files */
function removeEmptyParentDirs(dir: string, baseDir: string): void {
  let curr = dir;
  while (curr !== baseDir && !relative(baseDir, curr).startsWith('..')) {
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
  const rootStat = statSync(src);
  mkdirSync(dest, { recursive: true });
  const seenInodes = new Map<string, string>(); // dev:ino -> destPath

  const copyDir = (srcDir: string, destDir: string): void => {
    const entries = readdirSync(srcDir, { withFileTypes: true });
    for (const entry of entries) {
      const srcPath = join(srcDir, entry.name);
      const destPath = join(destDir, entry.name);

      if (entry.isDirectory()) {
        const dirStat = statSync(srcPath);
        mkdirSync(destPath, { recursive: true });
        copyDir(srcPath, destPath);
        try {
          chmodSync(destPath, dirStat.mode & 0o7777);
        } catch {}
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
  try {
    chmodSync(dest, rootStat.mode & 0o7777);
  } catch {}
}

export function resolveChildProducerArch(
  parentRecipe: { arch?: string; arches?: string[] },
  subDef?: { arch?: string; producer_arch?: string },
): string {
  if (subDef?.producer_arch) {
    return normalizeArch(subDef.producer_arch);
  }
  if (parentRecipe.arch === 'all') {
    return 'all';
  }
  const normArches =
    parentRecipe.arches && parentRecipe.arches.length > 0
      ? parentRecipe.arches.map(normalizeArch)
      : [normalizeArch(parentRecipe.arch || 'aarch64')];
  if (normArches.includes('all')) {
    return 'all';
  }
  return normArches.includes('aarch64') ? 'aarch64' : normArches[0];
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
      ensureTreeRemovable(actualStageDir);
      rmSync(actualStageDir, { recursive: true, force: true });
      safeRenameSync(tmpRestore, actualStageDir);
      restored = true;
    } finally {
      if (!restored && existsSync(tmpRestore)) {
        ensureTreeRemovable(tmpRestore);
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
          ensureTreeRemovable(full);
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
      safeRenameSync(tmpSnapshot, compiledStageDir);
      renameSucceeded = true;
    } finally {
      if (!renameSucceeded && existsSync(tmpSnapshot)) {
        ensureTreeRemovable(tmpSnapshot);
        rmSync(tmpSnapshot, { recursive: true, force: true });
      }
    }
  }

  if (existsSync(actualDestDir)) {
    for (const ent of readdirSync(actualDestDir)) {
      const full = join(actualDestDir, ent);
      if (ent.startsWith('stage_') && full !== actualStageDir) {
        ensureTreeRemovable(full);
        rmSync(full, { recursive: true, force: true });
      }
    }
  }

  const basePrefix = join(actualStageDir, 'data', 'data', 'com.termux', 'files', 'usr');
  let searchRoot = actualStageDir;
  if (existsSync(basePrefix)) {
    try {
      const realBase = realpathSync(basePrefix);
      const realStage = realpathSync(actualStageDir);
      if (realBase.startsWith(realStage + '/') || realBase === realStage) {
        searchRoot = basePrefix;
      }
    } catch {
      searchRoot = actualStageDir;
    }
  }

  const subpackageEntries = Object.entries(parentRecipe.subpackages).map(([subKey, subDef]) => ({
    subKey,
    subDef,
    subName: subDef.name || subKey,
    compiledPatterns: compilePatterns(subDef.include || subDef.files || []),
    subStageDir: join(actualDestDir, `stage_${subDef.name || subKey}`),
    matchedFiles: [] as string[],
  }));

  for (const entry of subpackageEntries) {
    mkdirSync(entry.subStageDir, { recursive: true });
    chmodSync(entry.subStageDir, 0o755);
  }

  // Scan searchRoot once and assign each file to the first matching subpackage (first-wins)
  if (existsSync(searchRoot)) {
    const glob = new Bun.Glob('**/*');
    const stagedRelPaths = Array.from(glob.scanSync({ cwd: searchRoot, dot: true, onlyFiles: false })).sort();
    for (const rel of stagedRelPaths) {
      const fullPath = join(searchRoot, rel);
      try {
        const lstat = lstatSync(fullPath);
        const isEmptyDir = lstat.isDirectory() && readdirSync(fullPath).length === 0;
        if (lstat.isFile() || lstat.isSymbolicLink() || isEmptyDir) {
          for (const sub of subpackageEntries) {
            if (matchPatterns(rel, sub.compiledPatterns)) {
              sub.matchedFiles.push(rel);
              break; // First-wins ownership order
            }
          }
        }
      } catch (err: unknown) {
        throw new Error(
          `Failed to inspect staged file '${fullPath}' during subpackage split: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  for (const { subDef, subName, subStageDir, matchedFiles } of subpackageEntries) {
    // Move matched files to subStageDir
    const affectedDirs = new Set<string>();
    const createdDirModes = new Map<string, number>();
    const originalSrcDirModes = new Map<string, number>();

    const makeDirWithSourceMode = (sDir: string, dDir: string): void => {
      if (!existsSync(dDir)) {
        makeDirWithSourceMode(dirname(sDir), dirname(dDir));
        mkdirSync(dDir, { recursive: true });
        try {
          const originalMode = originalSrcDirModes.get(sDir);
          const sStatMode = originalMode !== undefined ? originalMode : statSync(sDir).mode & 0o7777;
          createdDirModes.set(dDir, sStatMode);
        } catch {}
      }
    };

    // Ensure owner write permission on source directories before moving files
    for (const rel of matchedFiles) {
      const srcFile = join(searchRoot, rel);
      let curr = dirname(srcFile);
      while (curr !== actualStageDir && !relative(actualStageDir, curr).startsWith('..')) {
        if (!originalSrcDirModes.has(curr)) {
          try {
            const st = statSync(curr);
            const mode = st.mode & 0o7777;
            originalSrcDirModes.set(curr, mode);
            if ((mode & 0o200) === 0) {
              chmodSync(curr, mode | 0o200);
            }
          } catch {}
        }
        curr = dirname(curr);
      }
    }

    try {
      for (const rel of matchedFiles) {
        const srcFile = join(searchRoot, rel);
        const targetRel = relative(actualStageDir, srcFile);
        const destFile = join(subStageDir, targetRel);
        makeDirWithSourceMode(dirname(srcFile), dirname(destFile));
        safeRenameSync(srcFile, destFile);
        affectedDirs.add(dirname(srcFile));
      }
      for (const dir of Array.from(affectedDirs).sort((a, b) => b.length - a.length)) {
        removeEmptyParentDirs(dir, actualStageDir);
      }
    } finally {
      // Restore surviving modes deepest-first
      for (const [dir, mode] of Array.from(originalSrcDirModes.entries()).sort(([a], [b]) => b.length - a.length)) {
        try {
          if (existsSync(dir)) {
            chmodSync(dir, mode);
          }
        } catch {}
      }
    }
    const createdDirsSorted = Array.from(createdDirModes.keys()).sort((a, b) => b.length - a.length);
    for (const d of createdDirsSorted) {
      try {
        chmodSync(d, createdDirModes.get(d)!);
      } catch {}
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

    if (subArch === 'all') {
      const glob = new Bun.Glob('**/*');
      const files = Array.from(glob.scanSync({ cwd: subStageDir, dot: true, onlyFiles: true }));
      for (const rel of files) {
        const full = join(subStageDir, rel);
        try {
          const st = lstatSync(full);
          if (st.isFile()) {
            if (st.size >= 4) {
              const fd = openSync(full, 'r');
              try {
                const buf = Buffer.alloc(8);
                const bytesRead = readSync(fd, buf, 0, 8, 0);
                if (bytesRead >= 4 && buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46) {
                  throw new Error(
                    `Architecture-independent (all) subpackage '${subName}' contains native ELF binary '${rel}'.`,
                  );
                }
                if (bytesRead === 8 && buf.toString('ascii') === '!<arch>\n') {
                  const fileSize = st.size;
                  let currentOffset = 8;
                  const headerBuf = Buffer.alloc(60);
                  const magicBuf = Buffer.alloc(4);

                  while (currentOffset + 60 <= fileSize) {
                    const hRead = readSync(fd, headerBuf, 0, 60, currentOffset);
                    if (hRead < 60) {
                      break;
                    }
                    const name = headerBuf.subarray(0, 16).toString('ascii').trim();
                    const sizeStr = headerBuf.subarray(48, 58).toString('ascii').trim();
                    const memberSize = parseInt(sizeStr, 10);
                    if (isNaN(memberSize) || memberSize < 0) {
                      break;
                    }

                    const dataOffset = currentOffset + 60;
                    // Skip symbol index table ("/") and long-name table ("//"), BSD symbols ("__.SYMDEF")
                    const isSpecialTable =
                      name === '/' || name === '//' || name.startsWith('__.SYMDEF') || name.startsWith('#1/');
                    if (!isSpecialTable && memberSize >= 4) {
                      const mRead = readSync(fd, magicBuf, 0, 4, dataOffset);
                      if (
                        mRead === 4 &&
                        magicBuf[0] === 0x7f &&
                        magicBuf[1] === 0x45 &&
                        magicBuf[2] === 0x4c &&
                        magicBuf[3] === 0x46
                      ) {
                        throw new Error(
                          `Architecture-independent (all) subpackage '${subName}' contains native static library '${rel}'.`,
                        );
                      }
                    }

                    currentOffset = dataOffset + memberSize + (memberSize % 2);
                  }
                }
              } finally {
                closeSync(fd);
              }
            }
          }
        } catch (e: unknown) {
          if (
            e instanceof Error &&
            (e.message.includes('contains native ELF binary') || e.message.includes('contains native static library'))
          ) {
            throw e;
          }
          const reason = e instanceof Error ? e.message : String(e);
          throw new Error(
            `Cannot inspect '${rel}' in architecture-independent (all) subpackage '${subName}': ${reason}`,
          );
        }
      }
    }

    const designatedProducer = subArch === 'all' ? resolveChildProducerArch(parentRecipe, subDef) : undefined;

    const subRecipe: PackageRecipe = {
      name: subName,
      version: parentRecipe.version,
      epoch: parentRecipe.epoch,
      revision: parentRecipe.revision,
      arch: subArch,
      arches: subDef.arch === 'all' ? ['all'] : parentRecipe.arches,
      producer_arch: designatedProducer,
      multiarch: subDef.multiarch,
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
