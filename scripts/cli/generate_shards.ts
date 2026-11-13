import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { checkExistingReleaseHash } from "../core/fetcher.ts";
import { parseRecipe } from "../core/parser.ts";
import { DependencyGraph } from "../utils/dag.ts";

export function getGitDiffFiles(repoRoot: string): Set<string> {
  const baseRef = (process.env.GITHUB_BASE_REF || "").trim();
  const diffCmd = baseRef
    ? ["diff", "--name-only", `origin/${baseRef}...HEAD`]
    : ["diff", "--name-only", "HEAD~1", "HEAD"];

  let res = spawnSync("git", diffCmd, { cwd: repoRoot, encoding: "utf-8" });
  if (res.status !== 0 || !res.stdout?.trim()) {
    res = spawnSync("git", ["diff", "--name-only", "HEAD"], { cwd: repoRoot, encoding: "utf-8" });
  }

  if (res.status === 0 && res.stdout?.trim()) {
    return new Set(res.stdout.split("\n").map((f) => f.trim()).filter(Boolean));
  }
  return new Set();
}

export function getChangedPackages(repoRoot: string, dag?: DependencyGraph): Set<string> {
  const files = getGitDiffFiles(repoRoot);
  const changed = new Set<string>();

  for (const f of files) {
    const parts = f.split("/");
    if (parts.length >= 2 && parts[0] === "pkg") {
      changed.add(parts[1]);
    }
  }

  if (dag) {
    const builderFormatMap: Record<string, string> = {
      "debian.ts": "apt",
      "pacman.ts": "pacman",
      "alpine.ts": "apk",
    };

    for (const f of files) {
      const parts = f.split("/");
      if (parts.length >= 3 && parts[0] === "scripts" && parts[1] === "builders") {
        const targetFmt = builderFormatMap[parts[2]];
        if (targetFmt) {
          for (const [pkgName, recipe] of Object.entries(dag.recipes)) {
            if (recipe.formats.includes(targetFmt)) {
              changed.add(pkgName);
            }
          }
        }
      }
    }

    // Include transitive downstream dependents so updating a dependency triggers rebuild & testing
    const directChanged = Array.from(changed);
    for (const p of directChanged) {
      for (const dep of dag.getDependents(p)) {
        changed.add(dep);
      }
    }
  }

  return changed;
}

export function getAvailableChannels(pkg: string, dag: DependencyGraph): Set<string> {
  const recipe = dag.recipes[pkg];
  if (!recipe) return new Set(["latest"]);
  const set = new Set(["latest"]);
  if (recipe.channels) {
    for (const ch of Object.keys(recipe.channels)) {
      set.add(ch);
    }
  }
  return set;
}

export function parseTargetTokens(
  rawInput: string,
  dag: DependencyGraph,
  pkgsDir: string
): Array<[string, string]> {
  const allPkgs = new Set(Object.keys(dag.recipes));
  const tokens = rawInput.trim().split(/\s+/).filter(Boolean);

  const selectedPairs = new Set<string>();
  const excludedPairs = new Set<string>();
  const excludedPkgs = new Set<string>();

  let hasPositiveSelection = false;

  for (let token of tokens) {
    const isExclude = token.startsWith("!");
    if (isExclude) token = token.slice(1);

    let targetPart = token;
    let channelPart = "latest";
    if (token.includes("@")) {
      const parts = token.split("@");
      targetPart = parts[0];
      channelPart = parts[1];
    }

    const matchedPkgs = new Set<string>();
    if (targetPart.startsWith("type:") || targetPart.startsWith("format:")) {
      const targetFmt = targetPart.split(":")[1];
      for (const [p, r] of Object.entries(dag.recipes)) {
        if (r.formats.includes(targetFmt)) matchedPkgs.add(p);
      }
    } else if (targetPart === "all") {
      for (const p of allPkgs) matchedPkgs.add(p);
    } else if (allPkgs.has(targetPart)) {
      matchedPkgs.add(targetPart);
    }

    const pairs = new Set<string>();
    for (const p of matchedPkgs) {
      const avail = getAvailableChannels(p, dag);
      if (channelPart === "all") {
        for (const ch of avail) pairs.add(`${p}@${ch}`);
      } else {
        pairs.add(`${p}@${channelPart}`);
      }
    }

    if (isExclude) {
      for (const pair of pairs) excludedPairs.add(pair);
      if (channelPart === "all") {
        for (const p of matchedPkgs) excludedPkgs.add(p);
      }
    } else {
      hasPositiveSelection = true;
      for (const pair of pairs) selectedPairs.add(pair);
    }
  }

  if (!hasPositiveSelection) {
    for (const p of allPkgs) {
      selectedPairs.add(`${p}@latest`);
    }
  }

  const finalRequested: Array<[string, string]> = [];
  for (const pair of selectedPairs) {
    if (!excludedPairs.has(pair)) {
      const [p, ch] = pair.split("@");
      finalRequested.push([p, ch]);
    }
  }

  return finalRequested;
}

export async function buildMatrixLayer(
  pkgsList: Array<[string, string]>,
  pkgsDir: string,
  dag: DependencyGraph
): Promise<Array<Record<string, any>>> {
  const matrix: Array<Record<string, any>> = [];
  const forceRebuild = ["true", "1"].includes((process.env.FORCE_REBUILD || "").toLowerCase());

  for (const [p, ch] of pkgsList) {
    const recipePath = join(pkgsDir, p, "pkg.yml");
    if (!existsSync(recipePath)) continue;

    try {
      const r = parseRecipe(recipePath, ch);
      const stateHash = r.state_hash || "";

      if (!forceRebuild && stateHash && (await checkExistingReleaseHash(p, ch, stateHash))) {
        console.error(`Notice: Skipping matrix shard for ${p}@${ch} (state_hash unchanged).`);
        continue;
      }

      let maxZram = r.resources.zram ?? 0;
      let maxSwap = r.resources.swap ?? 0;
      let maxFreeSpace = r.resources.free_space ?? false;

      for (const depName of r.build_deps) {
        const depRecipePath = join(pkgsDir, depName, "pkg.yml");
        if (existsSync(depRecipePath)) {
          const dr = parseRecipe(depRecipePath, "latest");
          maxZram = Math.max(maxZram, dr.resources.zram ?? 0);
          maxSwap = Math.max(maxSwap, dr.resources.swap ?? 0);
          maxFreeSpace = maxFreeSpace || (dr.resources.free_space ?? false);
        }
      }

      matrix.push({
        package: p,
        channel: ch,
        heavy: r.heavy_build || maxSwap > 0 || maxZram > 0,
        build_system: r.build_system,
        zram: maxZram,
        swap: maxSwap,
        free_space: maxFreeSpace,
        tmpfs: r.resources.tmpfs ?? 12,
      });
    } catch (err: any) {
      console.error(`Notice: Failed to build matrix layer for ${p}@${ch}: ${err.message}`);
    }
  }

  return matrix;
}

async function main(): Promise<void> {
  const repoRoot = resolve(".");
  const pkgsDir = join(repoRoot, "pkg");
  const rawInput = (process.env.TARGET_INPUT || "").trim();

  const dag = new DependencyGraph(pkgsDir);

  let targetPkgs: Array<[string, string]>;
  if (!rawInput || rawInput === "auto") {
    const diffFiles = getGitDiffFiles(repoRoot);
    const changedPkgs = Array.from(getChangedPackages(repoRoot, dag));
    if (changedPkgs.length > 0) {
      const tokens = changedPkgs.map((p) => `${p}@all`).join(" ");
      targetPkgs = parseTargetTokens(tokens, dag, pkgsDir);
    } else if (diffFiles.size > 0) {
      targetPkgs = [];
    } else {
      targetPkgs = parseTargetTokens("all@latest", dag, pkgsDir);
    }
  } else {
    targetPkgs = parseTargetTokens(rawInput, dag, pkgsDir);
  }

  const matrix = await buildMatrixLayer(targetPkgs, pkgsDir, dag);
  console.log(JSON.stringify({ matrix }));
}

if (import.meta.main) {
  main();
}
