import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseRecipe } from "../core/parser.ts";
import type { PackageRecipe } from "../core/types.ts";

export function extractSemver(raw: string): string | null {
  const match = raw.match(/v?(\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]+)?)/);
  return match ? match[1] : null;
}

export async function fetchGithubRelease(owner: string, repo: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "RepoExe" } });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const tag = data.tag_name || "";
      return extractSemver(tag);
    }
  } catch {}
  return null;
}

export async function fetchGithubTag(owner: string, repo: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=10`;
  try {
    const resp = await fetch(url, { headers: { "User-Agent": "RepoExe" } });
    if (resp.ok) {
      const data = (await resp.json()) as any[];
      for (const t of data) {
        const ver = extractSemver(t.name || "");
        if (ver) return ver;
      }
    }
  } catch {}
  return null;
}

export function fetchGitTag(gitUrl: string): string | null {
  const cleanUrl = gitUrl.split("#")[0];
  const res = spawnSync("git", ["ls-remote", "--tags", "--refs", cleanUrl], { encoding: "utf-8" });
  if (res.status === 0 && res.stdout) {
    const lines = res.stdout.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const tag = lines[i].split("/").pop() || "";
      const ver = extractSemver(tag);
      if (ver) return ver;
    }
  }
  return null;
}

export async function checkPackageUpstream(recipe: PackageRecipe): Promise<string | null> {
  const strategy = recipe.update_strategy;
  if (!strategy || !recipe.auto_update) return null;

  const srcUrl = recipe.source || "";
  if (strategy === "github_release" || strategy === "github_tag") {
    const match = srcUrl.match(/github\.com\/([^\/]+)\/([^\/\.#]+)/);
    if (match) {
      const [, owner, repo] = match;
      if (strategy === "github_release") return await fetchGithubRelease(owner, repo);
      if (strategy === "github_tag") return await fetchGithubTag(owner, repo);
    }
  } else if (strategy === "git_tag") {
    return fetchGitTag(srcUrl);
  } else if (strategy === "custom" && recipe.custom_update_cmd) {
    const res = spawnSync("sh", ["-c", recipe.custom_update_cmd], { encoding: "utf-8" });
    if (res.status === 0 && res.stdout) {
      return extractSemver(res.stdout.trim());
    }
  }
  return null;
}

async function main(): Promise<void> {
  const pkgsDir = resolve("pkg");
  const entries = readdirSync(pkgsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const name of entries) {
    const rFile = join(pkgsDir, name, "pkg.yml");
    if (existsSync(rFile)) {
      try {
        const recipe = parseRecipe(rFile);
        if (recipe.auto_update) {
          const latest = await checkPackageUpstream(recipe);
          if (latest && latest !== recipe.version) {
            console.log(`Update available for ${recipe.name}: ${recipe.version} -> ${latest}`);
          }
        }
      } catch {}
    }
  }
}

if (import.meta.main) {
  main();
}
