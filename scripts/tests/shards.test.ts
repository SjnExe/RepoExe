import { describe, expect, spyOn, test } from 'bun:test';

import { buildMatrixLayer, getMissingReleasePackages } from '../cli/generate_shards.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { createRecipe } from './fixtures.ts';

describe('Matrix Shards & Concurrency Optimization (scripts/cli/generate_shards.ts)', (): void => {
  test('handles arch all with is_indep: true', async (): Promise<void> => {
    const dag = new DependencyGraph('pkg');
    const shards = await buildMatrixLayer(['repoexe'], 'pkg', dag, true);
    expect(shards).toHaveLength(1);
    expect(shards[0].name).toBe('repoexe:all');
    expect(shards[0].arch).toBe('aarch64');
    expect(shards[0].is_indep).toBeTrue();
    expect(shards[0].packages).toBe('repoexe');
  });

  test('keeps heavy packages isolated and batches light packages', async (): Promise<void> => {
    const dag = new DependencyGraph('pkg');
    // Register synthetic recipes
    dag.recipes['heavy-pkg'] = createRecipe({
      name: 'heavy-pkg',
      version: '1.0.0',
      arch: 'aarch64',
      heavy_build: true,
      resources: { zram: 4, swap: 8, free_space: true, tmpfs: 12 },
    });

    dag.recipes['z-provider'] = createRecipe({
      name: 'z-provider',
      version: '1.0.0',
      arch: 'aarch64',
      heavy_build: false,
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 2 },
    });

    dag.recipes['a-consumer'] = createRecipe({
      name: 'a-consumer',
      version: '1.0.0',
      arch: 'aarch64',
      build_deps: ['z-provider'],
      heavy_build: false,
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 2 },
    });

    const shards = await buildMatrixLayer(
      ['heavy-pkg', 'a-consumer', 'z-provider'],
      'pkg',
      dag,
      true,
      20,
    );

    expect(shards).toHaveLength(2);
    const heavyShards = shards.filter((s) => s.heavy);
    const lightShards = shards.filter((s) => !s.heavy);
    expect(heavyShards).toHaveLength(1);
    expect(lightShards).toHaveLength(1);

    expect(heavyShards[0].package).toBe('heavy-pkg');
    expect(heavyShards[0].packages).toBe('heavy-pkg');

    // Sequential compile and pack operations must retain dependency order (z-provider before a-consumer)
    const lightPackages = lightShards[0].packages.split(' ');
    expect(lightPackages).toEqual(['z-provider', 'a-consumer']);
  });

  test('dynamically batches light packages to optimize concurrency slots', async (): Promise<void> => {
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

  test('sizes light batches accounting for architecture groups (Thread #38)', async (): Promise<void> => {
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

  test('Finding #4: getMissingReleasePackages does not let subpackage _all.deb mask missing native parent arch', async (): Promise<void> => {
    const dag = new DependencyGraph('pkg');
    dag.registerRecipe(
      createRecipe({
        name: 'multi-app',
        version: '1.0.0',
        arches: ['aarch64', 'arm'],
        subpackages: { doc: { name: 'multi-app-doc', arch: 'all', include: ['share/doc/**'] } },
      }),
    );

    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      (async (): Promise<Response> =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'multi-app',
              assets: [
                { name: 'multi-app_1.0.0_aarch64.deb' },
                { name: 'multi-app-doc_1.0.0_all.deb' },
              ],
            },
          ]),
          { status: 200 },
        )) as unknown as typeof fetch,
    );

    try {
      const missing = await getMissingReleasePackages(dag, 'owner/repo');
      expect(missing).toContain('multi-app');
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('Thread #31: getMissingReleasePackages flags releases with absent or withheld child archives', async (): Promise<void> => {
    const dag = new DependencyGraph('pkg');
    dag.registerRecipe(
      createRecipe({
        name: 'withheld-app',
        version: '2.0.0',
        arches: ['aarch64', 'arm'],
        subpackages: { doc: { name: 'withheld-app-doc', arch: 'all', include: ['share/doc/**'] } },
      }),
    );

    let releaseBody: string = JSON.stringify({ partial: false, state_hash: 'hash' });
    let releaseAssets: Array<{ name: string }> = [
      { name: 'withheld-app_2.0.0_aarch64.deb' },
      { name: 'withheld-app_2.0.0_arm.deb' },
      { name: 'withheld-app-doc_2.0.0_all.deb' },
    ];

    const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
      (async (): Promise<Response> =>
        new Response(
          JSON.stringify([
            {
              tag_name: 'withheld-app',
              body: releaseBody,
              assets: releaseAssets,
            },
          ]),
          { status: 200 },
        )) as unknown as typeof fetch,
    );

    try {
      // 1. Complete archives and partial: false -> not missing
      let missing = await getMissingReleasePackages(dag, 'owner/repo');
      expect(missing).not.toContain('withheld-app');

      // 2. Complete archives but partial: true -> missing
      releaseBody = JSON.stringify({ partial: true, state_hash: 'hash' });
      missing = await getMissingReleasePackages(dag, 'owner/repo');
      expect(missing).toContain('withheld-app');

      // 3. Missing child archive -> missing
      releaseBody = '';
      releaseAssets = [
        { name: 'withheld-app_2.0.0_aarch64.deb' },
        { name: 'withheld-app_2.0.0_arm.deb' },
      ];
      missing = await getMissingReleasePackages(dag, 'owner/repo');
      expect(missing).toContain('withheld-app');
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
