import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { parseRecipe } from '../core/parser.ts';

test('parseRecipe parses aisleriot correctly', () => {
  const recipe = parseRecipe('pkg/aisleriot');
  expect(recipe.name).toBe('aisleriot');
  expect(recipe.version).toBe('3.22.35');
  expect(recipe.arch).toBe('aarch64');
  expect(recipe.formats).toEqual(['apt']);
  expect(recipe.build_deps).toContain('gtk3');
  expect(recipe.state_hash).toBeDefined();
  expect(recipe.state_hash.length).toBe(16);
});

test('parseRecipe parses repoexe correctly', () => {
  const recipe = parseRecipe('pkg/repoexe');
  expect(recipe.name).toBe('repoexe');
  expect(recipe.version).toBe('1.0.0');
  expect(recipe.arch).toBe('all');
  expect(recipe.state_hash).toBeDefined();
});

test('computeStateHash produces deterministic output', () => {
  const r1 = parseRecipe('pkg/repoexe');
  const r2 = parseRecipe('pkg/repoexe');
  expect(r1.state_hash).toBe(r2.state_hash);
});

test('parseRecipe supports maintainer and uploaders parsing', () => {
  const recipe = parseRecipe('pkg/aisleriot');
  expect(recipe.maintainer).toBe('@SjnExe');
  expect(Array.isArray(recipe.uploaders)).toBe(true);
});

test('parseRecipe normalizes uploaders array and string formats', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'recipe-test-'));
  try {
    writeFileSync(
      join(tmp, 'recipe.ts'),
      `export default {
        name: 'uploader-test',
        version: '1.0.0',
        maintainer: '@SjnExe <sjnexe@example.com>',
        uploaders: ['@co-maintainer1', 'Helper <helper@example.com>']
      };`,
    );
    const r1 = parseRecipe(tmp);
    expect(r1.maintainer).toBe('@SjnExe <sjnexe@example.com>');
    expect(r1.uploaders).toEqual(['@co-maintainer1', 'Helper <helper@example.com>']);

    writeFileSync(
      join(tmp, 'recipe.ts'),
      `export default {
        name: 'uploader-test-str',
        version: '1.0.0',
        maintainer: '@SjnExe',
        uploaders: '@co1, @co2, Helper <helper@example.com>'
      };`,
    );
    const r2 = parseRecipe(tmp);
    expect(r2.maintainer).toBe('@SjnExe');
    expect(r2.uploaders).toEqual(['@co1', '@co2', 'Helper <helper@example.com>']);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseRecipe applies heavy_build resource defaults when unspecified', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'heavy-test-'));
  try {
    writeFileSync(
      join(tmp, 'recipe.ts'),
      `export default {
        name: 'heavy-test',
        version: '1.0.0',
        heavy_build: true,
      };`,
    );
    const r1 = parseRecipe(tmp);
    expect(r1.resources.zram).toBe(4);
    expect(r1.resources.swap).toBe(8);
    expect(r1.resources.free_space).toBe(true);
    expect(r1.resources.tmpfs).toBe(6);

    writeFileSync(
      join(tmp, 'recipe.ts'),
      `export default {
        name: 'heavy-override',
        version: '1.0.0',
        heavy_build: true,
        resources: { swap: 0, tmpfs: 2 }
      };`,
    );
    const r2 = parseRecipe(tmp);
    expect(r2.resources.zram).toBe(4);
    expect(r2.resources.swap).toBe(0);
    expect(r2.resources.free_space).toBe(true);
    expect(r2.resources.tmpfs).toBe(2);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('parseRecipe defaults cache to false unless explicitly specified', () => {
  const rRepoexe = parseRecipe('pkg/repoexe');
  expect(rRepoexe.cache).toBe(false);

  const tmp = mkdtempSync(join(tmpdir(), 'cache-test-'));
  try {
    writeFileSync(
      join(tmp, 'recipe.ts'),
      `export default {
        name: 'heavy-without-cache',
        version: '1.0.0',
        heavy_build: true,
      };`,
    );
    const rHeavy = parseRecipe(tmp);
    expect(rHeavy.cache).toBe(false);

    writeFileSync(
      join(tmp, 'recipe.ts'),
      `export default {
        name: 'explicit-cache-on',
        version: '1.0.0',
        cache: true,
      };`,
    );
    const r1 = parseRecipe(tmp);
    expect(r1.cache).toBe(true);

    writeFileSync(
      join(tmp, 'recipe.ts'),
      `export default {
        name: 'explicit-cache-off',
        version: '1.0.0',
        cache: false,
      };`,
    );
    const r2 = parseRecipe(tmp);
    expect(r2.cache).toBe(false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
