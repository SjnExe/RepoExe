export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Resolve static file path on GitHub Pages
    let targetPath = pathname;
    if (!pathname.endsWith('.tgz') && !pathname.endsWith('.json')) {
      targetPath = `${pathname.replace(/\/$/, '')}/package.json`;
    }

    // 1. Query local RepoExe store on GitHub Pages first
    const repoexeUrl = `https://sjnexe.github.io/RepoExe/npm${targetPath}`;
    const localRes = await fetch(repoexeUrl, {
      headers: { 'User-Agent': 'RepoExe-Proxy' }
    });

    if (localRes.status === 200) {
      return localRes;
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
