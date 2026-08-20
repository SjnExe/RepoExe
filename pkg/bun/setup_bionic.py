import glob
import os
import re
import shutil
import sys
from pathlib import Path


def patch_cmake():
    opt_file = Path("/tmp/webkit-src/Source/cmake/OptionsJSCOnly.cmake")
    if opt_file.exists():
        stub = (
            "add_library(ICU::uc UNKNOWN IMPORTED)\n"
            "set_target_properties(ICU::uc PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicuuc.so INTERFACE_INCLUDE_DIRECTORIES /tmp/icu-include)\n"
            "add_library(ICU::i18n UNKNOWN IMPORTED)\n"
            "set_target_properties(ICU::i18n PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicui18n.so INTERFACE_INCLUDE_DIRECTORIES /tmp/icu-include)\n"
            "add_library(ICU::data UNKNOWN IMPORTED)\n"
            "set_target_properties(ICU::data PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicudata.so INTERFACE_INCLUDE_DIRECTORIES /tmp/icu-include)\n"
            "set(ICU_FOUND TRUE)\n"
            "set(ICU_INCLUDE_DIRS /tmp/icu-include)\n"
            "set(ICU_LIBRARIES /usr/lib/aarch64-linux-gnu/libicuuc.so /usr/lib/aarch64-linux-gnu/libicui18n.so /usr/lib/aarch64-linux-gnu/libicudata.so)\n"
            'set(ENABLE_BUN ON CACHE BOOL "" FORCE)\n'
            'set(ENABLE_BUN_JSC ON CACHE BOOL "" FORCE)\n'
            'set(USE_BUN_JSC_ADDITIONS ON CACHE BOOL "" FORCE)\n'
            'set(ENABLE_API_TESTS OFF CACHE BOOL "" FORCE)\n'
            'set(BUILD_TESTING OFF CACHE BOOL "" FORCE)'
        )
        content = opt_file.read_text(encoding="utf-8")
        new_content = re.sub(r"find_package\(ICU[^\)]*\)", stub, content)
        new_content += (
            '\nset(ENABLE_BUN ON CACHE BOOL "" FORCE)\n'
            'set(ENABLE_BUN_JSC ON CACHE BOOL "" FORCE)\n'
            'set(USE_BUN_JSC_ADDITIONS ON CACHE BOOL "" FORCE)\n'
            'set(ENABLE_API_TESTS OFF CACHE BOOL "" FORCE)\n'
            'set(BUILD_TESTING OFF CACHE BOOL "" FORCE)\n'
        )
        opt_file.write_text(new_content, encoding="utf-8")


def archive_jsc():
    jsc = Path(os.environ.get("JSC_CACHE_DIR", "/home/builder/RepoExe/.cache/bun-jsc"))
    wk = Path("/tmp/webkit-src")
    inc = jsc / "include"
    lib = jsc / "lib"
    inc.mkdir(parents=True, exist_ok=True)
    lib.mkdir(parents=True, exist_ok=True)

    for f in (wk / "build" / "lib").glob("lib*"):
        shutil.copy2(f, lib / f.name)

    for comp in ("JavaScriptCore", "WTF", "bmalloc"):
        for hdir in (
            wk / "build" / comp / "Headers",
            wk / "build" / comp / "PrivateHeaders",
            wk / "build" / comp / "DerivedSources",
        ):
            if hdir.exists():
                src_dir = hdir / comp if (hdir / comp).exists() else hdir
                shutil.copytree(src_dir, inc / comp, dirs_exist_ok=True)

    for comp in ("JavaScriptCore", "WTF", "bmalloc"):
        s = wk / "Source" / comp
        if s.exists():
            for h in s.rglob("*.h"):
                dest = inc / comp / h.relative_to(s)
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(h, dest)


def seed_bun():
    jsc = Path(os.environ.get("JSC_CACHE_DIR", "/home/builder/RepoExe/.cache/bun-jsc"))
    short_sha = os.environ.get("SHORT_SHA", "")
    full_sha = os.environ.get("WEBKIT_SHA", "")

    for base in (
        "build/release/cache",
        "build/cache",
        "build/release/deps",
        "build/deps",
    ):
        for name in (
            f"webkit-{short_sha}-arm64",
            f"webkit-{full_sha}-arm64",
            f"webkit-{short_sha}-linux-arm64",
            f"webkit-{short_sha}-android-arm64",
            f"webkit-{short_sha}",
            f"webkit-{full_sha}",
        ):
            d = Path(base) / name
            d.mkdir(parents=True, exist_ok=True)
            if (jsc / "lib").exists():
                shutil.copytree(jsc / "lib", d / "lib", dirs_exist_ok=True)
            if (jsc / "include").exists():
                shutil.copytree(jsc / "include", d / "include", dirs_exist_ok=True)


def setup_shims():
    ndk = os.environ.get("NDK", "/opt/android-ndk")
    sysroots = [
        p
        for p in glob.glob(f"{ndk}/**/sysroot", recursive=True)
        if os.path.isdir(os.path.join(p, "usr", "include"))
    ]
    sysroot = (
        sysroots[0]
        if sysroots
        else f"{ndk}/toolchains/llvm/prebuilt/linux-arm64/sysroot"
    )
    print(f"🔒 Resolved NDK sysroot: {sysroot}")

    for d in ("/tmp", "/tmp/fake-clang"):
        os.makedirs(d, exist_ok=True)
        Path(f"{d}/android_lf.h").write_text(
            "#pragma once\n#include <sys/types.h>\n", encoding="utf-8"
        )
        Path(f"{d}/spawn.h").write_text(
            '#pragma once\n#include "/tmp/bionic_stub.h"\n', encoding="utf-8"
        )

    cfg_h = (
        "#pragma once\n"
        "#define HAVE_STDINT_H 1\n"
        "#define HAVE_INTTYPES_H 1\n"
        "#define HAVE_SYS_PARAM_H 1\n"
        "#define HAVE_SYS_TIME_H 1\n"
        "#define HAVE_SYS_MMAN_H 1\n"
        "#define WTF_OS_LINUX 1\n"
        "#define WTF_OS_ANDROID 1\n"
        "#define JSC_OBJC_API_ENABLED 0\n"
        "#define STATICALLY_LINKED_WITH_JavaScriptCore 1\n"
        "#define STATICALLY_LINKED_WITH_BMALLOC 1\n"
    )

    scan_dirs = (
        list(Path(".").rglob("include"))
        + list(Path(".").rglob("JavaScriptCore"))
        + [
            Path("/tmp"),
            Path("/tmp/fake-clang"),
            Path("src/jsc/bindings"),
            Path("src/jsc/bindings/webcore"),
        ]
    )
    for d in scan_dirs:
        if d.is_dir():
            (d / "cmakeconfig.h").write_text(cfg_h, encoding="utf-8")

    shim_code = """#!/bin/bash
cmd="$(basename "$0")"
if [[ "$*" == *"codegen-tool"* ]] || [[ "$*" == *"-DC2STR"* ]] || [[ "$*" == *"conftest.c"* ]]; then
  exec "/usr/bin/$cmd" "$@"
fi
NDK_BIN="${NDK:-/opt/android-ndk}/toolchains/llvm/prebuilt/linux-arm64/bin"
[ -d "$NDK_BIN" ] || NDK_BIN=$(find "${NDK:-/opt/android-ndk}" -type f -name "clang" -exec dirname {} \\; 2>/dev/null | head -n 1)
if [[ "$1" =~ ^(-v|--version|-version)$ ]]; then
  [[ "$cmd" =~ lld$ ]] && echo "LLD 21.1.0" || echo "Ubuntu clang version 21.1.0-repoexe"
  exit 0
fi
ARGS=()
IS_COMPILE=0
IS_ASM=0
for a in "$@"; do
  case "$a" in
    -Werror|-Werror=*) ;;
    -c|-E|-S) IS_COMPILE=1; ARGS+=("$a") ;;
    *.s|*.S) IS_ASM=1; ARGS+=("$a") ;;
    -fno-pic|-fno-PIC|-fno-pie|-fno-PIE) ARGS+=("-fPIC" "-fPIE") ;;
    -Wl,-no-pie|-Wl,-nopie|-no-pie|-nopie) ARGS+=("-pie") ;;
    *) ARGS+=("$a") ;;
  esac
done
EXTRA=""
if [ "$IS_COMPILE" = "0" ] && [ -f /tmp/bionic_compat.o ]; then
  EXTRA="/tmp/bionic_compat.o -L/tmp -lbionic_compat"
fi
INC_FLAG=""
if [ "$IS_ASM" = "0" ]; then
  INC_FLAG="-I/tmp -include /tmp/bionic_stub.h"
fi
if [[ "$cmd" =~ ^clang ]]; then
  exec "$NDK_BIN/$cmd" "${ARGS[@]}" --target=aarch64-linux-android24 $INC_FLAG -Wno-error -Wno-undefined-var-template -Wno-dangling -Wno-unknown-warning-option -Wno-unsafe-buffer-usage -Wno-unsafe-buffer-usage-in-container $EXTRA
elif [[ "$cmd" =~ lld$ ]]; then
  exec "$NDK_BIN/$cmd" "${ARGS[@]}" $EXTRA
else
  exec "$NDK_BIN/$cmd" "${ARGS[@]}"
fi
"""
    shim_p = Path("/tmp/fake-clang/version_shim")
    shim_p.write_text(shim_code, encoding="utf-8")
    shim_p.chmod(0o755)

    for f in Path(".").rglob("*"):
        if (
            f.is_file()
            and f.suffix
            in (".ts", ".js", ".zig", ".cmake", ".json", ".h", ".c", ".cpp")
            and "node_modules" not in str(f)
        ):
            try:
                t = f.read_text("utf-8", "ignore")
                n = t
                if '#include "android_lf.h"' in n:
                    n = n.replace(
                        '#include "android_lf.h"', '/* #include "android_lf.h" */'
                    )
                if "alloc-override.c" in f.name or "mimalloc" in str(f):
                    n = re.sub(
                        r"void\*\s*reallocarray\s*\([^)]*\)\s*\{[^}]*\}",
                        "/* void* reallocarray disabled */",
                        n,
                    )
                n = re.sub(
                    r"aarch64-linux-gnu(?:\.[0-9\.]+)?", "aarch64-linux-android", n
                )
                n = re.sub(
                    r"linux-aarch64-gnu(?:\.[0-9\.]+)?", "linux-aarch64-android", n
                )
                n = re.sub(r'"linux-aarch64-gnu"', '"linux-aarch64-android"', n)
                n = re.sub(r"'linux-aarch64-gnu'", "'linux-aarch64-android'", n)
                n = re.sub(
                    r'[`"]https://github\.com/oven-sh/WebKit/releases/download/[^`"]*[`"]',
                    '"file:///tmp/bun-webkit-bionic.tar.gz"',
                    n,
                )
                if "-Dtarget=aarch64-linux-gnu" in n:
                    n = n.replace(
                        "-Dtarget=aarch64-linux-gnu",
                        f"-Dtarget=aarch64-linux-android -Dandroid_ndk_sysroot={sysroot}",
                    )
                if (
                    "-Dtarget=aarch64-linux-android" in n
                    and "-Dandroid_ndk_sysroot" not in n
                ):
                    n = n.replace(
                        "-Dtarget=aarch64-linux-android",
                        f"-Dtarget=aarch64-linux-android -Dandroid_ndk_sysroot={sysroot}",
                    )
                if n != t:
                    f.write_text(n, "utf-8")
            except Exception:
                pass

    stub_zig = (
        'extern "c" fn system(command: [*:0]const u8) c_int;\n'
        "pub fn exec(ctx: anytype) !void {\n"
        "    @branchHint(.cold);\n"
        "    _ = ctx;\n"
        '    _ = system("pkg install -y bun || apt-get install --only-upgrade -y bun || pacman -Sy --noconfirm bun || apk add --upgrade bun");\n'
        "    return;\n"
        "}\n"
    )
    for f in glob.glob("src/**/upgrade*.zig", recursive=True):
        try:
            s = Path(f).read_text(encoding="utf-8")
            idx = s.find("pub fn exec(")
            if idx != -1:
                b = s.find("{", idx)
                depth, i = 0, b
                while i < len(s):
                    if s[i] == "{":
                        depth += 1
                    elif s[i] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    i += 1
                Path(f).write_text(s[:idx] + stub_zig + s[i + 1 :], encoding="utf-8")
                print(f"✓ Patched upgrade exec in {f}")
        except Exception:
            pass


if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "patch_cmake":
        patch_cmake()
    elif cmd == "archive_jsc":
        archive_jsc()
    elif cmd == "seed_bun":
        seed_bun()
    elif cmd == "setup_shims":
        setup_shims()
