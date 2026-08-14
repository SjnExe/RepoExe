import json
import os
import shutil
import subprocess
from pathlib import Path

from builders.alpine import build_alpine
from builders.debian import build_deb
from builders.npm import build_npm
from builders.pacman import build_pacman
from builders.pip import build_pip
from core.subpkg import process_subpackages
from sanitizer.elf import sanitize_staging_elfs
from sanitizer.shebang import sanitize_shebangs
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
    "RUSTUP_TOOLCHAIN": "stable",
    "RUSTC_BOOTSTRAP": "1",
    "GIT_CONFIG_COUNT": "1",
    "GIT_CONFIG_KEY_0": "safe.directory",
    "GIT_CONFIG_VALUE_0": "*",
}


def setup_bionic_compat() -> None:
    ndk_clang = os.environ.get("NDK_CLANG", "aarch64-linux-android24-clang")
    compat_c = Path("/tmp/bionic_compat.c")
    compat_c.write_text(
        "#include <stddef.h>\n#include <time.h>\n#include <pthread.h>\n"
        "int backtrace(void **b, int s) { (void)b; (void)s; return 0; }\n"
        "char **backtrace_symbols(void *const *b, int s) { (void)b; (void)s; return NULL; }\n"
        "void backtrace_symbols_fd(void *const *b, int s, int f) { (void)b; (void)s; (void)f; }\n"
        "int pthread_getname_np(pthread_t t, char *n, size_t s) { (void)t; (void)n; (void)s; return 0; }\n"
        "int pthread_cond_clockwait(pthread_cond_t *c, pthread_mutex_t *m, clockid_t clock_id, const struct timespec *ts) { (void)clock_id; return pthread_cond_timedwait(c, m, ts); }\n",
        encoding="utf-8",
    )
    obj = Path("/tmp/bionic_compat.o")
    lib = Path("/tmp/libbionic_compat.a")
    subprocess.run([ndk_clang, "-c", str(compat_c), "-o", str(obj)], check=False, capture_output=True)
    subprocess.run(["ar", "rcs", str(lib), str(obj)], check=False, capture_output=True)

    stub_h = Path("/tmp/bionic_stub.h")
    stub_h.write_text(
        "#ifndef _BIONIC_STUB_H\n#define _BIONIC_STUB_H\n#include <sys/cdefs.h>\n#include <sys/types.h>\n#include <stddef.h>\n#include <stdlib.h>\n#include <pthread.h>\n"
        "#ifdef __cplusplus\nextern \"C\" {\n#endif\n"
        "int pthread_getname_np(pthread_t __pthread, char* __buf, size_t __buf_size);\n"
        "int pthread_cond_clockwait(pthread_cond_t* __cond, pthread_mutex_t* __mutex, clockid_t __clock_id, const struct timespec* __abstime);\n"
        "#ifndef WRDE_NOCMD\n#define WRDE_NOCMD 0\n"
        "typedef struct { size_t we_wordc; char **we_wordv; size_t we_offs; } wordexp_t;\n"
        "static inline int wordexp(const char *w, wordexp_t *p, int f) { (void)w; (void)p; (void)f; return -1; }\n"
        "static inline void wordfree(wordexp_t *p) { (void)p; }\n#endif\n"
        "#ifdef __cplusplus\n}\n#endif\n#endif\n",
        encoding="utf-8",
    )


def execute_compile(recipe, pkg_dir: Path, destdir: Path) -> Path:
    setup_bionic_compat()
    env = os.environ.copy()
    for k, v in DEFAULT_BIONIC_ENV.items():
        if k not in env:
            env[k] = v

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

    work_dir = pkg_dir
    src_url = getattr(recipe, "source_url", None)
    if src_url:
        src_url_str = str(src_url).strip()
        archive_path = destdir / "source.tar.gz"
        src_extract_dir = destdir / "src"
        src_extract_dir.mkdir(parents=True, exist_ok=True)

        is_archive = any(ext in src_url_str for ext in [".tar.gz", ".tgz", ".tar.xz", ".tar.bz2", ".zip", ".crate", ".whl"])
        if not is_archive and (src_url_str.endswith(".git") or "git" in src_url_str or "#" in src_url_str):
            if "#" in src_url_str:
                parts = src_url_str.split("#")
                repo_url, ref = parts[0], parts[1]
                subprocess.run(["git", "clone", "--depth", "1", "--branch", ref, repo_url, str(src_extract_dir)], check=True)
            else:
                subprocess.run(["git", "clone", "--depth", "1", src_url_str, str(src_extract_dir)], check=True)
            work_dir = src_extract_dir
        else:
            subprocess.run(["curl", "-fsSL", "-A", "Mozilla/5.0", "--retry", "5", src_url_str, "-o", str(archive_path)], check=True)
            subprocess.run(["tar", "-xf", str(archive_path), "-C", str(src_extract_dir)], check=False)
            extracted_items = [i for i in src_extract_dir.iterdir() if i.name != "source.tar.gz"]
            work_dir = extracted_items[0] if (len(extracted_items) == 1 and extracted_items[0].is_dir()) else src_extract_dir

    for p_folder in [pkg_dir / "patches", pkg_dir / f"patches@{recipe.active_channel}"]:
        if p_folder.exists() and p_folder.is_dir():
            for patch_file in sorted(p_folder.glob("*.patch")):
                print(f"⚡ Applying patch: {patch_file.name}...")
                subprocess.run(["patch", "-p1", "-i", str(patch_file)], cwd=work_dir, check=True)

    env["DESTDIR"] = str(stage_dir.resolve())
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", {})
    for phase_name in ("prepare", "configure", "make", "install"):
        cmd = phases.get(phase_name)
        if cmd:
            res = subprocess.run(cmd, shell=True, cwd=work_dir, env=env, check=False)
            if res.returncode != 0:
                raise RuntimeError(f"{phase_name.capitalize()} phase failed for {recipe.name}")

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
            build_deb(rec, str(d_dir), str(output_dir), target_arch=rec.arch, pkg_src_dir=pkg_dir)
        if "pacman" in fmts:
            build_pacman(rec, str(d_dir), str(output_dir), target_arch=rec.arch)
        if "apk" in fmts:
            build_alpine(rec, str(d_dir), str(output_dir), target_arch=rec.arch)
        if "pip" in fmts:
            build_pip(rec, str(d_dir), str(output_dir))
        if "npm" in fmts:
            build_npm(rec, str(d_dir), str(output_dir))

        meta = {
            "name": rec.name,
            "version": rec.version,
            "revision": rec.revision,
            "arch": rec.arch,
            "state_hash": getattr(rec, "state_hash", ""),
            "channel": getattr(rec, "active_channel", "latest"),
        }
        (output_dir / f"{rec.name}_metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def execute_test(recipe, destdir: Path | None = None) -> None:
    phases = getattr(recipe, "phases", {})
    test_cmd = phases.get("test")
    runner = ProotTestRunner()
    cmd_to_run = test_cmd or f"{recipe.name} --version || {recipe.name} --help"
    runner.execute_test(recipe.name, cmd_to_run, destdir=destdir)
