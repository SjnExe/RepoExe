import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseRecipe } from '../core/parser.ts';
import type { PackageRecipe } from '../core/types.ts';

export function extractSemver(raw: string): string | null {
  const match = raw.match(/v?(\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]+)?)/);
  return match ? match[1] : null;
}

export function compareSemver(a: string, b: string): number {
  const parseParts = (v: string) => {
    const [main, pre] = v.split('-');
    const num = (main || '').split('.').map((x) => parseInt(x, 10) || 0);
    return { num, pre };
  };
  const pa = parseParts(a);
  const pb = parseParts(b);
  const maxLen = Math.max(pa.num.length, pb.num.length);
  for (let i = 0; i < maxLen; i++) {
    const na = pa.num[i] || 0;
    const nb = pb.num[i] || 0;
    if (na !== nb) return na - nb;
  }
  if (!pa.pre && pb.pre) return 1;
  if (pa.pre && !pb.pre) return -1;
  if (pa.pre && pb.pre) return pa.pre.localeCompare(pb.pre);
  return 0;
}

export async function fetchGithubRelease(owner: string, repo: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'RepoExe' } });
    if (resp.ok) {
      const data = (await resp.json()) as any;
      const tag = data.tag_name || '';
      return extractSemver(tag);
    }
  } catch {}
  return null;
}

export async function fetchGithubTag(owner: string, repo: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`;
  try {
    const resp = await fetch(url, { headers: { 'User-Agent': 'RepoExe' } });
    if (resp.ok) {
      const data = (await resp.json()) as any[];
      const versions: string[] = [];
      for (const t of data) {
        const rawName = t.name || '';
        if (/(alpha|beta|rc|dev|test)/i.test(rawName)) continue;
        const ver = extractSemver(rawName);
        if (ver) versions.push(ver);
      }
      if (versions.length > 0) {
        versions.sort(compareSemver);
        return versions[versions.length - 1];
      }
    }
  } catch {}
  return null;
}

export function fetchGitTag(gitUrl: string): string | null {
  const cleanUrl = gitUrl.split('#')[0];
  const res = spawnSync('git', ['ls-remote', '--tags', '--refs', cleanUrl], { encoding: 'utf-8' });
  if (res.status === 0 && res.stdout) {
    const lines = res.stdout.trim().split('\n');
    const versions: string[] = [];
    for (const line of lines) {
      if (line.includes('^{}')) continue;
      const tag = line.split('/').pop() || '';
      if (/(alpha|beta|rc|dev|test)/i.test(tag)) continue;
      const ver = extractSemver(tag);
      if (ver) versions.push(ver);
    }
    if (versions.length > 0) {
      versions.sort(compareSemver);
      return versions[versions.length - 1];
    }
  }
  return null;
}

export async function checkPackageUpstream(recipe: PackageRecipe): Promise<string | null> {
  const strategy = recipe.update_strategy;
  if (!strategy || !recipe.auto_update) return null;

  const srcUrl = recipe.source || '';
  if (strategy === 'github_release' || strategy === 'github_tag') {
    const match = srcUrl.match(/github\.com\/([^\/]+)\/([^\/\.#]+)/);
    if (match) {
      const [, owner, repo] = match;
      if (strategy === 'github_release') return await fetchGithubRelease(owner, repo);
      if (strategy === 'github_tag') return await fetchGithubTag(owner, repo);
    }
  } else if (strategy === 'git_tag') {
    return fetchGitTag(srcUrl);
  } else if (strategy === 'custom' && recipe.custom_update_cmd) {
    const res = spawnSync('sh', ['-c', recipe.custom_update_cmd], { encoding: 'utf-8' });
    if (res.status === 0 && res.stdout) {
      return extractSemver(res.stdout.trim());
    }
  }
  return null;
}

async function main(): Promise<void> {
  const pkgsDir = resolve('pkg');
  const entries = readdirSync(pkgsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  for (const name of entries) {
    const rFile = join(pkgsDir, name, 'recipe.ts');
    if (existsSync(rFile)) {
      try {
        const recipe = parseRecipe(rFile);
        if (recipe.auto_update) {
          const latest = await checkPackageUpstream(recipe);
          if (latest && compareSemver(latest, recipe.version) > 0) {
            const channel = recipe.active_channel || 'latest';
            console.log(`Update available for ${recipe.name}@${channel}: ${recipe.version} -> ${latest}`);
          }
        }
      } catch {}
    }
  }
}

if (import.meta.main) {
  main();
}
