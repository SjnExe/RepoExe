import { defineRecipe } from '@core/types.ts';

export const REPOEXE_VERSION = '1.0.0';

export default defineRecipe({
  name: 'repoexe',
  version: REPOEXE_VERSION,
  revision: 2,
  arch: 'all',
  component: 'main',
  section: 'utils',
  priority: 'optional',
  interface: 'cli',
  tags: ['role::program', 'suite::repoexe'],
  description:
    'Central RepoExe package repository management CLI\n Manages Deb822 APT sources, GPG verification, and CLI/GUI component selection.',
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
mkdir -p "\${DESTDIR}\${PREFIX}/share/bash-completion/completions"
mkdir -p "\${DESTDIR}\${PREFIX}/share/zsh/site-functions"
mkdir -p "\${DESTDIR}\${PREFIX}/share/fish/vendor_completions.d"

RECIPE_DIR="\${RECIPE_DIR:-pkg/repoexe}"
REPO_ROOT="$(cd "\${RECIPE_DIR}/../.." 2>/dev/null && pwd || echo ".")"

cp "\${RECIPE_DIR}/install" "\${DESTDIR}\${PREFIX}/bin/repoexe"
chmod +x "\${DESTDIR}\${PREFIX}/bin/repoexe"

GPG_KEY=""
if [ -f "\${REPO_ROOT}/scripts/repoexe.gpg" ]; then
  GPG_KEY="\${REPO_ROOT}/scripts/repoexe.gpg"
elif [ -f "../../scripts/repoexe.gpg" ]; then
  GPG_KEY="../../scripts/repoexe.gpg"
elif [ -f "scripts/repoexe.gpg" ]; then
  GPG_KEY="scripts/repoexe.gpg"
fi

cat << 'EOF' > "\${DESTDIR}\${PREFIX}/etc/apt/sources.list.d/repoexe.sources"
Types: deb
URIs: https://sjnexe.github.io/RepoExe/apt
Suites: stable
Components: main gui
Signed-By:
EOF
if [ -n "$GPG_KEY" ] && [ -f "$GPG_KEY" ]; then
  sed 's/^[[:space:]]*$/./; s/^/ /' "$GPG_KEY" >> "\${DESTDIR}\${PREFIX}/etc/apt/sources.list.d/repoexe.sources"
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
