import { copyFileSync, existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

const STATIC_SITE_FILES = ['index.html', 'style.css'] as const;

/**
 * Builds and copies all static frontend assets and the install script into `siteDir`. Excludes
 * TypeScript source files (`app.ts`) from the published output.
 */
export async function buildSiteFrontend(repoRoot: string, siteDir: string): Promise<void> {
  const sPath = resolve(siteDir);
  const siteSrcDir = join(repoRoot, 'scripts', 'site');

  mkdirSync(sPath, { recursive: true });

  for (const file of STATIC_SITE_FILES) {
    const srcFile = join(siteSrcDir, file);
    if (existsSync(srcFile)) {
      copyFileSync(srcFile, join(sPath, file));
    }
  }

  const appTs = join(siteSrcDir, 'app.ts');
  if (existsSync(appTs)) {
    const buildRes = await Bun.build({
      entrypoints: [appTs],
      outdir: sPath,
      target: 'browser',
      minify: true,
    });
    if (!buildRes.success) {
      throw new Error(`Bun build failed for app.ts: ${JSON.stringify(buildRes.logs)}`);
    }
  }

  // Ensure site/install is always a concrete file (never a symlink)
  const siteInstall = join(sPath, 'install');
  try {
    lstatSync(siteInstall);
    rmSync(siteInstall, { force: true });
  } catch {}

  const repoexeInstall = join(repoRoot, 'pkg', 'repoexe', 'install');
  const fallbackInstall = join(siteSrcDir, 'install');
  if (existsSync(repoexeInstall)) {
    copyFileSync(repoexeInstall, siteInstall);
  } else if (existsSync(fallbackInstall)) {
    copyFileSync(fallbackInstall, siteInstall);
  }

  const gpgKeyPath = join(repoRoot, 'scripts', 'repoexe.gpg');
  if (existsSync(gpgKeyPath)) {
    copyFileSync(gpgKeyPath, join(sPath, 'repoexe.gpg'));
  }

  await Bun.write(join(sPath, '.nojekyll'), '');
}

if (import.meta.main) {
  const repoRoot = resolve('.');
  const siteDir = resolve('site');
  await buildSiteFrontend(repoRoot, siteDir);
  console.log(`✓ Built site frontend at ${siteDir}`);
}
