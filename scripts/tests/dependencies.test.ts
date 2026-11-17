import { expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  extractAllPackageNames,
  extractPrimaryPackageNames,
  filterDepsForArch,
  formatDebianDependency,
  parseDependencyList,
  type VersionConstraint,
} from '../core/dependencies.ts';
import {
  downloadFile,
  fetchSingleDep,
  HttpError,
  recordConstraint,
  resolvePackageDependencies,
  retireCandidateConstraints,
} from '../core/fetcher.ts';

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

test('recordConstraint records constraints with source without duplication', (): void => {
  const map = new Map<string, VersionConstraint[]>();
  recordConstraint(map, 'legacy', { operator: '=', version: '1.0' }, 'alpha');
  recordConstraint(map, 'legacy', { operator: '=', version: '1.0' }, 'alpha');
  recordConstraint(map, 'legacy', { operator: '>=', version: '1.0' }, 'beta');

  const list = map.get('legacy')!;
  expect(list.length).toBe(2);
  expect(list[0]).toEqual({ operator: '=', version: '1.0', source: 'alpha' });
  expect(list[1]).toEqual({ operator: '>=', version: '1.0', source: 'beta' });
});

test('retireCandidateConstraints removes obsolete constraints owned by replaced candidate', (): void => {
  const map = new Map<string, VersionConstraint[]>();
  recordConstraint(map, 'legacy', { operator: '=', version: '1.0' }, 'alpha');
  recordConstraint(map, 'legacy', { operator: '>=', version: '1.0' }, 'beta');
  recordConstraint(map, 'other', { operator: '>=', version: '2.0' }, 'alpha');

  retireCandidateConstraints(map, 'alpha');

  const legacyList = map.get('legacy')!;
  expect(legacyList.length).toBe(1);
  expect(legacyList[0]).toEqual({ operator: '>=', version: '1.0', source: 'beta' });

  expect(map.has('other')).toBeFalse();
});

function createMinimalDebBuffer(pkgName: string, version: string, arch: string): Buffer {
  const tmp = join(process.env.TMPDIR || tmpdir(), `mkdeb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const root = join(tmp, 'root');
  mkdirSync(join(root, 'DEBIAN'), { recursive: true });
  chmodSync(root, 0o755);
  chmodSync(join(root, 'DEBIAN'), 0o755);
  writeFileSync(
    join(root, 'DEBIAN', 'control'),
    `Package: ${pkgName}\nVersion: ${version}\nArchitecture: ${arch}\nMaintainer: Test <test@example.com>\nDescription: Test package\n`,
  );
  chmodSync(join(root, 'DEBIAN', 'control'), 0o644);
  const debOut = join(tmp, `${pkgName}_${version}_${arch}.deb`);
  const res = spawnSync('dpkg-deb', ['-b', root, debOut]);
  if (res.status !== 0) {
    throw new Error(`Failed to create minimal deb: ${res.stderr?.toString()}`);
  }
  const buf = readFileSync(debOut);
  rmSync(tmp, { recursive: true, force: true });
  return buf;
}

test('downloadFile throws HttpError immediately on permanent 403 failure without retries', async (): Promise<void> => {
  const dest = join(process.env.TMPDIR || tmpdir(), `test-dl-${Date.now()}`);
  let fetchAttempts = 0;
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
    fetchAttempts++;
    return new Response('Forbidden', { status: 403, statusText: 'Forbidden' });
  }) as unknown as typeof fetch);

  try {
    let thrownError: unknown = null;
    try {
      await downloadFile('https://example.com/test.deb', dest, false, undefined, 4);
    } catch (e: unknown) {
      thrownError = e;
    }
    expect(thrownError).toBeInstanceOf(HttpError);
    if (thrownError instanceof HttpError) {
      expect(thrownError.status).toBe(403);
    }
    // Verified: No retries were executed
    expect(fetchAttempts).toBe(1);
  } finally {
    fetchSpy.mockRestore();
    rmSync(dest, { force: true });
  }
});

test('downloadFile retries transient 502 error up to maxRetries', async (): Promise<void> => {
  const dest = join(process.env.TMPDIR || tmpdir(), `test-dl-${Date.now()}`);
  let fetchAttempts = 0;
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (): Promise<Response> => {
    fetchAttempts++;
    if (fetchAttempts < 2) {
      return new Response('Gateway Error', { status: 502, statusText: 'Bad Gateway' });
    }
    return new Response(Buffer.from('binary data'), { status: 200 });
  }) as unknown as typeof fetch);

  try {
    await downloadFile('https://example.com/test.deb', dest, false, undefined, 3);
    expect(fetchAttempts).toBe(2);
    expect(existsSync(dest)).toBeTrue();
  } finally {
    fetchSpy.mockRestore();
    rmSync(dest, { force: true });
  }
});

test('fetchSingleDep continues to next release asset candidate when download fails', async (): Promise<void> => {
  const destDir = join(process.env.TMPDIR || tmpdir(), `test-rel-dl-${Date.now()}`);
  const privateTmpDir = join(process.env.TMPDIR || tmpdir(), `private-cache-${Date.now()}`);
  const oldTmpDir = process.env.TMPDIR;
  const oldPrefix = process.env.PREFIX;
  let fetchSpy: { mockRestore: () => void } | undefined;

  try {
    mkdirSync(privateTmpDir, { recursive: true });
    process.env.TMPDIR = privateTmpDir;
    process.env.PREFIX = join(destDir, 'prefix');

    const validDeb = createMinimalDebBuffer('sample-pkg', '2.0', 'arm64');

    let releaseAsset1Tried = false;
    let releaseAsset2Tried = false;

    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
      url: string | URL | Request,
    ): Promise<Response> => {
      const urlStr = String(url);
      if (urlStr.includes('/releases/tags/sample-pkg')) {
        return new Response(
          JSON.stringify({
            assets: [
              {
                name: 'sample-pkg_1.0_aarch64.deb',
                url: 'https://api.github.com/repos/test/asset/1',
                browser_download_url: 'https://example.com/asset/1.deb',
              },
              {
                name: 'sample-pkg_2.0_aarch64.deb',
                url: 'https://api.github.com/repos/test/asset/2',
                browser_download_url: 'https://example.com/asset/2.deb',
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (urlStr.includes('/asset/1')) {
        releaseAsset1Tried = true;
        // First candidate asset fails with 404 (non-retryable permanent error)
        return new Response('Not Found', { status: 404 });
      }
      if (urlStr.includes('/asset/2')) {
        releaseAsset2Tried = true;
        // Second candidate asset succeeds with valid deb
        return new Response(new Uint8Array(validDeb), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch);

    const fetched = new Set<string>();
    const success = await fetchSingleDep('sample-pkg', destDir, fetched, 'aarch64');
    expect(releaseAsset1Tried).toBeTrue();
    expect(releaseAsset2Tried).toBeTrue();
    expect(success).toBeTrue();
    expect(fetched.has('sample-pkg')).toBeTrue();
  } finally {
    if (oldPrefix !== undefined) {
      process.env.PREFIX = oldPrefix;
    } else {
      delete process.env.PREFIX;
    }
    if (oldTmpDir !== undefined) {
      process.env.TMPDIR = oldTmpDir;
    } else {
      delete process.env.TMPDIR;
    }
    if (fetchSpy) {
      fetchSpy.mockRestore();
    }
    rmSync(privateTmpDir, { recursive: true, force: true });
    rmSync(destDir, { recursive: true, force: true });
  }
});

test('resolvePackageDependencies accepts compatible recursive references during resolving', async (): Promise<void> => {
  const fetched = new Set<string>(['alpha']);
  const resolving = new Set<string>(['alpha']);
  const selectedVersions = new Map<string, string>([['alpha', '2.0']]);
  const activeConstraints = new Map<string, VersionConstraint[]>();

  const ok = await resolvePackageDependencies(
    'alpha (>= 1.0)',
    tmpdir(),
    fetched,
    'aarch64',
    'aarch64',
    resolving,
    undefined,
    undefined,
    undefined,
    null,
    selectedVersions,
    null,
    activeConstraints,
    null,
    'test',
  );

  expect(ok).toBeTrue();
  expect(activeConstraints.get('alpha')).toBeDefined();
});

test('resolvePackageDependencies rejects incompatible recursive references during resolving without in-place replacement (Thread #5)', async (): Promise<void> => {
  const fetched = new Set<string>(['alpha', 'fallback']);
  const resolving = new Set<string>(['alpha']);
  const selectedVersions = new Map<string, string>([
    ['alpha', '1.0'],
    ['fallback', '1.0'],
  ]);
  const activeConstraints = new Map<string, VersionConstraint[]>();

  const ok = await resolvePackageDependencies(
    'alpha (>= 2.0) | fallback (>= 1.0)',
    tmpdir(),
    fetched,
    'aarch64',
    'aarch64',
    resolving,
    undefined,
    undefined,
    undefined,
    null,
    selectedVersions,
    null,
    activeConstraints,
    null,
    'test',
  );

  expect(ok).toBeTrue();
  // alpha was not replaced in-place while resolving; fallback satisfied the alternative
  expect(selectedVersions.get('alpha')).toBe('1.0');
  expect(activeConstraints.has('fallback')).toBeTrue();
  expect(activeConstraints.get('fallback')?.[0]?.version).toBe('1.0');
  expect(activeConstraints.has('alpha')).toBeFalse();
});

test('retireCandidateConstraints preserves pins for independently required packages (Thread #40)', (): void => {
  const activeConstraints = new Map<string, VersionConstraint[]>();
  // bridge is required by alpha (= 1) and by root (unversioned edge)
  recordConstraint(activeConstraints, 'bridge', { operator: '=', version: '1' }, 'alpha');
  recordConstraint(activeConstraints, 'bridge', undefined, '@root');
  // legacy is required by bridge (= 1)
  recordConstraint(activeConstraints, 'legacy', { operator: '=', version: '1' }, 'bridge');

  // Retiring alpha must NOT retire bridge or legacy because root also reaches bridge
  retireCandidateConstraints(activeConstraints, 'alpha');

  expect(activeConstraints.has('bridge')).toBeTrue();
  expect(activeConstraints.has('legacy')).toBeTrue();
  expect(activeConstraints.get('legacy')?.[0]?.version).toBe('1');
});

test('resolvePackageDependencies falls through to alternative when system package does not satisfy version constraint (Thread #41)', async (): Promise<void> => {
  const fetched = new Set<string>();
  const resolving = new Set<string>();
  const selectedVersions = new Map<string, string>();
  const activeConstraints = new Map<string, VersionConstraint[]>();

  resolving.add('custom-shell');
  selectedVersions.set('custom-shell', '1.0');
  resolving.add('bash');
  selectedVersions.set('bash', '5.1');

  const ok = await resolvePackageDependencies(
    'bash (>= 999.0) | custom-shell (>= 1.0)',
    tmpdir(),
    fetched,
    'aarch64',
    'aarch64',
    resolving,
    undefined,
    undefined,
    undefined,
    null,
    selectedVersions,
    null,
    activeConstraints,
    null,
    'test',
  );

  expect(ok).toBeTrue();
  expect(activeConstraints.has('custom-shell')).toBeTrue();
});
