import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecipe } from '../core/parser.ts';

export interface HealthReport {
  total_packages: number;
  valid_packages: number;
  invalid_packages: Array<{ package: string; error: string }>;
  build_systems: Record<string, number>;
}

export function auditRepositoryHealth(packagesDir: string): HealthReport {
  let totalPackages = 0;
  let validPackages = 0;
  const invalidPackages: Array<{ package: string; error: string }> = [];
  const buildSystems: Record<string, number> = {};

  const shellBin = spawnSync('which', ['bash']).status === 0 ? 'bash' : 'sh';

  const entries = readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  for (const pkgName of entries) {
    const pkgDir = join(packagesDir, pkgName);
    const recipeFile = join(pkgDir, 'recipe.ts');

    if (existsSync(recipeFile)) {
      totalPackages++;
      try {
        const recipe = parseRecipe(recipeFile);

        // Validate shell syntax across all defined phase blocks
        if (recipe.phases) {
          for (const [phaseName, scriptText] of Object.entries(recipe.phases)) {
            if (scriptText && typeof scriptText === 'string') {
              const res = spawnSync(shellBin, ['-n'], {
                input: scriptText,
                encoding: 'utf-8',
              });
              if (res.status !== 0) {
                const err = res.stderr?.trim() || 'Unknown shell syntax error';
                throw new Error(`Shell syntax error in phase '${phaseName}': ${err}`);
              }
            }
          }
        }

        validPackages++;
        const bs = recipe.build_system || 'custom';
        buildSystems[bs] = (buildSystems[bs] || 0) + 1;
      } catch (err: any) {
        invalidPackages.push({ package: pkgName, error: err.message || String(err) });
      }
    }
  }

  if (invalidPackages.length > 0) {
    for (const inv of invalidPackages) {
      console.error(`❌ [Health Error] ${inv.package}: ${inv.error}`);
    }
    throw new Error(`Repository health check failed with ${invalidPackages.length} error(s).`);
  }

  return {
    total_packages: totalPackages,
    valid_packages: validPackages,
    invalid_packages: invalidPackages,
    build_systems: buildSystems,
  };
}
