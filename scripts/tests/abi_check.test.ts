import { describe, expect, it } from 'bun:test';

import {
  collectTermuxClosure,
  detectChangedDeps,
  extractSonamesFromDebListOutput,
  findBrokenSonames,
} from '../cli/abi_check.ts';

describe('ABI revbump checker', (): void => {
  it('detects only dependencies whose Termux version changed', (): void => {
    const termuxIndex = {
      gtk3: [{ Package: 'gtk3', Version: '3.24.43', Filename: 'pool/gtk3.deb', BaseUrl: 'https://example.org' }],
      libxml2: [
        { Package: 'libxml2', Version: '2.13.4', Filename: 'pool/libxml2_old.deb', BaseUrl: 'https://example.org' },
        { Package: 'libxml2', Version: '2.14.0', Filename: 'pool/libxml2_new.deb', BaseUrl: 'https://example.org' },
      ],
    };

    const changed = detectChangedDeps({ gtk3: '3.24.43', libxml2: '2.13.4' }, termuxIndex);
    expect(changed).toEqual([{ name: 'libxml2', oldVersion: '2.13.4', newVersion: '2.14.0' }]);
  });

  it('collects transitive Termux dependency closure while skipping internal recipes', (): void => {
    const termuxIndex = {
      guile: [
        {
          Package: 'guile',
          Version: '3.0.10',
          Filename: 'pool/guile.deb',
          BaseUrl: 'https://example.org',
          Depends: 'libgc (>= 8.2.0), libgmp',
        },
      ],
      libgc: [{ Package: 'libgc', Version: '8.2.8', Filename: 'pool/libgc.deb', BaseUrl: 'https://example.org' }],
      libgmp: [{ Package: 'libgmp', Version: '6.3.0', Filename: 'pool/libgmp.deb', BaseUrl: 'https://example.org' }],
    };

    const closure = collectTermuxClosure(['guile', 'my-internal-pkg'], termuxIndex, new Set(['my-internal-pkg']));
    expect(closure.map((c) => c.name)).toEqual(['guile', 'libgc', 'libgmp']);
  });

  it('extracts versioned and unversioned shared library names from dpkg-deb output', (): void => {
    const output = `
drwxr-xr-x root/root         0 2026-01-01 00:00 ./data/data/com.termux/files/usr/lib/
lrwxrwxrwx root/root         0 2026-01-01 00:00 ./data/data/com.termux/files/usr/lib/libxml2.so.2 -> libxml2.so.2.13.4
-rw-r--r-- root/root   1234567 2026-01-01 00:00 ./data/data/com.termux/files/usr/lib/libxml2.so.2.13.4
-rw-r--r-- root/root      1234 2026-01-01 00:00 ./data/data/com.termux/files/usr/share/doc/libxml2/README
`;
    expect(extractSonamesFromDebListOutput(output)).toEqual(['libxml2.so.2', 'libxml2.so.2.13.4']);
  });

  it('reports only missing SONAMEs so ABI-compatible patch updates trigger zero revbumps', (): void => {
    const needed = ['libguile-3.0.so.1', 'libxml2.so.2'];
    const sameAbi = new Set(['libguile-3.0.so.1', 'libxml2.so.2', 'libgc.so.1']);
    expect(findBrokenSonames(needed, sameAbi)).toEqual([]);

    const brokenAbi = new Set(['libguile-3.0.so.1', 'libxml2.so.16']);
    expect(findBrokenSonames(needed, brokenAbi)).toEqual(['libxml2.so.2']);
  });
});
