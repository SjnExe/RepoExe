import { defineRecipe } from '@core/types.ts';

export default defineRecipe({
  name: 'repoexe',
  version: '2.0.0',
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
cp "../../scripts/site/install" "\${DESTDIR}\${PREFIX}/bin/repoexe"
chmod +x "\${DESTDIR}\${PREFIX}/bin/repoexe"
echo "deb [signed-by=\${PREFIX}/etc/apt/trusted.gpg.d/repoexe.asc] https://sjnexe.github.io/RepoExe/apt stable main" > "\${DESTDIR}\${PREFIX}/etc/apt/sources.list.d/repoexe.list"
cp "../../scripts/repoexe.gpg" "\${DESTDIR}\${PREFIX}/etc/apt/trusted.gpg.d/repoexe.asc"
`,
    test: `repoexe --version
`,
  },
});
