export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    const parts = pathname.split('/').filter(Boolean);
    if (parts.length === 0) {
      return new Response('RepoExe NPM Proxy', { status: 200 });
    }

    const pkgName = parts[0];
    let targetPath = pathname;

    // Map any package metadata request (e.g. /tsc/7.0.2) to /tsc/package.json
    if (!pathname.endsWith('.tgz')) {
      targetPath = `/${pkgName}/package.json`;
    }

    // 1. Query local RepoExe store on GitHub Pages first
    const repoexeUrl = `https://sjnexe.github.io/RepoExe/npm${targetPath}`;
    const localRes = await fetch(repoexeUrl, {
      headers: { 
        'User-Agent': 'RepoExe-Proxy',
        'Accept': 'application/json'
      }
    });

    if (localRes.status === 200) {
      const headers = new Headers(localRes.headers);
      headers.set('Content-Type', pathname.endsWith('.tgz') ? 'application/gzip' : 'application/json');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(localRes.body, {
        status: 200,
        headers: headers
      });
    }

    // 2. Fall back to upstream npmjs.org for unhosted public packages
    const upstreamUrl = `https://registry.npmjs.org${pathname}`;
    return fetch(upstreamUrl, {
      headers: { 
        'User-Agent': request.headers.get('User-Agent') || 'RepoExe-Proxy',
        'Accept': request.headers.get('Accept') || '*/*'
      }
    });
  }
};
