import { expect, test } from 'bun:test';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
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

test('stripVerneedFromElf nullifies DT_VERNEED in 32-bit ELF', () => {
  const buf = Buffer.alloc(120);
  // ELF Magic
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 1; // EI_CLASS: 32-bit
  buf[5] = 1; // EI_DATA: little-endian
  buf[6] = 1; // EI_VERSION

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(28, 52, true); // e_phoff = 52
  view.setUint16(42, 32, true); // e_phentsize = 32
  view.setUint16(44, 1, true); // e_phnum = 1

  // Program header at offset 52 (PT_DYNAMIC = 2)
  view.setUint32(52, 2, true); // p_type = 2
  view.setUint32(56, 84, true); // p_offset = 84
  view.setUint32(68, 24, true); // p_filesz = 24 (3 entries: 8 bytes each)

  // Dynamic entry 0 at offset 84: DT_VERNEED = 0x6ffffffe
  view.setInt32(84, 0x6ffffffe, true);
  view.setInt32(88, 0, true);

  // Dynamic entry 1 at offset 92: DT_NEEDED = 1
  view.setInt32(92, 1, true);
  view.setInt32(96, 1, true);

  // Dynamic entry 2 at offset 100: DT_NULL = 0
  view.setInt32(100, 0, true);
  view.setInt32(104, 0, true);

  const tmpFile = join(tmpdir(), `test_elf32_${Date.now()}.bin`);
  writeFileSync(tmpFile, buf);

  stripVerneedFromElf(tmpFile);

  const resultBuf = readFileSync(tmpFile);
  const resultView = new DataView(resultBuf.buffer, resultBuf.byteOffset, resultBuf.byteLength);

  // DT_VERNEED should be nullified (set to 0)
  expect(resultView.getInt32(84, true)).toBe(0);
  // DT_NEEDED should remain untouched
  expect(resultView.getInt32(92, true)).toBe(1);

  unlinkSync(tmpFile);
});
