import json
import os
import re
import shutil
import subprocess
from pathlib import Path

from builders.alpine import build_alpine
from builders.debian import build_deb
from builders.npm import build_npm
from builders.pacman import build_pacman
from builders.pip import build_pip
from core.fetcher import resolve_and_fetch_build_dependencies
from core.subpkg import process_subpackages
from sanitizer.elf import sanitize_staging_elfs
from sanitizer.shebang import sanitize_shebangs
from utils.elf_linter import audit_directory_elfs
from utils.test import ProotTestRunner
from utils.toolchains import setup_build_environment

DEFAULT_BIONIC_ENV = {
    "CFLAGS": "-O3 -DNDEBUG -pipe -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC -fPIE -include /tmp/bionic_stub.h",
    "CXXFLAGS": "-O3 -DNDEBUG -pipe -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC -fPIE -include /tmp/bionic_stub.h",
    "LDFLAGS": "-pie -fuse-ld=lld -static-libgcc -Wl,-O1 -Wl,--as-needed -Wl,-z,relro -Wl,-z,now -Wl,-z,max-page-size=16384 -Wl,--gc-sections -Wl,--threads=4 -L/tmp -lbionic_compat",
    "CARGO_BUILD_TARGET": "aarch64-linux-android",
    "GOOS": "android",
    "GOARCH": "arm64",
    "CGO_ENABLED": "1",
    "TMPDIR": "/tmp",
    "GOTMPDIR": "/tmp",
    "RUSTUP_HOME": "/home/builder/.rustup",
    "CARGO_HOME": "/home/builder/.cargo",
    "RUSTUP_TOOLCHAIN": "stable",
    "RUSTC_BOOTSTRAP": "1",
    "GIT_CONFIG_COUNT": "1",
    "GIT_CONFIG_KEY_0": "safe.directory",
    "GIT_CONFIG_VALUE_0": "*",
}


def resolve_ndk_tool(tool_name: str) -> str:
    """Dynamically locates an NDK tool binary in the environment or NDK filesystem."""
    if tool_name in os.environ and (
        Path(os.environ[tool_name]).exists() or shutil.which(os.environ[tool_name])
    ):
        return os.environ[tool_name]

    ndk_path = Path(os.environ.get("NDK", "/opt/android-ndk"))
    if ndk_path.exists():
        matches = list(ndk_path.rglob(tool_name))
        if matches:
            return str(matches[0])

    return shutil.which(tool_name) or tool_name


def setup_bionic_compat() -> None:
    ndk_clang = resolve_ndk_tool("aarch64-linux-android24-clang")
    ndk_ar = resolve_ndk_tool("llvm-ar")
    if ndk_ar == "llvm-ar" and not shutil.which("llvm-ar"):
        ndk_ar = resolve_ndk_tool("ar")

    compat_c = Path("/tmp/bionic_compat.c")
    compat_c.write_text(
        "#include <stddef.h>\n#include <time.h>\n#include <pthread.h>\n"
        '__attribute__((weak, visibility("default"))) int backtrace(void **b, int s) { (void)b; (void)s; return 0; }\n'
        '__attribute__((weak, visibility("default"))) char **backtrace_symbols(void *const *b, int s) { (void)b; (void)s; return NULL; }\n'
        '__attribute__((weak, visibility("default"))) void backtrace_symbols_fd(void *const *b, int s, int f) { (void)b; (void)s; (void)f; }\n'
        '__attribute__((weak, visibility("default"))) int pthread_getname_np(pthread_t t, char *n, size_t s) { (void)t; (void)n; (void)s; return 0; }\n'
        '__attribute__((weak, visibility("default"))) int pthread_cond_clockwait(pthread_cond_t *c, pthread_mutex_t *m, clockid_t clock_id, const struct timespec *ts) { (void)clock_id; return pthread_cond_timedwait(c, m, ts); }\n'
        '__attribute__((weak, visibility("default"))) long __timezone = 0;\n'
        '__attribute__((weak, visibility("default"))) long timezone = 0;\n'
        '__attribute__((weak, visibility("default"))) int daylight = 0;\n'
        '__attribute__((weak, visibility("default"))) int __daylight = 0;\n'
        '__attribute__((weak, visibility("default"))) char *tzname[2] = {"UTC", "UTC"};\n'
        '__attribute__((weak, visibility("default"))) char **__tzname = tzname;\n',
        encoding="utf-8",
    )
    obj = Path("/tmp/bionic_compat.o")
    lib = Path("/tmp/libbionic_compat.a")
    subprocess.run(
        [ndk_clang, "-fPIC", "-c", str(compat_c), "-o", str(obj)],
        check=False,
        capture_output=True,
    )
    subprocess.run(
        [ndk_ar, "rcs", str(lib), str(obj)],
        check=False,
        capture_output=True,
    )

    stub_h = Path("/tmp/bionic_stub.h")
    stub_h.write_text(
        "#ifndef _BIONIC_STUB_H\n#define _BIONIC_STUB_H\n#include <sys/cdefs.h>\n#include <android/api-level.h>\n#include <sys/types.h>\n#include <stddef.h>\n#include <stdlib.h>\n#include <pthread.h>\n#include <time.h>\n"
        '#ifdef __cplusplus\nextern "C" {\n#endif\n'
        "int pthread_getname_np(pthread_t __pthread, char* __buf, size_t __buf_size);\n"
        "int pthread_cond_clockwait(pthread_cond_t* __cond, pthread_mutex_t* __mutex, clockid_t __clock_id, const struct timespec* __abstime);\n"
        "extern long __timezone;\n"
        "extern long timezone;\n"
        "extern int daylight;\n"
        "extern int __daylight;\n"
        "extern char *tzname[2];\n"
        "extern char **__tzname;\n"
        "#ifndef WRDE_NOCMD\n#define WRDE_NOCMD 0\n"
        "typedef struct { size_t we_wordc; char **we_wordv; size_t we_offs; } wordexp_t;\n"
        "static inline int wordexp(const char *w, wordexp_t *p, int f) { (void)w; (void)p; (void)f; return -1; }\n"
        "static inline void wordfree(wordexp_t *p) { (void)p; }\n#endif\n"
        "#if !defined(__ANDROID_API__) || __ANDROID_API__ < 28\n"
        "#ifndef aligned_alloc\n"
        "static inline void* aligned_alloc(size_t a, size_t s) { void *p; return posix_memalign(&p, a, s) ? NULL : p; }\n"
        "#endif\n#endif\n"
        "#ifdef __cplusplus\n}\n#endif\n#endif\n",
        encoding="utf-8",
    )


def auto_patch_bionic_sources(src_dir: Path) -> None:
    """Automated Bionic polyfill and source patcher for Android builds."""
    if not src_dir or not src_dir.exists():
        return

    for p in src_dir.rglob("*"):
        if p.is_file() and p.suffix in (".h", ".cpp", ".c", ".cc", ".mm", ".hpp"):
            try:
                code_txt = p.read_text(encoding="utf-8", errors="ignore")
                new_code = code_txt
                if (
                    "#include <execinfo.h>" in new_code
                    or "#include <wordexp.h>" in new_code
                ):
                    new_code = re.sub(
                        r"#include\s*<execinfo\.h>",
                        "/* #include <execinfo.h> */",
                        new_code,
                    )
                    new_code = re.sub(
                        r"#include\s*<wordexp\.h>",
                        "/* #include <wordexp.h> */",
                        new_code,
                    )
                if "uc_mcontext.regs" in new_code:
                    new_code = new_code.replace(
                        "uc_mcontext.regs", "uc_mcontext.arm_regs"
                    )
                if new_code != code_txt:
                    p.write_text(new_code, encoding="utf-8")
            except Exception:
                pass

        if p.is_file() and (p.name == "OptionsJSCOnly.cmake" or p.suffix == ".cmake"):
            try:
                c_txt = p.read_text(encoding="utf-8", errors="ignore")
                if "find_package(ICU" in c_txt:
                    icu_stub = (
                        "add_library(ICU::uc UNKNOWN IMPORTED)\n"
                        "set_target_properties(ICU::uc PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicuuc.so INTERFACE_INCLUDE_DIRECTORIES /usr/include)\n"
                        "add_library(ICU::i18n UNKNOWN IMPORTED)\n"
                        "set_target_properties(ICU::i18n PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicui18n.so INTERFACE_INCLUDE_DIRECTORIES /usr/include)\n"
                        "add_library(ICU::data UNKNOWN IMPORTED)\n"
                        "set_target_properties(ICU::data PROPERTIES IMPORTED_LOCATION /usr/lib/aarch64-linux-gnu/libicudata.so INTERFACE_INCLUDE_DIRECTORIES /usr/include)\n"
                        "set(ICU_FOUND TRUE)\n"
                        "set(ICU_INCLUDE_DIRS /usr/include)\n"
                        "set(ICU_LIBRARIES /usr/lib/aarch64-linux-gnu/libicuuc.so /usr/lib/aarch64-linux-gnu/libicui18n.so /usr/lib/aarch64-linux-gnu/libicudata.so)"
                    )
                    new_c = re.sub(
                        r"find_package\(ICU[^\)]*\)",
                        lambda _, stub=icu_stub: stub,
                        c_txt,
                    )
                    if new_c != c_txt:
                        p.write_text(new_c, encoding="utf-8")
            except Exception:
                pass


def verify_format_archives(output_dir: Path, pkg_name: str) -> None:
    elf_errors = audit_directory_elfs(output_dir)
    if elf_errors:
        print(f"⚠️ [{pkg_name}] ELF Linter Audit Warnings:")
        for err in elf_errors:
            print(f"  - {err}")
    for f in output_dir.glob(f"{pkg_name}*"):
        if f.name.endswith(".deb"):
            subprocess.run(["dpkg-deb", "-I", str(f)], check=True, capture_output=True)
        elif (
            f.name.endswith(".pkg.tar.zst")
            or f.name.endswith(".pkg.tar.gz")
            or f.name.endswith(".apk")
        ):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".whl"):
            subprocess.run(["unzip", "-t", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".tgz"):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)


def execute_compile(recipe, pkg_dir: Path, destdir: Path) -> Path:
    Path("/data/data/com.termux/files/usr/tmp").mkdir(parents=True, exist_ok=True)
    Path("/tmp").mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", "*"], check=False
    )

    if shutil.which("rustup"):
        subprocess.run(
            ["rustup", "default", "stable"], check=False, capture_output=True
        )
        subprocess.run(
            ["rustup", "component", "add", "rust-src"], check=False, capture_output=True
        )
        subprocess.run(
            ["rustup", "target", "add", "aarch64-linux-android"],
            check=False,
            capture_output=True,
        )
        subprocess.run(
            ["rustup", "target", "add", "aarch64-unknown-linux-gnu"],
            check=False,
            capture_output=True,
        )

    setup_bionic_compat()
    env = os.environ.copy()
    for k, v in DEFAULT_BIONIC_ENV.items():
        if k not in env:
            env[k] = v

    cpus = str(os.cpu_count() or 4)
    env["MAKEFLAGS"] = f"-j{cpus}"
    env["NINJA_JOBS"] = cpus
    env["CARGO_BUILD_JOBS"] = cpus
    env["GOMAXPROCS"] = cpus

    if shutil.which("sccache"):
        env["RUSTC_WRAPPER"] = "sccache"
        env["CMAKE_C_COMPILER_LAUNCHER"] = "sccache"
        env["CMAKE_CXX_COMPILER_LAUNCHER"] = "sccache"
        env["SCCACHE_DIR"] = "/home/builder/.cache/sccache"

    ndk_clang = resolve_ndk_tool("aarch64-linux-android24-clang")
    if ndk_clang and (Path(ndk_clang).exists() or shutil.which(ndk_clang)):
        env["NDK_CLANG"] = ndk_clang
        if "CC" not in env:
            env["CC"] = ndk_clang
        if "CXX" not in env:
            env["CXX"] = ndk_clang.replace("clang", "clang++")
        env["CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER"] = ndk_clang
        rustflags = (
            f"-C linker={ndk_clang} -C link-arg=-fuse-ld=lld -C link-arg=-static-libgcc"
            " -C link-arg=-Wl,-z,max-page-size=16384 -C link-arg=-Wl,--threads=4"
        )
        env["RUSTFLAGS"] = rustflags
        env["CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS"] = rustflags
        env["MATURIN_TARGET"] = "aarch64-linux-android"
        env["MATURIN_PEP517_ARGS"] = "--target aarch64-linux-android"

    if getattr(recipe, "cflags", None):
        env["CFLAGS"] = f"{env.get('CFLAGS', '')} {recipe.cflags}".strip()
    if getattr(recipe, "cxxflags", None):
        env["CXXFLAGS"] = f"{env.get('CXXFLAGS', '')} {recipe.cxxflags}".strip()
    if getattr(recipe, "ldflags", None):
        env["LDFLAGS"] = f"{env.get('LDFLAGS', '')} {recipe.ldflags}".strip()
    if getattr(recipe, "vars", None):
        env.update(recipe.vars)

    build_sys = getattr(recipe, "build_system", None)
    if build_sys:
        try:
            env.update(setup_build_environment(build_sys, recipe.arch))
        except Exception:
            pass

    print(f"[COMPILING] Package: {recipe.name} (Channel: {recipe.active_channel})")
    destdir.parent.mkdir(parents=True, exist_ok=True)
    if destdir.exists():
        shutil.rmtree(destdir)
    destdir.mkdir(parents=True, exist_ok=True)

    stage_dir = destdir / "stage"
    stage_dir.mkdir(parents=True, exist_ok=True)

    resolve_and_fetch_build_dependencies(getattr(recipe, "build_deps", []), destdir)

    work_dir = pkg_dir
    src_url = getattr(recipe, "source_url", None)
    if src_url:
        src_url_str = str(src_url).strip()
        archive_path = destdir / "source.tar.gz"
        src_extract_dir = destdir / "src"
        src_extract_dir.mkdir(parents=True, exist_ok=True)

        is_archive = any(
            ext in src_url_str
            for ext in [
                ".tar.gz",
                ".tgz",
                ".tar.xz",
                ".tar.bz2",
                ".zip",
                ".crate",
                ".whl",
            ]
        )
        if not is_archive and (
            src_url_str.endswith(".git") or "git" in src_url_str or "#" in src_url_str
        ):
            if "#" in src_url_str:
                parts = src_url_str.split("#")
                repo_url, ref = parts[0], parts[1]
                if len(ref) == 40 and all(c in "0123456789abcdefABCDEF" for c in ref):
                    subprocess.run(["git", "init", str(src_extract_dir)], check=True)
                    subprocess.run(
                        [
                            "git",
                            "-C",
                            str(src_extract_dir),
                            "remote",
                            "add",
                            "origin",
                            repo_url,
                        ],
                        check=True,
                    )
                    subprocess.run(
                        [
                            "git",
                            "-C",
                            str(src_extract_dir),
                            "fetch",
                            "--depth",
                            "1",
                            "origin",
                            ref,
                        ],
                        check=True,
                    )
                    subprocess.run(
                        ["git", "-C", str(src_extract_dir), "checkout", "FETCH_HEAD"],
                        check=True,
                    )
                else:
                    subprocess.run(
                        [
                            "git",
                            "clone",
                            "--depth",
                            "1",
                            "--branch",
                            ref,
                            repo_url,
                            str(src_extract_dir),
                        ],
                        check=True,
                    )
            else:
                subprocess.run(
                    ["git", "clone", "--depth", "1", src_url_str, str(src_extract_dir)],
                    check=True,
                )
            work_dir = src_extract_dir
        else:
            subprocess.run(
                [
                    "curl",
                    "-fsSL",
                    "-A",
                    "Mozilla/5.0",
                    "--retry",
                    "5",
                    src_url_str,
                    "-o",
                    str(archive_path),
                ],
                check=True,
            )
            subprocess.run(
                ["tar", "-xf", str(archive_path), "-C", str(src_extract_dir)],
                check=False,
            )
            extracted_items = [
                i for i in src_extract_dir.iterdir() if i.name != "source.tar.gz"
            ]
            work_dir = (
                extracted_items[0]
                if (len(extracted_items) == 1 and extracted_items[0].is_dir())
                else src_extract_dir
            )

    for p_folder in [
        pkg_dir / "patches",
        pkg_dir / f"patches@{recipe.active_channel}",
    ]:
        if p_folder.exists() and p_folder.is_dir():
            for patch_file in sorted(p_folder.glob("*.patch")):
                print(f"⚡ Applying patch: {patch_file.name}...")
                subprocess.run(
                    ["patch", "-p1", "-i", str(patch_file)],
                    cwd=work_dir,
                    check=True,
                )

    env["DESTDIR"] = str(stage_dir.resolve())
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", {})
    auto_patch_bionic_sources(work_dir)
    if Path("/tmp/webkit-src").exists():
        auto_patch_bionic_sources(Path("/tmp/webkit-src"))

    for phase_name in ("prepare", "configure", "make", "install"):
        cmd = phases.get(phase_name)
        if cmd:
            auto_patch_bionic_sources(work_dir)
            res = subprocess.run(cmd, shell=True, cwd=work_dir, env=env, check=False)
            if res.returncode != 0:
                raise RuntimeError(
                    f"{phase_name.capitalize()} phase failed for {recipe.name}"
                )

    files_dir = pkg_dir / "files"
    if files_dir.exists() and files_dir.is_dir():
        prefix_dest = stage_dir / "data" / "data" / "com.termux" / "files" / "usr"
        prefix_dest.mkdir(parents=True, exist_ok=True)
        shutil.copytree(files_dir, prefix_dest, dirs_exist_ok=True)

    sanitize_staging_elfs(stage_dir, prefix="/data/data/com.termux/files/usr")
    sanitize_shebangs(stage_dir)
    return stage_dir


def execute_pack(recipe, pkg_dir: Path, destdir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    stage_dir = destdir / "stage"

    subpkgs = process_subpackages(pkg_dir, stage_dir, recipe)

    targets = [(recipe, destdir)]
    for sub_rec, sub_st in subpkgs:
        sub_dest = destdir.parent / f"dest_{sub_rec.name}"
        sub_dest.mkdir(parents=True, exist_ok=True)
        (sub_dest / "stage").mkdir(parents=True, exist_ok=True)
        shutil.copytree(sub_st, sub_dest / "stage", dirs_exist_ok=True)
        targets.append((sub_rec, sub_dest))

    for rec, d_dir in targets:
        st_dir = d_dir / "stage"
        sanitize_staging_elfs(st_dir)
        sanitize_shebangs(st_dir)

        fmts = getattr(rec, "formats", ["apt", "pacman", "apk"])
        if "apt" in fmts:
            build_deb(
                rec,
                str(d_dir),
                str(output_dir),
                target_arch=rec.arch,
                pkg_src_dir=pkg_dir,
            )
        if "pacman" in fmts:
            build_pacman(rec, str(d_dir), str(output_dir), target_arch=rec.arch)
        if "apk" in fmts:
            build_alpine(rec, str(d_dir), str(output_dir), target_arch=rec.arch)
        if "pip" in fmts:
            build_pip(rec, str(d_dir), str(output_dir))
        if "npm" in fmts:
            build_npm(rec, str(d_dir), str(output_dir))

        verify_format_archives(output_dir, rec.name)

        meta = {
            "name": rec.name,
            "version": rec.version,
            "revision": rec.revision,
            "arch": rec.arch,
            "state_hash": getattr(rec, "state_hash", ""),
            "channel": getattr(rec, "active_channel", "latest"),
        }
        (output_dir / f"{rec.name}_metadata.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )


def execute_test(recipe, destdir: Path | None = None) -> None:
    phases = getattr(recipe, "phases", {})
    test_cmd = phases.get("test")
    runner = ProotTestRunner()
    cmd_to_run = test_cmd or f"{recipe.name} --version || {recipe.name} --help"
    runner.execute_test(recipe.name, cmd_to_run, destdir=destdir)
