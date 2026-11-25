import { describe, expect, test } from 'bun:test';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  buildFallbackAssetUrl,
  escapeHtml,
  filterAndSortPackages,
  formatDebianVersion,
  formatVersionDisplay,
  getPackageInterface,
  isSafeHttpUrl,
  type PackageItem,
  parsePackageHash,
} from '../site/app.ts';
import { buildSiteFrontend } from '../utils/site_builder.ts';

describe('site frontend helpers', () => {
  test('escapeHtml escapes special HTML characters', () => {
    expect(escapeHtml(`<script>"a'&</script>`)).toBe(
      '&lt;script&gt;&quot;a&#39;&amp;&lt;/script&gt;',
    );
  });

  test('isSafeHttpUrl allows http/https and rejects javascript/data', () => {
    expect(isSafeHttpUrl('https://github.com/SjnExe/RepoExe')).toBe(true);
    expect(isSafeHttpUrl('http://example.com')).toBe(true);
    expect(isSafeHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeHttpUrl('data:text/html,<script>')).toBe(false);
    expect(isSafeHttpUrl('')).toBe(false);
  });

  test('formatDebianVersion and formatVersionDisplay include epoch and revision', () => {
    expect(formatDebianVersion({ version: '1.2.3' })).toBe('1.2.3');
    expect(formatDebianVersion({ version: '1.2.3', revision: 2 })).toBe('1.2.3-2');
    expect(formatDebianVersion({ version: '1.2.3', revision: 2, epoch: 1 })).toBe('1:1.2.3-2');
    expect(formatVersionDisplay({ version: '1.2.3', revision: 2, epoch: 1 })).toBe('v1:1.2.3-2');
    expect(formatVersionDisplay({ version: '' })).toBe('');
  });

  test('buildFallbackAssetUrl encodes package name and uses debian filename version', () => {
    expect(
      buildFallbackAssetUrl({ name: 'g++', version: '1.0', revision: 1, epoch: 2 }, 'aarch64'),
    ).toBe(
      'https://github.com/SjnExe/RepoExe/releases/download/g%2B%2B/g%2B%2B_2_1.0-1_aarch64.deb',
    );
  });

  test('parsePackageHash handles valid and malformed hashes safely', () => {
    expect(parsePackageHash('#/pkg/ripgrep')).toBe('ripgrep');
    expect(parsePackageHash('#/pkg/g%2B%2B')).toBe('g++');
    expect(parsePackageHash('#/pkg/%E0%A4%A')).toBeNull();
    expect(parsePackageHash('#/other')).toBeNull();
  });

  test('getPackageInterface normalizes component fallback', () => {
    expect(getPackageInterface({ interface: 'GUI', component: 'main' })).toBe('gui');
    expect(getPackageInterface({ component: 'gui' })).toBe('gui');
    expect(getPackageInterface({ component: 'main' })).toBe('cli');
  });

  test('filterAndSortPackages filters by search/interface/section and sorts', () => {
    const items: PackageItem[] = [
      {
        name: 'zebra',
        version: '1.0',
        description: 'Fast tool',
        arch: 'aarch64',
        license: 'MIT',
        homepage: 'https://example.com',
        maintainer: '@SjnExe',
        component: 'main',
        section: 'utils',
        total_downloads: 5,
      },
      {
        name: 'alpha',
        version: '2.0',
        description: 'GUI app',
        arch: 'aarch64',
        license: 'GPL-3.0',
        homepage: 'https://example.com',
        maintainer: '@SjnExe',
        component: 'gui',
        interface: 'gui',
        section: 'x11',
        total_downloads: 42,
      },
    ];

    expect(filterAndSortPackages(items, { sort: 'name' }).map((p) => p.name)).toEqual([
      'alpha',
      'zebra',
    ]);
    expect(filterAndSortPackages(items, { sort: 'downloads' }).map((p) => p.name)).toEqual([
      'alpha',
      'zebra',
    ]);
    expect(filterAndSortPackages(items, { iface: 'cli' }).map((p) => p.name)).toEqual(['zebra']);
    expect(filterAndSortPackages(items, { section: 'x11' }).map((p) => p.name)).toEqual(['alpha']);
    expect(filterAndSortPackages(items, { search: 'fast' }).map((p) => p.name)).toEqual(['zebra']);
  });
});

describe('buildSiteFrontend', () => {
  test('bundles app.ts to app.js and excludes raw app.ts from output', async () => {
    const outDir = mkdtempSync(join(tmpdir(), 'repoexe-site-test-'));
    try {
      await buildSiteFrontend(resolve('.'), outDir);
      expect(existsSync(join(outDir, 'index.html'))).toBe(true);
      expect(existsSync(join(outDir, 'style.css'))).toBe(true);
      expect(existsSync(join(outDir, 'app.js'))).toBe(true);
      expect(existsSync(join(outDir, 'install'))).toBe(true);
      expect(existsSync(join(outDir, '.nojekyll'))).toBe(true);
      expect(existsSync(join(outDir, 'app.ts'))).toBe(false);
    } finally {
      rmSync(outDir, { recursive: true, force: true });
    }
  });
});
