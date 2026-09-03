export default {
  async fetch(request, env, ctx) {
    return new Response("RepoExe Worker Proxy Retired. Please update repoexe CLI to v2.0+.", {
      status: 200,
      headers: { "content-type": "text/plain" }
    });
  }
};
