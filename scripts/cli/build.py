import argparse
import contextlib
import json
import os
import re
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

_scripts_dir = str(Path(__file__).resolve().parents[1])
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)

from builders.alpine import build_alpine
from builders.debian import build_deb
from builders.npm import build_npm
from builders.pacman import build_pacman
from builders.pip import build_pip
from utils.elf_linter import audit_directory_elfs
from utils.health import audit_repository_health
from utils.parser import parse_recipe
from utils.test import ProotTestRunner
from utils.toolchains import setup_build_environment

clang_bin = "/usr/lib/llvm-21/bin/clang" if Path("/usr/lib/llvm-21/bin/clang").exists() else "clang"
clangxx_bin = "/usr/lib/llvm-21/bin/clang++" if Path("/usr/lib/llvm-21/bin/clang++").exists() else "clang++"
ld_bin = "/usr/lib/llvm-21/bin/ld.lld" if Path("/usr/lib/llvm-21/bin/ld.lld").exists() else "ld.lld"

DEFAULT_BIONIC_ENV = {
    "CC": clang_bin,
    "CXX": clangxx_bin,
    "LD": ld_bin,
    "CFLAGS": "-O3 -DNDEBUG -pipe -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC",
    "CXXFLAGS": "-O3 -DNDEBUG -pipe -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC",
    "LDFLAGS": "-fuse-ld=lld -static-libgcc -Wl,-O1 -Wl,--as-needed -Wl,-z,relro -Wl,-z,now -Wl,--gc-sections",
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


def check_existing_release_hash(pkg_name: str, channel: str, target_hash: str) -> bool:
    tag = f"{pkg_name}@{channel}"
    api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"
    try:
        req = urllib.request.Request(
            api_url, headers={"User-Agent": "RepoExe-Orchestrator"}
        )
        with urllib.request.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))

        for asset in data.get("assets", []):
            if asset.get("name") == "metadata.json":
                meta_raw = (
                    urllib.request.urlopen(asset["browser_download_url"])
                    .read()
                    .decode("utf-8")
                )
                remote_meta = json.loads(meta_raw)
                return remote_meta.get("state_hash") == target_hash
    except Exception:
        return False
    return False


def resolve_and_fetch_build_dependencies(build_deps: list[str], destdir: Path) -> None:
    if not build_deps:
        return

    print(f"Resolving build dependencies: {', '.join(build_deps)}")
    stage_dir = destdir / "stage"
    output_dir = (Path.cwd() / "output").resolve()

    for dep in build_deps:
        fetched_remote = False

        local_arts = (
            list(Path("artifacts").glob(f"{dep}*.deb")) if Path("artifacts").exists() else []
        ) + (
            list(output_dir.glob(f"{dep}*.deb")) if output_dir.exists() else []
        )
        if local_arts:
            print(
                f"✓ Found local artifact for dependency '{dep}': {local_arts[0].name}"
            )
            subprocess.run(
                ["dpkg-deb", "-x", str(local_arts[0]), str(stage_dir)], check=True
            )
            fetched_remote = True
        else:
            tag = f"{dep}@latest"
            api_url = (
                f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"
            )
            try:
                req = urllib.request.Request(
                    api_url, headers={"User-Agent": "RepoExe-Orchestrator"}
                )
                with urllib.request.urlopen(req, timeout=10) as resp:
                    rel_data = json.loads(resp.read().decode("utf-8"))

                deb_asset = next(
                    (
                        a
                        for a in rel_data.get("assets", [])
                        if a.get("name", "").endswith(".deb")
                    ),
                    None,
                )

                if deb_asset:
                    download_url = deb_asset["browser_download_url"]
                    dep_deb = destdir / deb_asset["name"]
                    print(
                        f"Fetching pre-built dependency '{dep}' from {download_url}..."
                    )
                    urllib.request.urlretrieve(download_url, dep_deb)
                    subprocess.run(
                        ["dpkg-deb", "-x", str(dep_deb), str(stage_dir)], check=True
                    )
                    print(
                        f"✓ Extracted pre-built dependency '{dep}' into build staging."
                    )
                    fetched_remote = True
            except Exception as e:
                print(
                    f"Notice: Pre-built artifact for dependency '{dep}' could not be fetched ({e})."
                )

        if not fetched_remote:
            print(f"::error:: Missing required build dependency '{dep}' and no pre-built artifact or release exists.")
            sys.exit(1)


def fix_termux_shebangs(stage_dir: Path) -> None:
    """Normalizes host shebangs in staged binaries to Termux Bionic paths."""
    if not stage_dir or not os.path.exists(stage_dir):
        return
    prefix = "/data/data/com.termux/files/usr"
    replacements = {
        "#!/bin/sh": f"#!{prefix}/bin/sh",
        "#!/bin/bash": f"#!{prefix}/bin/bash",
        "#!/usr/bin/env sh": f"#!{prefix}/bin/sh",
        "#!/usr/bin/env bash": f"#!{prefix}/bin/bash",
        "#!/usr/bin/env python": f"#!{prefix}/bin/python3",
        "#!/usr/bin/env python3": f"#!{prefix}/bin/python3",
        "#!/usr/bin/python": f"#!{prefix}/bin/python3",
        "#!/usr/bin/python3": f"#!{prefix}/bin/python3",
    }
    for root, _, files in os.walk(stage_dir):
        for file in files:
            fpath = os.path.join(root, file)
            try:
                if os.path.islink(fpath) or os.path.getsize(fpath) > 2 * 1024 * 1024:
                    continue
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    first_line = f.readline().strip()
                for old_sb, new_sb in replacements.items():
                    if first_line == old_sb or first_line.startswith(f"{old_sb} "):
                        with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                            file_content = f.read()
                        new_content = file_content.replace(first_line, new_sb, 1)
                        with open(fpath, "w", encoding="utf-8") as f:
                            f.write(new_content)
                        os.chmod(fpath, 0o755)
                        break
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


def setup_bionic_compat_library() -> None:
    """Compiles /tmp/libbionic_compat.a and /tmp/bionic_stub.h for clean, zero-collision Bionic linking."""
    ndk_clang = (
        os.environ.get("NDK_CLANG")
        or "/opt/android-ndk/toolchains/llvm/prebuilt/linux-arm64/bin/aarch64-linux-android24-clang"
    )
    if not Path(ndk_clang).exists():
        ndk_clang = "aarch64-linux-android24-clang"

    compat_c = Path("/tmp/bionic_compat.c")
    compat_c.write_text(
        "#include <stddef.h>\n"
        "__attribute__((weak)) int backtrace(void **b, int s) { (void)b; (void)s; return 0; }\n"
        "__attribute__((weak)) char **backtrace_symbols(void *const *b, int s) { (void)b; (void)s; return NULL; }\n"
        "__attribute__((weak)) void backtrace_symbols_fd(void *const *b, int s, int f) { (void)b; (void)s; (void)f; }\n",
        encoding="utf-8",
    )

    obj_file = Path("/tmp/bionic_compat.o")
    lib_file = Path("/tmp/libbionic_compat.a")
    subprocess.run([ndk_clang, "-c", str(compat_c), "-o", str(obj_file)], check=False, capture_output=True)
    subprocess.run(["ar", "rcs", str(lib_file), str(obj_file)], check=False, capture_output=True)

    stub_h = Path("/tmp/bionic_stub.h")
    stub_h.write_text(
        "#ifndef _BIONIC_STUB_H\n"
        "#define _BIONIC_STUB_H\n\n"
        "#include <sys/types.h>\n"
        "#include <stddef.h>\n"
        "#include <stdlib.h>\n\n"
        "#ifdef __cplusplus\n"
        'extern "C" {\n'
        "#endif\n\n"
        "int backtrace(void **buffer, int size);\n"
        "char **backtrace_symbols(void *const *buffer, int size);\n"
        "void backtrace_symbols_fd(void *const *buffer, int size, int fd);\n\n"
        "#ifndef WRDE_NOCMD\n"
        "#define WRDE_NOCMD 0\n"
        "typedef struct { size_t we_wordc; char **we_wordv; size_t we_offs; } wordexp_t;\n"
        "static inline int wordexp(const char *w, wordexp_t *p, int f) { (void)w; (void)p; (void)f; return -1; }\n"
        "static inline void wordfree(wordexp_t *p) { (void)p; }\n"
        "#endif\n\n"
        "#ifndef aligned_alloc\n"
        "static inline void* aligned_alloc(size_t a, size_t s) { void *p; return posix_memalign(&p, a, s) ? NULL : p; }\n"
        "#endif\n\n"
        "#ifdef __cplusplus\n"
        "}\n"
        "#endif\n\n"
        "#endif\n",
        encoding="utf-8",
    )


def setup_global_bionic_env() -> None:
    """Exports default toolchain, LDFLAGS, and Cargo/Maturin cross-compilation environment variables."""
    setup_bionic_compat_library()
    ndk_clang = os.environ.get("NDK_CLANG")
    if not ndk_clang or not Path(ndk_clang).exists():
        ndk_path = Path("/opt/android-ndk")
        if ndk_path.exists():
            clangs = list(ndk_path.rglob("aarch64-linux-android24-clang"))
            ndk_clang = str(clangs[0]) if clangs else "aarch64-linux-android24-clang"
        else:
            ndk_clang = "aarch64-linux-android24-clang"

    os.environ["NDK_CLANG"] = ndk_clang
    os.environ["CC"] = ndk_clang
    os.environ["CXX"] = (
        ndk_clang.replace("clang", "clang++")
        if "clang" in ndk_clang
        else "aarch64-linux-android24-clang++"
    )

    cflags = os.environ.get("CFLAGS", "")
    if "-include /tmp/bionic_stub.h" not in cflags:
        os.environ["CFLAGS"] = f"-include /tmp/bionic_stub.h {cflags}".strip()

    cxxflags = os.environ.get("CXXFLAGS", "")
    if "-include /tmp/bionic_stub.h" not in cxxflags:
        os.environ["CXXFLAGS"] = f"-include /tmp/bionic_stub.h {cxxflags}".strip()

    ldflags = os.environ.get("LDFLAGS", "")
    if "-static-libgcc" not in ldflags:
        ldflags = f"-static-libgcc {ldflags}".strip()
    if "-L/tmp -lbionic_compat" not in ldflags:
        ldflags = f"-L/tmp -lbionic_compat {ldflags}".strip()
    os.environ["LDFLAGS"] = ldflags

    os.environ["CARGO_BUILD_TARGET"] = "aarch64-linux-android"
    os.environ["CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER"] = ndk_clang
    rustflags = (
        f"-C linker={ndk_clang} -C link-arg=-fuse-ld=lld -C link-arg=-static-libgcc"
        " -C link-arg=-Wl,-z,max-page-size=16384"
    )
    os.environ["RUSTFLAGS"] = rustflags
    os.environ["CARGO_TARGET_AARCH64_LINUX_ANDROID_RUSTFLAGS"] = rustflags
    os.environ["MATURIN_TARGET"] = "aarch64-linux-android"
    os.environ["MATURIN_PEP517_ARGS"] = "--target aarch64-linux-android"
    if "PYO3_PYTHON" not in os.environ:
        os.environ["PYO3_PYTHON"] = sys.executable or "/usr/bin/python3"


def auto_patch_bionic_sources(src_dir: Path) -> None:
    """Automated Bionic polyfill and source patcher for Android builds."""
    setup_global_bionic_env()
    if not src_dir or not src_dir.exists():
        return
    for p in src_dir.rglob("CMakeLists.txt"):
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
                new_c = re.sub(r"find_package\(ICU[^\)]*\)", lambda _, stub=icu_stub: stub, c_txt)
                if new_c != c_txt:
                    p.write_text(new_c, encoding="utf-8")
        except Exception:
            pass


def execute_compile(recipe, pkg_dir: Path, destdir: Path) -> Path:
    setup_global_bionic_env()
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
    if Path("/usr/lib/llvm-21/bin").exists():
        env["PATH"] = f"/usr/lib/llvm-21/bin:{env.get('PATH', '')}"
    cpus = str(os.cpu_count() or 4)

    env["MAKEFLAGS"] = f"-j{cpus}"
    env["NINJA_JOBS"] = cpus
    env["CARGO_BUILD_JOBS"] = cpus
    env["GOMAXPROCS"] = cpus
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "safe.directory"
    env["GIT_CONFIG_VALUE_0"] = "*"

    subprocess.run(["git", "config", "--global", "--add", "safe.directory", "*"], check=False)

    build_sys = getattr(recipe, "build_system", None)
    if build_sys:
        with contextlib.suppress(Exception):
            env.update(setup_build_environment(build_sys, recipe.arch))

    print(f"[COMPILING] Package: {recipe.name} (Channel: {recipe.active_channel})")
    Path("/data/data/com.termux/files/usr/tmp").mkdir(parents=True, exist_ok=True)
    subprocess.run(["git", "config", "--global", "--add", "safe.directory", "*"], check=False)
    subprocess.run(["git", "config", "--global", "--add", "safe.directory", "/home/builder/RepoExe"], check=False)
    if shutil.which("rustup"):
        subprocess.run(["rustup", "default", "stable"], check=False, capture_output=True)
        subprocess.run(["rustup", "component", "add", "rust-src"], check=False, capture_output=True)
    if build_sys in ("cargo", "custom") and shutil.which("rustup"):
        target_tr = env.get("CARGO_BUILD_TARGET", "aarch64-linux-android")
        subprocess.run(["rustup", "target", "add", target_tr], check=False, capture_output=True)

    destdir.parent.mkdir(parents=True, exist_ok=True)
    if destdir.exists():
        shutil.rmtree(destdir)
    destdir.mkdir(parents=True, exist_ok=True)

    stage_dir = destdir / "stage"
    stage_dir.mkdir(parents=True, exist_ok=True)

    resolve_and_fetch_build_dependencies(recipe.build_deps, destdir)

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
            src_url_str.endswith(".git")
            or src_url_str.startswith("git://")
            or "git" in src_url_str.split("/")[-1]
            or "#" in src_url_str
        ):
            print(f"⚡ Cloning Git source repository: {src_url_str}...")
            if "#" in src_url_str:
                parts = [x for x in src_url_str.split("#") if x]
                repo_url = parts[0]
                ref = parts[1]
                if len(ref) == 40 and all(c in "0123456789abcdefABCDEF" for c in ref):
                    subprocess.run(["git", "init", str(src_extract_dir)], check=True)
                    subprocess.run(["git", "-C", str(src_extract_dir), "remote", "add", "origin", repo_url], check=True)
                    subprocess.run(["git", "-C", str(src_extract_dir), "fetch", "--depth", "1", "origin", ref], check=True)
                    subprocess.run(["git", "-C", str(src_extract_dir), "checkout", "FETCH_HEAD"], check=True)
                else:
                    clone_cmd = ["git", "clone", "--depth", "1", "--branch", ref, repo_url, str(src_extract_dir)]
                    subprocess.run(clone_cmd, check=True)
            else:
                clone_cmd = ["git", "clone", "--depth", "1", src_url_str, str(src_extract_dir)]
                subprocess.run(clone_cmd, check=True)
            work_dir = src_extract_dir
        else:
            print(f"⚡ Downloading archive source: {src_url_str}...")
            subprocess.run(
                ["curl", "-fsSL", src_url_str, "-o", str(archive_path)],
                check=True,
            )
            if archive_path.exists():
                subprocess.run(
                    ["tar", "-xf", str(archive_path), "-C", str(src_extract_dir)],
                    check=False,
                )
                if not any(src_extract_dir.iterdir()):
                    subprocess.run(
                        ["unzip", "-q", str(archive_path), "-d", str(src_extract_dir)],
                        check=False,
                    )
                extracted_items = [
                    item for item in src_extract_dir.iterdir() if item.name != "source.tar.gz"
                ]
                if len(extracted_items) == 1 and extracted_items[0].is_dir():
                    work_dir = extracted_items[0]
                else:
                    work_dir = src_extract_dir

    patches = getattr(recipe, "patches", []) or []
    for patch_name in patches:
        p_path = pkg_dir / patch_name
        if p_path.exists():
            print(f"⚡ Applying automated Android patch: {patch_name}...")
            subprocess.run(["patch", "-p1", "-i", str(p_path)], cwd=work_dir, check=True)

    if shutil.which("sccache"):
        env["RUSTC_WRAPPER"] = "sccache"
        env["CMAKE_C_COMPILER_LAUNCHER"] = "sccache"
        env["CMAKE_CXX_COMPILER_LAUNCHER"] = "sccache"
        env["SCCACHE_DIR"] = "/home/builder/.cache/sccache"

    env["DESTDIR"] = str(stage_dir.resolve())
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", {})
    prepare_cmd = phases.get("prepare")
    configure_cmd = phases.get("configure")
    make_cmd = phases.get("make")
    install_cmd = phases.get("install")

    auto_patch_bionic_sources(work_dir)
    if Path("/tmp/webkit-src").exists():
        auto_patch_bionic_sources(Path("/tmp/webkit-src"))

    if prepare_cmd:
        res = subprocess.run(prepare_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Prepare phase failed for {recipe.name}")

    auto_patch_bionic_sources(work_dir)
    if Path("/tmp/webkit-src").exists():
        auto_patch_bionic_sources(Path("/tmp/webkit-src"))

    if configure_cmd:
        res = subprocess.run(configure_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Configure phase failed for {recipe.name}")

    if make_cmd:
        res = subprocess.run(make_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Make phase failed for {recipe.name}")

    if install_cmd:
        res = subprocess.run(install_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Install phase failed for {recipe.name}")

    return stage_dir


def execute_pack(recipe, pkg_dir: Path, destdir: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with contextlib.suppress(OSError):
        os.chmod(output_dir, 0o777)

    stage_dir = destdir / "stage"
    installed_files = list(stage_dir.rglob("*")) if stage_dir.exists() else []
    payload_files = [
        f for f in installed_files if f.is_file() and "DEBIAN" not in f.parts and ".PKGINFO" not in f.name
    ]

    out_has_wheels = list(output_dir.glob(f"{recipe.name}*.whl")) if output_dir.exists() else []
    if not payload_files and not out_has_wheels:
        raise RuntimeError(f"CRITICAL ERROR: No files installed in $DESTDIR for {recipe.name}.")

    target_formats = getattr(recipe, "formats", ["apt", "pacman", "apk"])

    if "apt" in target_formats:
        build_deb(
            recipe,
            str(destdir),
            str(output_dir),
            target_arch=recipe.arch,
            pkg_src_dir=pkg_dir,
        )
    if "pacman" in target_formats:
        build_pacman(recipe, str(destdir), str(output_dir), target_arch=recipe.arch)
    if "apk" in target_formats:
        build_alpine(recipe, str(destdir), str(output_dir), target_arch=recipe.arch)
    if "pip" in target_formats:
        build_pip(recipe, str(destdir), str(output_dir))
    if "npm" in target_formats:
        build_npm(recipe, str(destdir), str(output_dir))

    verify_format_archives(output_dir, recipe.name)

    meta = {
        "name": recipe.name,
        "version": recipe.version,
        "revision": recipe.revision,
        "arch": recipe.arch,
        "state_hash": recipe.state_hash,
        "channel": recipe.active_channel,
    }
    (output_dir / f"{recipe.name}_metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def execute_test(recipe, destdir: Path | None = None) -> None:
    phases = getattr(recipe, "phases", {})
    test_cmd = phases.get("test")
    if shutil.which("proot"):
        runner = ProotTestRunner()
        cmd_to_run = test_cmd or f"{recipe.name} --version || {recipe.name} --help"
        runner.execute_test(recipe.name, cmd_to_run, destdir=destdir)


def main() -> None:
    parser = argparse.ArgumentParser(description="RepoExe Build System CLI")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("check")

    for cmd_name in ("build", "compile", "pack", "test"):
        p = subparsers.add_parser(cmd_name)
        p.add_argument("package")
        p.add_argument("--channel", default="latest")
        p.add_argument("--dry-run", action="store_true")
        p.add_argument("--force", action="store_true")

    args = parser.parse_args()
    pkg_dir = Path(__file__).resolve().parents[2] / "pkg"

    if args.command == "check":
        audit_repository_health(pkg_dir)
        return

    if args.command in ("build", "compile", "pack", "test"):
        pkg_path = Path(args.package)
        if not pkg_path.is_absolute():
            pkg_path = Path.cwd() / args.package

        recipe_file = pkg_path / "build.yml" if pkg_path.is_dir() else pkg_path
        if not recipe_file.exists():
            print(f"Error: Recipe not found at {recipe_file}", file=sys.stderr)
            sys.exit(1)

        p_dir = recipe_file.parent
        recipe = parse_recipe(recipe_file, channel=args.channel)

        if not args.force and check_existing_release_hash(recipe.name, args.channel, recipe.state_hash):
            print(f"⏭️ Skipping {recipe.name}@{args.channel}: state_hash unchanged.")
            return

        if args.dry_run:
            print(f"✓ Dry-run complete for {recipe.name} ({args.command}).")
            return

        destdir = (Path.cwd() / "build" / f"build_{recipe.name}").resolve()
        output_dir = (Path.cwd() / "output").resolve()

        if args.command == "compile":
            execute_compile(recipe, p_dir, destdir)
            fix_termux_shebangs(destdir)
        elif args.command == "pack":
            execute_pack(recipe, p_dir, destdir, output_dir)
        elif args.command == "test":
            execute_test(recipe, destdir)
        elif args.command == "build":
            execute_compile(recipe, p_dir, destdir)
            execute_pack(recipe, p_dir, destdir, output_dir)
            execute_test(recipe, destdir)


if __name__ == "__main__":
    main()
