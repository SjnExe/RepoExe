import sys
from pathlib import Path

SCRIPTS_DIR = Path(__file__).resolve().parent.parent
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from utils.elf_linter import audit_directory_elfs
from pathlib import Path
import argparse
import contextlib
import json
import os
import shutil
import subprocess

clang_bin = "/usr/lib/llvm-21/bin/clang" if Path("/usr/lib/llvm-21/bin/clang").exists() else "clang"
clangxx_bin = "/usr/lib/llvm-21/bin/clang++" if Path("/usr/lib/llvm-21/bin/clang++").exists() else "clang++"
ld_bin = "/usr/lib/llvm-21/bin/ld.lld" if Path("/usr/lib/llvm-21/bin/ld.lld").exists() else "ld.lld"

DEFAULT_BIONIC_ENV = {
    "CC": clang_bin,
    "CXX": clangxx_bin,
    "LD": ld_bin,
    "CFLAGS": "-O3 -DNDEBUG -pipe -march=armv8-a+crc+crypto -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC",
    "CXXFLAGS": "-O3 -DNDEBUG -pipe -march=armv8-a+crc+crypto -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIC",
    "LDFLAGS": "-fuse-ld=lld -Wl,-O1 -Wl,--as-needed -Wl,-z,relro -Wl,-z,now -Wl,-icf=safe -Wl,--gc-sections -Wl,-z,pack-relative-relocs",
    "CARGO_BUILD_TARGET": "aarch64-linux-android",
    "GOOS": "android",
    "GOARCH": "arm64",
    "CGO_ENABLED": "1",
}

import sys
import urllib.request

from builders.alpine import build_alpine
from builders.debian import build_deb
from builders.npm import build_npm
from builders.pacman import build_pacman
from builders.pip import build_pip
from utils.health import audit_repository_health
from utils.parser import parse_recipe
from utils.test import ProotTestRunner
from utils.toolchains import setup_build_environment


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
    pkg_root = Path(__file__).resolve().parents[2] / "pkg"
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
    env = os.environ.copy()
    for k, v in DEFAULT_BIONIC_ENV.items():
        if k not in env:
            env[k] = v
    if getattr(recipe, 'cflags', None):
        env['CFLAGS'] = f"{env.get('CFLAGS', '')} {recipe.cflags}".strip()
    if getattr(recipe, 'cxxflags', None):
        env['CXXFLAGS'] = f"{env.get('CXXFLAGS', '')} {recipe.cxxflags}".strip()
    if getattr(recipe, 'ldflags', None):
        env['LDFLAGS'] = f"{env.get('LDFLAGS', '')} {recipe.ldflags}".strip()
    if getattr(recipe, 'vars', None):
        env.update(recipe.vars)
    if Path("/usr/lib/llvm-21/bin").exists():
        env['PATH'] = f"/usr/lib/llvm-21/bin:{env.get('PATH', '')}"
    cpus = str(os.cpu_count() or 4)

    env["MAKEFLAGS"] = f"-j{cpus}"

    env["NINJA_JOBS"] = cpus

    env["CARGO_BUILD_JOBS"] = cpus

    env["GOMAXPROCS"] = cpus
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "safe.directory"
    env["GIT_CONFIG_VALUE_0"] = "*"

    subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", "*"], check=False
    )

    build_sys = getattr(recipe, "build_system", None)
    if build_sys:
        with contextlib.suppress(Exception):
            setup_build_environment(build_sys, recipe.arch)

    print(f"[COMPILING] Package: {recipe.name} (Channel: {recipe.active_channel})")

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

    # Apply recipe patches automatically
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

    if prepare_cmd:
        res = subprocess.run(
            prepare_cmd, shell=True, cwd=work_dir, env=env, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Prepare phase failed for {recipe.name}")

    if configure_cmd:
        res = subprocess.run(
            configure_cmd, shell=True, cwd=work_dir, env=env, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Configure phase failed for {recipe.name}")

    if make_cmd:
        res = subprocess.run(
            make_cmd, shell=True, cwd=work_dir, env=env, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Make phase failed for {recipe.name}")

    if install_cmd:
        res = subprocess.run(
            install_cmd, shell=True, cwd=work_dir, env=env, check=False
        )
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
        f
        for f in installed_files
        if f.is_file() and "DEBIAN" not in f.parts and ".PKGINFO" not in f.name
    ]

    out_has_wheels = (
        list(output_dir.glob(f"{recipe.name}*.whl")) if output_dir.exists() else []
    )
    if not payload_files and not out_has_wheels:
        raise RuntimeError(
            f"CRITICAL ERROR: No files installed in $DESTDIR for {recipe.name}."
        )

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
        build_pacman(
            recipe, str(destdir), str(output_dir), target_arch=recipe.arch
        )
    if "apk" in target_formats:
        build_alpine(
            recipe, str(destdir), str(output_dir), target_arch=recipe.arch
        )
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
    (output_dir / f"{recipe.name}_metadata.json").write_text(
        json.dumps(meta, indent=2), encoding="utf-8"
    )


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

        if not args.force and check_existing_release_hash(
            recipe.name, args.channel, recipe.state_hash
        ):
            print(f"⏭️ Skipping {recipe.name}@{args.channel}: state_hash unchanged.")
            return

        if args.dry_run:
            print(f"✓ Dry-run complete for {recipe.name} ({args.command}).")
            return

        destdir = (Path.cwd() / "build" / f"build_{recipe.name}").resolve()
        output_dir = (Path.cwd() / "output").resolve()

        if args.command == "compile":
            execute_compile(recipe, p_dir, destdir)
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
