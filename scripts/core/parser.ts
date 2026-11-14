import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import type { ChannelOverride, PackageRecipe, RecipeDefinition, ResourceConfig } from './types.ts';

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
    formats: [...recipe.formats].sort(),
    deps: [...recipe.deps].sort(),
    recommends: [...recipe.recommends].sort(),
    suggests: [...recipe.suggests].sort(),
    conflicts: [...recipe.conflicts].sort(),
    provides: [...recipe.provides].sort(),
    replaces: [...recipe.replaces].sort(),
    breaks: [...(recipe.breaks || [])].sort(),
    enhances: [...(recipe.enhances || [])].sort(),
    maintainer_scripts: recipe.maintainer_scripts || null,
    patches: recipe.patches,
    cflags: recipe.cflags,
    cxxflags: recipe.cxxflags,
    ldflags: recipe.ldflags,
    phases: recipe.phases,
    vars: recipe.vars,
    env: recipe.env,
    channel: recipe.active_channel,
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

export function parseRecipe(recipePath: string, channel: string = 'latest'): PackageRecipe {
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

  const resources: ResourceConfig = {
    zram: Number(rawData.resources?.zram ?? 0),
    swap: Number(rawData.resources?.swap ?? 0),
    free_space: Boolean(rawData.resources?.free_space ?? false),
    tmpfs: Math.max(0, Math.min(12, Number(rawData.resources?.tmpfs ?? 12))),
  };

  const channels: Record<string, ChannelOverride> = rawData.channels || {};

  const baseRecipe: PackageRecipe = {
    name: String(rawData.name || ''),
    version: String(rawData.version || ''),
    epoch: Number(rawData.epoch ?? 0),
    revision: Number(rawData.revision ?? 0),
    arch: String(rawData.arch || 'aarch64'),
    description: String(rawData.description || ''),
    license: String(rawData.license || 'MIT'),
    homepage: String(rawData.homepage || ''),
    maintainer: String(rawData.maintainer || 'SjnExe'),
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
    maintainer_scripts:
      rawData.maintainer_scripts && typeof rawData.maintainer_scripts === 'object'
        ? rawData.maintainer_scripts
        : undefined,
    resources,
    heavy_build: Boolean(rawData.heavy_build ?? false),
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
    channels,
    active_channel: channel,
    state_hash: '',
    ndk: rawData.ndk,
  };

  if (baseRecipe.ndk && baseRecipe.ndk !== '30' && baseRecipe.ndk !== '23c') {
    throw new Error(`Unsupported NDK version: ${baseRecipe.ndk}. Supported versions: '30', '23c'.`);
  }

  // Apply channel override if present
  if (channel in baseRecipe.channels) {
    const override = baseRecipe.channels[channel];
    Object.assign(baseRecipe, override);
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

  baseRecipe.active_channel = channel;
  baseRecipe.state_hash = computeStateHash(baseRecipe, pkgDir);

  return baseRecipe;
}
