import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { extractDebArch, formatDebianVersion } from '../builders/debian.ts';
import { getExpectedAssetFilenames } from '../cli/prune.ts';
import { parseRecipe } from '../core/parser.ts';

export interface ReleaseAssetInfo {
  name: string;
  size: number;
  download_count: number;
  browser_download_url: string;
}

export function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function generatePackagesJson(
  pkgDir?: string,
  outputFile?: string,
  artifactsDir?: string,
  releaseAssetMap?: Map<string, ReleaseAssetInfo[]>,
): void {
  const repoRoot = resolve('.');
  const pkgsPath = pkgDir ? resolve(pkgDir) : join(repoRoot, 'pkg');
  const outPath = outputFile ? resolve(outputFile) : join(repoRoot, 'site', 'packages.json');
  const artPath = artifactsDir ? resolve(artifactsDir) : join(repoRoot, 'artifacts');

  mkdirSync(dirname(outPath), { recursive: true });

  const availableFiles = new Map<string, string>();
  if (existsSync(artPath)) {
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.isFile()) availableFiles.set(entry.name, full);
      }
    };
    collect(artPath);
  }

  const items: Array<Record<string, any>> = [];

  if (existsSync(pkgsPath)) {
    const entries = readdirSync(pkgsPath, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name)
      .sort();

    for (const pName of entries) {
      const recipeFile = join(pkgsPath, pName, 'recipe.ts');
      if (existsSync(recipeFile)) {
        try {
          const recipe = parseRecipe(recipeFile);
          const formats = recipe.formats || ['apt'];
          const uploaders = Array.isArray(recipe.uploaders)
            ? recipe.uploaders
            : recipe.uploaders
              ? [recipe.uploaders]
              : [];

          // Collect assets (merging remote release assets and local build artifacts by filename)
          const assetMap = new Map<string, Record<string, any>>();
          const remoteAssets = releaseAssetMap?.get(recipe.name);

          if (remoteAssets && remoteAssets.length > 0) {
            for (const asset of remoteAssets) {
              if (!asset.name.endsWith('.deb')) continue;
              const arch = extractDebArch(asset.name);
              assetMap.set(asset.name, {
                name: asset.name,
                arch,
                size: asset.size,
                size_formatted: formatBytes(asset.size),
                download_url: asset.browser_download_url,
                download_count: asset.download_count || 0,
              });
            }
          }

          const expectedFilenames = getExpectedAssetFilenames(recipe);

          for (const [filename, fullPath] of availableFiles.entries()) {
            if (filename.endsWith('.deb') && expectedFilenames.has(filename) && !assetMap.has(filename)) {
              const arch = extractDebArch(filename);
              let size = 0;
              try {
                size = statSync(fullPath).size;
              } catch {}
              assetMap.set(filename, {
                name: filename,
                arch,
                size,
                size_formatted: formatBytes(size),
                download_url: `https://github.com/SjnExe/RepoExe/releases/download/${recipe.name}/${filename}`,
                download_count: 0,
              });
            }
          }

          if (assetMap.size === 0) {
            const debArch = recipe.arch || 'aarch64';
            const verStr = formatDebianVersion(recipe);
            const defaultName = `${recipe.name}_${verStr}_${debArch}.deb`;
            assetMap.set(defaultName, {
              name: defaultName,
              arch: debArch,
              size: 0,
              size_formatted: 'Release Asset',
              download_url: `https://github.com/SjnExe/RepoExe/releases/download/${recipe.name}/${defaultName}`,
              download_count: 0,
            });
          }

          const assets = Array.from(assetMap.values());

          const totalDownloads = assets.reduce((acc, curr) => acc + (curr.download_count || 0), 0);

          items.push({
            name: recipe.name,
            version: recipe.version,
            revision: recipe.revision,
            epoch: recipe.epoch,
            description: recipe.description || `${recipe.name} binary package`,
            arch: recipe.arch || 'aarch64',
            license: recipe.license || 'MIT',
            homepage: recipe.homepage || 'https://github.com/SjnExe/RepoExe',
            maintainer: recipe.maintainer || '@SjnExe',
            uploaders,
            formats: Array.from(new Set(formats)).sort(),
            deps: recipe.deps,
            recommends: recipe.recommends,
            suggests: recipe.suggests,
            conflicts: recipe.conflicts,
            breaks: recipe.breaks,
            provides: recipe.provides,
            replaces: recipe.replaces,
            verified_built: Array.from(availableFiles.keys()).some((f) => f.includes(recipe.name)),
            assets,
            total_downloads: totalDownloads,
          });
        } catch {}
      }
    }
  }

  writeFileSync(outPath, JSON.stringify(items, null, 2), 'utf-8');
  console.log(`✓ Generated ${outPath} with ${items.length} package entries.`);
}
