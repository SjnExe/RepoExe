import { existsSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import { generatePackagesJson } from '../utils/metadata.ts';
import { buildSiteFrontend } from '../utils/site_builder.ts';

const repoRoot = resolve('.');
const siteDir = resolve('site');
const port = Number(process.env.PORT || 3000);

await buildSiteFrontend(repoRoot, siteDir);

const packagesJsonPath = join(siteDir, 'packages.json');
if (!existsSync(packagesJsonPath)) {
  generatePackagesJson(join(repoRoot, 'pkg'), packagesJsonPath);
}

const server = Bun.serve({
  port,
  hostname: '127.0.0.1',
  async fetch(req) {
    const url = new URL(req.url);
    const rawPath = decodeURIComponent(url.pathname);
    const relPath = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '');
    const filePath = resolve(siteDir, relPath);

    if (filePath !== siteDir && !filePath.startsWith(siteDir + sep)) {
      return new Response('Forbidden', { status: 403 });
    }

    const file = Bun.file(filePath);
    if (await file.exists()) {
      return new Response(file);
    }

    return new Response('Not Found', { status: 404 });
  },
});

console.log(`RepoExe site preview running at http://localhost:${server.port}`);
