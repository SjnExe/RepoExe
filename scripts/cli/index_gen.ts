import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

import { extractDebArch, generateAptMetadata, generateReleaseFile } from '../builders/debian.ts';
import { filterDepsForArch, normalizeArch, parseDependencyList } from '../core/dependencies.ts';
import { parseFilenameDebVersion } from '../core/fetcher.ts';
import { parseRecipe } from '../core/parser.ts';
import { getSubpackageNames } from '../core/subpkg.ts';
import type { PackageRecipe } from '../core/types.ts';
import { satisfiesVersionConstraint } from '../core/version.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { generatePackagesJson, type ReleaseAssetInfo } from '../utils/metadata.ts';
import { getExpectedAssetFilenames, identifyOutdatedAssets, type ReleaseAssetRecord } from './prune.ts';

export function getRetainedReleaseAssetFilenames(
  recipe: PackageRecipe,
  assets: ReleaseAssetRecord[] = [],
  allRecipes?: Record<string, PackageRecipe>,
): Set<string> {
  const expectedFiles = getExpectedAssetFilenames(recipe);
  const outdatedNames = new Set(identifyOutdatedAssets(assets, recipe, recipe.name, allRecipes).map((a) => a.name));
  const validNames = new Set([recipe.name, ...getSubpackageNames(recipe)]);
  for (const asset of assets) {
    const name = asset.name || '';
    if (name.endsWith('.deb') && !outdatedNames.has(name)) {
      const pkg = name.split('_')[0];
      if (validNames.has(pkg)) {
        expectedFiles.add(name);
      }
    }
  }
  return expectedFiles;
}

export function getExactPackageArtifacts(artPath: string, pkgName: string, subpkgNames: string[] = []): string[] {
  const matching: string[] = [];
  if (!existsSync(artPath)) {
    return matching;
  }

  const allNames = [pkgName, ...subpkgNames];

  const traverse = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(full);
      } else if (entry.isFile()) {
        const name = entry.name;
        for (const p of allNames) {
          if (name.startsWith(`${p}_`) && name.endsWith('.deb')) {
            matching.push(full);
            break;
          }
        }
      }
    }
  };
  traverse(artPath);
  return Array.from(new Set(matching)).sort();
}

function getDebDepends(debPath: string): string | null {
  try {
    const res = spawnSync('dpkg-deb', ['-f', debPath, 'Depends'], { encoding: 'utf-8' });
    if (res.status === 0) {
      return (res.stdout || '').trim();
    }
  } catch {}
  return null;
}

export function filterPublishableArtifacts(
  matchingFiles: string[],
  artPath: string,
  repoRoot: string = resolve('.'),
): string[] {
  const dag = new DependencyGraph(join(repoRoot, 'pkg'));

  let availableDebs: Array<{ name: string; ver: string; arch: string; path: string }> = [];
  const scanDir = (dir: string): void => {
    if (!existsSync(dir)) {
      return;
    }
    for (const ent of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, ent.name);
      if (ent.isDirectory()) {
        scanDir(full);
      } else if (ent.isFile() && ent.name.endsWith('.deb')) {
        const pkg = ent.name.split('_')[0];
        const arch = extractDebArch(ent.name);
        const ver = parseFilenameDebVersion(ent.name);
        availableDebs.push({ name: pkg, ver, arch, path: full });
      }
    }
  };
  scanDir(artPath);

  // Pre-filter unreadable files (Thread #11)
  const initialFiles: string[] = [];
  const unreadableFiles = new Set<string>();
  for (const file of matchingFiles) {
    if (!file.endsWith('.deb')) {
      initialFiles.push(file);
      continue;
    }
    const depStr = getDebDepends(file);
    if (depStr === null) {
      console.warn(`::warning:: Unreadable control data in archive '${basename(file)}'; withholding from publication.`);
      unreadableFiles.add(file);
      continue;
    }
    initialFiles.push(file);
  }

  // Fixpoint iteration to eliminate candidates that depend on withheld archives (Thread #13)
  let currentEligible = [...initialFiles];
  let changed = true;

  while (changed) {
    changed = false;
    const nextEligible: string[] = [];

    // Filter availableDebs to only those currently eligible or retained
    availableDebs = availableDebs.filter(
      (d) => !unreadableFiles.has(d.path) && (!initialFiles.includes(d.path) || currentEligible.includes(d.path)),
    );

    for (const file of currentEligible) {
      if (!file.endsWith('.deb')) {
        nextEligible.push(file);
        continue;
      }
      const debArch = extractDebArch(basename(file));
      const depStr = getDebDepends(file);
      if (!depStr) {
        nextEligible.push(file);
        continue;
      }

      const clauses = parseDependencyList([depStr]);
      const filtered = filterDepsForArch(clauses, debArch);
      let allClausesSatisfiable = true;

      for (const clause of filtered) {
        // For debArch === 'all', check across served architectures (Thread #14)
        const targetArchesToCheck = debArch === 'all' ? ['aarch64', 'arm', 'x86_64', 'i686'] : [normalizeArch(debArch)];

        const isClauseSatisfied = targetArchesToCheck.every((reqArch) =>
          clause.some((tok) => {
            const depPkg = tok.name.split(':')[0].trim();
            // Resolve subpackage to canonical parent owner before checking external (Thread #12)
            const ownerPkg = dag.recipes[depPkg] ? depPkg : dag.subpackageMap[depPkg];
            if (!ownerPkg && !existsSync(join(repoRoot, 'pkg', depPkg))) {
              return true;
            }
            const releaseTag = ownerPkg || depPkg;

            const localCands = availableDebs
              .filter((d) => d.name === depPkg)
              .map((d) => ({ arch: d.arch, ver: d.ver }));

            let remoteCands: Array<{ arch: string; ver: string }> = [];
            try {
              const ghRes = spawnSync('gh', ['release', 'view', releaseTag, '--json', 'assets'], {
                encoding: 'utf-8',
              });
              if (ghRes.status === 0 && ghRes.stdout) {
                const data = JSON.parse(ghRes.stdout);
                const assets: Array<{ name: string }> = data.assets || [];
                remoteCands = assets
                  .filter((a) => a.name.endsWith('.deb') && a.name.startsWith(`${depPkg}_`))
                  .map((a) => ({ arch: extractDebArch(a.name), ver: parseFilenameDebVersion(a.name) }));
              }
            } catch {}

            const allCands = [...localCands, ...remoteCands];
            return allCands.some((cand) => {
              const archMatches = cand.arch === 'all' || normalizeArch(cand.arch) === reqArch;
              return archMatches && satisfiesVersionConstraint(cand.ver, tok.versionConstraint);
            });
          }),
        );

        if (!isClauseSatisfied) {
          allClausesSatisfiable = false;
          break;
        }
      }

      if (allClausesSatisfiable) {
        nextEligible.push(file);
      } else {
        console.warn(
          `::warning:: Withholding ${basename(file)} from publication: unsatisfied dependency in current candidate set.`,
        );
        changed = true;
      }
    }
    currentEligible = nextEligible;
  }

  return currentEligible;
}

export async function fetchExistingReleaseAssetsToArtifacts(artPath: string): Promise<Map<string, ReleaseAssetInfo[]>> {
  const assetMap = new Map<string, ReleaseAssetInfo[]>();
  const ghCheck = spawnSync('which', ['gh']);
  if (ghCheck.status !== 0) {
    return assetMap;
  }

  mkdirSync(artPath, { recursive: true });
  const repoRoot = resolve('.');
  const pkgsDir = join(repoRoot, 'pkg');

  const repoRes = spawnSync('gh', ['repo', 'view', '--json', 'name,owner'], { encoding: 'utf-8' });
  if (repoRes.status !== 0) {
    return assetMap;
  }

  let owner: string;
  let repoName: string;
  try {
    const repoInfo = JSON.parse(repoRes.stdout);
    owner = repoInfo.owner.login;
    repoName = repoInfo.name;
  } catch {
    return assetMap;
  }

  const releasesRes = spawnSync('gh', ['api', '--paginate', `repos/${owner}/${repoName}/releases`], {
    encoding: 'utf-8',
    maxBuffer: 20 * 1024 * 1024,
  });
  if (releasesRes.status !== 0) {
    return assetMap;
  }

  let releases: Array<Record<string, any>> = [];
  try {
    releases = JSON.parse(releasesRes.stdout);
  } catch {
    return assetMap;
  }

  let allRecipes: Record<string, PackageRecipe> | undefined;
  if (existsSync(pkgsDir)) {
    try {
      const dag = new DependencyGraph(pkgsDir);
      allRecipes = dag.recipes;
    } catch {
      // ignore
    }
  }

  for (const rel of releases) {
    const tag = rel.tag_name || '';
    if (!tag || tag.includes('@')) {
      continue;
    }
    const pkg = tag;
    const recipePath = join(pkgsDir, pkg, 'recipe.ts');

    // Skip packages that no longer exist in the repository
    if (!existsSync(recipePath)) {
      continue;
    }

    let expectedFiles = new Set<string>();
    try {
      const recipe = parseRecipe(recipePath);
      expectedFiles = getRetainedReleaseAssetFilenames(recipe, rel.assets || [], allRecipes);
    } catch {
      continue;
    }

    if (expectedFiles.size === 0) {
      continue;
    }

    const pkgAssets: ReleaseAssetInfo[] = [];

    for (const asset of rel.assets || []) {
      const name = asset.name || '';
      const downloadUrl = asset.browser_download_url;
      if (!name || !downloadUrl) {
        continue;
      }

      if (!expectedFiles.has(name)) {
        continue;
      }

      pkgAssets.push({
        name,
        size: typeof asset.size === 'number' ? asset.size : 0,
        download_count: typeof asset.download_count === 'number' ? asset.download_count : 0,
        browser_download_url: downloadUrl,
      });

      const targetFile = join(artPath, name);
      if (!existsSync(targetFile)) {
        console.log(`⚡ Downloading existing published asset for index accumulation: ${name}...`);
        try {
          const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
          let resp: Response;
          if (ghToken && asset.url) {
            resp = await fetch(asset.url, {
              headers: {
                Authorization: `Bearer ${ghToken}`,
                Accept: 'application/octet-stream',
              },
            });
          } else {
            resp = await fetch(downloadUrl);
          }
          if (resp.ok) {
            const buf = Buffer.from(await resp.arrayBuffer());
            writeFileSync(targetFile, buf);
          }
        } catch {}
      }
    }

    if (pkgAssets.length > 0) {
      assetMap.set(pkg, pkgAssets);
    }
  }

  return assetMap;
}

export async function prepareSite(
  siteDir: string = 'site',
  artifactsDir: string = 'artifacts',
  skipRemote: boolean = false,
  stagingDir?: string,
): Promise<void> {
  const sPath = resolve(siteDir);
  const repoRoot = resolve('.');
  const artPath = resolve(artifactsDir);
  const shouldSkipRemote = skipRemote || process.env.REPOEXE_SKIP_REMOTE === '1';

  for (const sub of ['apt']) {
    mkdirSync(join(sPath, sub), { recursive: true });
  }

  const aptStaging = stagingDir ? resolve(stagingDir) : resolve('apt_staging');
  mkdirSync(aptStaging, { recursive: true });

  // 1. Publish newly built artifacts to GitHub Releases if gh CLI is available
  const ghCheck = spawnSync('which', ['gh']);
  if (!shouldSkipRemote && existsSync(artPath) && ghCheck.status === 0) {
    console.log('⚡ Publishing release artifacts to GitHub Releases...');
    const metaFiles: string[] = [];
    const findMetas = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          findMetas(full);
        } else if (entry.name.endsWith('_metadata.json')) {
          metaFiles.push(full);
        }
      }
    };
    findMetas(artPath);

    for (const pkgMetaFile of metaFiles) {
      try {
        const meta = JSON.parse(readFileSync(pkgMetaFile, 'utf-8'));
        const pkgName = meta.name;
        const tag = pkgName;

        let subpkgNames: string[] = [];
        const recipePath = join('pkg', pkgName);
        if (existsSync(recipePath)) {
          try {
            const recipe = parseRecipe(recipePath);
            subpkgNames = getSubpackageNames(recipe);
          } catch (e: any) {
            console.log(
              `::warning:: Could not read subpackages for ${pkgName}; subpackage debs will not be published: ${e?.message || e}`,
            );
          }
        }

        const rawMatchingFiles = getExactPackageArtifacts(artPath, pkgName, subpkgNames);
        const matchingFiles = filterPublishableArtifacts(rawMatchingFiles, artPath, repoRoot);
        const withheldFiles = rawMatchingFiles.filter((f) => !matchingFiles.includes(f));
        for (const w of withheldFiles) {
          if (existsSync(w)) {
            rmSync(w, { force: true });
          }
        }
        if (matchingFiles.length === 0) {
          console.log(`Notice: No publishable artifact files matched for tag ${tag}`);
          continue;
        }

        const effectiveMeta = withheldFiles.length > 0 ? { ...meta, state_hash: undefined, partial: true } : meta;
        const notesBody = JSON.stringify(effectiveMeta, null, 2);

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
  let releaseAssetMap = new Map<string, ReleaseAssetInfo[]>();
  if (!shouldSkipRemote) {
    releaseAssetMap = await fetchExistingReleaseAssetsToArtifacts(artPath);
  }

  // 3. Copy accumulated artifacts to aptStaging and site/apt/
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
    const arch = extractDebArch(f);
    if (arch !== 'unknown' && arch !== 'all') {
      arches.add(arch);
      if (arch === 'arm64') {
        arches.add('aarch64');
      } else if (arch === 'aarch64') {
        arches.add('arm64');
      }
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
  generatePackagesJson(join(repoRoot, 'pkg'), join(sPath, 'packages.json'), artPath, releaseAssetMap);

  // 6. Copy Frontend Source & Keyrings (dereferencing symlinks so site artifacts tarball cleanly)
  const siteSrcDir = join(repoRoot, 'scripts', 'site');
  if (existsSync(siteSrcDir)) {
    spawnSync('cp', ['-aL', `${siteSrcDir}/.`, `${sPath}/`]);
  }

  // Bundle scripts/site/app.ts using Bun into site/app.js
  const appTs = join(siteSrcDir, 'app.ts');
  if (existsSync(appTs)) {
    try {
      const buildRes = await Bun.build({
        entrypoints: [appTs],
        outdir: sPath,
        target: 'browser',
        minify: true,
      });
      if (!buildRes.success) {
        console.warn('::warning:: Bun build error compiling app.ts:', buildRes.logs);
      }
    } catch (err: any) {
      console.warn(`::warning:: Failed to bundle app.ts with Bun: ${err.message}`);
    }
  }

  // Ensure site/install is a concrete file, never a dangling symlink
  const siteInstall = join(sPath, 'install');
  try {
    const lstat = lstatSync(siteInstall);
    if (lstat.isSymbolicLink()) {
      const linkTarget = readlinkSync(siteInstall);
      const resolvedTarget = resolve(dirname(siteInstall), linkTarget);
      rmSync(siteInstall, { force: true });
      if (existsSync(resolvedTarget)) {
        copyFileSync(resolvedTarget, siteInstall);
      }
    }
  } catch {}

  const repoexeInstall = join(repoRoot, 'pkg', 'repoexe', 'install');
  if (existsSync(repoexeInstall)) {
    rmSync(siteInstall, { force: true });
    copyFileSync(repoexeInstall, siteInstall);
  }

  const gpgKeyPath = join(repoRoot, 'scripts', 'repoexe.gpg');
  if (existsSync(gpgKeyPath)) {
    copyFileSync(gpgKeyPath, join(sPath, 'repoexe.gpg'));
  }

  writeFileSync(join(sPath, '.nojekyll'), '', 'utf-8');
  console.log(`✓ Complete RepoExe site environment successfully generated at ${sPath}`);
}

if (import.meta.main) {
  prepareSite();
}
