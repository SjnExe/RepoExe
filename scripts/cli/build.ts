import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { checkExistingReleaseHash } from "../core/fetcher.ts";
import { parseRecipe } from "../core/parser.ts";
import { auditRepositoryHealth } from "../utils/health.ts";
import { buildDeb, ARCH_MAP, formatDebianFilenameVersion } from "../builders/debian.ts";
import { buildPacman } from "../builders/pacman.ts";
import { buildAlpine } from "../builders/alpine.ts";
import { sanitizeStagingElfs } from "../sanitizer/elf.ts";
import { sanitizeShebangs } from "../sanitizer/shebang.ts";
import { spawnSync } from "node:child_process";
import { DependencyGraph } from "../utils/dag.ts";

export async function executePack(
  recipe: any,
  pkgDir: string,
  destdir: string,
  outputDir: string
): Promise<void> {
  mkdirSync(outputDir, { recursive: true });
  const stageDir = join(destdir, "stage");

  sanitizeStagingElfs(stageDir);
  sanitizeShebangs(stageDir);

  const fmts = recipe.formats || ["apt", "pacman", "apk"];
  if (fmts.includes("apt")) {
    buildDeb(recipe, destdir, outputDir, recipe.arch);
  }
  if (fmts.includes("pacman")) {
    buildPacman(recipe, destdir, outputDir, recipe.arch);
  }
  if (fmts.includes("apk")) {
    buildAlpine(recipe, destdir, outputDir, recipe.arch);
  }

  const meta = {
    name: recipe.name,
    version: recipe.version,
    revision: recipe.revision,
    arch: recipe.arch,
    state_hash: recipe.state_hash || "",
    channel: recipe.active_channel || "latest",
  };
  const metaContent = JSON.stringify(meta, null, 2);
  await Bun.write(join(outputDir, `${recipe.name}_metadata.json`), metaContent);
  await Bun.write(join(outputDir, `${recipe.name}_${meta.channel}_metadata.json`), metaContent);
}

export function executeTest(recipe: any, destdir?: string, outputDir?: string): void {
  const testCmd = recipe.phases?.test || `${recipe.name} --version || ${recipe.name} --help`;
  console.log(`Running smoke test for ${recipe.name}: ${testCmd}`);

  const localOutputDir = outputDir ? resolve(outputDir) : resolve("output");
  const relOutputDir = relative(resolve("."), localOutputDir);
  const hostWorkspace = process.env.GITHUB_WORKSPACE || resolve(".");
  const hostOutputDir = relOutputDir.startsWith("..") ? localOutputDir : join(hostWorkspace, relOutputDir);

  const hasDockerSocket = existsSync("/var/run/docker.sock");

  if (hasDockerSocket) {
    const owner = (process.env.REPO_OWNER || "sjnexe").toLowerCase();
    const rawArch = (recipe.arch || "aarch64").toLowerCase();
    const debArch = ARCH_MAP[rawArch] || rawArch;
    const filenameVer = formatDebianFilenameVersion(recipe);
    const targetDeb = `${recipe.name}_${filenameVer}_${debArch}.deb`;
    const escapedCmd = testCmd.replace(/'/g, "'\\''");

    const archKey = `TESTER_IMAGE_${rawArch.toUpperCase()}`;
    const testerImage = process.env[archKey] || process.env.TESTER_IMAGE || `ghcr.io/${owner}/repoexe-tester:latest`;
    const containerPkgDir = "/data/data/com.termux/files/usr/tmp/repoexe-pkg";

    // Multi-package & sibling-aware package installer with forced architecture and dependency resolution
    const installCommands = [
      "set -e",
      "INSTALLED=0",
      // Install all available .deb packages in package staging dir with forced architecture & dependencies
      `if ls ${containerPkgDir}/*.deb 1>/dev/null 2>&1; then dpkg -i --force-architecture --force-depends ${containerPkgDir}/*.deb 2>/dev/null || true; fi`,
      // Specifically unpack the target package matching current name, version and arch
      `if [ -f "${containerPkgDir}/${targetDeb}" ]; then dpkg-deb -x "${containerPkgDir}/${targetDeb}" /; INSTALLED=1; elif ls ${containerPkgDir}/*.deb 1>/dev/null 2>&1; then for f in ${containerPkgDir}/*.deb; do if [ -f "$f" ]; then dpkg-deb -x "$f" /; INSTALLED=1; fi; done; fi`,
      // If pacman packages are present, extract them into /
      `if ls ${containerPkgDir}/*.pkg.tar.* 1>/dev/null 2>&1; then for f in ${containerPkgDir}/*.pkg.tar.*; do if [ -f "$f" ]; then tar -xf "$f" -C /; INSTALLED=1; fi; done; fi`,
      // If apk packages are present, extract them into /
      `if ls ${containerPkgDir}/*.apk 1>/dev/null 2>&1; then for f in ${containerPkgDir}/*.apk; do if [ -f "$f" ]; then tar -xf "$f" -C /; INSTALLED=1; fi; done; fi`,
      `if [ "$INSTALLED" -eq 0 ]; then echo "::error:: No package artifacts found in ${containerPkgDir} to install for smoke testing!"; exit 1; fi`,
      "chmod +x ${PREFIX:-/data/data/com.termux/files/usr}/bin/* 2>/dev/null || true",
      `timeout 120s sh -c '${escapedCmd}'`,
    ];

    const installAndTest = installCommands.join("; ");

    console.log(`Executing container smoke test via ${testerImage} (${rawArch})...`);
    const dockerArgs = [
      "run",
      "--rm",
      "--volume",
      `${hostOutputDir}:${containerPkgDir}:ro`,
      "--workdir",
      "/data/data/com.termux/files/home",
      "-e",
      "PREFIX=/data/data/com.termux/files/usr",
      "-e",
      "PATH=/data/data/com.termux/files/usr/bin:/bin:/usr/bin",
      "-e",
      "LD_LIBRARY_PATH=/data/data/com.termux/files/usr/lib",
      "-e",
      "HOME=/data/data/com.termux/files/home",
      "-e",
      `TARGET_ARCH=${rawArch}`,
      testerImage,
      "sh",
      "-c",
      installAndTest,
    ];

    const res = spawnSync("docker", dockerArgs, { stdio: "inherit", timeout: 150_000 });
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
  const buildDir = resolve("build");
  const siblingBins: string[] = [];
  const siblingLibs: string[] = [];
  if (existsSync(buildDir)) {
    for (const b of readdirSync(buildDir)) {
      const bPath = join(buildDir, b, "stage", "data", "data", "com.termux", "files", "usr");
      const binDir = join(bPath, "bin");
      const libDir = join(bPath, "lib");
      if (existsSync(binDir)) siblingBins.push(binDir);
      if (existsSync(libDir)) siblingLibs.push(libDir);
    }
  }

  const stageBin = destdir ? `${destdir}/stage/data/data/com.termux/files/usr/bin` : "";
  const stageLib = destdir ? `${destdir}/stage/data/data/com.termux/files/usr/lib` : "";
  const env = {
    ...process.env,
    PREFIX: process.env.PREFIX || "/data/data/com.termux/files/usr",
    PATH: [stageBin, ...siblingBins, process.env.PATH].filter(Boolean).join(":"),
    LD_LIBRARY_PATH: [stageLib, ...siblingLibs, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":"),
  };
  const res = spawnSync("sh", ["-c", testCmd], { stdio: "inherit", env, timeout: 60_000, killSignal: "SIGKILL" });
  if (res.status !== 0) {
    throw new Error(`Smoke test failed with exit code ${res.status} for ${recipe.name}`);
  }
  console.log(`✓ Smoke test passed locally for ${recipe.name}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  const pkgDir = resolve("pkg");

  if (command === "check") {
    auditRepositoryHealth(pkgDir);
    return;
  }

  if (["build", "compile", "pack", "test"].includes(command)) {
    const rawTargets: string[] = [];
    let channel = "latest";
    let force = false;
    let dryRun = false;

    for (let i = 1; i < args.length; i++) {
      if (args[i] === "--channel" && args[i + 1]) {
        channel = args[++i];
      } else if (args[i] === "--force") {
        force = true;
      } else if (args[i] === "--dry-run") {
        dryRun = true;
      } else if (!args[i].startsWith("-")) {
        rawTargets.push(args[i]);
      }
    }

    if (rawTargets.length === 0) {
      console.error(`Usage: bun run scripts/cli/build.ts ${command} <package...> [--channel <channel>] [--force] [--dry-run]`);
      process.exit(1);
    }

    const dag = new DependencyGraph(pkgDir);
    const availablePkgs = Object.keys(dag.recipes);

    let targetNames: string[] = [];
    if (rawTargets.includes("all")) {
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

      const destdir = resolve(join("build", `build_${recipe.name}`));
      const outputDir = resolve("output");
      const stageDir = join(destdir, "stage");

      if (command === "compile" || command === "build") {
        if (dryRun) {
          console.log(`✓ Dry-run complete for ${recipe.name} (${command}).`);
          continue;
        }

        if (!force && recipe.state_hash && (await checkExistingReleaseHash(recipe.name, channel, recipe.state_hash))) {
          console.log(`⏭️ Skipping ${recipe.name}@${channel}: state_hash unchanged.`);
          continue;
        }

        // Compile phases
        mkdirSync(stageDir, { recursive: true });
        const env = {
          ...process.env,
          DESTDIR: stageDir,
          PREFIX: "/data/data/com.termux/files/usr",
          RECIPE_VERSION: recipe.version,
          RECIPE_EPOCH: String(recipe.epoch),
          ACTIVE_CHANNEL: channel,
        };

        for (const phase of ["prepare", "configure", "make", "install"]) {
          const cmd = recipe.phases[phase];
          if (cmd) {
            console.log(`[${recipe.name}] Running ${phase} phase...`);
            const res = spawnSync("sh", ["-c", cmd], { stdio: "inherit", env, cwd: pDir });
            if (res.status !== 0) {
              throw new Error(`${phase} phase failed for ${recipe.name}`);
            }
          }
        }

        if (command === "build") {
          await executePack(recipe, pDir, destdir, outputDir);
          executeTest(recipe, destdir, outputDir);
        }
      } else if (command === "pack") {
        if (!existsSync(stageDir)) {
          console.warn(`::warning:: stage_dir ${stageDir} does not exist for pack.`);
          continue;
        }
        if (dryRun) {
          console.log(`✓ Dry-run complete for ${recipe.name} (${command}).`);
          continue;
        }
        await executePack(recipe, pDir, destdir, outputDir);
      } else if (command === "test") {
        if (!existsSync(stageDir) && !existsSync(join(outputDir, `${recipe.name}_metadata.json`))) {
          console.log(`Notice: Neither stage_dir nor package output exist for test (${recipe.name}).`);
          continue;
        }
        executeTest(recipe, destdir, outputDir);
      }
    }
  } else {
    console.log("RepoExe Build System CLI (Bun/TypeScript)");
    console.log("Commands: check, build, compile, pack, test");
  }
}

if (import.meta.main) {
  main();
}
