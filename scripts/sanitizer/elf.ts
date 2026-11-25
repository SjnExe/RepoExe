import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { PREFIX } from '../utils/properties.ts';

export const GLIBC_LIBS = new Set(['libc.so.6', 'libpthread.so.0', 'librt.so.1', 'libdl.so.2', 'libm.so.6']);

export const DYNAMIC_TAGS_TO_NULLIFY = new Set([
  0x6ffffffen, // DT_VERNEED
  0x6fffffffn, // DT_VERNEEDNUM
  0x6ffffff0n, // DT_VERSYM
  0x6ffffffcn, // DT_VERDEF
  0x6ffffffdn, // DT_VERDEFNUM
  0x7ffffffdn, // DT_AUXILIARY
  0x7fffffffn, // DT_FILTER
  15n, // DT_RPATH
]);

export function stripVerneedFromElf(elfPath: string): void {
  try {
    const buf = readFileSync(elfPath);
    if (buf.length < 52) {
      return;
    }
    if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
      return;
    }
    const is32Bit = buf[4] === 1;
    const is64Bit = buf[4] === 2;
    if (!is32Bit && !is64Bit) {
      return;
    }

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const littleEndian = buf[5] === 1;

    let e_phoff = 0;
    let e_phentsize = 0;
    let e_phnum = 0;

    if (is64Bit) {
      if (buf.length < 64) {
        return;
      }
      e_phoff = Number(view.getBigUint64(32, littleEndian));
      e_phentsize = view.getUint16(54, littleEndian);
      e_phnum = view.getUint16(56, littleEndian);
    } else {
      e_phoff = view.getUint32(28, littleEndian);
      e_phentsize = view.getUint16(42, littleEndian);
      e_phnum = view.getUint16(44, littleEndian);
    }

    let dynamicOffset = 0;
    let dynamicFilesz = 0;

    for (let i = 0; i < e_phnum; i++) {
      const phOffset = e_phoff + i * e_phentsize;
      if (phOffset + (is64Bit ? 40 : 20) > buf.length) {
        break;
      }
      const p_type = view.getUint32(phOffset, littleEndian);
      if (p_type === 2) {
        // PT_DYNAMIC
        if (is64Bit) {
          dynamicOffset = Number(view.getBigUint64(phOffset + 8, littleEndian));
          dynamicFilesz = Number(view.getBigUint64(phOffset + 32, littleEndian));
        } else {
          dynamicOffset = view.getUint32(phOffset + 4, littleEndian);
          dynamicFilesz = view.getUint32(phOffset + 16, littleEndian);
        }
        break;
      }
    }

    if (dynamicOffset > 0 && dynamicFilesz > 0) {
      const dynEntrySize = is64Bit ? 16 : 8;
      const numEntries = Math.floor(dynamicFilesz / dynEntrySize);

      if (is64Bit) {
        interface DynEntry64 {
          tag: bigint;
          val: bigint;
        }
        const retained: DynEntry64[] = [];
        let modified = false;

        for (let j = 0; j < numEntries; j++) {
          const entryOffset = dynamicOffset + j * dynEntrySize;
          if (entryOffset + dynEntrySize > buf.length) {
            break;
          }
          const d_tag = view.getBigInt64(entryOffset, littleEndian);
          if (d_tag === 0n) {
            break;
          }
          const d_val = view.getBigInt64(entryOffset + 8, littleEndian);
          const maskedTag = d_tag & 0xffffffffn;

          // Check for W^X text relocation violation (DT_TEXTREL or DF_TEXTREL in DT_FLAGS)
          if (d_tag === 22n || maskedTag === 22n || ((d_tag === 30n || maskedTag === 30n) && (d_val & 4n) !== 0n)) {
            throw new Error(
              `Security Enforcement Failed: '${basename(elfPath)}' contains DT_TEXTREL (text relocations), which violates Android 10+ W^X security policy. Recompile with position-independent code (-fPIC / -fPIE).`,
            );
          }

          if (DYNAMIC_TAGS_TO_NULLIFY.has(d_tag) || DYNAMIC_TAGS_TO_NULLIFY.has(maskedTag)) {
            modified = true;
          } else {
            retained.push({ tag: d_tag, val: d_val });
          }
        }

        if (modified) {
          for (let j = 0; j < numEntries; j++) {
            const entryOffset = dynamicOffset + j * dynEntrySize;
            if (entryOffset + dynEntrySize > buf.length) {
              break;
            }
            if (j < retained.length) {
              view.setBigInt64(entryOffset, retained[j].tag, littleEndian);
              view.setBigInt64(entryOffset + 8, retained[j].val, littleEndian);
            } else {
              view.setBigInt64(entryOffset, 0n, littleEndian);
              view.setBigInt64(entryOffset + 8, 0n, littleEndian);
            }
          }
          writeFileSync(elfPath, buf);
        }
      } else {
        interface DynEntry32 {
          tag: number;
          val: number;
        }
        const retained: DynEntry32[] = [];
        let modified = false;

        for (let j = 0; j < numEntries; j++) {
          const entryOffset = dynamicOffset + j * dynEntrySize;
          if (entryOffset + dynEntrySize > buf.length) {
            break;
          }
          const d_tag = view.getInt32(entryOffset, littleEndian);
          if (d_tag === 0) {
            break;
          }
          const d_val = view.getInt32(entryOffset + 4, littleEndian);
          const bigTag = BigInt(d_tag);
          const maskedTag = bigTag & 0xffffffffn;

          // Check for W^X text relocation violation (DT_TEXTREL or DF_TEXTREL in DT_FLAGS)
          if (d_tag === 22 || maskedTag === 22n || ((d_tag === 30 || maskedTag === 30n) && (d_val & 4) !== 0)) {
            throw new Error(
              `Security Enforcement Failed: '${basename(elfPath)}' contains DT_TEXTREL (text relocations), which violates Android 10+ W^X security policy. Recompile with position-independent code (-fPIC / -fPIE).`,
            );
          }

          if (DYNAMIC_TAGS_TO_NULLIFY.has(bigTag) || DYNAMIC_TAGS_TO_NULLIFY.has(maskedTag)) {
            modified = true;
          } else {
            retained.push({ tag: d_tag, val: d_val });
          }
        }

        if (modified) {
          for (let j = 0; j < numEntries; j++) {
            const entryOffset = dynamicOffset + j * dynEntrySize;
            if (entryOffset + dynEntrySize > buf.length) {
              break;
            }
            if (j < retained.length) {
              view.setInt32(entryOffset, retained[j].tag, littleEndian);
              view.setInt32(entryOffset + 4, retained[j].val, littleEndian);
            } else {
              view.setInt32(entryOffset, 0, littleEndian);
              view.setInt32(entryOffset + 4, 0, littleEndian);
            }
          }
          writeFileSync(elfPath, buf);
        }
      }
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message.includes('Security Enforcement Failed')) {
      throw err;
    }
    // Ignore invalid files
  }
}

export function sanitizeElfBinary(elfPath: string, prefix: string = PREFIX): void {
  try {
    const buf = readFileSync(elfPath);
    if (buf.length < 4 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
      return;
    }

    // 0. STRICT BIONIC & SECURITY VALIDATOR
    const res = spawnSync('readelf', ['-d', elfPath], { encoding: 'utf-8' });
    if (res.error) {
      throw new Error(`Failed to execute readelf on '${basename(elfPath)}': ${res.error.message}`);
    }
    const combinedOutput = `${res.stdout || ''}\n${res.stderr || ''}`;
    const isNoDynamic = /there is no dynamic section/i.test(combinedOutput);
    if (res.status !== 0 && !isNoDynamic) {
      const errDetail = res.stderr?.trim() || `exit code ${res.status}`;
      throw new Error(`Failed to inspect dynamic dependencies on '${basename(elfPath)}': ${errDetail}`);
    }
    if (res.status === 0 && res.stdout) {
      for (const line of res.stdout.split('\n')) {
        const tagMatch = line.match(/\(\s*([A-Za-z0-9_]+)\s*\)\s*(.*)$/);
        if (tagMatch) {
          const tag = tagMatch[1];
          const val = tagMatch[2];
          if (tag === 'NEEDED') {
            for (const glibcLib of GLIBC_LIBS) {
              if (val.includes(`[${glibcLib}]`)) {
                throw new Error(
                  `Strict Bionic Enforcement Failed: '${basename(elfPath)}' linked against glibc library '${glibcLib}'. Native Android builds must not use glibc.`,
                );
              }
            }
          } else if (tag === 'TEXTREL' || (tag === 'FLAGS' && /\bTEXTREL\b/.test(val))) {
            throw new Error(
              `Security Enforcement Failed: '${basename(elfPath)}' contains DT_TEXTREL (text relocations), which violates Android 10+ W^X security policy. Recompile with position-independent code (-fPIC / -fPIE).`,
            );
          }
        }
      }
    }

    // 1. Zero out DT_VERNEED / DT_VERSYM
    stripVerneedFromElf(elfPath);

    // 2. Enforce RPATH on every ELF binary (shared libraries and executables)
    const rpathRes = spawnSync('patchelf', ['--set-rpath', `${prefix}/lib`, elfPath]);
    if (rpathRes.status !== 0 && rpathRes.stderr?.length) {
      console.warn(
        `[ELF Sanitizer] Warning: Failed to set RPATH on ${basename(elfPath)}: ${rpathRes.stderr.toString().trim()}`,
      );
    }

    // 3. Set dynamic interpreter only on executables with an INTERP program header
    const phdrs = spawnSync('readelf', ['-l', elfPath], { encoding: 'utf-8' });
    if (phdrs.status === 0 && phdrs.stdout?.includes('INTERP')) {
      const is32Bit = buf.length >= 5 && buf[4] === 1;
      const linker = is32Bit ? '/system/bin/linker' : '/system/bin/linker64';
      const interpRes = spawnSync('patchelf', ['--set-interpreter', linker, elfPath]);
      if (interpRes.status !== 0 && interpRes.stderr?.length) {
        console.warn(
          `[ELF Sanitizer] Warning: Failed to set interpreter on ${basename(elfPath)}: ${interpRes.stderr.toString().trim()}`,
        );
      }
    }
  } catch (err: unknown) {
    if (
      err instanceof Error &&
      (err.message.includes('Strict Bionic Enforcement Failed') ||
        err.message.includes('Security Enforcement Failed') ||
        err.message.includes('Failed to execute readelf') ||
        err.message.includes('Failed to inspect dynamic dependencies'))
    ) {
      throw err;
    }
  }
}

export function sanitizeStagingElfs(stageDir: string, prefix: string = PREFIX): void {
  if (!stageDir || !existsSync(stageDir)) {
    return;
  }

  const traverse = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(full);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        sanitizeElfBinary(full, prefix);
      }
    }
  };

  traverse(stageDir);
}
