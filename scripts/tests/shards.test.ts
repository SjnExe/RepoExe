import { describe, expect, test } from 'bun:test';

import { buildMatrixLayer } from '../cli/generate_shards.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { createRecipe } from './fixtures.ts';

describe('Matrix Shards & Concurrency Optimization (scripts/cli/generate_shards.ts)', () => {
  test('handles arch all with is_indep: true', async () => {
    const dag = new DependencyGraph('pkg');
    const shards = await buildMatrixLayer(['repoexe'], 'pkg', dag, true);
    expect(shards).toHaveLength(1);
    expect(shards[0].name).toBe('repoexe:all');
    expect(shards[0].arch).toBe('aarch64');
    expect(shards[0].is_indep).toBeTrue();
    expect(shards[0].packages).toBe('repoexe');
  });

  test('keeps heavy packages isolated and batches light packages', async () => {
    const dag = new DependencyGraph('pkg');
    // Register synthetic recipes
    dag.recipes['heavy-pkg'] = createRecipe({
      name: 'heavy-pkg',
      version: '1.0.0',
      arch: 'aarch64',
      heavy_build: true,
      resources: { zram: 4, swap: 8, free_space: true, tmpfs: 12 },
    });

    dag.recipes['light-1'] = createRecipe({
      name: 'light-1',
      version: '1.0.0',
      arch: 'aarch64',
      heavy_build: false,
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 2 },
    });

    dag.recipes['light-2'] = createRecipe({
      name: 'light-2',
      version: '1.0.0',
      arch: 'aarch64',
      heavy_build: false,
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 2 },
    });

    const shards = await buildMatrixLayer(['heavy-pkg', 'light-1', 'light-2'], 'pkg', dag, true, 20);

    expect(shards).toHaveLength(2);
    const heavyShards = shards.filter((s) => s.heavy);
    const lightShards = shards.filter((s) => !s.heavy);
    expect(heavyShards).toHaveLength(1);
    expect(lightShards).toHaveLength(1);

    expect(heavyShards[0].package).toBe('heavy-pkg');
    expect(heavyShards[0].packages).toBe('heavy-pkg');

    const lightPackages = lightShards[0].packages.split(' ').sort();
    expect(lightPackages).toEqual(['light-1', 'light-2']);
  });

  test('dynamically batches light packages to optimize concurrency slots', async () => {
    const dag = new DependencyGraph('pkg');
    const targetNames: string[] = [];

    // Create 12 light packages for aarch64
    for (let i = 0; i < 12; i++) {
      const name = `bulk-light-${i}`;
      targetNames.push(name);
      dag.recipes[name] = createRecipe({
        name,
        version: '1.0.0',
        arch: 'aarch64',
        heavy_build: false,
        resources: { zram: 0, swap: 0, free_space: false, tmpfs: 2 },
      });
    }

    const shards = await buildMatrixLayer(targetNames, 'pkg', dag, true, 2);
    expect(shards.length).toBe(2);
    for (const s of shards) {
      expect(s.packages.split(' ').length).toBe(6);
    }
    const flattened = shards.flatMap((s) => s.packages.split(' '));
    expect(flattened.sort()).toEqual([...targetNames].sort());
  });

  test('sizes light batches accounting for architecture groups (Thread #38)', async () => {
    const dag = new DependencyGraph('pkg');
    const targetNames: string[] = [];

    // 18 heavy packages on aarch64
    for (let i = 0; i < 18; i++) {
      const name = `heavy-${i}`;
      targetNames.push(name);
      dag.recipes[name] = createRecipe({
        name,
        version: '1.0.0',
        arch: 'aarch64',
        heavy_build: true,
        resources: { zram: 0, swap: 1, free_space: false, tmpfs: 4 },
      });
    }

    // 5 light packages on aarch64
    for (let i = 0; i < 5; i++) {
      const name = `light-aarch64-${i}`;
      targetNames.push(name);
      dag.recipes[name] = createRecipe({
        name,
        version: '1.0.0',
        arch: 'aarch64',
        heavy_build: false,
        resources: { zram: 0, swap: 0, free_space: false, tmpfs: 2 },
      });
    }

    // 2 light packages on arm
    for (let i = 0; i < 2; i++) {
      const name = `light-arm-${i}`;
      targetNames.push(name);
      dag.recipes[name] = createRecipe({
        name,
        version: '1.0.0',
        arch: 'arm',
        heavy_build: false,
        resources: { zram: 0, swap: 0, free_space: false, tmpfs: 2 },
      });
    }

    // maxConcurrency = 20, remainingSlots = 2.
    // batchSize must expand to 5 so 5 aarch64 items = 1 job, 2 arm items = 1 job (total 20 jobs).
    const shards = await buildMatrixLayer(targetNames, 'pkg', dag, true, 20);
    expect(shards.length).toBe(20);
    const heavyShards = shards.filter((s) => s.heavy);
    const lightShards = shards.filter((s) => !s.heavy);
    expect(heavyShards.length).toBe(18);
    expect(lightShards.length).toBe(2);
    expect(lightShards.map((s) => s.arch).sort()).toEqual(['aarch64', 'arm']);
  });
});
