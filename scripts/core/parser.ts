import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { CANONICAL_ARCHES, normalizeArch, parseDependencyList } from './dependencies.ts';
import type { PackageRecipe, RecipeDefinition, ResourceConfig, SubpackageDefinition } from './types.ts';

export class RecipeCollisionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecipeCollisionError';
  }
}

function validateProvidesList(provides: string[], ownerName: string, isArchAll = false): void {
  for (const item of provides) {
    if (typeof item !== 'string' || !item.trim()) {
      throw new Error(`Invalid provides entry in ${ownerName}: empty or blank capability is not permitted.`);
    }
  }
  const debPkgNameRegex = /^[a-z0-9][a-z0-9+.-]+$/;
  const clauses = parseDependencyList(provides);
  for (const clause of clauses) {
    if (clause.length > 1) {
      throw new Error(
        `Invalid Provides relationship '${clause.map((t) => t.name).join(' | ')}' in ${ownerName}: Debian policy does not permit alternatives ('|') in Provides.`,
      );
    }
    for (const token of clause) {
      const baseName = token.name.split(':')[0].trim();
      if (!debPkgNameRegex.test(baseName)) {
        throw new Error(
          `Invalid Provides relationship '${token.name}' in ${ownerName}: package name must match Debian package naming rules.`,
        );
      }
      if (isArchAll && token.architectures && token.architectures.length > 0) {
        throw new Error(
          `Package '${ownerName}' has architecture 'all' but declares architecture-restricted Provides '${token.name} [${token.architectures.join(' ')}]'.`,
        );
      }
      if (token.versionConstraint && token.versionConstraint.operator !== '=') {
        throw new Error(
          `Invalid Provides relationship '${token.name} (${token.versionConstraint.operator} ${token.versionConstraint.version})' in ${ownerName}: Debian policy permits only '=' in versioned Provides.`,
        );
      }
      if (token.versionConstraint) {
        if (!token.versionConstraint.version || !token.versionConstraint.version.trim()) {
          throw new Error(
            `Invalid Provides relationship '${token.name} (${token.versionConstraint.operator})' in ${ownerName}: a versioned Provides requires a version.`,
          );
        }
        const debVersionRegex = /^(?:[0-9]+:)?[0-9][a-zA-Z0-9.+:~-]*$/;
        if (!debVersionRegex.test(token.versionConstraint.version.trim())) {
          throw new Error(
            `Invalid Provides relationship '${token.name} (${token.versionConstraint.operator} ${token.versionConstraint.version})' in ${ownerName}: version must conform to Debian version syntax.`,
          );
        }
      }
    }
  }
}

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
    arches: recipe.arches ? [...recipe.arches] : [],
    build_system: recipe.build_system,
    source: recipe.source,
    sources: recipe.sources ? [...recipe.sources] : [],
    mirrors: recipe.mirrors ? [...recipe.mirrors] : [],
    sha256: recipe.sha256,
    formats: [...(recipe.formats || [])].sort(),
    build_deps: recipe.build_deps ? [...recipe.build_deps] : [],
    deps: [...(recipe.deps || [])].sort(),
    recommends: [...(recipe.recommends || [])].sort(),
    suggests: [...(recipe.suggests || [])].sort(),
    conflicts: [...(recipe.conflicts || [])].sort(),
    provides: [...(recipe.provides || [])].sort(),
    replaces: [...(recipe.replaces || [])].sort(),
    breaks: [...(recipe.breaks || [])].sort(),
    enhances: [...(recipe.enhances || [])].sort(),
    multiarch: recipe.multiarch,
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

  const canonicalizeArch = (s: string): string => {
    const trimmed = s.trim();
    if (!trimmed) {
      return '';
    }
    return trimmed.toLowerCase() === 'all' ? 'all' : normalizeArch(trimmed);
  };
  const rawArch = Array.isArray(rawData.arches) && rawData.arches.length > 0 ? rawData.arches : rawData.arch;
  let resolvedArches: string[];
  if (Array.isArray(rawArch)) {
    resolvedArches = rawArch.map((s) => canonicalizeArch(String(s))).filter(Boolean);
  } else if (typeof rawArch === 'string') {
    const trimmedRaw = rawArch.trim();
    if (trimmedRaw.toLowerCase() === 'any') {
      resolvedArches = ['aarch64', 'arm', 'x86_64', 'i686'];
    } else if (trimmedRaw.includes(',') || trimmedRaw.includes(' ')) {
      resolvedArches = trimmedRaw
        .split(/[,\s]+/)
        .map(canonicalizeArch)
        .filter(Boolean);
    } else {
      resolvedArches = [canonicalizeArch(trimmedRaw) || 'aarch64'];
    }
  } else {
    resolvedArches = ['aarch64'];
  }
  resolvedArches = Array.from(new Set(resolvedArches));
  if (resolvedArches.length === 0) {
    resolvedArches = ['aarch64'];
  }
  const allowedArches = new Set([...CANONICAL_ARCHES, 'all']);
  for (const a of resolvedArches) {
    if (!allowedArches.has(a)) {
      throw new Error(
        `Unsupported architecture '${a}' in recipe '${rawData.name || 'unnamed'}'. Supported architectures: ${Array.from(CANONICAL_ARCHES).join(', ')}, all.`,
      );
    }
  }
  if (resolvedArches.includes('all') && resolvedArches.length > 1) {
    throw new Error(
      `Invalid architecture configuration in recipe '${rawData.name || 'unnamed'}': cannot mix architecture 'all' with native architectures (${resolvedArches.filter((a) => a !== 'all').join(', ')}).`,
    );
  }
  const primaryArch = resolvedArches[0];

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
    source: rawData.source
      ? Array.isArray(rawData.source)
        ? rawData.source.length > 0
          ? String(rawData.source[0])
          : null
        : String(rawData.source)
      : null,
    sources: Array.isArray(rawData.sources)
      ? rawData.sources.map(String)
      : Array.isArray(rawData.source)
        ? rawData.source.map(String)
        : rawData.source
          ? [String(rawData.source)]
          : [],
    mirrors: Array.isArray(rawData.mirrors) ? rawData.mirrors.map(String) : [],
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
    multiarch: rawData.multiarch ? String(rawData.multiarch) : undefined,
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

  validateProvidesList(baseRecipe.provides, baseRecipe.name, baseRecipe.arch === 'all');

  if (rawData.subpackages) {
    const normSubpkgs: Record<string, SubpackageDefinition> = Object.create(null);

    const addSubpkg = (key: string, def: SubpackageDefinition): void => {
      const emittedName = def.name || key;
      if (normSubpkgs[key] || Object.values(normSubpkgs).some((existing) => (existing.name || '') === emittedName)) {
        throw new RecipeCollisionError(
          `Subpackage name '${emittedName}' in ${baseRecipe.name} collides with the parent or another subpackage.`,
        );
      }
      normSubpkgs[key] = def;
    };

    const normalizeSubpkgDef = (val: Partial<SubpackageDefinition>, key: string): SubpackageDefinition => {
      const sName = val.name || key;
      const filesAlias = (val as { files?: string[] }).files;
      if (val.include !== undefined && !Array.isArray(val.include)) {
        throw new Error(
          `Invalid include entry in subpackage '${sName}' for ${baseRecipe.name}: must be an array of strings, got ${typeof val.include}`,
        );
      }
      if (filesAlias !== undefined && !Array.isArray(filesAlias)) {
        throw new Error(
          `Invalid files entry in subpackage '${sName}' for ${baseRecipe.name}: must be an array of strings, got ${typeof filesAlias}`,
        );
      }
      const isAutoStatic = val.auto === 'static' || val.type === 'auto:static';
      const isAutoDev = val.auto === 'dev' || val.type === 'auto:dev';
      const isAutoDoc = val.auto === 'doc' || val.type === 'auto:doc';

      const rawInclude = Array.isArray(val.include)
        ? val.include
        : Array.isArray(filesAlias)
          ? filesAlias
          : isAutoStatic
            ? ['lib/*.a', 'lib/**/*.a']
            : isAutoDoc
              ? ['share/doc/**', 'share/man/**', 'share/info/**']
              : isAutoDev
                ? [
                    'include/**',
                    'lib/pkgconfig/**',
                    'share/pkgconfig/**',
                    'share/aclocal/**',
                    'share/cmake/**',
                    'lib/cmake/**',
                    'lib/*.a',
                  ]
                : [];
      const effectiveSubArch = isAutoDoc && !val.arch ? 'all' : val.arch;
      for (const inc of rawInclude) {
        if (typeof inc !== 'string') {
          throw new Error(
            `Invalid include entry in subpackage '${sName}' for ${baseRecipe.name}: must be a string, got ${typeof inc}`,
          );
        }
      }
      const toStringArray = (arr: unknown): string[] =>
        Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];

      let normProducerArch: string | undefined;
      if (val.producer_arch !== undefined) {
        if (typeof val.producer_arch !== 'string') {
          throw new Error(
            `Invalid producer_arch in subpackage '${sName}' for ${baseRecipe.name}: must be a string, got ${typeof val.producer_arch}`,
          );
        }
        const norm = normalizeArch(val.producer_arch);
        if (!CANONICAL_ARCHES.has(norm) || norm === 'all') {
          throw new Error(
            `Unsupported producer_arch '${val.producer_arch}' in subpackage '${sName}' for ${baseRecipe.name}. Must be a concrete architecture.`,
          );
        }
        const parentNormArches = resolvedArches.map(normalizeArch);
        if (parentNormArches.includes('all')) {
          throw new Error(
            `Declared producer_arch '${val.producer_arch}' in subpackage '${sName}' is invalid: parent recipe '${baseRecipe.name}' has architecture 'all' and cannot designate a native producer architecture.`,
          );
        }
        if (!parentNormArches.includes(norm)) {
          throw new Error(
            `Declared producer_arch '${val.producer_arch}' in subpackage '${sName}' is not in parent recipe architectures (${parentNormArches.join(', ')}).`,
          );
        }
        normProducerArch = norm;
      }

      return {
        name: sName,
        description: val.description || `${key} subpackage for ${baseRecipe.name}`,
        arch: effectiveSubArch,
        include: rawInclude,
        deps: toStringArray(val.deps),
        parent_dep: val.parent_dep || 'exact',
        recommends: toStringArray(val.recommends),
        suggests: toStringArray(val.suggests),
        conflicts: toStringArray(val.conflicts),
        provides: toStringArray(val.provides),
        replaces: toStringArray(val.replaces),
        producer_arch: normProducerArch,
        multiarch: val.multiarch
          ? String(val.multiarch)
          : (val as { multi_arch?: string }).multi_arch
            ? String((val as { multi_arch?: string }).multi_arch)
            : undefined,
      };
    };

    if (rawData.subpackages !== undefined && rawData.subpackages !== null) {
      if (Array.isArray(rawData.subpackages)) {
        for (const item of rawData.subpackages) {
          if (item === 'auto:dev') {
            const key = `${baseRecipe.name}-dev`;
            addSubpkg(key, {
              name: key,
              description: `${baseRecipe.name} development files`,
              include: [
                'include/**',
                'lib/pkgconfig/**',
                'share/pkgconfig/**',
                'share/aclocal/**',
                'share/cmake/**',
                'lib/cmake/**',
                'lib/*.a',
              ],
              deps: [],
              parent_dep: 'exact',
            });
          } else if (item === 'auto:doc') {
            const key = `${baseRecipe.name}-doc`;
            addSubpkg(key, {
              name: key,
              description: `${baseRecipe.name} documentation`,
              arch: 'all',
              include: ['share/doc/**', 'share/man/**', 'share/info/**'],
              deps: [],
              parent_dep: 'exact',
            });
          } else if (item === 'auto:static') {
            const key = `${baseRecipe.name}-static`;
            addSubpkg(key, {
              name: key,
              description: `${baseRecipe.name} static libraries`,
              include: ['lib/*.a', 'lib/**/*.a'],
              deps: [],
              parent_dep: 'exact',
            });
          } else if (item && typeof item === 'object' && item.name) {
            addSubpkg(item.name, normalizeSubpkgDef(item, item.name));
          } else {
            throw new Error(
              `Invalid subpackage entry in ${baseRecipe.name}: expected 'auto:dev', 'auto:doc', 'auto:static', or object with 'name'.`,
            );
          }
        }
      } else if (typeof rawData.subpackages === 'object') {
        for (const [key, val] of Object.entries(rawData.subpackages)) {
          if (val === 'auto:dev') {
            addSubpkg(key, {
              name: `${baseRecipe.name}-dev`,
              description: `${baseRecipe.name} development files`,
              include: [
                'include/**',
                'lib/pkgconfig/**',
                'share/pkgconfig/**',
                'share/aclocal/**',
                'share/cmake/**',
                'lib/cmake/**',
                'lib/*.a',
              ],
              deps: [],
              parent_dep: 'exact',
            });
          } else if (val === 'auto:doc') {
            addSubpkg(key, {
              name: `${baseRecipe.name}-doc`,
              description: `${baseRecipe.name} documentation`,
              arch: 'all',
              include: ['share/doc/**', 'share/man/**', 'share/info/**'],
              deps: [],
              parent_dep: 'exact',
            });
          } else if (val === 'auto:static') {
            addSubpkg(key, {
              name: `${baseRecipe.name}-static`,
              description: `${baseRecipe.name} static libraries`,
              include: ['lib/*.a', 'lib/**/*.a'],
              deps: [],
              parent_dep: 'exact',
            });
          } else if (val && typeof val === 'object' && !Array.isArray(val)) {
            addSubpkg(key, normalizeSubpkgDef(val as Partial<SubpackageDefinition>, key));
          } else {
            throw new Error(
              `Invalid subpackage '${key}' in ${baseRecipe.name}: expected 'auto:dev', 'auto:doc', 'auto:static', or an object with 'include'.`,
            );
          }
        }
      } else {
        throw new Error(
          `Invalid subpackages in ${baseRecipe.name}: expected an array (e.g. ['auto:dev', 'auto:doc', 'auto:static']) or a record mapping names to definitions, received ${typeof rawData.subpackages}.`,
        );
      }
    }
    const emittedNames = new Set<string>();
    const debPkgNameRegex = /^[a-z0-9][a-z0-9+.-]+$/;
    for (const sub of Object.values(normSubpkgs)) {
      if (typeof sub.name !== 'string' || !debPkgNameRegex.test(sub.name)) {
        throw new Error(
          `Invalid subpackage name '${String(sub.name)}' in ${baseRecipe.name}: must match Debian package naming rules (lowercase letters, numbers, plus, minus, dots).`,
        );
      }
      const sName = sub.name;
      if (sub.arch) {
        const normArch = sub.arch.toLowerCase() === 'all' ? 'all' : normalizeArch(sub.arch);
        if (!CANONICAL_ARCHES.has(normArch)) {
          throw new Error(`Unsupported architecture '${sub.arch}' for subpackage '${sName}' in ${baseRecipe.name}.`);
        }
        sub.arch = normArch;
        if (normArch !== 'all') {
          const parentArches =
            baseRecipe.arches && baseRecipe.arches.length > 0
              ? baseRecipe.arches.map(normalizeArch)
              : baseRecipe.arch && baseRecipe.arch !== 'all'
                ? Array.isArray(baseRecipe.arch)
                  ? baseRecipe.arch.map(normalizeArch)
                  : [normalizeArch(baseRecipe.arch)]
                : [];
          if (parentArches.length > 0 && !parentArches.every((pa) => pa === normArch)) {
            throw new Error(
              `Child subpackage '${sName}' declared architecture '${sub.arch}' which cannot pack on all parent targets [${parentArches.join(', ')}] in ${baseRecipe.name}.`,
            );
          }
        }
      }
      if (sName === baseRecipe.name || emittedNames.has(sName)) {
        throw new RecipeCollisionError(
          `Subpackage name '${sName}' in ${baseRecipe.name} collides with the parent or another subpackage.`,
        );
      }
      validateProvidesList(sub.provides || [], sName, (sub.arch || baseRecipe.arch) === 'all');
      emittedNames.add(sName);
    }
    baseRecipe.subpackages = normSubpkgs;
  }

  const verStr = String(baseRecipe.version);
  const epochStr = String(baseRecipe.epoch);

  if (baseRecipe.source) {
    baseRecipe.source = baseRecipe.source.replace(/{version}/g, verStr).replace(/{epoch}/g, epochStr);
  }

  if (baseRecipe.sources) {
    baseRecipe.sources = baseRecipe.sources.map((s: string): string =>
      s.replace(/{version}/g, verStr).replace(/{epoch}/g, epochStr),
    );
  }

  if (baseRecipe.mirrors) {
    baseRecipe.mirrors = baseRecipe.mirrors.map((m: string): string =>
      m.replace(/{version}/g, verStr).replace(/{epoch}/g, epochStr),
    );
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
