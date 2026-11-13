import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { PackageRecipe } from '../core/types.ts';
import { parseDependencyList, filterDepsForArch, formatAlpineDependency } from '../core/dependencies.ts';

export const ALPINE_ARCH_MAP: Record<string, string> = {
  aarch64: 'aarch64',
  x86_64: 'x86_64',
  arm: 'armhf',
};

export function buildAlpine(
  recipe: PackageRecipe,
  destdir: string,
  outputDir: string,
  targetArch: string = 'aarch64',
): string {
  const stageDir = join(resolve(destdir), 'stage');
  const outPath = resolve(outputDir);
  mkdirSync(outPath, { recursive: true });

  const rawArch = recipe.arch || targetArch;
  const pkgArch = ALPINE_ARCH_MAP[rawArch] || 'aarch64';
  const verBody = recipe.revision > 0 ? `${recipe.version}-r${recipe.revision}` : `${recipe.version}-r0`;
  const pkgver = recipe.epoch > 0 ? `${recipe.version}_p${recipe.epoch}-r${recipe.revision}` : verBody;

  const pkginfoLines = [
    `pkgname = ${recipe.name}`,
    `pkgver = ${pkgver}`,
    `pkgdesc = ${recipe.description || 'RepoExe package'}`,
    `url = ${recipe.homepage || 'https://github.com/SjnExe/RepoExe'}`,
    `arch = ${pkgArch}`,
    `license = ${recipe.license || 'MIT'}`,
  ];

  if (recipe.deps.length > 0) {
    const clauses = parseDependencyList(recipe.deps);
    const filtered = filterDepsForArch(clauses, rawArch);
    const apkDeps = formatAlpineDependency(filtered);
    if (apkDeps.length > 0) {
      pkginfoLines.push(`depend = ${apkDeps.join(' ')}`);
    }
  }

  writeFileSync(join(stageDir, '.PKGINFO'), pkginfoLines.join('\n') + '\n', 'utf-8');

  const apkFilename = `${recipe.name}-${pkgver}.apk`;
  const apkPath = join(outPath, apkFilename);

  const res = spawnSync('tar', ['--exclude=DEBIAN', '-I', 'gzip -9', '-cf', apkPath, '-C', stageDir, '.'], {
    encoding: 'utf-8',
  });

  if (res.status !== 0) {
    throw new Error(`Alpine tar packaging failed: ${res.stderr}`);
  }

  return apkPath;
}
