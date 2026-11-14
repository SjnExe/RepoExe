import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { parseRecipe } from '../core/parser.ts';

export function generatePackagesJson(pkgDir?: string, outputFile?: string, artifactsDir?: string): void {
  const repoRoot = resolve('.');
  const pkgsPath = pkgDir ? resolve(pkgDir) : join(repoRoot, 'pkg');
  const outPath = outputFile ? resolve(outputFile) : join(repoRoot, 'site', 'packages.json');
  const artPath = artifactsDir ? resolve(artifactsDir) : join(repoRoot, 'artifacts');

  mkdirSync(dirname(outPath), { recursive: true });

  const availableFiles = new Set<string>();
  if (existsSync(artPath)) {
    const collect = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) collect(full);
        else if (entry.isFile()) availableFiles.add(entry.name);
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

          items.push({
            name: recipe.name,
            version: recipe.version,
            revision: recipe.revision,
            epoch: recipe.epoch,
            description: recipe.description || `${recipe.name} binary package`,
            arch: recipe.arch || 'aarch64',
            license: recipe.license || 'MIT',
            homepage: recipe.homepage || 'https://github.com/SjnExe/RepoExe',
            maintainer: recipe.maintainer || 'SjnExe',
            uploaders: recipe.uploaders || [],
            formats: Array.from(new Set(formats)).sort(),
            deps: recipe.deps,
            recommends: recipe.recommends,
            suggests: recipe.suggests,
            conflicts: recipe.conflicts,
            provides: recipe.provides,
            replaces: recipe.replaces,
            verified_built: Array.from(availableFiles).some((f) => f.includes(recipe.name)),
          });
        } catch {}
      }
    }
  }

  writeFileSync(outPath, JSON.stringify(items, null, 2), 'utf-8');
  console.log(`✓ Generated ${outPath} with ${items.length} package entries.`);
}
