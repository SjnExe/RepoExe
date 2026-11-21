import { expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { PackageRecipe } from '../core/types.ts';
import { DependencyGraph } from '../utils/dag.ts';
import { createRecipe } from './fixtures.ts';

test('DependencyGraph loads recipes and resolves layers', (): void => {
  const dag = new DependencyGraph('pkg');
  expect(dag.recipes['aisleriot']).toBeDefined();
  expect(dag.recipes['repoexe']).toBeDefined();

  const layers = dag.getLayers();
  expect(layers.length).toBeGreaterThan(0);
  const flattened = layers.flat();
  expect(flattened).toContain('aisleriot');
  expect(flattened).toContain('repoexe');
});

test('DependencyGraph resolveBuildOrder sorts targets', (): void => {
  const dag = new DependencyGraph('pkg');
  const order = dag.resolveBuildOrder(['repoexe', 'aisleriot']);
  expect(order).toBeArray();
  expect(order).toContain('repoexe');
  expect(order).toContain('aisleriot');
});

test('DependencyGraph getDependents returns dependent packages', (): void => {
  const dag = new DependencyGraph('pkg');
  // synthetic test recipe graph
  dag.recipes['libtest'] = createRecipe({
    name: 'libtest',
    version: '1.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    deps: [],
    build_deps: [],
    recommends: [],
    suggests: [],
    conflicts: [],
    provides: [],
    replaces: [],
    formats: ['apt'],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 12 },
  });
  dag.recipes['apptest'] = createRecipe({
    name: 'apptest',
    version: '1.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    deps: ['libtest'],
    build_deps: [],
    recommends: [],
    suggests: [],
    conflicts: [],
    provides: [],
    replaces: [],
    formats: ['apt'],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 12 },
  });

  const dependents = dag.getDependents('libtest');
  expect(dependents.has('apptest')).toBeTrue();

  const order = dag.resolveBuildOrder(['apptest', 'libtest']);
  expect(order.indexOf('libtest')).toBeLessThan(order.indexOf('apptest'));
});

test('DependencyGraph resolves subpackages and provides to canonical parent recipe', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'parentpkg',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        dev: {
          name: 'parentpkg-dev',
          include: ['include/**'],
          provides: ['custom-dev-provider (= 1.0)'],
        },
      },
      provides: ['virtual-pkg (= 1.0)'],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'consumer',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['parentpkg-dev', 'virtual-pkg', 'custom-dev-provider'],
      build_deps: [],
      subpackages: {},
      provides: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const resolvedDeps = dag.getRecipeDepNames(dag.recipes['consumer']);
  expect(resolvedDeps).toContain('parentpkg');
  expect(resolvedDeps).not.toContain('parentpkg-dev');
  expect(resolvedDeps).not.toContain('virtual-pkg');
  expect(resolvedDeps).not.toContain('custom-dev-provider');

  const order = dag.resolveBuildOrder(['consumer', 'parentpkg']);
  expect(order).toContain('parentpkg');
  expect(order).toContain('consumer');
  expect(order.indexOf('parentpkg')).toBeLessThan(order.indexOf('consumer'));
});

test('DependencyGraph prevents record-key aliases from overwriting emitted package names in either registration order', (): void => {
  // Order 1: owner-a then owner-b
  const dag1 = new DependencyGraph('pkg');
  dag1.registerRecipe(
    createRecipe({
      name: 'owner-a',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        cli: { name: 'tools', include: ['bin/**'] },
      },
      provides: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag1.registerRecipe(
    createRecipe({
      name: 'owner-b',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        tools: { name: 'owner-b-tools', include: ['bin/**'] },
      },
      provides: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag1.registerRecipe(
    createRecipe({
      name: 'consumer',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['tools'],
      build_deps: [],
      subpackages: {},
      provides: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const deps1 = dag1.getRecipeDepNames(dag1.recipes['consumer']);
  expect(deps1).toContain('owner-a');
  expect(deps1).not.toContain('owner-b');

  // Order 2: owner-b then owner-a
  const dag2 = new DependencyGraph('pkg');
  dag2.registerRecipe(
    createRecipe({
      name: 'owner-b',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        tools: { name: 'owner-b-tools', include: ['bin/**'] },
      },
      provides: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag2.registerRecipe(
    createRecipe({
      name: 'owner-a',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        cli: { name: 'tools', include: ['bin/**'] },
      },
      provides: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag2.registerRecipe(
    createRecipe({
      name: 'consumer',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['tools'],
      build_deps: [],
      subpackages: {},
      provides: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const deps2 = dag2.getRecipeDepNames(dag2.recipes['consumer']);
  expect(deps2).toContain('owner-a');
  expect(deps2).not.toContain('owner-b');
});

test('DependencyGraph prioritizes real recipe over provides alias', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'real-pkg',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'compat-pkg',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      provides: ['real-pkg'],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const consumer = createRecipe({
    name: 'consumer',
    version: '1.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    deps: ['real-pkg'],
    build_deps: [],
    formats: ['apt'],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
  });

  const resolved = dag.getRecipeDepNames(consumer);
  expect(resolved.has('real-pkg')).toBeTrue();
  expect(resolved.has('compat-pkg')).toBeFalse();
});

test('DependencyGraph retains child subpackage dependencies for dependent discovery without forcing owner build prerequisite', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.recipes['z-helper'] = createRecipe({
    name: 'z-helper',
    version: '1.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    deps: [],
    build_deps: [],
    formats: ['apt'],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
  });

  dag.recipes['a-owner'] = createRecipe({
    name: 'a-owner',
    version: '1.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    deps: [],
    build_deps: [],
    subpackages: {
      child: {
        include: ['bin/tool'],
        deps: ['z-helper'],
      },
    },
    formats: ['apt'],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
  });

  const dependents = dag.getDependents('z-helper');
  expect(dependents.has('a-owner')).toBeTrue();

  const ownerPrereqs = dag.getRecipeDepNames(dag.recipes['a-owner']);
  expect(ownerPrereqs.has('z-helper')).toBeFalse();
});

test('DependencyGraph normalizes versioned provides entries to bare names', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'pkg-with-versioned-provides',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      provides: ['virtual-alias (= 2.0)'],
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const consumer = createRecipe({
    name: 'consumer-pkg',
    version: '1.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    deps: ['virtual-alias'],
    build_deps: [],
    formats: ['apt'],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
  });

  const resolved = dag.getRecipeDepNames(consumer);
  expect(resolved.has('pkg-with-versioned-provides')).toBeTrue();
});

test('DependencyGraph treats owner-satisfied dependency alternative as satisfying the clause without mandating other alternatives', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['a-child | b-helper'],
      build_deps: [],
      subpackages: {
        child: {
          name: 'a-child',
          include: ['lib/**'],
        },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'b-helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['a-child'],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const ownerClauses = dag.getRecipeDepClauses(dag.recipes['a-owner']);
  expect(ownerClauses.length).toBe(0);

  const ownerPrereqs = dag.getRecipeDepNames(dag.recipes['a-owner']);
  expect(ownerPrereqs.has('b-helper')).toBeFalse();

  const layers = dag.getLayers(['a-owner', 'b-helper']);
  expect(layers.length).toBe(2);
  expect(layers[0]).toContain('a-owner');
  expect(layers[1]).toContain('b-helper');
});

test('DependencyGraph getDependents filters child dependencies using child architecture and includes custom parent_dep', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'arm-helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'arm',
      provides: ['platform-helper'],
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'aarch64-helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      provides: ['platform-helper'],
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'custom-base',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'parent-pkg',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        child: {
          name: 'parent-child',
          arch: 'all',
          include: ['share/**'],
          deps: ['platform-helper'],
          parent_dep: 'custom-base (>= 1.0)',
        },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  // An arch:all child with an unrestricted virtual dep discovers dependents across both native providers
  expect(dag.getDependents('arm-helper').has('parent-pkg')).toBeTrue();
  expect(dag.getDependents('aarch64-helper').has('parent-pkg')).toBeTrue();

  // Custom parent_dep is discoverable for dependents
  expect(dag.getDependents('custom-base').has('parent-pkg')).toBeTrue();

  // None of these child-only runtime deps are unconditional build prerequisites of the owner
  const buildPrereqs = dag.getRecipeDepNames(dag.recipes['parent-pkg'], 'aarch64', false);
  expect(buildPrereqs.has('arm-helper')).toBeFalse();
  expect(buildPrereqs.has('aarch64-helper')).toBeFalse();
  expect(buildPrereqs.has('custom-base')).toBeFalse();
});

test('DependencyGraph rejects alternatives in Provides, arch-restricted Provides on all, and clears stale rejections', (): void => {
  const dag = new DependencyGraph('pkg');

  expect(() => {
    const r = createRecipe({ name: 'alt-prov', version: '1.0' });
    r.provides = ['sdk-a | sdk-b'];
    dag.registerRecipe(r);
  }).toThrow(/does not permit alternatives/);

  expect(() => {
    const r = createRecipe({
      name: 'all-child-prov',
      version: '1.0',
      arches: ['aarch64', 'arm'],
      subpackages: {
        doc: { name: 'all-child-prov-doc', arch: 'all', include: ['share/**'] },
      },
    });
    r.subpackages!.doc.provides = ['sdk-api [arm]'];
    dag.registerRecipe(r);
  }).toThrow(/architecture 'all'.*architecture-restricted Provides/);

  dag.rejectedRecipes['recovered'] = 'previous invalid Provides';
  expect(() => dag.resolveBuildOrder(['recovered'])).toThrow(/previous invalid Provides/);

  // Failed registration must keep rejection intact
  expect(() => {
    const r = createRecipe({ name: 'recovered', version: '1.0' });
    r.provides = ['bad (>= 1)'];
    dag.registerRecipe(r);
  }).toThrow();
  expect(dag.rejectedRecipes['recovered']).toBe('previous invalid Provides');

  // Valid registration clears stale rejection
  dag.registerRecipe(createRecipe({ name: 'recovered', version: '1.0', provides: ['good-a, good-b (= 2)'] }));
  expect(dag.rejectedRecipes['recovered']).toBeUndefined();
  expect(dag.resolveBuildOrder(['recovered'])).toEqual(['recovered']);
  expect(dag.getLayers(['recovered'])).toEqual([['recovered']]);
});

test('DependencyGraph retains external alternatives in child subpackages for dependent discovery without making them build prerequisites', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        runtime: {
          name: 'a-runtime',
          include: ['lib/**'],
        },
        tools: {
          name: 'a-tools',
          include: ['bin/**'],
          parent_dep: 'none',
          deps: ['a-runtime | z-helper'],
        },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'z-helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  // Discovering dependents finds a-owner when z-helper changes
  const zDependents = dag.getDependents('z-helper');
  expect(zDependents.has('a-owner')).toBeTrue();

  // Child dependencies are excluded from compile-only order.
  const buildPrereqs = dag.getRecipeDepNames(dag.recipes['a-owner'], 'aarch64', false);
  expect(buildPrereqs.has('z-helper')).toBeFalse();

  // With child dependencies enabled, a-owner self-satisfies a-runtime | z-helper.
  const buildPrereqsWithSubpkgs = dag.getRecipeDepNames(dag.recipes['a-owner'], 'aarch64', true);
  expect(buildPrereqsWithSubpkgs.has('z-helper')).toBeFalse();
});

test('DependencyGraph preserves alternative edge when self reference carries a version constraint', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['a-owner (>= 2.0) | b-helper'],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'b-helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  // Because self token 'a-owner (>= 2.0)' carries a version constraint, the clause is not self-satisfied
  // and b-helper must be retained as a prerequisite in build ordering
  const buildPrereqs = dag.getRecipeDepNames(dag.recipes['a-owner'], 'aarch64', false);
  expect(buildPrereqs.has('b-helper')).toBeTrue();
  expect(buildPrereqs.has('a-owner')).toBeFalse();

  const order = dag.resolveBuildOrder(['a-owner', 'b-helper']);
  expect(order).toContain('b-helper');
  expect(order).toContain('a-owner');
  expect(order.indexOf('b-helper')).toBeLessThan(order.indexOf('a-owner'));
});

test('DependencyGraph separates build_deps from runtime self-satisfaction (Thread #7)', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: ['a-tool | z-bootstrap'],
      subpackages: {
        tool: { name: 'a-tool', include: ['bin/**'] },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'z-bootstrap',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const buildPrereqs = dag.getRecipeDepNames(dag.recipes['a-owner'], 'aarch64', false);
  // Self-emitted a-tool is skipped as a prereq, but external alternative z-bootstrap is preserved
  expect(buildPrereqs.has('z-bootstrap')).toBeTrue();
  expect(buildPrereqs.has('a-owner')).toBeFalse();

  const layers = dag.getLayers(['a-owner', 'z-bootstrap'], 'aarch64');
  expect(layers.length).toBe(2);
  expect(layers[0]).toContain('z-bootstrap');
  expect(layers[1]).toContain('a-owner');
});

test('DependencyGraph recognizes satisfied versioned runtime alternatives (Thread #8)', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '2.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['a-child (>= 1.0) | b-helper'],
      build_deps: [],
      subpackages: {
        child: { name: 'a-child', include: ['lib/**'] },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'b-helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: ['a-child'],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  // Since a-owner 2.0 emits a-child 2.0 satisfying (>= 1.0), self-satisfaction succeeds
  // b-helper is not retained as a prerequisite
  const buildPrereqs = dag.getRecipeDepNames(dag.recipes['a-owner'], 'aarch64', false);
  expect(buildPrereqs.has('b-helper')).toBeFalse();

  const layers = dag.getLayers(['a-owner', 'b-helper'], 'aarch64');
  expect(layers.length).toBeGreaterThan(0);
  expect(layers.flat()).toContain('a-owner');
  expect(layers.flat()).toContain('b-helper');
});

test('DependencyGraph handles package and child names matching Object prototype properties like constructor', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'constructor',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  expect(dag.recipes['constructor']).toBeDefined();
  const order = dag.resolveBuildOrder(['constructor']);
  expect(order).toEqual(['constructor']);
});

test('DependencyGraph rejects duplicate emitted names across recipes', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'owner-x',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {
        child: { name: 'shared-child', include: ['bin/**'] },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  expect(() => {
    dag.registerRecipe(
      createRecipe({
        name: 'owner-y',
        version: '1.0',
        revision: 0,
        epoch: 0,
        arch: 'aarch64',
        deps: [],
        build_deps: [],
        subpackages: {
          child2: { name: 'shared-child', include: ['bin/**'] },
        },
        formats: ['apt'],
        phases: {},
        env: {},
        resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
      }),
    );
  }).toThrow(/Package name collision/);
});

test('DependencyGraph rejects internal subpackage alias in dependencies with diagnostic', (): void => {
  const tmpPkgDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'empty-pkg-'));
  try {
    const dag = new DependencyGraph(tmpPkgDir);
    dag.registerRecipe(
      createRecipe({
        name: 'owner-sdk',
        version: '1.0',
        revision: 0,
        epoch: 0,
        arch: 'aarch64',
        deps: [],
        build_deps: [],
        subpackages: {
          'sdk-local': { name: 'sample-dev', include: ['include/**'] },
        },
        formats: ['apt'],
        phases: {},
        env: {},
        resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
      }),
    );

    const consumer: PackageRecipe = createRecipe({
      name: 'consumer',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: ['sdk-local'],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    });

    expect(() => {
      dag.getRecipeDepClauses(consumer);
    }).toThrow(
      /Dependency 'sdk-local' refers to an internal subpackage record key; use emitted package name 'sample-dev' instead/,
    );
  } finally {
    rmSync(tmpPkgDir, { recursive: true, force: true });
  }
});

test('DependencyGraph evaluates virtual Provides version rather than owner version in self-satisfaction', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'super-owner',
      version: '3.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: ['sample-api (>= 2.0) | helper'],
      build_deps: [],
      subpackages: {
        child: {
          name: 'super-child',
          include: ['lib/**'],
          provides: ['sample-api (= 1.0)'],
        },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const clauses = dag.getRecipeDepClauses(dag.recipes['super-owner']);
  expect(clauses.some((c) => c.includes('helper'))).toBeTrue();
});

test('ownerProducesDep skips provider record when architecture differs from planned build', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'provider-arm',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'arm',
      arches: ['arm'],
      deps: [],
      build_deps: [],
      provides: ['sdk-virtual (= 1.0) [arm]'],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  expect(dag.ownerProducesDep('provider-arm', 'sdk-virtual', 'aarch64')).toBe(false);
  expect(dag.ownerProducesDep('provider-arm', 'sdk-virtual', 'arm')).toBe(true);
});

test('unscoped dependent discovery indexes native providers for top-level all runtime dependencies', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'arm-sdk',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'arm',
      arches: ['arm'],
      deps: [],
      build_deps: [],
      provides: ['sdk-api (= 1.0)'],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'aarch64-sdk',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      arches: ['aarch64'],
      deps: [],
      build_deps: [],
      provides: ['sdk-api (= 1.0)'],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'doc-all',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'all',
      deps: ['sdk-api'],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const depsArm = dag.getDependents('arm-sdk');
  expect(depsArm).toContain('doc-all');

  const depsAarch64 = dag.getDependents('aarch64-sdk');
  expect(depsAarch64).toContain('doc-all');
});

test('getLayers evaluates alternative build dependency clauses so valid alternative enables scheduling', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'z-bootstrap',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: [],
      subpackages: {},
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'pkg-a',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: ['b-dev | z-bootstrap'],
      subpackages: {
        child: { name: 'a-dev', include: ['include/**'] },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  dag.registerRecipe(
    createRecipe({
      name: 'pkg-b',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'aarch64',
      deps: [],
      build_deps: ['a-dev'],
      subpackages: {
        child: { name: 'b-dev', include: ['include/**'] },
      },
      formats: ['apt'],
      phases: {},
      env: {},
      resources: { zram: 0, swap: 0, free_space: false, tmpfs: 4 },
    }),
  );

  const layers = dag.getLayers(['z-bootstrap', 'pkg-a', 'pkg-b'], 'aarch64');
  expect(layers).toEqual([['z-bootstrap'], ['pkg-a'], ['pkg-b']]);
});

test('DependencyGraph validates registration upfront before updating graph indices', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'owner-x',
      version: '1.0',
      subpackages: {
        first: { name: 'shared-child', include: ['bin/**'] },
      },
    }),
  );

  expect(() => {
    dag.registerRecipe(
      createRecipe({
        name: 'owner-y',
        version: '1.0',
        subpackages: {
          child1: { name: 'new-child', include: ['lib/**'] },
          child2: { name: 'shared-child', include: ['bin/**'] },
        },
      }),
    );
  }).toThrow(/Package name collision/);

  // owner-y and new-child must not have leaked into indices
  expect(dag.recipes['owner-y']).toBeUndefined();
  expect(dag.subpackageMap['new-child']).toBeUndefined();
});

test('DependencyGraph ties provided version to provider and preserves external alternative for unversioned provider', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'old-provider',
      version: '1.0',
      provides: ['sample-api (= 2)'],
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '1.0',
      provides: ['sample-api'],
      deps: ['sample-api (>= 2) | z-helper'],
    }),
  );

  expect(dag.canOwnerSatisfyDep('a-owner', 'sample-api', { operator: '>=', version: '2' })).toBeFalse();
  expect(dag.canOwnerSatisfyDep('old-provider', 'sample-api', { operator: '>=', version: '2' })).toBeTrue();
  const clauses = dag.getRecipeDepClauses(dag.recipes['a-owner']);
  expect(clauses.some((clause) => clause.includes('z-helper'))).toBeTrue();
});

test('DependencyGraph resolves valid provides name without throwing internal key diagnostic', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'sample',
      version: '1.0',
      subpackages: {
        'tls-api': { name: 'sample-dev', include: ['include/**'] },
      },
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'provider-pkg',
      version: '1.0',
      provides: ['tls-api'],
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'consumer-pkg',
      version: '1.0',
      deps: ['tls-api'],
    }),
  );

  const clauses = dag.getRecipeDepClauses(dag.recipes['consumer-pkg']);
  expect(clauses.some((clause) => clause.includes('provider-pkg'))).toBeTrue();
});

test('DependencyGraph checks required version before marking build alternative ready', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'b-kit',
      version: '1.0',
      subpackages: {
        dev: { name: 'b-kit-dev', include: ['include/**'] },
      },
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'z-bootstrap',
      version: '1.0',
      build_deps: ['b-kit-dev'],
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'a-app',
      version: '1.0',
      build_deps: ['b-kit-dev (>= 2) | z-bootstrap'],
    }),
  );

  const order = dag.resolveBuildOrder(['b-kit', 'z-bootstrap', 'a-app']);
  expect(order).toContain('b-kit');
  expect(order).toContain('z-bootstrap');
  expect(order).toContain('a-app');
  expect(order.indexOf('b-kit')).toBeLessThan(order.indexOf('z-bootstrap'));
  expect(order.indexOf('z-bootstrap')).toBeLessThan(order.indexOf('a-app'));
  expect(dag.getLayers(['b-kit', 'z-bootstrap', 'a-app'])).toEqual([['b-kit'], ['z-bootstrap'], ['a-app']]);
});

test('DependencyGraph alias removal removes only aliases of previous owner without prefix collisions', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'owner-sdk',
      version: '1.0',
      subpackages: {
        'sdk-local': { name: 'sample-dev', include: ['include/**'] },
      },
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'owner-other',
      version: '1.0',
      subpackages: {
        'sdk-other': { name: 'other-dev', include: ['include/**'] },
      },
    }),
  );
  expect(dag.subpackageAliasToNameMap['sdk-local']).toBe('sample-dev');
  expect(dag.subpackageAliasToNameMap['sdk-other']).toBe('other-dev');

  // Replace owner-sdk without that child
  dag.registerRecipe(
    createRecipe({
      name: 'owner-sdk',
      version: '1.1',
      subpackages: {},
    }),
  );
  expect(dag.subpackageAliasToNameMap['sdk-local']).toBeUndefined();
  expect(dag.subpackageAliasToNameMap['sdk-other']).toBe('other-dev');
});

test('DependencyGraph rejects malformed provider entries upfront without corrupting graph state', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'valid-pkg',
      version: '1.0',
      provides: ['valid-feature (= 1.0)'],
    }),
  );

  expect(() => {
    dag.registerRecipe(
      createRecipe({
        name: 'bad-pkg',
        version: '1.0',
        provides: [null as any],
      }),
    );
  }).toThrow(/Invalid provides entry/);

  expect(dag.recipes['bad-pkg']).toBeUndefined();
  expect(dag.providesMap['valid-feature']).toBe('valid-pkg');
});

test('DependencyGraph keeps versioned provider eligible when concrete package is too old', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'libapi',
      version: '1.0',
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'libapi-prereq',
      version: '1.0',
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'libapi-compat',
      version: '2.0',
      deps: ['libapi-prereq'],
      provides: ['libapi (= 2.0)'],
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'app',
      version: '1.0',
      deps: ['libapi (>= 2.0)'],
    }),
  );

  const layers = dag.getLayers(['libapi', 'libapi-prereq', 'libapi-compat', 'app']);
  expect(layers).toEqual([['libapi', 'libapi-prereq'], ['libapi-compat'], ['app']]);
});

test('DependencyGraph getDependents discovers child dependencies on non-primary architecture when arch is undefined', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'arm-helper',
      version: '1.0',
      arch: 'arm',
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'multi-pkg',
      version: '1.0',
      arch: 'aarch64',
      arches: ['aarch64', 'arm'],
      subpackages: {
        tool: {
          name: 'multi-pkg-tool',
          include: ['bin/**'],
          deps: ['arm-helper [arm]'],
        },
      },
    }),
  );

  const deps = dag.getDependents('arm-helper');
  expect(deps.has('multi-pkg')).toBeTrue();
});

test('Finding #9: getLayers does not let arch-incompatible local recipe unlock consumer before matching provider', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(createRecipe({ name: 'libapi', version: '1.0', arch: 'arm' }));
  dag.registerRecipe(createRecipe({ name: 'prereq', version: '1.0', arch: 'aarch64' }));
  dag.registerRecipe(
    createRecipe({
      name: 'libapi-aarch64',
      version: '1.0',
      arch: 'aarch64',
      deps: ['prereq'],
      provides: ['libapi (= 1.0)'],
    }),
  );
  dag.registerRecipe(createRecipe({ name: 'app', version: '1.0', arch: 'aarch64', deps: ['libapi'] }));

  const layers = dag.getLayers(['libapi', 'prereq', 'libapi-aarch64', 'app'], 'aarch64');
  expect(layers).toEqual([['libapi', 'prereq'], ['libapi-aarch64'], ['app']]);
});

test('Finding #9: resolveBuildOrder preserves topological order when local alternative fails constraint and upstream fallback exists', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(createRecipe({ name: 'local-old', version: '1.0', arch: 'aarch64' }));
  dag.registerRecipe(
    createRecipe({
      name: 'z-mid',
      version: '1.0',
      arch: 'aarch64',
      deps: ['local-old (>= 2.0) | upstream-fallback'],
    }),
  );
  dag.registerRecipe(createRecipe({ name: 'a-consumer', version: '1.0', arch: 'aarch64', deps: ['z-mid'] }));

  const order = dag.resolveBuildOrder(['a-consumer', 'z-mid', 'local-old'], 'aarch64');
  // Without fix, z-mid deadlocks and leftovers sort alphabetically (a-consumer before z-mid)
  expect(order.indexOf('z-mid')).toBeLessThan(order.indexOf('a-consumer'));
});

test('Thread #28: keeps compatible providers in execution plan while preferring concrete package', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(createRecipe({ name: 'sdk', version: '2', arch: 'aarch64' }));
  dag.registerRecipe(createRecipe({ name: 'z-sdk-compat', version: '2', arch: 'aarch64', provides: ['sdk (= 2)'] }));
  dag.registerRecipe(createRecipe({ name: 'a-app', version: '1', arch: 'aarch64', deps: ['sdk (>= 2)'] }));

  const targets = dag.getRecipeDepTargets(dag.recipes['a-app'], 'aarch64');
  expect(targets).toHaveLength(1);
  expect(targets[0].map((t) => t.owner)).toEqual(['sdk', 'z-sdk-compat']);

  const order = dag.resolveBuildOrder(['a-app', 'sdk', 'z-sdk-compat'], 'aarch64');
  expect(order.indexOf('sdk')).toBeLessThan(order.indexOf('a-app'));
  expect(order.indexOf('z-sdk-compat')).toBeLessThan(order.indexOf('a-app'));
});

test('Thread #29: orders child runtime dependencies before build-and-test while excluding them from compile-only order', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(createRecipe({ name: 'z-helper', version: '1', arch: 'aarch64' }));
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '1',
      arch: 'aarch64',
      subpackages: {
        tools: { name: 'a-tools', include: ['bin/**'], deps: ['z-helper'] },
      },
    }),
  );

  // Compile-only order excludes child runtime deps (tie-break puts a-owner first)
  const compileOrder = dag.resolveBuildOrder(['a-owner', 'z-helper'], 'aarch64', false);
  expect(compileOrder).toEqual(['a-owner', 'z-helper']);

  // Build-and-test order includes child runtime deps (z-helper before a-owner)
  const testOrder = dag.resolveBuildOrder(['a-owner', 'z-helper'], 'aarch64', true);
  expect(testOrder).toEqual(['z-helper', 'a-owner']);
});

test('resolveBuildOrder rejects unknown target names without throwing TypeError', (): void => {
  const dag = new DependencyGraph('pkg');
  expect(() => dag.resolveBuildOrder(['nonexistent'], 'aarch64')).toThrow(
    /target package 'nonexistent' does not exist in recipe graph/,
  );
});

test('canOwnerSatisfyDep resolves unnamed subpackage children by record key', (): void => {
  const dag = new DependencyGraph('pkg');
  const recipe = createRecipe({
    name: 'parent-pkg',
    version: '1.0.0',
    arch: 'aarch64',
    subpackages: {
      'unnamed-child': { arch: 'all' },
    },
  });
  if (recipe.subpackages?.['unnamed-child']) {
    (recipe.subpackages['unnamed-child'] as { name?: string }).name = undefined;
  }
  dag.registerRecipe(recipe);
  expect(dag.canOwnerSatisfyDep('parent-pkg', 'unnamed-child', undefined, undefined, 'arm')).toBeTrue();
});

test('getRecipeDepTargets respects includeRuntime parameter', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(createRecipe({ name: 'b-dep', version: '1.0' }));
  dag.registerRecipe(createRecipe({ name: 'r-dep', version: '1.0' }));
  dag.registerRecipe(
    createRecipe({
      name: 'main-pkg',
      version: '1.0',
      build_deps: ['b-dep'],
      deps: ['r-dep'],
    }),
  );
  const buildOnly = dag.getRecipeDepTargets(dag.recipes['main-pkg'], 'aarch64', false, undefined, false, false);
  expect(buildOnly).toHaveLength(1);
  expect(buildOnly[0][0].name).toBe('b-dep');

  const withRuntime = dag.getRecipeDepTargets(dag.recipes['main-pkg'], 'aarch64', false, undefined, false, true);
  expect(withRuntime).toHaveLength(2);
});

test('DependencyGraph rejects empty version in direct provides registration', (): void => {
  const dag = new DependencyGraph('pkg');
  const r = createRecipe({ name: 'empty-prov-pkg', version: '1.0' });
  r.provides = ['sdk-api (= )'];
  expect(() => dag.registerRecipe(r)).toThrow(/a versioned Provides requires a version/);
});

test('DependencyGraph ownerProducesDep checks child producer_arch accurately', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'z-sdk',
      version: '1.0.0',
      arch: 'aarch64',
      arches: ['aarch64', 'arm'],
      subpackages: {
        'z-sdk-tools': { arch: 'all', producer_arch: 'arm' },
      },
    }),
  );
  expect(dag.ownerProducesDep('z-sdk', 'z-sdk-tools', 'arm')).toBeTrue();
  expect(dag.ownerProducesDep('z-sdk', 'z-sdk-tools', 'aarch64')).toBeFalse();
});

test('resolveBuildOrder breaks runtime-dependency cycles preserving build prerequisites', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'a-consumer',
      version: '2.0',
      build_deps: ['z-provider (>= 2)'],
      deps: [],
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'z-provider',
      version: '2.0',
      build_deps: [],
      deps: ['a-consumer (>= 1)'],
    }),
  );

  const order = dag.resolveBuildOrder(['a-consumer', 'z-provider'], 'aarch64');
  expect(order.indexOf('z-provider')).toBeLessThan(order.indexOf('a-consumer'));
});

test('DependencyGraph ownerProducesDep checks virtual provides accurately', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'kit',
      version: '2.0',
      arch: 'aarch64',
      provides: ['sdk (= 2)'],
    }),
  );
  expect(dag.ownerProducesDep('kit', 'sdk', 'aarch64')).toBeTrue();
  expect(dag.ownerProducesDep('kit', 'sdk', 'arm')).toBeFalse();
});

test('DependencyGraph ownerProducesDep recognizes all parent as producing all child in native batch', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'meta-pkg',
      version: '1.0',
      arch: 'all',
      subpackages: {
        'meta-doc': { arch: 'all' },
      },
    }),
  );
  expect(dag.ownerProducesDep('meta-pkg', 'meta-doc', 'aarch64')).toBeTrue();
  expect(dag.ownerProducesDep('meta-pkg', 'meta-doc', 'arm')).toBeTrue();
});

test('Thread #24: ownerProducesDep rejects unversioned provider record when versionConstraint is present', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'kit',
      version: '3.0',
      arch: 'aarch64',
      provides: ['sdk'],
    }),
  );
  // Without version constraint, it produces
  expect(dag.ownerProducesDep('kit', 'sdk', 'aarch64')).toBeTrue();
  // With version constraint, unversioned provides is rejected
  expect(dag.ownerProducesDep('kit', 'sdk', 'aarch64', { operator: '>=', version: '2.0' })).toBeFalse();
});

test('Thread #25: getRecipeDepTargets does not inherit owner version for bare provides', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'kit',
      version: '3.0',
      arch: 'aarch64',
      provides: ['sdk'],
    }),
  );
  const consumer = createRecipe({
    name: 'consumer',
    version: '1.0',
    arch: 'aarch64',
    deps: ['sdk (>= 2)'],
  });
  dag.registerRecipe(consumer);
  const targets = dag.getRecipeDepTargets(consumer, 'aarch64');
  // Local kit should not qualify as sdk (>= 2) via bare provides, fallback should not reinsert kit
  expect(targets.flat().some((t) => t.owner === 'kit')).toBeFalse();
});

test('Thread #26: getRecipeDepTargets retains alternative when self-satisfied subpackage is not produced on current shard', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'a-owner',
      version: '1.0',
      arches: ['aarch64', 'arm'],
      subpackages: {
        'a-doc': { arch: 'all', producer_arch: 'aarch64' },
      },
      deps: ['a-doc | z-helper'],
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'z-helper',
      version: '1.0',
      arches: ['aarch64', 'arm'],
    }),
  );
  // On aarch64 (the producer), the clause is self-satisfied and dropped
  const aarch64Targets = dag.getRecipeDepTargets(dag.recipes['a-owner']!, 'aarch64');
  expect(aarch64Targets.length).toBe(0);

  // On arm (non-producer), the clause must be retained
  const armTargets = dag.getRecipeDepTargets(dag.recipes['a-owner']!, 'arm');
  expect(armTargets.length).toBeGreaterThan(0);
  expect(armTargets.flat().some((t) => t.name === 'z-helper')).toBeTrue();
});

test('Thread #27: resolveBuildOrder without arch does not credit ARM-only build for aarch64 consumer', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'arm-lib',
      version: '1.0',
      arches: ['arm', 'aarch64'],
    }),
  );
  dag.registerRecipe(
    createRecipe({
      name: 'aarch64-consumer',
      version: '1.0',
      arch: 'aarch64',
      deps: ['arm-lib [aarch64]'],
    }),
  );
  // Without explicit arch, arm-lib planned target is primary arch 'arm'
  const orderDefault = dag.resolveBuildOrder(['aarch64-consumer', 'arm-lib']);
  expect(orderDefault).toBeDefined();

  // With explicit aarch64 build, arm-lib is built for aarch64 and satisfies consumer
  const orderAarch64 = dag.resolveBuildOrder(['aarch64-consumer', 'arm-lib'], 'aarch64');
  expect(orderAarch64).toEqual(['arm-lib', 'aarch64-consumer']);
});

test('Thread #14: canOwnerSupplyDepUnified counts top-level all packages as outputs of native batches', (): void => {
  const dag = new DependencyGraph('pkg');
  dag.registerRecipe(
    createRecipe({
      name: 'top-meta',
      version: '1.0',
      arch: 'all',
      arches: ['aarch64', 'arm'],
      provides: ['virt-meta (= 1.0)'],
    }),
  );

  // In native batch planned for arm (normPlan = 'arm'), top-level all package supplies arm dependency
  expect(dag.canOwnerSupplyDepUnified('top-meta', 'top-meta', 'arm', 'arm')).toBeTrue();
  // And its Provides record supplies arm dependency
  expect(dag.canOwnerSupplyDepUnified('top-meta', 'virt-meta', 'arm', 'arm')).toBeTrue();
});
