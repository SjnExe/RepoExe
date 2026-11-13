import { existsSync, mkdirSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { checkExistingReleaseHash } from "../core/fetcher.ts";
import { parseRecipe } from "../core/parser.ts";
import { auditRepositoryHealth } from "../utils/health.ts";
import { buildDeb } from "../builders/debian.ts";
import { buildPacman } from "../builders/pacman.ts";
import { buildAlpine } from "../builders/alpine.ts";
import { sanitizeStagingElfs } from "../sanitizer/elf.ts";
import { sanitizeShebangs } from "../sanitizer/shebang.ts";
import { spawnSync } from "node:child_process";

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
  await Bun.write(join(outputDir, `${recipe.name}_metadata.json`), JSON.stringify(meta, null, 2));
}

export function executeTest(recipe: any, destdir?: string, outputDir?: string): void {
  const testCmd = recipe.phases?.test || `${recipe.name} --version || ${recipe.name} --help`;
  console.log(`Running smoke test for ${recipe.name}: ${testCmd}`);

  const hasDockerSocket = existsSync("/var/run/docker.sock");
  const hostWorkspace = process.env.GITHUB_WORKSPACE || resolve(".");
  const hostOutputDir = join(hostWorkspace, "output");
  const localOutputDir = outputDir || resolve("output");

  if (hasDockerSocket) {
    const owner = (process.env.REPO_OWNER || "sjnexe").toLowerCase();
    const testerImage = process.env.TESTER_IMAGE || `ghcr.io/${owner}/repoexe-tester:latest`;

    let debFilename = "";
    if (existsSync(localOutputDir)) {
      const files = readdirSync(localOutputDir);
      const match = files.find((f) => f.startsWith(`${recipe.name}_`) && f.endsWith(".deb"));
      if (match) debFilename = match;
    }

    const installAndTest = debFilename
      ? `set -e; dpkg -i /tmp/repoexe-pkg/${debFilename} || true; timeout 120s ${testCmd}`
      : `set -e; timeout 120s ${testCmd}`;

    console.log(`Executing container smoke test via ${testerImage}...`);
    const dockerArgs = [
      "run",
      "--rm",
      "--volume",
      `${hostOutputDir}:/tmp/repoexe-pkg:ro`,
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

  // Fallback: Local execution on native Termux device
  const env = { ...process.env, PATH: `${destdir}/stage/data/data/com.termux/files/usr/bin:${process.env.PATH}` };
  const res = spawnSync("sh", ["-c", testCmd], { stdio: "inherit", env, timeout: 60_000 });
  if (res.status !== 0) {
    throw new Error(`Smoke test failed with exit code ${res.status} for ${recipe.name}`);
  }
  console.log(`✓ Local smoke test passed for ${recipe.name}`);
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
    const pkgTarget = args[1];
    if (!pkgTarget) {
      console.error(`Usage: bun run scripts/cli/build.ts ${command} <package> [--channel <channel>] [--force] [--dry-run]`);
      process.exit(1);
    }

    let channel = "latest";
    let force = false;
    let dryRun = false;

    for (let i = 2; i < args.length; i++) {
      if (args[i] === "--channel" && args[i + 1]) {
        channel = args[++i];
      } else if (args[i] === "--force") {
        force = true;
      } else if (args[i] === "--dry-run") {
        dryRun = true;
      }
    }

    let pkgPath = resolve(pkgTarget);
    if (!existsSync(pkgPath)) {
      pkgPath = join(pkgDir, pkgTarget);
    }
    const pDir = existsSync(pkgPath) && (await Bun.file(pkgPath).exists()) ? dirname(pkgPath) : pkgPath;
    const recipe = parseRecipe(pkgPath, channel);

    const destdir = resolve(join("build", `build_${recipe.name}`));
    const outputDir = resolve("output");
    const stageDir = join(destdir, "stage");

    if (command === "compile" || command === "build") {
      if (!force && recipe.state_hash && (await checkExistingReleaseHash(recipe.name, channel, recipe.state_hash))) {
        console.log(`⏭️ Skipping ${recipe.name}@${channel}: state_hash unchanged.`);
        return;
      }

      if (dryRun) {
        console.log(`✓ Dry-run complete for ${recipe.name} (${command}).`);
        return;
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
        return;
      }
      if (dryRun) {
        console.log(`✓ Dry-run complete for ${recipe.name} (${command}).`);
        return;
      }
      await executePack(recipe, pDir, destdir, outputDir);
    } else if (command === "test") {
      if (!existsSync(stageDir)) {
        console.log(`Notice: stage_dir ${stageDir} does not exist for test.`);
        return;
      }
      executeTest(recipe, destdir, outputDir);
    }
  } else {
    console.log("RepoExe Build System CLI (Bun/TypeScript)");
    console.log("Commands: check, build, compile, pack, test");
  }
}

if (import.meta.main) {
  main();
}
