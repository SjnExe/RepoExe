import { expect, test } from 'bun:test';

import {
  buildDebianTags,
  extractDebArch,
  formatDebianDescription,
  formatDebianVersion,
  generateControlFile,
} from '../builders/debian.ts';
import { parseRecipe } from '../core/parser.ts';

test('generateControlFile formats valid Debian control file', () => {
  const recipe = parseRecipe('pkg/aisleriot');
  const control = generateControlFile(recipe, 1024);

  expect(control).toContain('Package: aisleriot');
  expect(control).toContain('Version: 3.22.35');
  expect(control).toContain('Architecture: aarch64');
  expect(control).toContain('Maintainer: @SjnExe');
  expect(control).toContain('Section: games');
  expect(control).toContain('Priority: optional');
  expect(control).toContain(
    'Tag: interface::graphical, game::card, uitoolkit::gtk, interface::x11, role::program',
  );
  expect(control).toContain('Installed-Size: 1024');
  expect(control).toContain('Depends: gtk3, guile, librsvg, libcanberra, libxml2');
});

test('generateControlFile evaluates architecture-specific and alternative dependencies', () => {
  const recipe = parseRecipe('pkg/aisleriot');
  recipe.arch = 'aarch64';
  recipe.deps = [
    'gtk3',
    'openblas [aarch64] | atlas [x86_64] | lapack',
    'vulkan-loader [aarch64 x86_64]',
    'simdutf [!i686]',
    'x86-only [i686]',
  ];

  const control = generateControlFile(recipe);
  expect(control).toContain('Depends: gtk3, openblas | lapack, vulkan-loader, simdutf');
  expect(control.includes('atlas')).toBeFalse();
  expect(control.includes('x86-only')).toBeFalse();
  expect(control.includes('[')).toBeFalse();
  expect(control.includes(']')).toBeFalse();

  // Test evaluated for i686
  recipe.arch = 'i686';
  const controlI686 = generateControlFile(recipe);
  expect(controlI686).toContain('Depends: gtk3, lapack, x86-only');
  expect(controlI686.includes('openblas')).toBeFalse();
  expect(controlI686.includes('vulkan-loader')).toBeFalse();
  expect(controlI686.includes('simdutf')).toBeFalse();
});

test('formatDebianVersion handles epoch and revision', () => {
  const recipe = { ...parseRecipe('pkg/repoexe'), revision: 0, epoch: 0 };
  expect(formatDebianVersion(recipe)).toBe('1.0.0');

  recipe.revision = 1;
  expect(formatDebianVersion(recipe)).toBe('1.0.0-1');

  recipe.epoch = 2;
  expect(formatDebianVersion(recipe)).toBe('2:1.0.0-1');
});

test('extractDebArch handles all supported architectures including underscores', () => {
  expect(extractDebArch('aisleriot_3.22.35_x86_64.deb')).toBe('x86_64');
  expect(extractDebArch('aisleriot_3.22.35_aarch64.deb')).toBe('aarch64');
  expect(extractDebArch('aisleriot_3.22.35_arm64.deb')).toBe('aarch64');
  expect(extractDebArch('aisleriot_3.22.35_arm.deb')).toBe('arm');
  expect(extractDebArch('aisleriot_3.22.35_i686.deb')).toBe('i686');
  expect(extractDebArch('repoexe_1.0.0_all.deb')).toBe('all');
});

test('formatDebianDescription formats multi-line Debian Policy descriptions', () => {
  expect(formatDebianDescription('Short summary\n\nLonger paragraph\nSecond line')).toBe(
    'Short summary\n .\n Longer paragraph\n Second line',
  );
});

test('buildDebianTags merges interface traits with explicit tags', () => {
  expect(
    buildDebianTags({ interface: 'cli', tags: ['role::program', 'interface::commandline'] }),
  ).toEqual(['interface::commandline', 'role::program']);
  expect(buildDebianTags({ interface: 'both', tags: ['game::puzzle'] })).toEqual([
    'interface::commandline',
    'interface::graphical',
    'game::puzzle',
  ]);
});

test('parseRecipe derives component and control metadata for CLI and GUI packages', () => {
  const aisleriot = parseRecipe('pkg/aisleriot');
  expect(aisleriot.component).toBe('gui');
  expect(aisleriot.section).toBe('games');
  expect(aisleriot.interface).toBe('gui');

  const repoexe = parseRecipe('pkg/repoexe');
  expect(repoexe.component).toBe('main');
  expect(repoexe.section).toBe('utils');
  expect(repoexe.interface).toBe('cli');
});
