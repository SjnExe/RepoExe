import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export function safeRenameSync(
  oldPath: string,
  newPath: string,
  renameFn: (oldP: string, newP: string) => void = renameSync,
): void {
  try {
    renameFn(oldPath, newPath);
  } catch (err: unknown) {
    const e = err as { code?: string };
    if (e.code === 'EXDEV') {
      const st = lstatSync(oldPath);
      if (st.isSymbolicLink()) {
        const tmpLink = `${newPath}.exdev.${process.pid}.${Date.now()}`;
        mkdirSync(dirname(tmpLink), { recursive: true });
        symlinkSync(readlinkSync(oldPath), tmpLink);
        renameSync(tmpLink, newPath);
        try {
          rmSync(oldPath, { force: true });
        } catch {}
      } else if (st.isDirectory()) {
        cpSync(oldPath, newPath, { recursive: true });
        try {
          rmSync(oldPath, { recursive: true, force: true });
        } catch {}
      } else {
        const tmpDst = `${newPath}.exdev.${process.pid}.${Date.now()}`;
        mkdirSync(dirname(tmpDst), { recursive: true });
        copyFileSync(oldPath, tmpDst);
        renameSync(tmpDst, newPath);
        try {
          rmSync(oldPath, { force: true });
        } catch {}
      }
    } else {
      throw err;
    }
  }
}

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
          if (existsSync(candidate)) {
            return candidate;
          }
        }
      } catch {}
    }

    // 2. Fallback bounded search if located in alternative subdirectories
    const findInNdk = (dir: string, depth: number = 0): string | null => {
      if (depth > 4) {
        return null;
      }
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const full = join(dir, entry.name);
          if (entry.isDirectory()) {
            const res = findInNdk(full, depth + 1);
            if (res) {
              return res;
            }
          } else if (entry.name === toolName) {
            return full;
          }
        }
      } catch {}
      return null;
    };
    const found = findInNdk(ndkPath);
    if (found) {
      return found;
    }
  }

  const whichRes = spawnSync('which', [toolName], { encoding: 'utf-8' });
  if (whichRes.status === 0 && whichRes.stdout) {
    return whichRes.stdout.trim();
  }
  return toolName;
}

interface NdkArchConfig {
  clang: string;
  clangxx: string;
  cpu_family: string;
  cpu: string;
  extraFlags: string[];
}

const NDK_ARCH_CONFIGS: Record<string, NdkArchConfig> = {
  aarch64: {
    clang: 'aarch64-linux-android24-clang',
    clangxx: 'aarch64-linux-android24-clang++',
    cpu_family: 'aarch64',
    cpu: 'armv8-a',
    extraFlags: [],
  },
  arm64: {
    clang: 'aarch64-linux-android24-clang',
    clangxx: 'aarch64-linux-android24-clang++',
    cpu_family: 'aarch64',
    cpu: 'armv8-a',
    extraFlags: [],
  },
  arm: {
    clang: 'armv7a-linux-androideabi24-clang',
    clangxx: 'armv7a-linux-androideabi24-clang++',
    cpu_family: 'arm',
    cpu: 'armv7-a',
    extraFlags: ['-march=armv7-a', '-mfpu=neon', '-mfloat-abi=softfp'],
  },
  x86_64: {
    clang: 'x86_64-linux-android24-clang',
    clangxx: 'x86_64-linux-android24-clang++',
    cpu_family: 'x86_64',
    cpu: 'x86_64',
    extraFlags: [],
  },
  i686: {
    clang: 'i686-linux-android24-clang',
    clangxx: 'i686-linux-android24-clang++',
    cpu_family: 'x86',
    cpu: 'i686',
    extraFlags: ['-march=i686'],
  },
};

export function setupBionicCompat(targetArch: string = 'aarch64'): void {
  const normArch = (targetArch || 'aarch64').toLowerCase();
  const archConfig = NDK_ARCH_CONFIGS[normArch] || NDK_ARCH_CONFIGS.aarch64;

  const ndkClang = resolveNdkTool(archConfig.clang);
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
  const srcHash = new Bun.CryptoHasher('sha256').update(srcData).digest('hex').slice(0, 16);

  const cacheDir = join(repoRoot, '.cache', 'compat');
  mkdirSync(cacheDir, { recursive: true });

  const cachedObj = join(cacheDir, `compat_${normArch}_${srcHash}_rcsD_relsrc.o`);
  const cachedLib = join(cacheDir, `libcompat_${normArch}_${srcHash}_rcsD_relsrc.a`);

  if (!existsSync(cachedObj) || !existsSync(cachedLib)) {
    console.log(`⚡ Compiling universal Bionic compat library for ${normArch} (Hash: ${srcHash})...`);
    const resCc = spawnSync(
      ndkClang,
      [
        `-I${join(repoRoot, 'scripts', 'compat')}`,
        '-fPIC',
        '-fvisibility=hidden',
        '-O2',
        '-Wno-error',
        '-Wno-ignored-attributes',
        ...archConfig.extraFlags,
        '-c',
        join('scripts', 'compat', 'bionic_compat.c'),
        '-o',
        cachedObj,
      ],
      { encoding: 'utf-8' },
    );
    if (resCc.status !== 0 || resCc.error) {
      const errDetail = resCc.error ? resCc.error.message : resCc.stderr || `exit code ${resCc.status}`;
      throw new Error(`Failed to compile bionic_compat.c for ${normArch}:\n${errDetail}`);
    }

    const resAr = spawnSync(ndkAr, ['rcsD', cachedLib, cachedObj], {
      encoding: 'utf-8',
      env: { ...process.env, ZERO_AR_DATE: '1' },
    });
    if (resAr.status !== 0 || resAr.error) {
      const errDetail = resAr.error ? resAr.error.message : resAr.stderr || `exit code ${resAr.status}`;
      throw new Error(`Failed to create libcompat.a for ${normArch}:\n${errDetail}`);
    }
    console.log(`✓ Bionic compat library built and cached for ${normArch}.`);
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

  let ndkClangxx = resolveNdkTool(archConfig.clangxx);
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

  const formatMesonString = (str: string): string => {
    if (!str.includes("'")) {
      return `'${str}'`;
    }
    return `'''${str}'''`;
  };

  const stubH = join(tempDir, 'bionic_stub.h');
  const extraCArgsStr = archConfig.extraFlags.map((f) => formatMesonString(f)).join(', ');
  const prefixMapArgs = Array.from(
    new Set([
      "'-ffile-prefix-map=/data/data/com.termux/files=.'",
      "'-ffile-prefix-map=/home/builder/RepoExe=.'",
      formatMesonString(`-ffile-prefix-map=${repoRoot}=.`),
    ]),
  );
  const cArgsList = [
    "'-I/data/data/com.termux/files/usr/include'",
    formatMesonString(`-I${tempDir}`),
    "'-include'",
    formatMesonString(stubH),
    "'-D__ANDROID_UNAVAILABLE_SYMBOLS_ARE_WEAK__=1'",
    "'-fPIC'",
    ...prefixMapArgs,
    "'-Wno-error=date-time'",
    ...(extraCArgsStr ? [extraCArgsStr] : []),
  ].join(', ');

  const mesonCross = `[binaries]
c = ${formatMesonString(ndkClang)}
cpp = ${formatMesonString(ndkClangxx)}
ar = ${formatMesonString(ndkAr)}
strip = ${formatMesonString(ndkStrip)}
pkg-config = 'pkg-config'
glib-compile-resources = ${formatMesonString(hostGlibCompileResources)}

[built-in options]
c_args = [${cArgsList}]
cpp_args = [${cArgsList}]
c_link_args = ['-L/data/data/com.termux/files/usr/lib', ${formatMesonString(`-L${tempDir}`)}, '-lbionic_compat', '-lm', '-Wl,-rpath=/data/data/com.termux/files/usr/lib', '-Wl,-rpath-link=/data/data/com.termux/files/usr/lib']
cpp_link_args = ['-L/data/data/com.termux/files/usr/lib', ${formatMesonString(`-L${tempDir}`)}, '-lbionic_compat', '-lm', '-Wl,-rpath=/data/data/com.termux/files/usr/lib', '-Wl,-rpath-link=/data/data/com.termux/files/usr/lib']

[properties]
needs_exe_wrapper = true
sys_root = '/data/data/com.termux/files/usr'
pkg_config_libdir = '/data/data/com.termux/files/usr/lib/pkgconfig:/data/data/com.termux/files/usr/share/pkgconfig'

[host_machine]
system = 'android'
cpu_family = '${archConfig.cpu_family}'
cpu = '${archConfig.cpu}'
endian = 'little'
`;
  writeFileSync(join(tempDir, 'meson-cross.ini'), mesonCross, 'utf-8');
}
