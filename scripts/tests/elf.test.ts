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

test('stripVerneedFromElf compacts retained entries and nullifies DT_VERNEED in 32-bit ELF', () => {
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
  view.setInt32(96, 42, true);

  // Dynamic entry 2 at offset 100: DT_NULL = 0
  view.setInt32(100, 0, true);
  view.setInt32(104, 0, true);

  const tmpFile = join(tmpdir(), `test_elf32_${Date.now()}.bin`);
  writeFileSync(tmpFile, buf);

  stripVerneedFromElf(tmpFile);

  const resultBuf = readFileSync(tmpFile);
  const resultView = new DataView(resultBuf.buffer, resultBuf.byteOffset, resultBuf.byteLength);

  // Traverse table until DT_NULL as Bionic does
  const tags: number[] = [];
  for (let offset = 84; offset < 84 + 24; offset += 8) {
    const tag = resultView.getInt32(offset, true);
    if (tag === 0) {
      break;
    }
    tags.push(tag);
  }

  // DT_VERNEED is compacted away, so DT_NEEDED is reached as the first dynamic entry
  expect(tags).toEqual([1]);
  // Offset 84 should now be DT_NEEDED (tag 1, val 42)
  expect(resultView.getInt32(84, true)).toBe(1);
  expect(resultView.getInt32(88, true)).toBe(42);
  // Subsequent slot is now DT_NULL
  expect(resultView.getInt32(92, true)).toBe(0);

  unlinkSync(tmpFile);
});

test('stripVerneedFromElf compacts retained entries in 64-bit ELF', () => {
  const buf = Buffer.alloc(200);
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 2; // EI_CLASS: 64-bit
  buf[5] = 1; // little-endian
  buf[6] = 1;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setBigUint64(32, 64n, true); // e_phoff = 64
  view.setUint16(54, 56, true); // e_phentsize = 56
  view.setUint16(56, 1, true); // e_phnum = 1

  // Program header at offset 64 (PT_DYNAMIC = 2)
  view.setUint32(64, 2, true); // p_type = 2
  view.setBigUint64(64 + 8, 120n, true); // p_offset = 120
  view.setBigUint64(64 + 32, 48n, true); // p_filesz = 48 (3 entries: 16 bytes each)

  // Entry 0 (offset 120): DT_VERNEED = 0x6ffffffen
  view.setBigInt64(120, 0x6ffffffen, true);
  view.setBigInt64(128, 0n, true);

  // Entry 1 (offset 136): DT_NEEDED = 1n
  view.setBigInt64(136, 1n, true);
  view.setBigInt64(144, 99n, true);

  // Entry 2 (offset 152): DT_NULL = 0n
  view.setBigInt64(152, 0n, true);
  view.setBigInt64(160, 0n, true);

  const tmpFile = join(tmpdir(), `test_elf64_${Date.now()}.bin`);
  writeFileSync(tmpFile, buf);

  stripVerneedFromElf(tmpFile);

  const resultBuf = readFileSync(tmpFile);
  const resultView = new DataView(resultBuf.buffer, resultBuf.byteOffset, resultBuf.byteLength);

  // Traverse table until DT_NULL as dynamic linker does
  const tags: bigint[] = [];
  for (let offset = 120; offset < 120 + 48; offset += 16) {
    const tag = resultView.getBigInt64(offset, true);
    if (tag === 0n) {
      break;
    }
    tags.push(tag);
  }

  expect(tags).toEqual([1n]);
  expect(resultView.getBigInt64(120, true)).toBe(1n);
  expect(resultView.getBigInt64(128, true)).toBe(99n);
  expect(resultView.getBigInt64(136, true)).toBe(0n);

  unlinkSync(tmpFile);
});

test('stripVerneedFromElf throws security violation on ELF containing DT_TEXTREL', () => {
  const buf = Buffer.alloc(120);
  buf[0] = 0x7f;
  buf[1] = 0x45;
  buf[2] = 0x4c;
  buf[3] = 0x46;
  buf[4] = 1; // 32-bit
  buf[5] = 1; // little-endian
  buf[6] = 1;

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  view.setUint32(28, 52, true); // e_phoff = 52
  view.setUint16(42, 32, true); // e_phentsize = 32
  view.setUint16(44, 1, true); // e_phnum = 1

  // Program header (PT_DYNAMIC = 2)
  view.setUint32(52, 2, true);
  view.setUint32(56, 84, true);
  view.setUint32(68, 16, true);

  // Dynamic entry: DT_TEXTREL = 22
  view.setInt32(84, 22, true);
  view.setInt32(88, 0, true);

  const tmpFile = join(tmpdir(), `test_textrel_${Date.now()}.bin`);
  writeFileSync(tmpFile, buf);

  expect(() => stripVerneedFromElf(tmpFile)).toThrow(/contains DT_TEXTREL/);
  unlinkSync(tmpFile);
});
