import { expect, test } from 'bun:test';
import { unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { GLIBC_LIBS, stripVerneedFromElf } from '../sanitizer/elf.ts';

test('GLIBC_LIBS contains core glibc shared objects', () => {
  expect(GLIBC_LIBS.has('libc.so.6')).toBeTrue();
  expect(GLIBC_LIBS.has('libpthread.so.0')).toBeTrue();
});

test('stripVerneedFromElf handles non-ELF or tiny files gracefully', () => {
  const tmpFile = join(tmpdir(), 'test_non_elf.bin');
  writeFileSync(tmpFile, 'HELLO_WORLD');
  expect(() => stripVerneedFromElf(tmpFile)).not.toThrow();
  unlinkSync(tmpFile);
});
