import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { rewriteShebangLine, sanitizeShebangs } from '../sanitizer/shebang.ts';

describe('Shebang Sanitizer (scripts/sanitizer/shebang.ts)', () => {
  const defaultPrefix = '/data/data/com.termux/files/usr';

  test('rewriteShebangLine rewrites standard shells and interpreters', () => {
    expect(rewriteShebangLine('#!/bin/sh', defaultPrefix)).toBe('#!/data/data/com.termux/files/usr/bin/sh');
    expect(rewriteShebangLine('#!/bin/bash', defaultPrefix)).toBe('#!/data/data/com.termux/files/usr/bin/bash');
    expect(rewriteShebangLine('#!/usr/bin/env sh', defaultPrefix)).toBe('#!/data/data/com.termux/files/usr/bin/sh');
    expect(rewriteShebangLine('#!/usr/bin/env bash', defaultPrefix)).toBe('#!/data/data/com.termux/files/usr/bin/bash');
    expect(rewriteShebangLine('#!/usr/bin/env python', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/python3',
    );
    expect(rewriteShebangLine('#!/usr/bin/env python3', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/python3',
    );
    expect(rewriteShebangLine('#!/usr/bin/python', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/python3',
    );
    expect(rewriteShebangLine('#!/usr/bin/python3', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/python3',
    );
    expect(rewriteShebangLine('#!/usr/bin/perl -w', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/perl -w',
    );
    expect(rewriteShebangLine('#!/usr/local/bin/ruby', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/ruby',
    );
  });

  test('rewriteShebangLine preserves env options', () => {
    expect(rewriteShebangLine('#!/usr/bin/env -S python3 -u', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/env -S python3 -u',
    );
    expect(rewriteShebangLine('#!/bin/env -S bash -e', defaultPrefix)).toBe(
      '#!/data/data/com.termux/files/usr/bin/env -S bash -e',
    );
  });

  test('rewriteShebangLine respects custom prefix', () => {
    const custom = '/opt/custom/usr';
    expect(rewriteShebangLine('#!/bin/sh', custom)).toBe('#!/opt/custom/usr/bin/sh');
    expect(rewriteShebangLine('#!/usr/bin/env node', custom)).toBe('#!/opt/custom/usr/bin/node');
  });

  test('rewriteShebangLine preserves system binaries and existing prefix paths', () => {
    expect(rewriteShebangLine('#!/system/bin/sh')).toBeNull();
    expect(rewriteShebangLine('#!/data/data/com.termux/files/usr/bin/sh')).toBeNull();
    expect(rewriteShebangLine('echo "not a shebang"')).toBeNull();
  });

  test('sanitizeShebangs scans and rewrites files recursively', () => {
    const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'shebang-test-'));
    try {
      mkdirSync(join(tmp, 'sub'), { recursive: true });

      const f1 = join(tmp, 'script1.sh');
      const f2 = join(tmp, 'sub', 'tool.py');
      writeFileSync(f1, '#!/bin/sh -e\necho 1\n');
      writeFileSync(f2, '#!/usr/bin/env python\nprint(1)\n');

      sanitizeShebangs(tmp, '/data/data/com.termux/files/usr');

      expect(readFileSync(f1, 'utf-8')).toBe('#!/data/data/com.termux/files/usr/bin/sh -e\necho 1\n');
      expect(readFileSync(f2, 'utf-8')).toBe('#!/data/data/com.termux/files/usr/bin/python3\nprint(1)\n');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('sanitizeShebangs preserves non-UTF-8 body bytes and non-legacy file permissions', () => {
    const tmp = mkdtempSync(join(process.env.TMPDIR || tmpdir(), 'shebang-bytes-'));
    try {
      mkdirSync(tmp, { recursive: true });

      const f1 = join(tmp, 'latin1.py');
      const f2 = join(tmp, 'custom.pl');

      // Shebang followed by non-UTF-8 byte sequence (e.g. 0xff, 0xfe)
      const latin1Body = Buffer.from([0x23, 0x21, 0x2f, 0x62, 0x69, 0x6e, 0x2f, 0x73, 0x68, 0x0a, 0xff, 0xfe, 0xfa]);
      writeFileSync(f1, latin1Body);

      // Non-legacy shebang with mode 0700
      writeFileSync(f2, '#!/usr/bin/perl\nexit(0);\n');
      chmodSync(f2, 0o700);

      sanitizeShebangs(tmp, '/data/data/com.termux/files/usr');

      const readF1 = readFileSync(f1);
      expect(readF1.subarray(0, readF1.indexOf(0x0a)).toString('utf-8')).toBe(
        '#!/data/data/com.termux/files/usr/bin/sh',
      );
      expect(readF1.subarray(readF1.indexOf(0x0a) + 1)).toEqual(Buffer.from([0xff, 0xfe, 0xfa]));

      expect(readFileSync(f2, 'utf-8').split('\n')[0]).toBe('#!/data/data/com.termux/files/usr/bin/perl');
      const st2 = statSync(f2);
      expect(st2.mode & 0o7777).toBe(0o700);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
