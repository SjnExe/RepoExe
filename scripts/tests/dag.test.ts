import { expect, test } from 'bun:test';

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
          provides: ['custom-dev-provider (>= 1.0)'],
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
  dag.recipes['real-pkg'] = createRecipe({
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
  });

  dag.recipes['compat-pkg'] = createRecipe({
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
  });

  dag.providesMap['real-pkg'] = 'compat-pkg';

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
          deps: ['arm-helper [arm]'],
          parent_dep: 'custom-base (>= 1.0)',
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
      name: 'arm-helper',
      version: '1.0',
      revision: 0,
      epoch: 0,
      arch: 'arm',
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

  // When discovering dependents, child arch 'all' retains arm-helper [arm]
  const armHelperDependents = dag.getDependents('arm-helper');
  expect(armHelperDependents.has('parent-pkg')).toBeTrue();

  // Custom parent_dep is discoverable for dependents
  const customBaseDependents = dag.getDependents('custom-base');
  expect(customBaseDependents.has('parent-pkg')).toBeTrue();

  // But neither is an unconditional build prerequisite of the owner
  const buildPrereqs = dag.getRecipeDepNames(dag.recipes['parent-pkg'], 'aarch64', false);
  expect(buildPrereqs.has('arm-helper')).toBeFalse();
  expect(buildPrereqs.has('custom-base')).toBeFalse();
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

  // For build ordering, clause is self-satisfied by owner, so z-helper is not a build prerequisite
  const buildPrereqs = dag.getRecipeDepNames(dag.recipes['a-owner'], 'aarch64', false);
  expect(buildPrereqs.has('z-helper')).toBeFalse();
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
  const dag = new DependencyGraph('pkg');
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
  expect(order.indexOf('b-kit')).toBeLessThan(order.indexOf('z-bootstrap'));
  expect(order.indexOf('z-bootstrap')).toBeLessThan(order.indexOf('a-app'));
  expect(dag.getLayers(['b-kit', 'z-bootstrap', 'a-app'])).toEqual([['b-kit'], ['z-bootstrap'], ['a-app']]);
});
