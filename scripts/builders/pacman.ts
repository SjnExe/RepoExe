import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import type { PackageRecipe } from "../core/types.ts";

export const PACMAN_ARCH_MAP: Record<string, string> = {
  aarch64: "aarch64",
  x86_64: "x86_64",
  arm: "armv7h",
  i686: "pentium4",
};

export function buildPacman(
  recipe: PackageRecipe,
  destdir: string,
  outputDir: string,
  targetArch: string = "aarch64"
): string {
  const stageDir = join(resolve(destdir), "stage");
  const outPath = resolve(outputDir);
  mkdirSync(outPath, { recursive: true });

  const rawArch = recipe.arch || targetArch;
  const pkgArch = PACMAN_ARCH_MAP[rawArch] || "aarch64";
  const verBody = recipe.revision > 0 ? `${recipe.version}-${recipe.revision}` : `${recipe.version}-1`;
  const pkgver = recipe.epoch > 0 ? `${recipe.epoch}:${verBody}` : verBody;
  const filenameVer = recipe.epoch > 0 ? `${recipe.epoch}_${verBody}` : verBody;

  const pkginfoLines = [
    `pkgname = ${recipe.name}`,
    `pkgver = ${pkgver}`,
    `pkgdesc = ${recipe.description || "RepoExe package"}`,
    `url = ${recipe.homepage || "https://github.com/SjnExe/RepoExe"}`,
    `arch = ${pkgArch}`,
    `license = ${recipe.license || "MIT"}`,
  ];

  for (const d of recipe.deps) pkginfoLines.push(`depend = ${d}`);
  for (const c of recipe.conflicts) pkginfoLines.push(`conflict = ${c}`);
  for (const p of recipe.provides) pkginfoLines.push(`provides = ${p}`);
  for (const r of recipe.replaces) pkginfoLines.push(`replaces = ${r}`);

  writeFileSync(join(stageDir, ".PKGINFO"), pkginfoLines.join("\n") + "\n", "utf-8");

  const zstFilename = `${recipe.name}-${filenameVer}-${pkgArch}.pkg.tar.zst`;
  const zstPath = join(outPath, zstFilename);

  const zstdCheck = spawnSync("which", ["zstd"]);
  if (zstdCheck.status === 0) {
    const res = spawnSync(
      "tar",
      ["--exclude=DEBIAN", "-I", "zstd -9", "-cf", zstPath, "-C", stageDir, "."],
      { encoding: "utf-8" }
    );
    if (res.status === 0) {
      return zstPath;
    }
  }

  // Fallback to .tar.gz
  const gzFilename = `${recipe.name}-${filenameVer}-${pkgArch}.pkg.tar.gz`;
  const gzPath = join(outPath, gzFilename);
  const res = spawnSync("tar", ["--exclude=DEBIAN", "-czf", gzPath, "-C", stageDir, "."], {
    encoding: "utf-8",
  });
  if (res.status !== 0) {
    throw new Error(`Pacman tar packaging failed: ${res.stderr}`);
  }
  return gzPath;
}
