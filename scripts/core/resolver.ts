import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { parseDependencyList, extractAllPackageNames } from './dependencies.ts';

function interpolateValues(obj: any, ctx: Record<string, string>): any {
  if (typeof obj === 'string') {
    let res = obj;
    for (const [k, v] of Object.entries(ctx)) {
      res = res.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
    return res;
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateValues(item, ctx));
  }
  if (obj && typeof obj === 'object') {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      res[k] = interpolateValues(v, ctx);
    }
    return res;
  }
  return obj;
}

export function resolveChannelRecipe(
  rawRecipe: Record<string, any>,
  channelName: string = 'latest',
): Record<string, any> {
  const baseData = JSON.parse(JSON.stringify(rawRecipe));
  const channelsMap = baseData.channels || {};
  delete baseData.channels;

  const channelCfg = channelsMap[channelName] || {};
  const resolved = { ...baseData, channel: channelName };

  for (const [key, val] of Object.entries(channelCfg)) {
    if (val === undefined || val === null) continue;
    if (['deps', 'build_deps', 'patches', 'formats'].includes(key)) {
      resolved[key] = JSON.parse(JSON.stringify(val));
    } else if (key.startsWith('extra_')) {
      const targetKey = key.replace(/^extra_/, '');
      const existingList = Array.isArray(resolved[targetKey]) ? [...resolved[targetKey]] : [];
      if (Array.isArray(val)) {
        for (const item of val) {
          if (!existingList.includes(item)) existingList.push(item);
        }
      }
      resolved[targetKey] = existingList;
    } else if (typeof val === 'object' && !Array.isArray(val) && typeof resolved[key] === 'object') {
      resolved[key] = { ...resolved[key], ...JSON.parse(JSON.stringify(val)) };
    } else {
      resolved[key] = JSON.parse(JSON.stringify(val));
    }
  }

  const ctx: Record<string, string> = {
    name: String(resolved.name || ''),
    version: String(resolved.version || ''),
    revision: String(resolved.revision ?? 0),
    channel: String(channelName),
    arch: String(resolved.arch || 'aarch64'),
  };

  return interpolateValues(resolved, ctx);
}

export function applyChannelOverlay(recipe: any, channelName: string = 'latest'): any {
  const resolved = resolveChannelRecipe(recipe, channelName);
  Object.assign(recipe, resolved);
  return recipe;
}

export function computeChannelStateHash(resolvedRecipe: Record<string, any>, pkgDir?: string): string {
  const hashableDict: Record<string, any> = {
    name: resolvedRecipe.name,
    version: resolvedRecipe.version,
    revision: resolvedRecipe.revision,
    channel: resolvedRecipe.channel,
    arch: resolvedRecipe.arch,
    source: resolvedRecipe.source,
    build_deps: [...(resolvedRecipe.build_deps || [])].sort(),
    deps: [...(resolvedRecipe.deps || [])].sort(),
    phases: resolvedRecipe.phases || {},
    env: resolvedRecipe.env || {},
  };

  if (pkgDir && existsSync(pkgDir) && statSync(pkgDir).isDirectory()) {
    const parentDir = dirname(pkgDir);
    const depVersions: Record<string, string> = {};
    const rawDeps = [...(resolvedRecipe.deps || []), ...(resolvedRecipe.build_deps || [])];
    const cleanDepNames = extractAllPackageNames(parseDependencyList(rawDeps));

    for (const dep of cleanDepNames) {
      const depFile = resolve(join(parentDir, dep, 'recipe.ts'));
      if (existsSync(depFile)) {
        try {
          delete require.cache[depFile];
          const mod = require(depFile);
          const r = mod.default || mod;
          if (r && r.version) {
            depVersions[dep] = `${r.version}-${r.revision ?? 0}`;
          }
        } catch {}
      }
    }
    if (Object.keys(depVersions).length > 0) {
      hashableDict.dep_versions = depVersions;
    }
  }

  const hasher = new Bun.CryptoHasher('sha256');
  hasher.update(JSON.stringify(hashableDict));

  if (pkgDir && existsSync(pkgDir) && statSync(pkgDir).isDirectory()) {
    const patches = Array.isArray(resolvedRecipe.patches) ? resolvedRecipe.patches : [];
    for (const patchRel of patches) {
      const patchPath = join(pkgDir, patchRel);
      if (existsSync(patchPath)) {
        hasher.update(readFileSync(patchPath));
      }
    }

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
