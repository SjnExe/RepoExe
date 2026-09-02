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
    let targetSubpkg = null;
    let checkName = pkgName;

    let repoexeUrl = `https://sjnexe.github.io/RepoExe/npm${targetPath}`;
    let localRes = await fetch(repoexeUrl, {
      headers: {
        'User-Agent': 'RepoExe-Proxy',
        'Accept': 'application/json'
      }
    });

    if (localRes.status !== 200 && !pathname.endsWith('.tgz')) {
      try {
        const pkgsRes = await fetch('https://sjnexe.github.io/RepoExe/packages.json', {
          headers: { 'User-Agent': 'RepoExe-Proxy' }
        });
        if (pkgsRes.status === 200) {
          const storeData = await pkgsRes.json();
          const storePkgs = new Set();
          for (const item of storeData) {
            const formats = item.formats || [];
            if (formats.includes('npm') || formats.includes('all')) {
              if (item.name) storePkgs.add(item.name);
              if (item.npm_name) storePkgs.add(item.npm_name);
            }
          }
          if (!storePkgs.has(pkgName)) {
            for (const sPkg of storePkgs) {
              if (sPkg.startsWith(`@${pkgName}/`) || sPkg.startsWith(`${pkgName}-`)) {
                targetSubpkg = sPkg;
                break;
              }
            }
          }
        }
      } catch (e) {
        // Fallback on fetch error
      }

      if (targetSubpkg) {
        checkName = targetSubpkg;
        repoexeUrl = `https://sjnexe.github.io/RepoExe/npm/${checkName}/package.json`;
        localRes = await fetch(repoexeUrl, {
          headers: {
            'User-Agent': 'RepoExe-Proxy',
            'Accept': 'application/json'
          }
        });
      }
    }

    if (localRes.status === 200) {
      if (!pathname.endsWith('.tgz') && (targetPath.endsWith('package.json') || targetSubpkg)) {
        try {
          const localData = await localRes.json();
          const patchedRange = localData.patched_version_range;
          const patchedTarget = localData.patched_target;

          if (patchedRange || patchedTarget === pkgName || targetSubpkg) {
            const upstreamUrl = `https://registry.npmjs.org${pathname}${search}`;
            const upstreamRes = await fetch(upstreamUrl, {
              headers: {
                'User-Agent': request.headers.get('User-Agent') || 'RepoExe-Proxy',
                'Accept': request.headers.get('Accept') || '*/*'
              }
            });

            if (upstreamRes.status === 200) {
              const upstreamData = await upstreamRes.json();
              const mergedVersions = { ...upstreamData.versions };

              function versionSatisfiesPatchedRange(vStr, pRange) {
                if (!pRange || !vStr) return false;
                const mV = String(vStr).match(/^(\d+)/);
                const mR = String(pRange).match(/(\d+)/);
                if (mV && mR) {
                  return parseInt(mV[1], 10) >= parseInt(mR[1], 10);
                }
                return false;
              }

              if (patchedTarget === pkgName || targetSubpkg) {
                const subpkgLatest = localData['dist-tags']?.latest || '7.0.2';
                const subpkgVersions = localData.versions || {};
                for (const [vKey, vVal] of Object.entries(mergedVersions)) {
                  const opDeps = vVal.optionalDependencies || {};
                  const matchVer = subpkgVersions[vKey] ? vKey : subpkgLatest;
                  opDeps[checkName] = matchVer;
                  vVal.optionalDependencies = opDeps;
                }
              } else {
                Object.assign(mergedVersions, localData.versions || {});
                const latestLocalVer = localData['dist-tags']?.latest;
                if (latestLocalVer && localData.versions?.[latestLocalVer]) {
                  const localLatestObj = localData.versions[latestLocalVer];
                  for (const [vKey, vVal] of Object.entries(mergedVersions)) {
                    if (patchedRange && versionSatisfiesPatchedRange(vKey, patchedRange)) {
                      for (const kOver of ['dist', 'bin', 'os', 'cpu']) {
                        if (kOver in localLatestObj) {
                          vVal[kOver] = localLatestObj[kOver];
                        }
                      }
                    }
                  }
                }
              }

              const latestLocalVer = localData['dist-tags']?.latest;
              const mergedManifest = {
                ...upstreamData,
                'dist-tags': {
                  ...upstreamData['dist-tags'],
                  ...(latestLocalVer && !targetSubpkg ? { latest: latestLocalVer } : {})
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
