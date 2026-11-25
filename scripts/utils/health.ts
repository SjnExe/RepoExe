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

        // Validate patch naming and strict 4-digit zero-padded numbering
        const declaredPatches = Array.isArray(recipe.patches)
          ? recipe.patches.map((p) => (p.startsWith('patches/') ? p.slice(8) : p))
          : [];
        const patchDir = join(pkgDir, 'patches');
        for (const dec of declaredPatches) {
          const patchPath = join(patchDir, dec);
          if (!existsSync(patchPath) || !statSync(patchPath).isFile()) {
            throw new Error(`Declared patch '${dec}' does not exist in '${patchDir}'.`);
          }
        }
        const patchEntries = existsSync(patchDir) ? readdirSync(patchDir) : [];
        if (declaredPatches.length === 0) {
          for (const entryName of patchEntries) {
            const entryPath = join(patchDir, entryName);
            if (
              (entryName.endsWith('.patch') || entryName.endsWith('.diff')) &&
              (!existsSync(entryPath) || !statSync(entryPath).isFile())
            ) {
              throw new Error(`Patch entry '${entryName}' in '${patchDir}' is not a regular file.`);
            }
          }
        }
        const patchesToValidate =
          declaredPatches.length > 0
            ? declaredPatches
            : patchEntries
                .filter((name) => {
                  const entryPath = join(patchDir, name);
                  return (
                    existsSync(entryPath) &&
                    statSync(entryPath).isFile() &&
                    (name.endsWith('.patch') || name.endsWith('.diff'))
                  );
                })
                .sort();
        for (const patch of patchesToValidate) {
          if (!/^\d{4}-[\w.-]+\.(patch|diff)$/.test(patch)) {
            throw new Error(
              `Invalid patch filename '${patch}' in '${pkgName}'. Patches must follow strict 4-digit zero-padded numbering (e.g. '0001-fix.patch').`,
            );
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
    const details = invalidPackages.map((inv) => `[${inv.package}] ${inv.error}`).join('; ');
    throw new Error(`Repository health check failed with ${invalidPackages.length} error(s): ${details}`);
  }

  return {
    total_packages: totalPackages,
    valid_packages: validPackages,
    invalid_packages: invalidPackages,
    build_systems: buildSystems,
  };
}
