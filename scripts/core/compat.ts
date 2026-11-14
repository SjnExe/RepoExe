import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

export function resolveNdkTool(toolName: string): string {
  if (process.env[toolName]) {
    const val = process.env[toolName]!;
    if (existsSync(val) || spawnSync('which', [val]).status === 0) {
      return val;
    }
  }

  const ndkPath = process.env.NDK || '/opt/android-ndk';
  if (existsSync(ndkPath)) {
    // 1. Direct LLVM prebuilt bin path (standard in all modern NDK versions)
    const prebuiltDir = join(ndkPath, 'toolchains', 'llvm', 'prebuilt');
    if (existsSync(prebuiltDir)) {
      try {
        for (const host of readdirSync(prebuiltDir)) {
          const candidate = join(prebuiltDir, host, 'bin', toolName);
          if (existsSync(candidate)) return candidate;
        }
      } catch {}
    }

    // 2. Fallback bounded search if located in alternative subdirectories
    const findInNdk = (dir: string, depth: number = 0): string | null => {
      if (depth > 4) return null;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            const res = findInNdk(full, depth + 1);
            if (res) return res;
          } else if (entry.name === toolName) {
            return full;
          }
        }
      } catch {}
      return null;
    };
    const found = findInNdk(ndkPath);
    if (found) return found;
  }

  const whichRes = spawnSync('which', [toolName], { encoding: 'utf-8' });
  if (whichRes.status === 0 && whichRes.stdout) {
    return whichRes.stdout.trim();
  }
  return toolName;
}

export function setupBionicCompat(): void {
  const ndkClang = resolveNdkTool('aarch64-linux-android24-clang');
  let ndkAr = resolveNdkTool('llvm-ar');
  if (ndkAr === 'llvm-ar' && spawnSync('which', ['llvm-ar']).status !== 0) {
    ndkAr = resolveNdkTool('ar');
  }

  const repoRoot = resolve('.');
  const compatSrc = join(repoRoot, 'scripts', 'compat', 'bionic_compat.c');
  const stubSrc = join(repoRoot, 'scripts', 'compat', 'bionic_stub.h');

  if (!existsSync(compatSrc) || !existsSync(stubSrc)) {
    throw new Error('Bionic compat source files not found in scripts/compat/');
  }

  const srcData = Buffer.concat([readFileSync(compatSrc), readFileSync(stubSrc)]);
  const srcHash = createHash('sha256').update(srcData).digest('hex').slice(0, 16);

  const cacheDir = join(repoRoot, '.cache', 'compat');
  mkdirSync(cacheDir, { recursive: true });

  const cachedObj = join(cacheDir, `compat_${srcHash}.o`);
  const cachedLib = join(cacheDir, `libcompat_${srcHash}.a`);

  if (!existsSync(cachedObj) || !existsSync(cachedLib)) {
    console.log(`⚡ Compiling universal Bionic compat library (Hash: ${srcHash})...`);
    const resCc = spawnSync(
      ndkClang,
      [
        `-I${join(repoRoot, 'scripts', 'compat')}`,
        '-fPIC',
        '-O2',
        '-Wno-error',
        '-Wno-ignored-attributes',
        '-c',
        compatSrc,
        '-o',
        cachedObj,
      ],
      { encoding: 'utf-8' },
    );
    if (resCc.status !== 0 || resCc.error) {
      const errDetail = resCc.error ? resCc.error.message : resCc.stderr || `exit code ${resCc.status}`;
      throw new Error(`Failed to compile bionic_compat.c:\n${errDetail}`);
    }

    const resAr = spawnSync(ndkAr, ['rcs', cachedLib, cachedObj], { encoding: 'utf-8' });
    if (resAr.status !== 0 || resAr.error) {
      const errDetail = resAr.error ? resAr.error.message : resAr.stderr || `exit code ${resAr.status}`;
      throw new Error(`Failed to create libcompat.a:\n${errDetail}`);
    }
    console.log('✓ Bionic compat library built and cached.');
  }

  const tempDir = process.env.TMPDIR || tmpdir();
  mkdirSync(tempDir, { recursive: true });
  copyFileSync(cachedObj, join(tempDir, 'bionic_compat.o'));
  copyFileSync(cachedLib, join(tempDir, 'libcompat.a'));
  copyFileSync(cachedLib, join(tempDir, 'libbionic_compat.a'));
  copyFileSync(stubSrc, join(tempDir, 'bionic_stub.h'));
  writeFileSync(join(tempDir, 'spawn.h'), `#pragma once\n#include "${join(tempDir, 'bionic_stub.h')}"\n`, 'utf-8');
  writeFileSync(join(tempDir, 'android_lf.h'), '#pragma once\n#include <sys/types.h>\n', 'utf-8');

  mkdirSync(join(tempDir, 'icu-include'), { recursive: true });
  writeFileSync(join(tempDir, 'icu-include', 'android_lf.h'), '#pragma once\n#include <sys/types.h>\n', 'utf-8');

  let ndkClangxx = resolveNdkTool('aarch64-linux-android24-clang++');
  if (!ndkClangxx || !existsSync(ndkClangxx)) {
    ndkClangxx = ndkClang.replace('clang', 'clang++');
  }
  let ndkStrip = resolveNdkTool('llvm-strip');
  if (ndkStrip === 'llvm-strip' && spawnSync('which', ['llvm-strip']).status !== 0) {
    ndkStrip = resolveNdkTool('strip');
  }

  const hostGlibCompileResources =
    spawnSync('which', ['glib-compile-resources'], { encoding: 'utf-8' }).stdout?.trim() ||
    '/usr/bin/glib-compile-resources';

  const stubH = join(tempDir, 'bionic_stub.h');
  const mesonCross = `[binaries]
c = '${ndkClang}'
cpp = '${ndkClangxx}'
ar = '${ndkAr}'
strip = '${ndkStrip}'
pkg-config = 'pkg-config'
glib-compile-resources = '${hostGlibCompileResources}'

[built-in options]
c_args = ['-I/data/data/com.termux/files/usr/include', '-I${tempDir}', '-include', '${stubH}', '-D__ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__=1', '-fPIC']
cpp_args = ['-I/data/data/com.termux/files/usr/include', '-I${tempDir}', '-include', '${stubH}', '-D__ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__=1', '-fPIC']
c_link_args = ['-L/data/data/com.termux/files/usr/lib', '-L${tempDir}', '-lbionic_compat', '-lm', '-Wl,-rpath=/data/data/com.termux/files/usr/lib', '-Wl,-rpath-link=/data/data/com.termux/files/usr/lib']
cpp_link_args = ['-L/data/data/com.termux/files/usr/lib', '-L${tempDir}', '-lbionic_compat', '-lm', '-Wl,-rpath=/data/data/com.termux/files/usr/lib', '-Wl,-rpath-link=/data/data/com.termux/files/usr/lib']

[properties]
needs_exe_wrapper = true
sys_root = '/data/data/com.termux/files/usr'
pkg_config_libdir = '/data/data/com.termux/files/usr/lib/pkgconfig:/data/data/com.termux/files/usr/share/pkgconfig'

[host_machine]
system = 'android'
cpu_family = 'aarch64'
cpu = 'aarch64'
endian = 'little'
`;
  writeFileSync(join(tempDir, 'meson-cross.ini'), mesonCross, 'utf-8');
}
