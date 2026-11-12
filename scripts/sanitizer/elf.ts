import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { PREFIX } from "../utils/properties.ts";

export const GLIBC_LIBS = new Set([
  "libc.so.6",
  "libpthread.so.0",
  "librt.so.1",
  "libdl.so.2",
  "libm.so.6",
]);

export const DYNAMIC_TAGS_TO_NULLIFY = new Set([
  0x6ffffffen, // DT_VERNEED
  0x6fffffffn, // DT_VERNEEDNUM
  0x6ffffff0n, // DT_VERSYM
  0x6ffffffcn, // DT_VERDEF
  0x6ffffffdn, // DT_VERDEFNUM
  15n,         // DT_RPATH
]);

export function stripVerneedFromElf(elfPath: string): void {
  try {
    const buf = readFileSync(elfPath);
    if (buf.length < 64) return;
    if (buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) return;
    if (buf[4] !== 2) return; // Only 64-bit ELF

    const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
    const littleEndian = buf[5] === 1;

    const e_phoff = Number(view.getBigUint64(32, littleEndian));
    const e_phentsize = view.getUint16(54, littleEndian);
    const e_phnum = view.getUint16(56, littleEndian);

    let dynamicOffset = 0;
    let dynamicFilesz = 0;

    for (let i = 0; i < e_phnum; i++) {
      const phOffset = e_phoff + i * e_phentsize;
      if (phOffset + 40 > buf.length) break;
      const p_type = view.getUint32(phOffset, littleEndian);
      if (p_type === 2) {
        // PT_DYNAMIC
        dynamicOffset = Number(view.getBigUint64(phOffset + 8, littleEndian));
        dynamicFilesz = Number(view.getBigUint64(phOffset + 32, littleEndian));
        break;
      }
    }

    if (dynamicOffset > 0 && dynamicFilesz > 0) {
      const dynEntrySize = 16;
      const numEntries = Math.floor(dynamicFilesz / dynEntrySize);

      for (let j = 0; j < numEntries; j++) {
        const entryOffset = dynamicOffset + j * dynEntrySize;
        if (entryOffset + 8 > buf.length) break;
        const d_tag = view.getBigInt64(entryOffset, littleEndian);
        if (d_tag === 0n) break;

        const maskedTag = d_tag & 0xffffffffn;
        if (DYNAMIC_TAGS_TO_NULLIFY.has(d_tag) || DYNAMIC_TAGS_TO_NULLIFY.has(maskedTag)) {
          view.setBigInt64(entryOffset, 0n, littleEndian);
        }
      }

      writeFileSync(elfPath, buf);
    }
  } catch {
    // Ignore invalid files
  }
}

export function sanitizeElfBinary(elfPath: string, prefix: string = PREFIX): void {
  try {
    const buf = readFileSync(elfPath);
    if (buf.length < 4 || buf[0] !== 0x7f || buf[1] !== 0x45 || buf[2] !== 0x4c || buf[3] !== 0x46) {
      return;
    }

    // 0. STRICT BIONIC VALIDATOR
    const res = spawnSync("readelf", ["-d", elfPath], { encoding: "utf-8" });
    if (res.status === 0 && res.stdout) {
      for (const line of res.stdout.split("\n")) {
        if (line.includes("(NEEDED)")) {
          for (const glibcLib of GLIBC_LIBS) {
            if (line.includes(`[${glibcLib}]`)) {
              throw new Error(
                `Strict Bionic Enforcement Failed: '${basename(elfPath)}' linked against glibc library '${glibcLib}'. Native Android builds must not use glibc.`
              );
            }
          }
        }
      }
    }

    // 1. Zero out DT_VERNEED / DT_VERSYM
    stripVerneedFromElf(elfPath);

    // 2. Set dynamic interpreter and enforce RPATH
    spawnSync("patchelf", ["--set-interpreter", "/system/bin/linker64", elfPath]);
    spawnSync("patchelf", ["--set-rpath", `${prefix}/lib`, elfPath]);

    // 3. Clean remaining version tags
    stripVerneedFromElf(elfPath);
  } catch (err: any) {
    if (err.message?.includes("Strict Bionic Enforcement Failed")) {
      throw err;
    }
  }
}

export function sanitizeStagingElfs(stageDir: string, prefix: string = PREFIX): void {
  if (!stageDir || !existsSync(stageDir)) return;

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
