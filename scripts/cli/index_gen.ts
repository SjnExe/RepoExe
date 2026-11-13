import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { generateAptMetadata, generateReleaseFile } from '../builders/debian.ts';
import { parseRecipe } from '../core/parser.ts';
import { generatePackagesJson } from '../utils/metadata.ts';
import { getExpectedAssetFilenames } from './prune.ts';

export function getExactPackageArtifacts(artPath: string, pkgName: string): string[] {
  const matching: string[] = [];
  if (!existsSync(artPath)) return matching;

  const escapedPkg = pkgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pacmanRegex = new RegExp(`^${escapedPkg}-(?:[0-9]|v[0-9])`);
  const apkRegex = new RegExp(`^${escapedPkg}-(?:[0-9]|v[0-9])`);

  const traverse = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(full);
      } else if (entry.isFile()) {
        const name = entry.name;
        if (
          (name.startsWith(`${pkgName}_`) && name.endsWith('.deb')) ||
          (pacmanRegex.test(name) && (name.includes('.pkg.tar.zst') || name.includes('.pkg.tar.gz'))) ||
          (apkRegex.test(name) && name.endsWith('.apk'))
        ) {
          matching.push(full);
        }
      }
    }
  };
  traverse(artPath);
  return Array.from(new Set(matching)).sort();
}

export async function fetchExistingReleaseAssetsToArtifacts(artPath: string): Promise<void> {
  const ghCheck = spawnSync('which', ['gh']);
  if (ghCheck.status !== 0) return;

  mkdirSync(artPath, { recursive: true });
  const repoRoot = resolve('.');
  const pkgsDir = join(repoRoot, 'pkg');

  const repoRes = spawnSync('gh', ['repo', 'view', '--json', 'name,owner'], { encoding: 'utf-8' });
  if (repoRes.status !== 0) return;

  let owner: string;
  let repoName: string;
  try {
    const repoInfo = JSON.parse(repoRes.stdout);
    owner = repoInfo.owner.login;
    repoName = repoInfo.name;
  } catch {
    return;
  }

  const releasesRes = spawnSync('gh', ['api', `repos/${owner}/${repoName}/releases?per_page=100`], {
    encoding: 'utf-8',
  });
  if (releasesRes.status !== 0) return;

  let releases: Array<Record<string, any>> = [];
  try {
    releases = JSON.parse(releasesRes.stdout);
  } catch {
    return;
  }

  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (!tag.includes('@')) continue;

    const [pkg, channel] = tag.split('@');
    const recipePath = join(pkgsDir, pkg, 'recipe.ts');
    let expectedFiles = new Set<string>();

    if (existsSync(recipePath)) {
      try {
        const recipe = parseRecipe(recipePath, channel);
        expectedFiles = getExpectedAssetFilenames(recipe);
      } catch {}
    }

    for (const asset of rel.assets || []) {
      const name = asset.name || '';
      const downloadUrl = asset.browser_download_url;
      if (!name || !downloadUrl) continue;

      if (expectedFiles.size > 0 && !expectedFiles.has(name)) {
        continue;
      }

      const targetFile = join(artPath, name);
      if (!existsSync(targetFile)) {
        console.log(`⚡ Downloading existing published asset for index accumulation: ${name}...`);
        try {
          const resp = await fetch(downloadUrl);
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            writeFileSync(targetFile, buf);
          }
        } catch {}
      }
    }
  }
}

export async function prepareSite(siteDir: string = 'site', artifactsDir: string = 'artifacts'): Promise<void> {
  const sPath = resolve(siteDir);
  const artPath = resolve(artifactsDir);

  for (const sub of ['apt', 'pacman', 'alpine']) {
    mkdirSync(join(sPath, sub), { recursive: true });
  }

  const aptStaging = resolve('apt_staging');
  mkdirSync(aptStaging, { recursive: true });

  // 1. Publish newly built artifacts to GitHub Releases if gh CLI is available
  const ghCheck = spawnSync('which', ['gh']);
  if (existsSync(artPath) && ghCheck.status === 0) {
    console.log('⚡ Publishing release artifacts to GitHub Releases...');
    const metaFiles: string[] = [];
    const findMetas = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) findMetas(full);
        else if (entry.name.endsWith('_metadata.json')) metaFiles.push(full);
      }
    };
    findMetas(artPath);

    for (const pkgMetaFile of metaFiles) {
      try {
        const meta = JSON.parse(readFileSync(pkgMetaFile, 'utf-8'));
        const pkgName = meta.name;
        const channel = meta.channel || 'latest';
        const tag = `${pkgName}@${channel}`;

        const matchingFiles = getExactPackageArtifacts(artPath, pkgName);
        if (matchingFiles.length === 0) {
          console.log(`Notice: No artifact files matched for tag ${tag}`);
          continue;
        }

        const notesBody = JSON.stringify(meta, null, 2);

        spawnSync('gh', ['release', 'view', tag]);
        const res = spawnSync(
          'gh',
          ['release', 'create', tag, ...matchingFiles, '--title', tag, '--notes', notesBody],
          { encoding: 'utf-8' },
        );
        if (res.status === 0) {
          console.log(`✓ Successfully published GitHub release tag: ${tag}`);
        } else {
          const resUp = spawnSync('gh', ['release', 'upload', tag, ...matchingFiles, '--clobber'], {
            encoding: 'utf-8',
          });
          spawnSync('gh', ['release', 'edit', tag, '--notes', notesBody]);
          if (resUp.status === 0) {
            console.log(`✓ Uploaded release assets to existing tag: ${tag}`);
          } else {
            console.log(`::warning:: Failed to upload release assets for ${tag}: ${resUp.stderr?.trim()}`);
          }
        }
      } catch (e: any) {
        console.log(`::warning:: Failed publishing release tag for ${basename(pkgMetaFile)}: ${e.message}`);
      }
    }
  }

  // 2. Fetch existing release assets
  await fetchExistingReleaseAssetsToArtifacts(artPath);

  // 3. Copy accumulated artifacts to respective directories
  if (existsSync(artPath)) {
    const copyArtifacts = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          copyArtifacts(full);
        } else if (entry.isFile()) {
          if (entry.name.endsWith('.deb')) {
            copyFileSync(full, join(aptStaging, entry.name));
            copyFileSync(full, join(sPath, 'apt', entry.name));
          } else if (entry.name.endsWith('.pkg.tar.zst') || entry.name.endsWith('.pkg.tar.gz')) {
            copyFileSync(full, join(sPath, 'pacman', entry.name));
          } else if (entry.name.endsWith('.apk')) {
            copyFileSync(full, join(sPath, 'alpine', entry.name));
          }
        }
      }
    };
    copyArtifacts(artPath);
  }

  // 4. Generate APT Metadata and Release File
  const debFiles = existsSync(aptStaging) ? readdirSync(aptStaging).filter((f) => f.endsWith('.deb')) : [];

  const arches = new Set<string>();
  for (const f of debFiles) {
    const parts = f.split('_');
    const arch = parts[parts.length - 1].replace('.deb', '');
    if (arch !== 'all') {
      arches.add(arch);
      if (arch === 'arm64') arches.add('aarch64');
      else if (arch === 'aarch64') arches.add('arm64');
    }
  }
  if (arches.size === 0) {
    arches.add('arm64');
    arches.add('aarch64');
  }

  for (const arch of arches) {
    generateAptMetadata(aptStaging, 'main', arch);
  }
  generateReleaseFile(aptStaging, 'stable', 'main');

  const distsDir = join(aptStaging, 'dists');
  if (existsSync(distsDir)) {
    spawnSync('cp', ['-a', `${distsDir}/.`, `${join(sPath, 'apt', 'dists')}/`]);
  }

  // 5. Generate packages.json Store Manifest
  const repoRoot = resolve('.');
  generatePackagesJson(join(repoRoot, 'pkg'), join(sPath, 'packages.json'), artPath);

  // 6. Copy Frontend Source & Keyrings
  const siteSrcDir = join(repoRoot, 'scripts', 'site');
  if (existsSync(siteSrcDir)) {
    spawnSync('cp', ['-a', `${siteSrcDir}/.`, `${sPath}/`]);
  }

  for (const key of ['scripts/repoexe.gpg', 'scripts/repoexe.rsa.pub']) {
    const keyPath = join(repoRoot, key);
    if (existsSync(keyPath)) {
      copyFileSync(keyPath, join(sPath, basename(keyPath)));
    }
  }

  writeFileSync(join(sPath, '.nojekyll'), '', 'utf-8');
  console.log(`✓ Complete RepoExe site environment successfully generated at ${sPath}`);
}

if (import.meta.main) {
  prepareSite();
}
