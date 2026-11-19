import { expect, spyOn, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
  checkExistingReleaseHash,
  computeFileFingerprint,
  downloadFile,
  fetchSingleDep,
  HttpError,
  installDebsToPrefix,
  recordConstraint,
  resolveAndFetchBuildDependencies,
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
      if (urlStr === 'https://api.github.com/repos/test/asset/1') {
        releaseAsset1Tried = true;
        // First candidate asset fails with 404 (non-retryable permanent error)
        return new Response('Not Found', { status: 404 });
      }
      if (urlStr === 'https://api.github.com/repos/test/asset/2') {
        releaseAsset2Tried = true;
        // Second candidate asset succeeds with valid deb
        return new Response(new Uint8Array(validDeb), { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch);

    const fetched = new Set<string>();
    const success = await fetchSingleDep(
      'sample-pkg',
      destDir,
      fetched,
      'aarch64',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      [],
    );
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
    process.env.TMPDIR || tmpdir(),
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
    process.env.TMPDIR || tmpdir(),
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
  const privateDest = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'dep-test-'));
  const privatePrefix = join(privateDest, 'prefix');
  mkdirSync(privatePrefix, { recursive: true });
  const oldPrefix = process.env.PREFIX;
  process.env.PREFIX = privatePrefix;

  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    (async (): Promise<Response> => new Response('Not Found', { status: 404 })) as unknown as typeof fetch,
  );
  const fetched = new Set<string>(['bash', 'custom-shell']);
  const resolving = new Set<string>(['custom-shell']);
  const selectedVersions = new Map<string, string>([
    ['custom-shell', '1.0'],
    ['bash', '5.1'],
  ]);
  const activeConstraints = new Map<string, VersionConstraint[]>();

  try {
    const ok = await resolvePackageDependencies(
      'bash (>= 999.0) | custom-shell (>= 1.0)',
      privateDest,
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
      [],
    );

    expect(ok).toBeTrue();
    expect(activeConstraints.has('custom-shell')).toBeTrue();
  } finally {
    fetchSpy.mockRestore();
    if (oldPrefix !== undefined) {
      process.env.PREFIX = oldPrefix;
    } else {
      delete process.env.PREFIX;
    }
    rmSync(privateDest, { recursive: true, force: true });
  }
});

function createTestDebFile(
  outDir: string,
  pkgName: string,
  version: string,
  arch: string,
  opts: { depends?: string; provides?: string; payloadRelPath?: string; payloadMode?: number } = {},
): string {
  const tmp = join(process.env.TMPDIR || tmpdir(), `mkdeb-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const root = join(tmp, 'root');
  mkdirSync(join(root, 'DEBIAN'), { recursive: true });
  chmodSync(root, 0o755);
  chmodSync(join(root, 'DEBIAN'), 0o755);
  const ctrlLines = [
    `Package: ${pkgName}`,
    `Version: ${version}`,
    `Architecture: ${arch}`,
    'Maintainer: Test <test@example.com>',
    'Description: Test package',
    ...(opts.depends ? [`Depends: ${opts.depends}`] : []),
    ...(opts.provides ? [`Provides: ${opts.provides}`] : []),
  ];
  writeFileSync(join(root, 'DEBIAN', 'control'), `${ctrlLines.join('\n')}\n`);
  chmodSync(join(root, 'DEBIAN', 'control'), 0o644);
  if (opts.payloadRelPath) {
    const filePath = join(root, 'data', 'data', 'com.termux', 'files', 'usr', opts.payloadRelPath);
    mkdirSync(join(filePath, '..'), { recursive: true });
    writeFileSync(filePath, `${pkgName}@${version}\n`);
    chmodSync(filePath, opts.payloadMode ?? 0o644);
  }
  mkdirSync(outDir, { recursive: true });
  const debOut = join(outDir, `${pkgName}_${version}_${arch}.deb`);
  const res = spawnSync('dpkg-deb', ['-b', root, debOut]);
  rmSync(tmp, { recursive: true, force: true });
  if (res.status !== 0) {
    throw new Error(`Failed to create deb ${pkgName}: ${res.stderr?.toString()}`);
  }
  return debOut;
}

test('Finding #2: backtracking prunes orphaned transitive debs while preserving live virtual/concrete aliases', async (): Promise<void> => {
  const workDir = join(process.env.TMPDIR || tmpdir(), `test-f2-${Date.now()}`);
  const localDir = join(workDir, 'local');
  const destDir = join(workDir, 'dest');
  const prefixDir = join(workDir, 'prefix');
  const oldPrefix = process.env.PREFIX;
  process.env.PREFIX = prefixDir;
  try {
    createTestDebFile(localDir, 'orphan-only', '1.0', 'aarch64');
    createTestDebFile(localDir, 'alpha', '1.0', 'aarch64', { depends: 'orphan-only (= 1.0)' });
    createTestDebFile(localDir, 'alpha', '2.0', 'aarch64');
    createTestDebFile(localDir, 'real-virt', '1.0', 'aarch64', { provides: 'virt-cap (= 1.0)' });

    const fetched = new Set<string>();
    const pendingDebs = new Map<string, string>();
    const selectedVersions = new Map<string, string>();
    const activeConstraints = new Map<string, VersionConstraint[]>();

    // Stage virtual provider and alpha 1.0 (which pulls orphan-only 1.0)
    expect(
      await fetchSingleDep(
        'virt-cap',
        destDir,
        fetched,
        'aarch64',
        new Set(),
        pendingDebs,
        undefined,
        selectedVersions,
        activeConstraints,
        '@root',
        [localDir],
      ),
    ).toBeTrue();
    expect(
      await fetchSingleDep(
        'alpha (= 1.0)',
        destDir,
        fetched,
        'aarch64',
        new Set(),
        pendingDebs,
        undefined,
        selectedVersions,
        activeConstraints,
        '@root',
        [localDir],
      ),
    ).toBeTrue();
    // Simulate alpha initially requested unversioned by root so replacement is allowed
    activeConstraints.set('alpha', [{ operator: '', version: '', source: '@root' }]);
    expect(pendingDebs.has('orphan-only')).toBeTrue();
    expect(pendingDebs.has('real-virt')).toBeTrue();

    // Trigger replacement to alpha >= 2.0 via fetchSingleDep
    const replaced = await fetchSingleDep(
      'alpha (>= 2.0)',
      destDir,
      fetched,
      'aarch64',
      new Set(),
      pendingDebs,
      undefined,
      selectedVersions,
      activeConstraints,
      '@root',
      [localDir],
    );
    expect(replaced).toBeTrue();
    expect(selectedVersions.get('alpha')).toBe('2.0');
    // Retired transitive dependency must be evicted
    expect(pendingDebs.has('orphan-only')).toBeFalse();
    expect(fetched.has('orphan-only')).toBeFalse();
    expect(activeConstraints.has('orphan-only')).toBeFalse();
    // Live virtual package AND its concrete alias must survive pruning
    expect(pendingDebs.has('virt-cap')).toBeTrue();
    expect(pendingDebs.has('real-virt')).toBeTrue();
    expect(fetched.has('real-virt')).toBeTrue();
  } finally {
    if (oldPrefix !== undefined) {
      process.env.PREFIX = oldPrefix;
    } else {
      delete process.env.PREFIX;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('Finding #7: direct fetchSingleDep extracts virtual/concrete alias archive only once', async (): Promise<void> => {
  const workDir = join(process.env.TMPDIR || tmpdir(), `test-f7-${Date.now()}`);
  const localDir = join(workDir, 'local');
  const destDir = join(workDir, 'dest');
  const shimDir = join(workDir, 'shim');
  const prefixDir = join(workDir, 'prefix');
  const extractLog = join(workDir, 'extracts.log');
  const oldPath = process.env.PATH;
  const oldPrefix = process.env.PREFIX;

  try {
    createTestDebFile(localDir, 'real-provider', '1.0', 'aarch64', {
      provides: 'virtual-tool (= 1.0)',
      payloadRelPath: 'bin/vtool',
      payloadMode: 0o555,
    });

    const realDpkgDeb = Bun.which('dpkg-deb')!;
    mkdirSync(shimDir, { recursive: true });
    writeFileSync(
      join(shimDir, 'dpkg-deb'),
      `#!/bin/sh\nif [ "$1" = "-x" ]; then echo "$2" >> "$REPOEXE_TEST_EXTRACT_LOG"; fi\nexec "${realDpkgDeb}" "$@"\n`,
    );
    chmodSync(join(shimDir, 'dpkg-deb'), 0o755);

    process.env.REPOEXE_TEST_EXTRACT_LOG = extractLog;
    process.env.PATH = `${shimDir}:${oldPath || ''}`;
    process.env.PREFIX = prefixDir;

    // Direct call (pendingDebs = undefined)
    const ok = await fetchSingleDep(
      'virtual-tool (= 1.0)',
      destDir,
      new Set(),
      'aarch64',
      new Set(),
      undefined,
      undefined,
      new Map(),
      new Map(),
      '@root',
      [localDir],
    );
    expect(ok).toBeTrue();
    expect(existsSync(join(prefixDir, 'bin', 'vtool'))).toBeTrue();

    const extractCalls = readFileSync(extractLog, 'utf-8').trim().split('\n').filter(Boolean);
    expect(extractCalls).toHaveLength(1);
  } finally {
    delete process.env.REPOEXE_TEST_EXTRACT_LOG;
    process.env.PATH = oldPath;
    if (oldPrefix !== undefined) {
      process.env.PREFIX = oldPrefix;
    } else {
      delete process.env.PREFIX;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('Finding #14: loadTermuxIndex trims ProvidedVersion whitespace and rejects non-= Provides operators', async (): Promise<void> => {
  const tmpCache = join(process.env.TMPDIR || tmpdir(), `test-f14-${Date.now()}`);
  const oldTmpDir = process.env.TMPDIR;
  let fetchSpy: { mockRestore: () => void } | undefined;

  try {
    mkdirSync(tmpCache, { recursive: true });
    process.env.TMPDIR = tmpCache;

    const fakePackages = [
      'Package: libfoo-provider',
      'Version: 2.0',
      'Filename: pool/main/libfoo-provider_2.0_i686.deb',
      'Provides: libfoo (= 1.5 ), libbar (>= 1.0), libbaz:any (= 3.0)',
      '',
    ].join('\n');

    fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
      url: string | URL | Request,
    ): Promise<Response> => {
      const u = String(url);
      if (u.includes('termux-main') && u.endsWith('/Packages')) {
        return new Response(fakePackages, { status: 200 });
      }
      return new Response('Not Found', { status: 404 });
    }) as unknown as typeof fetch);

    const { loadTermuxIndex, satisfiesVersionConstraint } = await import('../core/fetcher.ts');
    const index = await loadTermuxIndex('i686');

    expect(index['libfoo']?.[0]?.ProvidedVersion).toBe('1.5');
    expect(
      satisfiesVersionConstraint(index['libfoo'][0].ProvidedVersion, { operator: '=', version: '1.5' }),
    ).toBeTrue();
    expect(index['libbaz']?.[0]?.ProvidedVersion).toBe('3.0');
    expect(index['libbar']).toBeUndefined();
  } finally {
    if (oldTmpDir !== undefined) {
      process.env.TMPDIR = oldTmpDir;
    } else {
      delete process.env.TMPDIR;
    }
    fetchSpy?.mockRestore();
    rmSync(tmpCache, { recursive: true, force: true });
  }
});

test('Thread #12: checkExistingReleaseHash requires designated child archives while allowing non-producer arm skip', async (): Promise<void> => {
  const recipe = {
    name: 'multiapp',
    version: '2.0',
    revision: 0,
    epoch: 0,
    arch: 'aarch64',
    arches: ['aarch64', 'arm'],
    subpackages: {
      doc: { name: 'multiapp-doc', arch: 'all', include: ['share/doc/**'] },
    },
  };

  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    (async (): Promise<Response> =>
      new Response(
        JSON.stringify({
          body: JSON.stringify({ state_hash: 'deadbeef' }),
          assets: [
            { name: 'multiapp_2.0_aarch64.deb', browser_download_url: 'https://example.com/a.deb' },
            { name: 'multiapp_2.0_arm.deb', browser_download_url: 'https://example.com/b.deb' },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch,
  );

  try {
    // aarch64 is designated producer for multiapp-doc (_all.deb) and it is missing -> must NOT skip
    expect(await checkExistingReleaseHash('multiapp', 'deadbeef', 'aarch64', recipe)).toBeFalse();
    // arm does NOT produce the _all.deb child -> CAN skip independently
    expect(await checkExistingReleaseHash('multiapp', 'deadbeef', 'arm', recipe)).toBeTrue();
  } finally {
    fetchSpy.mockRestore();
  }
});

test('Thread #13: resolveAndFetchBuildDependencies backtracks to earlier alternative when later clause conflicts', async (): Promise<void> => {
  const workDir = join(process.env.TMPDIR || tmpdir(), `test-t13-${Date.now()}`);
  const localDir = join(workDir, 'local');
  const destDir = join(workDir, 'dest');
  const prefixDir = join(workDir, 'prefix');
  const oldPrefix = process.env.PREFIX;
  const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
    (async (): Promise<Response> => new Response('Not Found', { status: 404 })) as unknown as typeof fetch,
  );

  try {
    process.env.PREFIX = prefixDir;
    createTestDebFile(localDir, 'alpha', '1', 'aarch64', { payloadRelPath: 'include/alpha1.h' });
    createTestDebFile(localDir, 'alpha', '2', 'aarch64', { payloadRelPath: 'include/alpha2.h' });
    createTestDebFile(localDir, 'beta', '1', 'aarch64', { payloadRelPath: 'include/beta.h' });

    await resolveAndFetchBuildDependencies(
      ['alpha (= 1) | beta', 'alpha (= 2)'],
      destDir,
      'aarch64',
      undefined,
      'consumer',
      [localDir],
    );

    expect(existsSync(join(prefixDir, 'include', 'beta.h'))).toBeTrue();
    expect(existsSync(join(prefixDir, 'include', 'alpha2.h'))).toBeTrue();
    expect(existsSync(join(prefixDir, 'include', 'alpha1.h'))).toBeFalse();
  } finally {
    fetchSpy.mockRestore();
    if (oldPrefix !== undefined) {
      process.env.PREFIX = oldPrefix;
    } else {
      delete process.env.PREFIX;
    }
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('Thread #14: installDebsToPrefix removes headers dropped by superseded dependency while preserving other deps', (): void => {
  const workDir = join(process.env.TMPDIR || tmpdir(), `test-t14-${Date.now()}`);
  const localDir = join(workDir, 'local');
  const prefixDir = join(workDir, 'prefix');
  const stagingBase = join(workDir, 'staging');
  mkdirSync(stagingBase, { recursive: true });

  try {
    const sampleV1 = createTestDebFile(localDir, 'libsample', '1', 'aarch64', {
      payloadRelPath: 'include/sample_old.h',
    });
    const sampleV2 = createTestDebFile(localDir, 'libsample', '2', 'aarch64', {
      payloadRelPath: 'include/sample_new.h',
    });
    const otherLib = createTestDebFile(localDir, 'libother', '1', 'aarch64', {
      payloadRelPath: 'include/other.h',
    });

    installDebsToPrefix([sampleV1, otherLib], prefixDir, stagingBase);
    expect(existsSync(join(prefixDir, 'include', 'sample_old.h'))).toBeTrue();
    expect(existsSync(join(prefixDir, 'include', 'other.h'))).toBeTrue();

    installDebsToPrefix([sampleV2], prefixDir, stagingBase);
    expect(existsSync(join(prefixDir, 'include', 'sample_old.h'))).toBeFalse();
    expect(existsSync(join(prefixDir, 'include', 'sample_new.h'))).toBeTrue();
    expect(existsSync(join(prefixDir, 'include', 'other.h'))).toBeTrue();
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
});

test('fetchSingleDep skips -doc shortcut when activeConstraints contains version predicate (Thread #8)', async (): Promise<void> => {
  const tmpDest = join(process.env.TMPDIR || tmpdir(), `test-dest-${Date.now()}`);
  mkdirSync(tmpDest, { recursive: true });
  const privatePrefix = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'dep-doc-test-prefix-'));
  const oldPrefix = process.env.PREFIX;
  process.env.PREFIX = privatePrefix;
  try {
    const fetched = new Set<string>();
    const selectedVersions = new Map<string, string>();
    const pending = new Map<string, string>();
    const activeConstraints = new Map<string, VersionConstraint[]>([
      ['unmapped-doc', [{ operator: '=', version: '1.0' }]],
    ]);

    const ok = await fetchSingleDep(
      'unmapped-doc',
      tmpDest,
      fetched,
      'aarch64',
      new Set<string>(),
      pending,
      {},
      selectedVersions,
      activeConstraints,
      undefined,
      [],
    );
    expect(ok).toBeFalse();
    expect(fetched.has('unmapped-doc')).toBeFalse();
  } finally {
    if (oldPrefix !== undefined) {
      process.env.PREFIX = oldPrefix;
    } else {
      delete process.env.PREFIX;
    }
    rmSync(tmpDest, { recursive: true, force: true });
    rmSync(privatePrefix, { recursive: true, force: true });
  }
});

test('resolveAndFetchBuildDependencies creates fresh destdir on empty filtered build dependency list and reconciles existing prefix (Thread #9 & Thread #21)', async (): Promise<void> => {
  const tmpBase = process.env.TMPDIR || tmpdir();
  const freshDest = join(tmpBase, `fresh-dest-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  const separatePrefix = join(tmpBase, `separate-prefix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  mkdirSync(join(separatePrefix, 'include'), { recursive: true });

  const managedFile = join(separatePrefix, 'include', 'managed.h');
  writeFileSync(managedFile, '/* managed */', 'utf-8');
  const manifestPath = join(separatePrefix, '.repoexe_dep_ownership.json');
  const hash = computeFileFingerprint(managedFile);
  writeFileSync(
    manifestPath,
    JSON.stringify({
      'old-pkg': {
        version: '1.0',
        files: ['include/managed.h'],
        hashes: { 'include/managed.h': hash },
      },
    }),
    'utf-8',
  );

  expect(existsSync(freshDest)).toBeFalse();
  expect(existsSync(managedFile)).toBeTrue();

  const oldPrefix = process.env.PREFIX;
  process.env.PREFIX = separatePrefix;
  try {
    await resolveAndFetchBuildDependencies(['arm-only [arm]'], freshDest, 'aarch64');
    expect(existsSync(freshDest)).toBeTrue();
    expect(existsSync(managedFile)).toBeFalse();
  } finally {
    if (oldPrefix !== undefined) {
      process.env.PREFIX = oldPrefix;
    } else {
      delete process.env.PREFIX;
    }
    rmSync(freshDest, { recursive: true, force: true });
    rmSync(separatePrefix, { recursive: true, force: true });
  }
});

test('Thread #1: installDebsToPrefix does not delete tracked file if another installer replaced it', (): void => {
  const tmpDir = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'test-prune-replace-'));
  const fakePrefix = join(tmpDir, 'prefix');
  const fakeStaging = join(tmpDir, 'staging');
  mkdirSync(fakePrefix, { recursive: true });
  mkdirSync(fakeStaging, { recursive: true });

  const manifestPath = join(fakePrefix, '.repoexe_dep_ownership.json');
  // Recorded file with original hash
  const sdkHeaderPath = join(fakePrefix, 'include', 'sdk.h');
  const libPath = join(fakePrefix, 'lib', 'libfoo.so');
  mkdirSync(join(fakePrefix, 'include'), { recursive: true });
  mkdirSync(join(fakePrefix, 'lib'), { recursive: true });

  writeFileSync(sdkHeaderPath, '/* original header v1 */\n');
  writeFileSync(libPath, '/* libfoo v1 */\n');

  // Compute original hashes
  const hasher1 = new Bun.CryptoHasher('sha256');
  hasher1.update(readFileSync(sdkHeaderPath));
  const origHeaderHash = `sha256:${hasher1.digest('hex')}`;

  const hasher2 = new Bun.CryptoHasher('sha256');
  hasher2.update(readFileSync(libPath));
  const origLibHash = `sha256:${hasher2.digest('hex')}`;

  const manifest = {
    'foo-dev': {
      version: '1.0',
      files: ['include/sdk.h', 'lib/libfoo.so'],
      hashes: {
        'include/sdk.h': origHeaderHash,
        'lib/libfoo.so': origLibHash,
      },
    },
  };
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  // Now simulate another installer replacing include/sdk.h
  writeFileSync(sdkHeaderPath, '/* replaced by another installer */\n');

  try {
    // Empty dependency build reconciles against prefix with pruneUnselected = true
    installDebsToPrefix([], fakePrefix, fakeStaging, true);

    // include/sdk.h was replaced by another installer -> MUST NOT be deleted
    expect(existsSync(sdkHeaderPath)).toBeTrue();
    expect(readFileSync(sdkHeaderPath, 'utf-8')).toBe('/* replaced by another installer */\n');

    // lib/libfoo.so was unchanged -> MUST be deleted as part of pruning unselected package
    expect(existsSync(libPath)).toBeFalse();
  } finally {
    rmSync(tmpDir, { recursive: true, force: true });
  }
});
