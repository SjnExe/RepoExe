import { expect, test } from 'bun:test';

import { extractDebArch, formatDebianVersion, generateControlFile } from '../builders/debian.ts';
import { parseRecipe } from '../core/parser.ts';

test('generateControlFile formats valid Debian control file', () => {
  const recipe = parseRecipe('pkg/aisleriot');
  const control = generateControlFile(recipe, 1024);

  expect(control).toContain('Package: aisleriot');
  expect(control).toContain('Version: 3.22.35');
  expect(control).toContain('Architecture: aarch64');
  expect(control).toContain('Maintainer: @SjnExe');
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
  const recipe = parseRecipe('pkg/repoexe');
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
