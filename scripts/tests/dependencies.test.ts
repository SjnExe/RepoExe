import { expect, test } from 'bun:test';
import {
  parseDependencyList,
  filterDepsForArch,
  formatDebianDependency,
  extractAllPackageNames,
  extractPrimaryPackageNames,
} from '../core/dependencies.ts';

test('parses simple dependencies', () => {
  const clauses = parseDependencyList(['gtk3', 'guile (>= 3.0)']);
  expect(clauses.length).toBe(2);
  expect(clauses[0][0].name).toBe('gtk3');
  expect(clauses[1][0].name).toBe('guile');
  expect(clauses[1][0].versionConstraint).toEqual({ operator: '>=', version: '3.0' });
});

test('parses alternative dependencies', () => {
  const clauses = parseDependencyList(['openblas | atlas | lapack']);
  expect(clauses.length).toBe(1);
  expect(clauses[0].length).toBe(3);
  expect(clauses[0].map((t) => t.name)).toEqual(['openblas', 'atlas', 'lapack']);
});

test('filters architecture-specific dependencies', () => {
  const raw = ['vulkan-loader [aarch64 x86_64]', 'simdutf [!i686]', 'openblas [aarch64] | atlas [x86_64] | lapack'];
  const clauses = parseDependencyList(raw);

  // Evaluated for aarch64
  const arm64 = filterDepsForArch(clauses, 'aarch64');
  expect(formatDebianDependency(arm64)).toBe('vulkan-loader, simdutf, openblas | lapack');

  // Evaluated for x86_64
  const x64 = filterDepsForArch(clauses, 'x86_64');
  expect(formatDebianDependency(x64)).toBe('vulkan-loader, simdutf, atlas | lapack');

  // Evaluated for arm
  const arm = filterDepsForArch(clauses, 'arm');
  expect(formatDebianDependency(arm)).toBe('simdutf, lapack');

  // Evaluated for i686
  const x86 = filterDepsForArch(clauses, 'i686');
  expect(formatDebianDependency(x86)).toBe('lapack');
});

test('filters architecture-specific dependencies with Debian wildcards', () => {
  const raw = ['libfoo [any]', 'libbar [!any]', 'libarm [any-arm64]'];
  const clauses = parseDependencyList(raw);

  const arm64 = filterDepsForArch(clauses, 'aarch64');
  expect(formatDebianDependency(arm64)).toBe('libfoo, libarm');

  const x64 = filterDepsForArch(clauses, 'x86_64');
  expect(formatDebianDependency(x64)).toBe('libfoo');
});

test('strips architecture brackets for debian binary control', () => {
  const clauses = parseDependencyList(['libfoo (>= 1.0) [arm64] | libbar [amd64]']);
  const filtered = filterDepsForArch(clauses, 'aarch64');
  const debianStr = formatDebianDependency(filtered);
  expect(debianStr).toBe('libfoo (>= 1.0)');
  expect(debianStr.includes('[')).toBeFalse();
  expect(debianStr.includes(']')).toBeFalse();
});

test('extracts all package names across alternatives for DAG and cache invalidation', () => {
  const clauses = parseDependencyList([
    'gtk3',
    'openblas [aarch64] | atlas [x86_64] | lapack',
    'python3:any (>= 3.10)',
  ]);
  const names = extractAllPackageNames(clauses);
  expect(names.has('gtk3')).toBeTrue();
  expect(names.has('openblas')).toBeTrue();
  expect(names.has('atlas')).toBeTrue();
  expect(names.has('lapack')).toBeTrue();
  expect(names.has('python3')).toBeTrue();
});

test('extracts primary package names', () => {
  const clauses = parseDependencyList(['gtk3', 'openblas | atlas | lapack']);
  expect(extractPrimaryPackageNames(clauses)).toEqual(['gtk3', 'openblas']);
});
