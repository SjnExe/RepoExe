export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. Query local RepoExe store first for custom compiled packages
    const repoexeUrl = `https://sjnexe.github.io/RepoExe/npm${url.pathname}`;
    const localRes = await fetch(repoexeUrl, {
      headers: { 'User-Agent': 'RepoExe-Proxy' }
    });

    if (localRes.status === 200) {
      return localRes;
    }

    // 2. Fall back to upstream npmjs.org for standard public packages
    const upstreamUrl = `https://registry.npmjs.org${url.pathname}`;
    return fetch(upstreamUrl, {
      headers: { 
        'User-Agent': request.headers.get('User-Agent') || 'RepoExe-Proxy',
        'Accept': request.headers.get('Accept') || '*/*'
      }
    });
  }
};
