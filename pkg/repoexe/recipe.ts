import { defineRecipe } from '@core/types.ts';

export default defineRecipe({
  name: 'repoexe',
  version: '1.0.0',
  arch: 'all',
  description: 'Central RepoExe package repository management CLI',
  license: 'MIT',
  homepage: 'https://github.com/SjnExe/RepoExe',
  maintainer: '@SjnExe',
  build_system: 'custom',
  formats: ['apt'],
  resources: {
    zram: 0,
    swap: 0,
    tmpfs: 2,
  },
  phases: {
    install: `mkdir -p "\${DESTDIR}\${PREFIX}/bin"
mkdir -p "\${DESTDIR}\${PREFIX}/etc/apt/sources.list.d"
mkdir -p "\${DESTDIR}\${PREFIX}/etc/apt/trusted.gpg.d"
mkdir -p "\${DESTDIR}\${PREFIX}/share/bash-completion/completions"
mkdir -p "\${DESTDIR}\${PREFIX}/share/zsh/site-functions"
mkdir -p "\${DESTDIR}\${PREFIX}/share/fish/vendor_completions.d"

RECIPE_DIR="\${RECIPE_DIR:-pkg/repoexe}"
REPO_ROOT="$(cd "\${RECIPE_DIR}/../.." 2>/dev/null && pwd || echo ".")"

cp "\${RECIPE_DIR}/install" "\${DESTDIR}\${PREFIX}/bin/repoexe"
chmod +x "\${DESTDIR}\${PREFIX}/bin/repoexe"

echo "deb [signed-by=\${PREFIX}/etc/apt/trusted.gpg.d/repoexe.asc] https://sjnexe.github.io/RepoExe/apt stable main" > "\${DESTDIR}\${PREFIX}/etc/apt/sources.list.d/repoexe.list"
if [ -f "\${REPO_ROOT}/scripts/repoexe.gpg" ]; then
  cp "\${REPO_ROOT}/scripts/repoexe.gpg" "\${DESTDIR}\${PREFIX}/etc/apt/trusted.gpg.d/repoexe.asc"
elif [ -f "../../scripts/repoexe.gpg" ]; then
  cp "../../scripts/repoexe.gpg" "\${DESTDIR}\${PREFIX}/etc/apt/trusted.gpg.d/repoexe.asc"
fi

if [ -d "\${RECIPE_DIR}/completions" ]; then
  cp "\${RECIPE_DIR}/completions/repoexe.bash" "\${DESTDIR}\${PREFIX}/share/bash-completion/completions/repoexe"
  cp "\${RECIPE_DIR}/completions/repoexe.zsh" "\${DESTDIR}\${PREFIX}/share/zsh/site-functions/_repoexe"
  cp "\${RECIPE_DIR}/completions/repoexe.fish" "\${DESTDIR}\${PREFIX}/share/fish/vendor_completions.d/repoexe.fish"
fi
`,
    test: `repoexe --version
`,
  },
});
