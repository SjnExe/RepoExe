import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

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

    for dep in build_deps:
        tag = f"{dep}@latest"
        api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"
        fetched_remote = False

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

            # Check local workflow artifacts directory first (from previous CI stage)
            local_arts = list(Path("artifacts").glob(f"{dep}*.deb")) if Path("artifacts").exists() else []
            if local_arts:
                print(f"✓ Found local workflow artifact for dependency '{dep}': {local_arts[0].name}")
                subprocess.run(["dpkg-deb", "-x", str(local_arts[0]), str(stage_dir)], check=True)
                fetched_remote = True
            elif deb_asset:
                download_url = deb_asset["browser_download_url"]
                dep_deb = destdir / deb_asset["name"]
                print(f"Fetching pre-built dependency '{dep}' from {download_url}...")
                urllib.request.urlretrieve(download_url, dep_deb)
                subprocess.run(
                    ["dpkg-deb", "-x", str(dep_deb), str(stage_dir)], check=True
                )
                print(f"✓ Extracted pre-built dependency '{dep}' into build staging.")
                fetched_remote = True
        except Exception as e:
            print(
                f"Notice: Pre-built artifact for dependency '{dep}' could not be fetched remotely ({e})."
            )

        if not fetched_remote:
            local_recipe_file = pkg_root / dep / "build.yml"
            if local_recipe_file.exists():
                print(f"⚡ Local recipe found for missing dependency '{dep}'. Building locally first...")
                dep_recipe = parse_recipe(local_recipe_file, channel="latest")
                dep_destdir = (destdir.parent / f"build_{dep}").resolve()
                dep_stage_dir = execute_compile(dep_recipe, local_recipe_file.parent, dep_destdir)
                
                # Copy compiled headers and libraries from dependency stage into active build staging
                if dep_stage_dir.exists():
                    shutil.copytree(dep_stage_dir, stage_dir, dirs_exist_ok=True)
                    print(f"✓ Successfully built and staged local dependency '{dep}'.")
            else:
                print(f"⚠️ Warning: Dependency '{dep}' not found on remote release or local repository.")


def verify_format_archives(output_dir: Path, pkg_name: str) -> None:
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
    env["MAKEFLAGS"] = "-j4"
    env["NINJA_JOBS"] = "4"
    env["CARGO_BUILD_JOBS"] = "4"
    env["GOMAXPROCS"] = "4"
    env["GIT_CONFIG_COUNT"] = "1"
    env["GIT_CONFIG_KEY_0"] = "safe.directory"
    env["GIT_CONFIG_VALUE_0"] = "*"

    subprocess.run(
        ["git", "config", "--global", "--add", "safe.directory", "*"], check=False
    )

    build_sys = getattr(recipe, "build_system", None)
    if build_sys:
        with contextlib.suppress(Exception):
            setup_build_environment(build_sys, recipe.architecture)

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
        archive_path = destdir / "source.tar.gz"
        src_extract_dir = destdir / "src"
        src_extract_dir.mkdir(parents=True, exist_ok=True)

        res = subprocess.run(
            ["curl", "-fsSL", str(src_url), "-o", str(archive_path)], check=False
        )
        if res.returncode == 0 and archive_path.exists() and archive_path.stat().st_size > 1000:
            subprocess.run(
                [
                    "tar",
                    "-xf",
                    str(archive_path),
                    "-C",
                    str(src_extract_dir),
                    "--strip-components=1",
                ],
                check=False,
            )
            if not any(src_extract_dir.iterdir()):
                subprocess.run(
                    ["tar", "-xf", str(archive_path), "-C", str(src_extract_dir)],
                    check=True,
                )
            work_dir = src_extract_dir
        else:
            print(f"Notice: Direct archive download failed for {src_url}. Falling back to git clone...")
            git_url = str(src_url).replace("/archive/refs/heads/main.tar.gz", ".git").replace("/archive/refs/tags/", "/tree/")
            if not git_url.endswith(".git"):
                git_url = str(src_url).split("/archive/")[0] + ".git"
            subprocess.run(["git", "clone", "--depth", "1", git_url, str(src_extract_dir)], check=True)
            work_dir = src_extract_dir

    env["DESTDIR"] = str(stage_dir.resolve())
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", {})
    prepare_cmd = phases.get("prepare")
    make_cmd = phases.get("make")
    install_cmd = phases.get("install")

    if prepare_cmd:
        res = subprocess.run(
            prepare_cmd, shell=True, cwd=work_dir, env=env, check=False
        )
        if res.returncode != 0:
            raise RuntimeError(f"Prepare phase failed for {recipe.name}")

    if make_cmd:
        res = subprocess.run(make_cmd, shell=True, cwd=work_dir, env=env, check=False)
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
            target_arch=recipe.architecture,
            pkg_src_dir=pkg_dir,
        )
    if "pacman" in target_formats:
        build_pacman(
            recipe, str(destdir), str(output_dir), target_arch=recipe.architecture
        )
    if "apk" in target_formats:
        build_alpine(
            recipe, str(destdir), str(output_dir), target_arch=recipe.architecture
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
        "architecture": recipe.architecture,
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
