import { defineRecipe } from '@core/types.ts';

export default defineRecipe({
  name: 'repoexe',
  version: '2.0.0',
  arch: 'all',
  description: 'Central RepoExe package repository management CLI',
  license: 'MIT',
  homepage: 'https://github.com/SjnExe/RepoExe',
  maintainer: 'SjnExe',
  build_system: 'custom',
  formats: ['apt'],
  resources: {
    zram: 0,
    swap: 0,
    tmpfs: 2,
  },
  phases: {
    install: `mkdir -p "\${DESTDIR}\${PREFIX}/bin"
cp "../../scripts/site/install" "\${DESTDIR}\${PREFIX}/bin/repoexe"
chmod +x "\${DESTDIR}\${PREFIX}/bin/repoexe"
`,
    test: `repoexe --version
`,
  },
});
