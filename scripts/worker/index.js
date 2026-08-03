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

    if (pathname.endsWith('.tgz')) {
      targetPath = pathname.replace('/-/', '/');
    } else {
      targetPath = `/${pkgName}/package.json`;
    }

    // 1. Query local RepoExe store on GitHub Pages first
    const repoexeUrl = `https://sjnexe.github.io/RepoExe/npm${targetPath}`;

    // Timeout handler for Cloudflare worker proxy
    const controller = new AbortController();
    const timeout = setTimeout(() => { controller.abort(); }, 5000);

    try {
        const localRes = await fetch(repoexeUrl, {
          headers: {
            'User-Agent': 'RepoExe-Proxy',
            'Accept': 'application/json'
          },
          signal: controller.signal
        });
        clearTimeout(timeout);

        if (localRes.status === 200) {
          const headers = new Headers(localRes.headers);
          headers.set('Content-Type', pathname.endsWith('.tgz') ? 'application/gzip' : 'application/json');
          headers.set('Access-Control-Allow-Origin', '*');

          // Stream the response for large tarballs
          return new Response(localRes.body, {
            status: 200,
            headers: headers
          });
        }
    } catch (e) {
        clearTimeout(timeout);
        // Fallback below
    }

    // 2. Fall back to upstream npmjs.org for unhosted public packages
    const upstreamUrl = `https://registry.npmjs.org${pathname}`;
    const upstreamController = new AbortController();
    const upstreamTimeout = setTimeout(() => { upstreamController.abort(); }, 15000);
    try {
        const res = await fetch(upstreamUrl, {
          headers: {
            'User-Agent': request.headers.get('User-Agent') || 'RepoExe-Proxy',
            'Accept': request.headers.get('Accept') || '*/*'
          },
          signal: upstreamController.signal
        });
        clearTimeout(upstreamTimeout);
        return res;
    } catch (e) {
        clearTimeout(upstreamTimeout);
        return new Response('Upstream timeout', { status: 504 });
    }
  }
};
