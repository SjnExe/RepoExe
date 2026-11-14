import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { checkExistingReleaseHash, resolveAndFetchBuildDependencies } from '../core/fetcher.ts';
import { setupBionicCompat } from '../core/compat.ts';
import { parseRecipe, computeStateHash } from '../core/parser.ts';
import type { PackageRecipe } from '../core/types.ts';
import { auditRepositoryHealth } from '../utils/health.ts';
import { buildDeb, ARCH_MAP, formatDebianFilenameVersion } from '../builders/debian.ts';
import { buildPacman } from '../builders/pacman.ts';
import { buildAlpine } from '../builders/alpine.ts';
import { sanitizeStagingElfs } from '../sanitizer/elf.ts';
import { sanitizeShebangs } from '../sanitizer/shebang.ts';
import { spawnSync } from 'node:child_process';
import { DependencyGraph } from '../utils/dag.ts';

export function computeSourceIdentity(recipe: any, pDir: string): string {
  const channel = recipe.active_channel || 'latest';
  const patches: string[] = [];
  for (const pf of [join(pDir, 'patches'), join(pDir, `patches@${channel}`)]) {
    if (existsSync(pf)) {
      for (const f of readdirSync(pf).sort()) {
        if (f.endsWith('.patch')) {
          const patchContent = readFileSync(join(pf, f));
          patches.push(`${f}:${createHash('sha256').update(patchContent).digest('hex')}`);
        }
      }
    }
  }

  const identityData = {
    source: recipe.source ? recipe.source.replace(/\{version\}/g, recipe.version) : '',
    version: String(recipe.version || ''),
    sha256: String(recipe.sha256 || ''),
    channel,
    patches,
  };
  return createHash('sha256').update(JSON.stringify(identityData)).digest('hex');
}

export function fetchAndPrepareSource(
  recipe: any,
  pDir: string,
  destdir: string,
  continueBuild: boolean = false,
): string {
  if (!recipe.source) return pDir;

  const srcUrl = recipe.source.replace(/\{version\}/g, recipe.version);
  const srcExtractDir = join(destdir, 'src');
  const readyFile = join(destdir, '.source_prepared.json');
  const currentIdentity = computeSourceIdentity(recipe, pDir);

  if (continueBuild && existsSync(srcExtractDir) && existsSync(readyFile)) {
    try {
      const marker = JSON.parse(readFileSync(readyFile, 'utf-8'));
      if (marker.identity === currentIdentity && marker.workDir && existsSync(marker.workDir)) {
        console.log(`[${recipe.name}] Continuing build: reusing existing source directory at ${marker.workDir}...`);
        return marker.workDir;
      }
    } catch {}
  }

  if (existsSync(readyFile)) {
    rmSync(readyFile, { force: true });
  }

  if (existsSync(srcExtractDir)) {
    rmSync(srcExtractDir, { recursive: true, force: true });
  }
  mkdirSync(srcExtractDir, { recursive: true });
  console.log(`[${recipe.name}] Fetching source from ${srcUrl}...`);

  const isArchive = /\.(tar\.gz|tgz|tar\.xz|tar\.bz2|zip|crate|whl)$/i.test(srcUrl.split('#')[0]);
  let workDir = srcExtractDir;

  if (!isArchive && (srcUrl.endsWith('.git') || srcUrl.includes('.git#') || srcUrl.includes('#'))) {
    if (srcUrl.includes('#')) {
      const [repoUrl, ref] = srcUrl.split('#');
      if (ref.length === 40 && /^[0-9a-fA-F]+$/.test(ref)) {
        let res = spawnSync('git', ['init', srcExtractDir], { stdio: 'inherit' });
        if (res.status !== 0) throw new Error(`git init failed for ${recipe.name}`);
        res = spawnSync('git', ['-C', srcExtractDir, 'remote', 'add', 'origin', repoUrl], { stdio: 'inherit' });
        if (res.status !== 0) throw new Error(`git remote add failed for ${recipe.name}`);
        res = spawnSync('git', ['-C', srcExtractDir, 'fetch', '--depth', '1', 'origin', ref], { stdio: 'inherit' });
        if (res.status !== 0) throw new Error(`git fetch failed for ${recipe.name}`);
        res = spawnSync('git', ['-C', srcExtractDir, 'checkout', 'FETCH_HEAD'], { stdio: 'inherit' });
        if (res.status !== 0) throw new Error(`git checkout failed for ${recipe.name}`);
      } else {
        const res = spawnSync('git', ['clone', '--depth', '1', '--branch', ref, repoUrl, srcExtractDir], {
          stdio: 'inherit',
        });
        if (res.status !== 0) throw new Error(`git clone failed for ${recipe.name} from ${repoUrl}`);
      }
    } else {
      const res = spawnSync('git', ['clone', '--depth', '1', srcUrl, srcExtractDir], { stdio: 'inherit' });
      if (res.status !== 0) throw new Error(`git clone failed for ${recipe.name} from ${srcUrl}`);
    }
  } else {
    const archivePath = join(destdir, 'source_archive');
    const curlRes = spawnSync('curl', ['-fsSL', '-A', 'Mozilla/5.0', '--retry', '5', srcUrl, '-o', archivePath], {
      stdio: 'inherit',
    });
    if (curlRes.status !== 0) {
      throw new Error(`Failed to download source archive for ${recipe.name} from ${srcUrl}`);
    }

    if (recipe.sha256) {
      const digest = createHash('sha256').update(readFileSync(archivePath)).digest('hex');
      if (digest.toLowerCase() !== recipe.sha256.toLowerCase()) {
        throw new Error(`sha256 mismatch for ${recipe.name}: expected ${recipe.sha256}, got ${digest}`);
      }
    }

    let extractRes;
    if (srcUrl.endsWith('.zip') || srcUrl.includes('.zip')) {
      extractRes = spawnSync('unzip', ['-q', '-o', archivePath, '-d', srcExtractDir], { stdio: 'inherit' });
    } else {
      extractRes = spawnSync('tar', ['-xf', archivePath, '-C', srcExtractDir], { stdio: 'inherit' });
    }
    if (extractRes.status !== 0) {
      throw new Error(`Failed to extract source archive for ${recipe.name}`);
    }

    const items = readdirSync(srcExtractDir, { withFileTypes: true });
    if (items.length === 1 && items[0].isDirectory()) {
      workDir = join(srcExtractDir, items[0].name);
    }
  }

  // Apply patches if present
  const channel = recipe.active_channel || 'latest';
  for (const pFolder of [join(pDir, 'patches'), join(pDir, `patches@${channel}`)]) {
    if (existsSync(pFolder)) {
      const patches = readdirSync(pFolder)
        .filter((f) => f.endsWith('.patch'))
        .sort();
      for (const patch of patches) {
        console.log(`⚡ Applying patch: ${patch}...`);
        const patchRes = spawnSync('patch', ['-p1', '-i', join(pFolder, patch)], {
          cwd: workDir,
          stdio: 'inherit',
        });
        if (patchRes.status !== 0) {
          throw new Error(`Failed to apply patch ${patch} for ${recipe.name}`);
        }
      }
    }
  }

  writeFileSync(readyFile, JSON.stringify({ identity: currentIdentity, workDir }, null, 2), 'utf-8');
  return workDir;
}

export async function executePack(recipe: any, pkgDir: string, destdir: string, outputDir: string): Promise<void> {
  const supportedFormats = new Set(['apt', 'pacman', 'apk']);
  const fmts = recipe.formats || ['apt', 'pacman', 'apk'];
  for (const fmt of fmts) {
    if (!supportedFormats.has(fmt)) {
      throw new Error(`Unsupported package format '${fmt}' for ${recipe.name}. Supported formats: apt, pacman, apk.`);
    }
  }

  mkdirSync(outputDir, { recursive: true });
  const escapedPkg = recipe.name.replace(/[-[\]{}()*+?.,\\^$|#\s]/g, '\\$&');
  const isTargetDeb = new RegExp(`^${escapedPkg}_.+_[^_]+\\.deb$`);
  const isTargetPacman = new RegExp(`^${escapedPkg}-[0-9].*\\.pkg\\.tar\\..+$`);
  const isTargetApk = new RegExp(`^${escapedPkg}-[0-9].*\\.apk$`);

  // Clear any existing artifacts for this package to prevent stale files
  for (const f of readdirSync(outputDir)) {
    if (isTargetDeb.test(f) || isTargetPacman.test(f) || isTargetApk.test(f)) {
      rmSync(join(outputDir, f), { force: true });
    }
  }

  const stageDir = join(destdir, 'stage');

  sanitizeStagingElfs(stageDir);
  sanitizeShebangs(stageDir);

  if (fmts.includes('apt')) {
    buildDeb(recipe, destdir, outputDir, recipe.arch);
  }
  if (fmts.includes('pacman')) {
    buildPacman(recipe, destdir, outputDir, recipe.arch);
  }
  if (fmts.includes('apk')) {
    buildAlpine(recipe, destdir, outputDir, recipe.arch);
  }

  const meta = {
    name: recipe.name,
    version: recipe.version,
    revision: recipe.revision,
    arch: recipe.arch,
    state_hash: recipe.state_hash || '',
    channel: recipe.active_channel || 'latest',
  };
  const metaContent = JSON.stringify(meta, null, 2);
  await Bun.write(join(outputDir, `${recipe.name}_metadata.json`), metaContent);
  await Bun.write(join(outputDir, `${recipe.name}_${meta.channel}_metadata.json`), metaContent);
}

export function executeTest(recipe: any, destdir?: string, outputDir?: string): void {
  const testCmd = recipe.phases?.test || `${recipe.name} --version || ${recipe.name} --help`;
  console.log(`Running smoke test for ${recipe.name}: ${testCmd}`);

  const localOutputDir = outputDir ? resolve(outputDir) : resolve('output');
  const relOutputDir = relative(resolve('.'), localOutputDir);
  const hostWorkspace = process.env.GITHUB_WORKSPACE || resolve('.');
  const hostOutputDir = relOutputDir.startsWith('..') ? localOutputDir : join(hostWorkspace, relOutputDir);

  const hasDockerSocket = existsSync('/var/run/docker.sock');

  if (hasDockerSocket) {
    const owner = (process.env.REPO_OWNER || 'sjnexe').toLowerCase();
    const rawArch = (recipe.arch || 'aarch64').toLowerCase();
    const debArch = ARCH_MAP[rawArch] || rawArch;
    const filenameVer = formatDebianFilenameVersion(recipe);
    const targetDeb = `${recipe.name}_${filenameVer}_${debArch}.deb`;
    const escapedCmd = testCmd.replace(/'/g, "'\\''");

    const archKey = `TESTER_IMAGE_${rawArch.toUpperCase()}`;
    const testerImage = process.env[archKey] || process.env.TESTER_IMAGE || `ghcr.io/${owner}/repoexe-tester:latest`;
    const containerPkgDir = '/data/data/com.termux/files/usr/tmp/repoexe-pkg';

    // Sibling & target package installer with explicit exit verification
    const installCommands = [
      'set -e',
      'INSTALLED=0',
      // Install sibling runtime dependencies matching host architecture before target install
      `for sib in ${containerPkgDir}/*_${debArch}.deb ${containerPkgDir}/*_all.deb; do if [ -f "$sib" ] && [ "$(basename "$sib")" != "${targetDeb}" ]; then if ! dpkg -i --force-architecture --force-depends "$sib" 2>/dev/null; then TMP_S=$(mktemp -d); if dpkg-deb -x "$sib" "$TMP_S" 2>/dev/null; then if [ -d "$TMP_S/data/data/com.termux/files" ]; then cp -a "$TMP_S/data/data/com.termux/files/." /data/data/com.termux/files/ 2>/dev/null || true; fi; fi; rm -rf "$TMP_S"; fi; fi; done`,
      // If target Debian package exists, install it directly with dpkg or extract into PREFIX
      `if [ -f "${containerPkgDir}/${targetDeb}" ]; then if dpkg -i --force-architecture --force-depends "${containerPkgDir}/${targetDeb}" 2>/dev/null; then INSTALLED=1; else TMP_X=$(mktemp -d); if dpkg-deb -x "${containerPkgDir}/${targetDeb}" "$TMP_X" 2>/dev/null; then if [ -d "$TMP_X/data/data/com.termux/files" ]; then cp -a "$TMP_X/data/data/com.termux/files/." /data/data/com.termux/files/ && INSTALLED=1; fi; fi; rm -rf "$TMP_X"; fi; elif ls ${containerPkgDir}/${recipe.name}_*.deb 1>/dev/null 2>&1; then for f in ${containerPkgDir}/${recipe.name}_*.deb; do if [ -f "$f" ]; then if dpkg -i --force-architecture --force-depends "$f" 2>/dev/null; then INSTALLED=1; else TMP_X=$(mktemp -d); if dpkg-deb -x "$f" "$TMP_X" 2>/dev/null; then if [ -d "$TMP_X/data/data/com.termux/files" ]; then cp -a "$TMP_X/data/data/com.termux/files/." /data/data/com.termux/files/ && INSTALLED=1; fi; fi; rm -rf "$TMP_X"; fi; fi; done; fi`,
      // If pacman package for target is present and deb not installed, extract into /data/data/com.termux/files/
      `if [ "$INSTALLED" -eq 0 ] && ls ${containerPkgDir}/${recipe.name}-*.pkg.tar.* 1>/dev/null 2>&1; then for f in ${containerPkgDir}/${recipe.name}-*.pkg.tar.*; do if [ -f "$f" ]; then TMP_X=$(mktemp -d); if tar --no-overwrite-dir -xf "$f" -C "$TMP_X" 2>/dev/null || tar -xf "$f" -C "$TMP_X" 2>/dev/null; then if [ -d "$TMP_X/data/data/com.termux/files" ]; then cp -a "$TMP_X/data/data/com.termux/files/." /data/data/com.termux/files/ && INSTALLED=1; fi; fi; rm -rf "$TMP_X"; fi; done; fi`,
      // If apk package for target is present and not yet installed, extract into /data/data/com.termux/files/
      `if [ "$INSTALLED" -eq 0 ] && ls ${containerPkgDir}/${recipe.name}-*.apk 1>/dev/null 2>&1; then for f in ${containerPkgDir}/${recipe.name}-*.apk; do if [ -f "$f" ]; then TMP_X=$(mktemp -d); if tar --no-overwrite-dir -xf "$f" -C "$TMP_X" 2>/dev/null || tar -xf "$f" -C "$TMP_X" 2>/dev/null; then if [ -d "$TMP_X/data/data/com.termux/files" ]; then cp -a "$TMP_X/data/data/com.termux/files/." /data/data/com.termux/files/ && INSTALLED=1; fi; fi; rm -rf "$TMP_X"; fi; done; fi`,
      `if [ "$INSTALLED" -eq 0 ]; then echo "::error:: Target package artifact for ${recipe.name} could not be installed for smoke testing!"; exit 1; fi`,
      'chmod +x ${PREFIX:-/data/data/com.termux/files/usr}/bin/* 2>/dev/null || true',
      `timeout 120s sh -c '${escapedCmd}'`,
    ];

    const installAndTest = installCommands.join('; ');

    console.log(`Executing container smoke test via ${testerImage} (${rawArch})...`);
    const dockerArgs = [
      'run',
      '--rm',
      '--volume',
      `${hostOutputDir}:${containerPkgDir}:ro`,
      '--workdir',
      '/data/data/com.termux/files/home',
      '-e',
      'PREFIX=/data/data/com.termux/files/usr',
      '-e',
      'PATH=/data/data/com.termux/files/usr/bin:/bin:/usr/bin',
      '-e',
      'LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib',
      '-e',
      'HOME=/data/data/com.termux/files/home',
      '-e',
      `TARGET_ARCH=${rawArch}`,
      testerImage,
      'sh',
      '-c',
      installAndTest,
    ];

    const res = spawnSync('docker', dockerArgs, { stdio: 'inherit', timeout: 150_000 });
    if (res.status !== 0) {
      if (res.status === 124) {
        throw new Error(`Smoke test timed out after 120s under emulation for ${recipe.name}`);
      } else if (res.status === 132 || res.status === 139) {
        throw new Error(`QEMU emulation crash (signal ${res.status}) executing ${recipe.name}`);
      }
      throw new Error(`Smoke test failed with exit code ${res.status} for ${recipe.name}`);
    }
    console.log(`✓ Smoke test passed in container for ${recipe.name}`);
    return;
  }

  // Fallback: Local execution on native Termux device (with sibling stage discovery)
  const buildDir = resolve('build');
  const siblingBins: string[] = [];
  const siblingLibs: string[] = [];
  if (existsSync(buildDir)) {
    for (const b of readdirSync(buildDir)) {
      const bPath = join(buildDir, b, 'stage', 'data', 'data', 'com.termux', 'files', 'usr');
      const binDir = join(bPath, 'bin');
      const libDir = join(bPath, 'lib');
      if (existsSync(binDir)) siblingBins.push(binDir);
      if (existsSync(libDir)) siblingLibs.push(libDir);
    }
  }

  const stageBin = destdir ? `${destdir}/stage/data/data/com.termux/files/usr/bin` : '';
  const stageLib = destdir ? `${destdir}/stage/data/data/com.termux/files/usr/lib` : '';
  const env = {
    ...process.env,
    PREFIX: process.env.PREFIX || '/data/data/com.termux/files/usr',
    PATH: [stageBin, ...siblingBins, process.env.PATH].filter(Boolean).join(':'),
    LD_LIBRARY_PATH: [stageLib, ...siblingLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':'),
  };
  const res = spawnSync('sh', ['-c', testCmd], { stdio: 'inherit', env, timeout: 60_000, killSignal: 'SIGKILL' });
  if (res.status !== 0) {
    throw new Error(`Smoke test failed with exit code ${res.status} for ${recipe.name}`);
  }
  console.log(`✓ Smoke test passed locally for ${recipe.name}`);
}

export async function simulateDryRun(
  recipe: PackageRecipe,
  pDir: string,
  destdir: string,
  outputDir: string,
  channel: string,
  command: string,
  force: boolean = false,
): Promise<void> {
  console.log(`\n============================================================`);
  console.log(`🔍 [DRY-RUN SIMULATION] ${recipe.name}@${channel} (${command.toUpperCase()})`);
  console.log(`============================================================`);

  console.log(`📦 Package:       ${recipe.name}`);
  console.log(`🔖 Version:       ${recipe.version}`);
  console.log(`🔄 Revision:      ${recipe.revision}`);
  console.log(`⏳ Epoch:         ${recipe.epoch}`);
  console.log(`🏛️ Architecture:  ${recipe.arch || 'aarch64'}`);
  console.log(`📡 Channel:       ${channel}`);
  console.log(`📁 Formats:       ${(recipe.formats || ['apt', 'pacman', 'apk']).join(', ')}`);
  if (recipe.description) console.log(`📝 Description:   ${recipe.description}`);
  if (recipe.homepage) console.log(`🌐 Homepage:      ${recipe.homepage}`);

  const stateHash = recipe.state_hash || '';
  console.log(`🔑 State Hash:    ${stateHash ? stateHash.slice(0, 16) + '...' : '(none)'}`);
  if (!force && stateHash && (await checkExistingReleaseHash(recipe.name, channel, stateHash))) {
    console.log(`⚡ Release State:  MATCHED EXISTING RELEASE (would skip without --force)`);
  } else {
    console.log(`⚡ Release State:  NEEDS BUILD (state hash differs or --force specified)`);
  }

  const buildDeps = recipe.build_deps || [];
  const runDeps = recipe.deps || [];
  console.log(`🔧 Build Deps:    ${buildDeps.length > 0 ? buildDeps.join(', ') : '(none)'}`);
  console.log(`🔗 Runtime Deps:  ${runDeps.length > 0 ? runDeps.join(', ') : '(none)'}`);

  if (recipe.source) {
    const srcUrl = recipe.source.replace(/\{version\}/g, recipe.version);
    console.log(`🌐 Source URL:    ${srcUrl}`);
    console.log(`🛡️ Source SHA256: ${recipe.sha256 || '(unspecified)'}`);
  } else {
    console.log(`🌐 Source:        (local files only)`);
  }

  const patchFolders = [join(pDir, 'patches'), join(pDir, `patches@${channel}`)];
  const patchesToApply: string[] = [];
  for (const pf of patchFolders) {
    if (existsSync(pf)) {
      for (const f of readdirSync(pf)) {
        if (f.endsWith('.patch')) patchesToApply.push(f);
      }
    }
  }
  console.log(`⚡ Patches:       ${patchesToApply.length > 0 ? patchesToApply.join(', ') : '(none)'}`);

  console.log(`🛠️ Build Phases:`);
  for (const phase of ['prepare', 'configure', 'make', 'install']) {
    const cmd = recipe.phases?.[phase];
    if (cmd) {
      console.log(`   - [${phase}]: ${cmd}`);
    } else {
      console.log(`   - [${phase}]: (skipped)`);
    }
  }

  console.log(`🎯 Expected Artifacts:`);
  const rawArch = (recipe.arch || 'aarch64').toLowerCase();
  const debArch = ARCH_MAP[rawArch] || rawArch;
  const filenameVer = formatDebianFilenameVersion(recipe);
  const versionStrPacman = recipe.revision > 0 ? `${recipe.version}-${recipe.revision}` : `${recipe.version}-1`;
  const versionStrApk = recipe.revision > 0 ? `${recipe.version}-r${recipe.revision}` : `${recipe.version}-r0`;
  const fmts = recipe.formats || ['apt', 'pacman', 'apk'];

  if (fmts.includes('apt')) {
    console.log(`   - apt:    ${recipe.name}_${filenameVer}_${debArch}.deb`);
  }
  if (fmts.includes('pacman')) {
    console.log(`   - pacman: ${recipe.name}-${versionStrPacman}-${rawArch}.pkg.tar.zst`);
  }
  if (fmts.includes('apk')) {
    console.log(`   - apk:    ${recipe.name}-${versionStrApk}.apk`);
  }
  console.log(`   - meta:   ${recipe.name}_metadata.json`);
  console.log(`   - meta:   ${recipe.name}_${channel}_metadata.json`);

  const testCmd = recipe.phases?.test || `${recipe.name} --version || ${recipe.name} --help`;
  console.log(`🧪 Smoke Test:   ${testCmd}`);
  console.log(`📂 Output Dir:   ${outputDir}`);
  console.log(`============================================================`);
  console.log(`✓ Dry-run simulation finished for ${recipe.name} (${command}).`);
  console.log(`============================================================\n`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const pkgDir = resolve('pkg');

  if (command === 'check') {
    auditRepositoryHealth(pkgDir);
    return;
  }

  if (['build', 'compile', 'pack', 'test', 'info'].includes(command)) {
    const rawTargets: string[] = [];
    let channel = 'latest';
    let force = false;
    let dryRun = false;
    let targetArch: string | undefined = undefined;
    let outputDirOverride: string | undefined = undefined;
    let skipDeps = false;
    let continueBuild = false;
    let cleanBuild = false;
    let formatOverride: string | undefined = undefined;
    let quiet = false;

    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg === '--channel' && args[i + 1]) {
        channel = args[++i];
      } else if ((arg === '-a' || arg === '--arch') && args[i + 1]) {
        targetArch = args[++i];
      } else if ((arg === '-o' || arg === '--output') && args[i + 1]) {
        outputDirOverride = args[++i];
      } else if (arg === '-f' || arg === '--force') {
        force = true;
      } else if (arg === '-d' || arg === '-n' || arg === '--dry-run') {
        dryRun = true;
      } else if (arg === '-s' || arg === '--skip-deps') {
        skipDeps = true;
      } else if (arg === '-c' || arg === '--continue') {
        continueBuild = true;
      } else if (arg === '-C' || arg === '--clean') {
        cleanBuild = true;
      } else if (arg === '--format' && args[i + 1]) {
        formatOverride = args[++i];
      } else if (arg === '-q' || arg === '--quiet') {
        quiet = true;
      } else if (!arg.startsWith('-')) {
        rawTargets.push(arg);
      }
    }

    if (rawTargets.length === 0) {
      console.error(
        `Usage: bun run scripts/cli/build.ts ${command} <package...> [options]\n\n` +
          `Options:\n` +
          `  --channel <channel>  Target channel (default: latest)\n` +
          `  -a, --arch <arch>    Target architecture override (aarch64, arm, x86_64, all)\n` +
          `  -o, --output <dir>   Package output directory (default: output/)\n` +
          `  -f, --force          Force build even if state_hash matches existing release\n` +
          `  -d, --dry-run        Detailed simulation mode without modifying files\n` +
          `  -s, --skip-deps      Skip downloading and resolving build dependencies\n` +
          `  -c, --continue       Continue build reusing existing source directory\n` +
          `  -C, --clean          Clean build destination directory before starting\n` +
          `  --format <formats>   Filter formats (comma-separated: apt, pacman, apk)\n` +
          `  -q, --quiet          Quiet output mode`,
      );
      process.exit(1);
    }

    const VALID_FORMATS = new Set(['apt', 'pacman', 'apk']);
    let parsedFormats: string[] | undefined;
    if (formatOverride !== undefined) {
      const candidates = formatOverride
        .split(',')
        .map((f: string) => f.trim().toLowerCase())
        .filter(Boolean);
      if (candidates.length === 0 || candidates.some((f) => !VALID_FORMATS.has(f))) {
        console.error(`Error: Invalid format override '${formatOverride}'. Supported formats: apt, pacman, apk.`);
        process.exit(1);
      }
      parsedFormats = candidates;
    }

    const dag = new DependencyGraph(pkgDir);
    const availablePkgs = Object.keys(dag.recipes);

    let targetNames: string[] = [];
    if (rawTargets.includes('all')) {
      targetNames = availablePkgs;
    } else {
      for (const t of rawTargets) {
        const baseName = basename(t);
        if (availablePkgs.includes(baseName)) {
          targetNames.push(baseName);
        } else if (existsSync(t)) {
          targetNames.push(baseName);
        } else {
          console.error(`Error: Unknown target package '${t}'.`);
          process.exit(1);
        }
      }
    }

    const sortedTargets = dag.resolveBuildOrder(targetNames);

    for (const pkgName of sortedTargets) {
      const pkgPath = join(pkgDir, pkgName);
      const pDir = existsSync(pkgPath) ? pkgPath : resolve(pkgName);
      const recipe = parseRecipe(pDir, channel);

      if (targetArch) {
        recipe.arch = targetArch;
      }
      if (parsedFormats) {
        recipe.formats = [...parsedFormats];
      }
      if (targetArch || parsedFormats) {
        recipe.state_hash = computeStateHash(recipe, pDir);
      }

      const destdir = resolve(join('build', `build_${recipe.name}`));
      const outputDir = outputDirOverride ? resolve(outputDirOverride) : resolve('output');
      const stageDir = join(destdir, 'stage');

      if (command === 'info' || dryRun) {
        await simulateDryRun(recipe, pDir, destdir, outputDir, channel, command, force);
        continue;
      }

      if (cleanBuild && existsSync(destdir)) {
        rmSync(destdir, { recursive: true, force: true });
      }

      if (command === 'compile' || command === 'build') {
        if (!force && recipe.state_hash && (await checkExistingReleaseHash(recipe.name, channel, recipe.state_hash))) {
          if (!quiet) console.log(`⏭️ Skipping ${recipe.name}@${channel}: state_hash unchanged.`);
          continue;
        }

        mkdirSync(destdir, { recursive: true });
        mkdirSync(stageDir, { recursive: true });

        // 1. Setup bionic compat if available
        try {
          setupBionicCompat();
        } catch {}

        // 2. Fetch build dependencies
        if (!skipDeps && recipe.build_deps && recipe.build_deps.length > 0) {
          await resolveAndFetchBuildDependencies(recipe.build_deps, destdir);
        }

        // 3. Fetch source and apply patches
        const workDir = fetchAndPrepareSource(recipe, pDir, destdir, continueBuild);

        // 4. Staging directories & environment
        const prefixDir = '/data/data/com.termux/files/usr';
        try {
          mkdirSync(join(prefixDir, 'lib'), { recursive: true });
          writeFileSync(join(prefixDir, 'lib', 'libpthread.so'), 'INPUT(-lc)\n');
          writeFileSync(join(prefixDir, 'lib', 'libpthread.a'), 'INPUT(-lc)\n');
        } catch {}

        const env: Record<string, string> = {
          ...(process.env as Record<string, string>),
          DESTDIR: stageDir,
          PREFIX: prefixDir,
          RECIPE_VERSION: recipe.version,
          RECIPE_EPOCH: String(recipe.epoch),
          ACTIVE_CHANNEL: channel,
          RECIPE_NDK: recipe.ndk || 'default',
          PKG_CONFIG_DIR: '',
          PKG_CONFIG_LIBDIR: `${prefixDir}/lib/pkgconfig:${prefixDir}/share/pkgconfig`,
          PKG_CONFIG_PATH: `${prefixDir}/lib/pkgconfig:${prefixDir}/share/pkgconfig`,
          PKG_CONFIG_SYSROOT_DIR: '',
        };

        // 5. Run compile phases inside workDir
        for (const phase of ['prepare', 'configure', 'make', 'install']) {
          const cmd = recipe.phases[phase];
          if (cmd) {
            if (!quiet) console.log(`[${recipe.name}] Running ${phase} phase...`);
            const res = spawnSync('sh', ['-c', cmd], { stdio: 'inherit', env, cwd: workDir });
            if (res.status !== 0) {
              throw new Error(`${phase} phase failed for ${recipe.name}`);
            }
          }
        }

        // 6. Copy static files/ if present
        const filesDir = join(pDir, 'files');
        if (existsSync(filesDir)) {
          const prefixDest = join(stageDir, 'data', 'data', 'com.termux', 'files', 'usr');
          mkdirSync(prefixDest, { recursive: true });
          const cpRes = spawnSync('cp', ['-a', `${filesDir}/.`, `${prefixDest}/`]);
          if (cpRes.status !== 0) {
            throw new Error(`Failed to copy static files from ${filesDir} to ${prefixDest}`);
          }
        }

        if (command === 'build') {
          await executePack(recipe, pDir, destdir, outputDir);
          executeTest(recipe, destdir, outputDir);
        }
      } else if (command === 'pack') {
        if (!existsSync(stageDir)) {
          console.warn(`::warning:: stage_dir ${stageDir} does not exist for pack.`);
          continue;
        }
        await executePack(recipe, pDir, destdir, outputDir);
      } else if (command === 'test') {
        if (!existsSync(stageDir) && !existsSync(join(outputDir, `${recipe.name}_metadata.json`))) {
          if (!quiet) console.log(`Notice: Neither stage_dir nor package output exist for test (${recipe.name}).`);
          continue;
        }
        executeTest(recipe, destdir, outputDir);
      }
    }
  } else {
    console.log('RepoExe Build System CLI (Bun/TypeScript)');
    console.log('Commands: check, build, compile, pack, test, info');
  }
}

if (import.meta.main) {
  main();
}
