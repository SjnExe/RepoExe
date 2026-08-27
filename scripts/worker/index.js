export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const search = url.search;

    // 1. Transparently proxy non-GET/HEAD requests to registry.npmjs.org
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      const upstreamUrl = `https://registry.npmjs.org${pathname}${search}`;
      const headers = new Headers(request.headers);
      headers.set('Host', 'registry.npmjs.org');
      return fetch(upstreamUrl, {
        method: request.method,
        headers: headers,
        body: request.body,
        redirect: 'follow'
      });
    }

    const decodedPath = decodeURIComponent(pathname);
    const parts = decodedPath.split('/').filter(Boolean);
    if (parts.length === 0) {
      return new Response('RepoExe NPM Proxy', { status: 200 });
    }

    // System endpoints (e.g., /-/npm/v1/..., /-/v1/search) don't exist in local store
    if (parts[0].startsWith('-')) {
      const upstreamUrl = `https://registry.npmjs.org${pathname}${search}`;
      const headers = new Headers(request.headers);
      headers.set('Host', 'registry.npmjs.org');
      return fetch(upstreamUrl, {
        method: request.method,
        headers: headers,
        redirect: 'follow'
      });
    }

    let pkgName = parts[0];
    if (parts[0].startsWith('@') && parts.length >= 2) {
      pkgName = `${parts[0]}/${parts[1]}`;
    }

    let targetPath = pathname;
    if (pathname.endsWith('.tgz')) {
      targetPath = pathname.replace('/-/', '/');
    } else {
      targetPath = `/${pkgName}/package.json`;
    }

    // 2. Query local RepoExe store on GitHub Pages first for GET/HEAD requests
    const repoexeUrl = `https://sjnexe.github.io/RepoExe/npm${targetPath}`;
    const localRes = await fetch(repoexeUrl, {
      headers: {
        'User-Agent': 'RepoExe-Proxy',
        'Accept': 'application/json'
      }
    });

    if (localRes.status === 200) {
      if (!pathname.endsWith('.tgz') && targetPath.endsWith('package.json')) {
        try {
          const localData = await localRes.json();
          const patchedRange = localData.patched_version_range;

          // If local manifest defines a patched_version_range, rewrite latest/dist-tags to local latest patched release
          if (patchedRange) {
            const upstreamUrl = `https://registry.npmjs.org${pathname}${search}`;
            const upstreamRes = await fetch(upstreamUrl, {
              headers: {
                'User-Agent': request.headers.get('User-Agent') || 'RepoExe-Proxy',
                'Accept': request.headers.get('Accept') || '*/*'
              }
            });

            if (upstreamRes.status === 200) {
              const upstreamData = await upstreamRes.json();
              const mergedVersions = { ...upstreamData.versions, ...localData.versions };
              const latestLocalVer = localData['dist-tags'] ? localData['dist-tags'].latest : null;

              const mergedManifest = {
                ...upstreamData,
                'dist-tags': {
                  ...upstreamData['dist-tags'],
                  latest: latestLocalVer || upstreamData['dist-tags']?.latest
                },
                versions: mergedVersions
              };

              return new Response(JSON.stringify(mergedManifest), {
                status: 200,
                headers: {
                  'Content-Type': 'application/json',
                  'Access-Control-Allow-Origin': '*'
                }
              });
            }
          }

          const headers = new Headers();
          headers.set('Content-Type', 'application/json');
          headers.set('Access-Control-Allow-Origin', '*');
          return new Response(JSON.stringify(localData), {
            status: 200,
            headers: headers
          });
        } catch (e) {
          // Fallback if parsing json fails
        }
      }

      const headers = new Headers(localRes.headers);
      headers.set('Content-Type', pathname.endsWith('.tgz') ? 'application/gzip' : 'application/json');
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(localRes.body, {
        status: 200,
        headers: headers
      });
    }

    // 3. Fall back to upstream npmjs.org for unhosted public packages
    const upstreamUrl = `https://registry.npmjs.org${pathname}${search}`;
    const headers = new Headers(request.headers);
    headers.set('Host', 'registry.npmjs.org');
    return fetch(upstreamUrl, {
      method: request.method,
      headers: headers,
      redirect: 'follow'
    });
  }
};
