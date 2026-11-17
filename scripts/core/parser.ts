import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { PackageRecipe, RecipeDefinition, ResourceConfig, SubpackageDefinition } from './types.ts';

function canonicalJson(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(canonicalJson).join(',') + ']';
  }
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  const entries = keys.map((k) => `${JSON.stringify(k)}:${canonicalJson((obj as Record<string, unknown>)[k])}`);
  return '{' + entries.join(',') + '}';
}

export function computeStateHash(recipe: PackageRecipe, pkgDir?: string): string {
  const payload: Record<string, unknown> = {
    name: recipe.name,
    version: recipe.version,
    epoch: recipe.epoch,
    revision: recipe.revision,
    arch: recipe.arch,
    build_system: recipe.build_system,
    source: recipe.source,
    sha256: recipe.sha256,
    formats: [...(recipe.formats || [])].sort(),
    deps: [...(recipe.deps || [])].sort(),
    recommends: [...(recipe.recommends || [])].sort(),
    suggests: [...(recipe.suggests || [])].sort(),
    conflicts: [...(recipe.conflicts || [])].sort(),
    provides: [...(recipe.provides || [])].sort(),
    replaces: [...(recipe.replaces || [])].sort(),
    breaks: [...(recipe.breaks || [])].sort(),
    enhances: [...(recipe.enhances || [])].sort(),
    ...(recipe.subpackages ? { subpackages: Object.entries(recipe.subpackages) } : {}),
    maintainer_scripts: recipe.maintainer_scripts || null,
    patches: recipe.patches ? [...recipe.patches] : [],
    cflags: recipe.cflags,
    cxxflags: recipe.cxxflags,
    ldflags: recipe.ldflags,
    phases: recipe.phases,
    vars: recipe.vars,
    env: recipe.env,
    toolchains: recipe.toolchains,
    ndk: recipe.ndk,
  };

  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(canonicalJson(payload));

  if (pkgDir && existsSync(pkgDir) && statSync(pkgDir).isDirectory()) {
    const glob = new Bun.Glob('**/*');
    const files: string[] = [];
    for (const rel of glob.scanSync({ cwd: pkgDir, dot: true })) {
      if (rel !== 'recipe.ts' && rel !== 'pkg.yml') {
        const full = join(pkgDir, rel);
        if (statSync(full).isFile()) {
          files.push(rel);
        }
      }
    }

    files.sort();
    for (const rel of files) {
      hasher.update(rel);
      hasher.update(readFileSync(join(pkgDir, rel)));
    }
  }

  return hasher.digest('hex').slice(0, 16);
}

export function parseRecipe(recipePath: string): PackageRecipe {
  let p = resolve(recipePath);
  if (existsSync(p) && statSync(p).isDirectory()) {
    p = join(p, 'recipe.ts');
  } else if (!p.endsWith('.ts')) {
    if (existsSync(join(p, 'recipe.ts'))) {
      p = join(p, 'recipe.ts');
    } else if (existsSync(join(dirname(p), 'recipe.ts'))) {
      p = join(dirname(p), 'recipe.ts');
    }
  }

  if (!existsSync(p)) {
    throw new Error(`Recipe file not found: ${p}`);
  }

  const pkgDir = dirname(p);
  // Clear require cache for dynamic reloads if necessary
  delete require.cache[p];
  const mod = require(p);
  const rawData: RecipeDefinition = (mod.default || mod) as RecipeDefinition;

  if (!rawData || typeof rawData !== 'object') {
    throw new Error(`Invalid recipe export in ${p}: expected default export or object.`);
  }

  return normalizeRecipe(rawData, pkgDir);
}

export function normalizeRecipe(rawData: RecipeDefinition, pkgDir?: string): PackageRecipe {
  if (!rawData || typeof rawData !== 'object') {
    throw new Error('Invalid recipe definition: expected default export or object.');
  }

  const isHeavy = Boolean(rawData.heavy_build ?? false);
  const resources: ResourceConfig = {
    zram: rawData.resources?.zram !== undefined ? Number(rawData.resources.zram) : isHeavy ? 4 : 0,
    swap: rawData.resources?.swap !== undefined ? Number(rawData.resources.swap) : isHeavy ? 8 : 0,
    free_space: rawData.resources?.free_space !== undefined ? Boolean(rawData.resources.free_space) : isHeavy,
    tmpfs: Math.max(0, Math.min(6, Number(rawData.resources?.tmpfs ?? (isHeavy ? 6 : 4)))),
  };

  const rawArch = rawData.arch;
  let resolvedArches: string[];
  if (Array.isArray(rawArch)) {
    resolvedArches = rawArch.map((s) => String(s).trim()).filter(Boolean);
  } else if (typeof rawArch === 'string') {
    if (rawArch === 'any') {
      resolvedArches = ['aarch64', 'arm', 'x86_64', 'i686'];
    } else if (rawArch.includes(',') || rawArch.includes(' ')) {
      resolvedArches = rawArch
        .split(/[,\s]+/)
        .map((s) => s.trim())
        .filter(Boolean);
    } else {
      resolvedArches = [rawArch.trim() || 'aarch64'];
    }
  } else {
    resolvedArches = ['aarch64'];
  }
  const primaryArch = resolvedArches[0] || 'aarch64';

  const baseRecipe: PackageRecipe = {
    name: String(rawData.name || ''),
    version: String(rawData.version || ''),
    epoch: Number(rawData.epoch ?? 0),
    revision: Number(rawData.revision ?? 0),
    arch: primaryArch,
    arches: resolvedArches,
    description: String(rawData.description || ''),
    license: String(rawData.license || 'MIT'),
    homepage: String(rawData.homepage || ''),
    maintainer: String(rawData.maintainer || 'SjnExe'),
    uploaders: Array.isArray(rawData.uploaders)
      ? rawData.uploaders.map(String)
      : typeof rawData.uploaders === 'string'
        ? rawData.uploaders
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        : [],
    component: String(rawData.component || 'main'),
    build_system: String(rawData.build_system || 'custom'),
    source: rawData.source ? String(rawData.source) : null,
    sha256: rawData.sha256 ? String(rawData.sha256) : null,
    formats: Array.isArray(rawData.formats) ? rawData.formats : ['apt'],
    build_deps: Array.isArray(rawData.build_deps) ? rawData.build_deps : [],
    deps: Array.isArray(rawData.deps) ? rawData.deps : [],
    recommends: Array.isArray(rawData.recommends) ? rawData.recommends : [],
    suggests: Array.isArray(rawData.suggests) ? rawData.suggests : [],
    conflicts: Array.isArray(rawData.conflicts) ? rawData.conflicts : [],
    provides: Array.isArray(rawData.provides) ? rawData.provides : [],
    replaces: Array.isArray(rawData.replaces) ? rawData.replaces : [],
    breaks: Array.isArray(rawData.breaks) ? rawData.breaks : [],
    enhances: Array.isArray(rawData.enhances) ? rawData.enhances : [],
    subpackages: undefined,
    maintainer_scripts:
      rawData.maintainer_scripts && typeof rawData.maintainer_scripts === 'object'
        ? rawData.maintainer_scripts
        : undefined,
    resources,
    heavy_build: Boolean(rawData.heavy_build ?? false),
    cache: Boolean(rawData.cache ?? false),
    auto_update: Boolean(rawData.auto_update ?? false),
    update_strategy: rawData.update_strategy ? String(rawData.update_strategy) : null,
    custom_update_cmd: rawData.custom_update_cmd ? String(rawData.custom_update_cmd) : null,
    patches: Array.isArray(rawData.patches) ? rawData.patches : [],
    cflags: rawData.cflags ? String(rawData.cflags) : null,
    cxxflags: rawData.cxxflags ? String(rawData.cxxflags) : null,
    ldflags: rawData.ldflags ? String(rawData.ldflags) : null,
    phases: rawData.phases && typeof rawData.phases === 'object' ? rawData.phases : {},
    vars: rawData.vars && typeof rawData.vars === 'object' ? rawData.vars : {},
    env: rawData.env && typeof rawData.env === 'object' ? rawData.env : {},
    toolchains: rawData.toolchains && typeof rawData.toolchains === 'object' ? rawData.toolchains : {},
    state_hash: '',
    ndk: rawData.ndk,
  };

  if (baseRecipe.ndk && baseRecipe.ndk !== '30' && baseRecipe.ndk !== '23c') {
    throw new Error(`Unsupported NDK version: ${baseRecipe.ndk}. Supported versions: '30', '23c'.`);
  }

  if (rawData.subpackages) {
    const normSubpkgs: Record<string, SubpackageDefinition> = Object.create(null);
    if (Array.isArray(rawData.subpackages)) {
      for (const item of rawData.subpackages) {
        if (item === 'auto:dev') {
          const key = `${baseRecipe.name}-dev`;
          normSubpkgs[key] = {
            name: key,
            description: `${baseRecipe.name} development files`,
            include: ['include/**', 'lib/pkgconfig/**', 'lib/*.a', 'share/pkgconfig/**'],
            deps: [],
            parent_dep: 'exact',
          };
        } else if (item === 'auto:doc') {
          const key = `${baseRecipe.name}-doc`;
          normSubpkgs[key] = {
            name: key,
            description: `${baseRecipe.name} documentation`,
            arch: 'all',
            include: ['share/doc/**', 'share/man/**', 'share/info/**'],
            deps: [],
            parent_dep: 'exact',
          };
        } else if (item && typeof item === 'object' && item.name) {
          const filesAlias = (item as { files?: string[] }).files;
          normSubpkgs[item.name] = {
            ...item,
            include: Array.isArray(item.include) ? item.include : Array.isArray(filesAlias) ? filesAlias : [],
            deps: Array.isArray(item.deps) ? item.deps : [],
            parent_dep: item.parent_dep || 'exact',
          };
        } else {
          throw new Error(
            `Invalid subpackage entry in ${baseRecipe.name}: expected 'auto:dev', 'auto:doc', or object with 'name'.`,
          );
        }
      }
    } else if (typeof rawData.subpackages === 'object') {
      for (const [key, val] of Object.entries(rawData.subpackages)) {
        if (val === 'auto:dev') {
          normSubpkgs[key] = {
            name: `${baseRecipe.name}-dev`,
            description: `${baseRecipe.name} development files`,
            include: ['include/**', 'lib/pkgconfig/**', 'lib/*.a', 'share/pkgconfig/**'],
            deps: [],
            parent_dep: 'exact',
          };
        } else if (val === 'auto:doc') {
          normSubpkgs[key] = {
            name: `${baseRecipe.name}-doc`,
            description: `${baseRecipe.name} documentation`,
            arch: 'all',
            include: ['share/doc/**', 'share/man/**', 'share/info/**'],
            deps: [],
            parent_dep: 'exact',
          };
        } else if (val && typeof val === 'object') {
          normSubpkgs[key] = {
            name: (val as SubpackageDefinition).name || key,
            description: (val as SubpackageDefinition).description || `${key} subpackage for ${baseRecipe.name}`,
            arch: (val as SubpackageDefinition).arch,
            include: Array.isArray((val as SubpackageDefinition).include) ? (val as SubpackageDefinition).include : [],
            deps: Array.isArray((val as SubpackageDefinition).deps) ? (val as SubpackageDefinition).deps : [],
            parent_dep: (val as SubpackageDefinition).parent_dep || 'exact',
            recommends: Array.isArray((val as SubpackageDefinition).recommends)
              ? (val as SubpackageDefinition).recommends
              : [],
            suggests: Array.isArray((val as SubpackageDefinition).suggests)
              ? (val as SubpackageDefinition).suggests
              : [],
            conflicts: Array.isArray((val as SubpackageDefinition).conflicts)
              ? (val as SubpackageDefinition).conflicts
              : [],
            provides: Array.isArray((val as SubpackageDefinition).provides)
              ? (val as SubpackageDefinition).provides
              : [],
            replaces: Array.isArray((val as SubpackageDefinition).replaces)
              ? (val as SubpackageDefinition).replaces
              : [],
          };
        } else {
          throw new Error(
            `Invalid subpackage '${key}' in ${baseRecipe.name}: expected 'auto:dev', 'auto:doc', or an object with 'include'.`,
          );
        }
      }
    }
    const emittedNames = new Set<string>();
    const debPkgNameRegex = /^[a-z0-9][a-z0-9+.-]+$/;
    for (const sub of Object.values(normSubpkgs)) {
      const sName = sub.name || '';
      if (!debPkgNameRegex.test(sName)) {
        throw new Error(
          `Invalid subpackage name '${sName}' in ${baseRecipe.name}: must match Debian package naming rules (lowercase letters, numbers, plus, minus, dots).`,
        );
      }
      if (sName === baseRecipe.name || emittedNames.has(sName)) {
        throw new Error(
          `Subpackage name '${sName}' in ${baseRecipe.name} collides with the parent or another subpackage.`,
        );
      }
      emittedNames.add(sName);
    }
    baseRecipe.subpackages = normSubpkgs;
  }

  const verStr = String(baseRecipe.version);
  const epochStr = String(baseRecipe.epoch);

  if (baseRecipe.source) {
    baseRecipe.source = baseRecipe.source.replace(/{version}/g, verStr).replace(/{epoch}/g, epochStr);
  }

  if (baseRecipe.vars) {
    const newVars: Record<string, string> = {};
    for (const [k, v] of Object.entries(baseRecipe.vars)) {
      newVars[k] = String(v)
        .replace(/{version}/g, verStr)
        .replace(/{epoch}/g, epochStr);
    }
    baseRecipe.vars = newVars;
  }

  baseRecipe.state_hash = computeStateHash(baseRecipe, pkgDir);

  return baseRecipe;
}
