import argparse
import contextlib
import json
import os
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

from core.alpine import build_alpine
from core.debian import build_deb
from core.health import audit_repository_health
from core.npm import build_npm
from core.pacman import build_pacman
from core.parser import parse_recipe
from core.pip import build_pip
from core.test import ProotTestRunner
from core.toolchains import setup_build_environment


def get_ruff_cmd() -> list[str]:
    if shutil.which("ruff"):
        return ["ruff"]
    return ["uvx", "ruff"]


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

    for dep in build_deps:
        tag = f"{dep}@latest"
        api_url = f"https://api.github.com/repos/SjnExe/RepoExe/releases/tags/{tag}"

        try:
            req = urllib.request.Request(
                api_url, headers={"User-Agent": "RepoExe-Orchestrator"}
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                rel_data = json.loads(resp.read().decode("utf-8"))

            deb_asset = next(
                (a for a in rel_data.get("assets", []) if a.get("name", "").endswith(".deb")),
                None,
            )

            if deb_asset:
                download_url = deb_asset["browser_download_url"]
                dep_deb = destdir / deb_asset["name"]
                print(f"Fetching pre-built dependency '{dep}' from {download_url}...")
                urllib.request.urlretrieve(download_url, dep_deb)
                subprocess.run(
                    ["dpkg-deb", "-x", str(dep_deb), str(stage_dir)], check=True
                )
                print(f"✓ Extracted pre-built dependency '{dep}' into build staging.")
        except Exception as e:
            print(f"Notice: Pre-built artifact for dependency '{dep}' could not be fetched ({e}).")


def verify_format_archives(output_dir: Path, pkg_name: str) -> None:
    """Validates structural integrity of produced package archives."""
    for f in output_dir.glob(f"{pkg_name}*"):
        if f.name.endswith(".deb"):
            subprocess.run(["dpkg-deb", "-I", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".pkg.tar.zst") or f.name.endswith(".pkg.tar.gz"):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".apk"):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".whl"):
            subprocess.run(["unzip", "-t", str(f)], check=True, capture_output=True)
        elif f.name.endswith(".tgz"):
            subprocess.run(["tar", "-tf", str(f)], check=True, capture_output=True)


def execute_build(
    package_path: Path,
    channel: str = "latest",
    dry_run: bool = False,
    force: bool = False,
) -> None:
    recipe_file = package_path / "build.yml" if package_path.is_dir() else package_path
    if not recipe_file.exists():
        print(f"Error: Recipe not found at {recipe_file}", file=sys.stderr)
        sys.exit(1)

    pkg_dir = recipe_file.parent
    recipe = parse_recipe(recipe_file, channel=channel)

    if not force and check_existing_release_hash(recipe.name, channel, recipe.state_hash):
        print(f"⏭️ Skipping build for {recipe.name}@{channel}: state_hash unchanged.")
        return

    # Hardware parallel compilation flags (4 Cores / 16GB RAM)
    env = os.environ.copy()
    env["MAKEFLAGS"] = "-j4"
    env["CARGO_BUILD_JOBS"] = "4"
    env["GOMAXPROCS"] = "4"

    build_sys = getattr(recipe, "build_system", None)
    if build_sys:
        with contextlib.suppress(Exception):
            setup_build_environment(build_sys, recipe.architecture)

    print(f"[BUILDING] Package: {recipe.name} (Channel: {recipe.active_channel})")

    if dry_run:
        print("✓ Dry-run complete.")
        return

    output_dir = Path("output")
    output_dir.mkdir(parents=True, exist_ok=True)

    destdir = Path(f"/tmp/build_{recipe.name}")
    if destdir.exists():
        shutil.rmtree(destdir)
    destdir.mkdir(parents=True, exist_ok=True)
    stage_dir = destdir / "stage"
    stage_dir.mkdir(parents=True, exist_ok=True)

    # 1. Fetch & Install Build Dependencies
    resolve_and_fetch_build_dependencies(recipe.build_deps, destdir)

    # 2. Source Extraction
    work_dir = pkg_dir
    src_url = getattr(recipe, "source_url", None)
    if src_url:
        archive_path = destdir / "source.tar.gz"
        src_extract_dir = destdir / "src"
        src_extract_dir.mkdir(parents=True, exist_ok=True)

        subprocess.run(["curl", "-fsSL", str(src_url), "-o", str(archive_path)], check=True)
        if archive_path.exists():
            subprocess.run(
                ["tar", "-xf", str(archive_path), "-C", str(src_extract_dir), "--strip-components=1"],
                check=False,
            )
            if not any(src_extract_dir.iterdir()):
                subprocess.run(["tar", "-xf", str(archive_path), "-C", str(src_extract_dir)], check=True)
            work_dir = src_extract_dir

    env["DESTDIR"] = str(stage_dir)
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", {})
    prepare_cmd = phases.get("prepare")
    make_cmd = phases.get("make")

    if prepare_cmd:
        res = subprocess.run(prepare_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Prepare phase failed for {recipe.name}")
    install_cmd = phases.get("install")
    test_cmd = phases.get("test")

    if make_cmd:
        res = subprocess.run(make_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Make phase failed for {recipe.name}")

    if install_cmd:
        res = subprocess.run(install_cmd, shell=True, cwd=work_dir, env=env, check=False)
        if res.returncode != 0:
            raise RuntimeError(f"Install phase failed for {recipe.name}")

    # 3. Payload Sanity Verification
    installed_files = list(stage_dir.rglob("*"))
    payload_files = [
        f for f in installed_files if f.is_file() and "DEBIAN" not in f.parts and ".PKGINFO" not in f.name
    ]
    if not payload_files:
        raise RuntimeError(f"CRITICAL ERROR: No files installed in $DESTDIR for {recipe.name}.")

    # 4. PRoot + QEMU Post-Build Smoke Test Sandbox (Hard Fails on error)
    if shutil.which("proot"):
        runner = ProotTestRunner()
        cmd_to_run = test_cmd or f"{recipe.name} --version || {recipe.name} --help"
        runner.execute_test(recipe.name, cmd_to_run)

    target_formats = getattr(recipe, "formats", ["apt", "pacman", "apk"])

    if "apt" in target_formats:
        build_deb(recipe, str(destdir), str(output_dir), target_arch=recipe.architecture, pkg_src_dir=pkg_dir)
    if "pacman" in target_formats:
        build_pacman(recipe, str(destdir), str(output_dir), target_arch=recipe.architecture)
    if "apk" in target_formats:
        build_alpine(recipe, str(destdir), str(output_dir), target_arch=recipe.architecture)
    if "pip" in target_formats:
        build_pip(recipe, str(destdir), str(output_dir))
    if "npm" in target_formats:
        build_npm(recipe, str(destdir), str(output_dir))

    # 5. Format Archive Verification & Metadata Generation
    verify_format_archives(output_dir, recipe.name)

    meta = {
        "name": recipe.name,
        "version": recipe.version,
        "revision": recipe.revision,
        "architecture": recipe.architecture,
        "state_hash": recipe.state_hash,
        "channel": recipe.active_channel,
    }
    (output_dir / f"{recipe.name}_metadata.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")


def main() -> None:
    parser = argparse.ArgumentParser(description="RepoExe Build System CLI")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("check")
    build_p = subparsers.add_parser("build")
    build_p.add_argument("package")
    build_p.add_argument("--channel", default="latest")
    build_p.add_argument("--dry-run", action="store_true")
    build_p.add_argument("--force", action="store_true")

    args = parser.parse_args()
    pkg_dir = Path(__file__).parent.parent / "pkg"

    if args.command == "check":
        audit_repository_health(pkg_dir)
    elif args.command == "build":
        pkg_path = Path(args.package)
        if not pkg_path.is_absolute():
            pkg_path = Path.cwd() / args.package
        execute_build(pkg_path, channel=args.channel, dry_run=args.dry_run, force=args.force)


if __name__ == "__main__":
    main()
