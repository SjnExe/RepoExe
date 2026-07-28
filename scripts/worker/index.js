export default {
  async fetch(request) {
    const url = new URL(request.url);

    // 1. Try fetching from RepoExe GitHub Pages
    const repoexeUrl = `https://sjnexe.github.io/RepoExe/npm${url.pathname}${url.search}`;

    try {
      const response = await fetch(repoexeUrl, {
        method: request.method,
        headers: request.headers,
      });

      if (response.status === 200) {
        return response;
      }
    } catch (err) {
      // Fallback on network error
    }

    // 2. Redirect to official npmjs.org for standard packages
    const npmUrl = `https://registry.npmjs.org${url.pathname}${url.search}`;
    return Response.redirect(npmUrl, 307);
  }
};
