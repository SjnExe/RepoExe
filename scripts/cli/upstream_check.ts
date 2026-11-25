import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { parseRecipe } from '../core/parser.ts';
import type { PackageRecipe } from '../core/types.ts';

function getGitHubHeaders(): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': 'RepoExe' };
  const token = process.env.GH_PAT || process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

export function extractSemver(raw: string): string | null {
  const match = raw.match(/v?(\d+\.\d+(?:\.\d+)?(?:[a-zA-Z0-9.-]+)?)/);
  return match ? match[1] : null;
}

export function compareSemver(a: string, b: string): number {
  const parseParts = (v: string) => {
    const withoutBuild = v.split('+')[0];
    const dashIdx = withoutBuild.indexOf('-');
    let mainStr = withoutBuild;
    let preStr = '';
    if (dashIdx !== -1) {
      mainStr = withoutBuild.slice(0, dashIdx);
      preStr = withoutBuild.slice(dashIdx + 1);
    }
    const num = mainStr.split('.').map((x) => parseInt(x, 10) || 0);
    return { num, pre: preStr };
  };

  const pa = parseParts(a);
  const pb = parseParts(b);
  const maxLen = Math.max(pa.num.length, pb.num.length);
  for (let i = 0; i < maxLen; i++) {
    const na = pa.num[i] || 0;
    const nb = pb.num[i] || 0;
    if (na !== nb) {
      return na - nb;
    }
  }

  if (!pa.pre && pb.pre) {
    return 1;
  }
  if (pa.pre && !pb.pre) {
    return -1;
  }
  if (!pa.pre && !pb.pre) {
    return 0;
  }

  const preA = pa.pre.split('.');
  const preB = pb.pre.split('.');
  const preLen = Math.max(preA.length, preB.length);

  for (let i = 0; i < preLen; i++) {
    const partA = preA[i];
    const partB = preB[i];
    if (partA === undefined) {
      return -1;
    }
    if (partB === undefined) {
      return 1;
    }
    if (partA === partB) {
      continue;
    }

    const isNumA = /^\d+$/.test(partA);
    const isNumB = /^\d+$/.test(partB);

    if (isNumA && isNumB) {
      const diff = parseInt(partA, 10) - parseInt(partB, 10);
      if (diff !== 0) {
        return diff;
      }
    } else if (isNumA && !isNumB) {
      return -1;
    } else if (!isNumA && isNumB) {
      return 1;
    } else {
      const cmp = partA.localeCompare(partB);
      if (cmp !== 0) {
        return cmp;
      }
    }
  }

  return 0;
}

export async function fetchGithubRelease(owner: string, repo: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;
  try {
    const resp = await fetch(url, { headers: getGitHubHeaders(), signal: AbortSignal.timeout(10_000) });
    if (resp.ok) {
      const data = (await resp.json()) as { tag_name?: string };
      const tag = data.tag_name || '';
      return extractSemver(tag);
    }
  } catch {}
  return null;
}

export async function fetchGithubTag(owner: string, repo: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${owner}/${repo}/tags?per_page=100`;
  try {
    const resp = await fetch(url, { headers: getGitHubHeaders(), signal: AbortSignal.timeout(10_000) });
    if (resp.ok) {
      const data = (await resp.json()) as Array<{ name?: string }>;
      const versions: string[] = [];
      for (const t of data) {
        const rawName = t.name || '';
        const ver = extractSemver(rawName);
        if (!ver) {
          continue;
        }
        const dashIdx = ver.indexOf('-');
        if (dashIdx !== -1) {
          const pre = ver.slice(dashIdx + 1);
          if (/(alpha|beta|rc|dev|test)/i.test(pre)) {
            continue;
          }
        }
        versions.push(ver);
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
  const res = Bun.spawnSync(['git', 'ls-remote', '--tags', '--refs', cleanUrl], { stdout: 'pipe', stderr: 'pipe' });
  const stdout = res.stdout ? new TextDecoder().decode(res.stdout) : '';
  if (res.exitCode === 0 && stdout) {
    const lines = stdout.trim().split('\n');
    const versions: string[] = [];
    for (const line of lines) {
      if (line.includes('^{}')) {
        continue;
      }
      const tag = line.split('/').pop() || '';
      const ver = extractSemver(tag);
      if (!ver) {
        continue;
      }
      const dashIdx = ver.indexOf('-');
      if (dashIdx !== -1) {
        const pre = ver.slice(dashIdx + 1);
        if (/(alpha|beta|rc|dev|test)/i.test(pre)) {
          continue;
        }
      }
      versions.push(ver);
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
  if (!strategy || !recipe.auto_update) {
    return null;
  }

  const srcUrl = recipe.source || '';
  if (strategy === 'github_release' || strategy === 'github_tag') {
    const match = srcUrl.match(/github\.com\/([^/]+)\/([^/.#]+)/);
    if (match) {
      const [, owner, repo] = match;
      if (strategy === 'github_release') {
        return await fetchGithubRelease(owner, repo);
      }
      if (strategy === 'github_tag') {
        return await fetchGithubTag(owner, repo);
      }
    }
  } else if (strategy === 'git_tag') {
    return fetchGitTag(srcUrl);
  } else if (strategy === 'custom' && recipe.custom_update_cmd) {
    const res = Bun.spawnSync(['sh', '-c', recipe.custom_update_cmd], { stdout: 'pipe', stderr: 'pipe' });
    const stdout = res.stdout ? new TextDecoder().decode(res.stdout) : '';
    if (res.exitCode === 0 && stdout) {
      return extractSemver(stdout.trim());
    }
  }
  return null;
}

export interface UpstreamUpdateCandidate {
  name: string;
  oldVersion: string;
  newVersion: string;
  heavy: boolean;
  maintainer?: string;
  uploaders?: string[];
}

async function main(): Promise<void> {
  const jsonMode = process.argv.includes('--json');
  const pkgsDir = resolve('pkg');
  const entries = readdirSync(pkgsDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name);

  const recipes: PackageRecipe[] = [];
  for (const name of entries) {
    const rFile = join(pkgsDir, name, 'recipe.ts');
    if (existsSync(rFile)) {
      try {
        const recipe = parseRecipe(rFile);
        if (recipe.auto_update) {
          recipes.push(recipe);
        }
      } catch {}
    }
  }

  const results: UpstreamUpdateCandidate[] = [];
  const CONCURRENCY = 8;
  for (let i = 0; i < recipes.length; i += CONCURRENCY) {
    const batch = recipes.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(
      batch.map(async (recipe) => {
        try {
          const latest = await checkPackageUpstream(recipe);
          if (latest && compareSemver(latest, recipe.version) > 0) {
            return {
              name: recipe.name,
              oldVersion: recipe.version,
              newVersion: latest,
              heavy: Boolean(
                recipe.heavy_build || (recipe.resources?.swap ?? 0) > 0 || (recipe.resources?.zram ?? 0) > 0,
              ),
              maintainer: recipe.maintainer,
              uploaders: recipe.uploaders,
            } satisfies UpstreamUpdateCandidate;
          }
        } catch {}
        return null;
      }),
    );
    for (const item of settled) {
      if (item) {
        results.push(item);
      }
    }
  }

  if (jsonMode) {
    console.log(JSON.stringify(results));
  } else {
    for (const item of results) {
      console.log(`Update available for ${item.name}: ${item.oldVersion} -> ${item.newVersion}`);
    }
  }
}

if (import.meta.main) {
  main();
}
