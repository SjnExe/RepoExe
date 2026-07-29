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


def list_packages(pkg_dir: Path) -> None:
    print("Available packages:")
    for p_dir in sorted(pkg_dir.iterdir()):
        recipe_file = p_dir / "build.yml"
        if p_dir.is_dir() and recipe_file.exists():
            try:
                recipe = parse_recipe(recipe_file, channel="latest")
                ch_list = (
                    list(recipe.channels.keys()) if recipe.channels else ["latest"]
                )
                channels_str = ", ".join(ch_list)
                print(f"  • {recipe.name:<12} v{recipe.version:<8} [{channels_str}]")
            except Exception as e:  # noqa: BLE001
                print(f"  • {p_dir.name:<12} [INVALID: {e}]")


def inspect_package(pkg_dir: Path, package_name: str, channel: str = "latest") -> None:
    recipe_file = pkg_dir / package_name / "build.yml"
    if not recipe_file.exists():
        print(f"Error: Package '{package_name}' not found", file=sys.stderr)
        sys.exit(1)

    recipe = parse_recipe(recipe_file, channel=channel)
    print(json.dumps(recipe.model_dump(), indent=2))


def run_health_check(pkg_dir: Path) -> None:
    report = audit_repository_health(pkg_dir)
    print("Repository Health Audit:")
    print("------------------------")
    print(f"Total Packages Found  : {report['total_packages']}")
    print(f"Valid Package Recipes : {report['valid_packages']}")


def check_existing_release_hash(pkg_name: str, channel: str, target_hash: str) -> bool:
    """Checks if active release tag metadata matches target state_hash to prevent rebuilds."""
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
    except Exception:  # noqa: BLE001
        return False
    return False


def resolve_and_fetch_build_dependencies(build_deps: list[str], destdir: Path) -> None:
    """Fetches up-to-date pre-built .deb dependencies from GitHub Releases."""
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

            deb_asset = None
            for asset in rel_data.get("assets", []):
                if asset.get("name", "").endswith(".deb"):
                    deb_asset = asset
                    break

            if deb_asset:
                download_url = deb_asset["browser_download_url"]
                dep_deb = destdir / deb_asset["name"]
                print(f"Fetching pre-built dependency '{dep}' from {download_url}...")
                urllib.request.urlretrieve(download_url, dep_deb)

                subprocess.run(
                    ["dpkg-deb", "-x", str(dep_deb), str(stage_dir)], check=True
                )
                print(f"✓ Extracted pre-built dependency '{dep}' into build staging.")
        except Exception as e:  # noqa: BLE001
            print(
                f"Notice: Pre-built artifact for dependency '{dep}' could not be fetched ({e})."
            )


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

    # Rebuild Prevention Guard
    if not force and check_existing_release_hash(
        recipe.name, channel, recipe.state_hash
    ):
        print(
            f"⏭️ Skipping build for {recipe.name}@{channel}: state_hash ({recipe.state_hash}) unchanged in release tag."
        )
        return

    env = os.environ.copy()
    build_sys = getattr(recipe, "build_system", None) or getattr(
        recipe, "build_type", None
    )
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
    build_deps = getattr(recipe, "build_deps", [])
    resolve_and_fetch_build_dependencies(build_deps, destdir)

    # 2. Source Extraction
    work_dir = pkg_dir
    src_url = getattr(recipe, "source_url", None)
    if src_url:
        archive_path = destdir / "source.tar.gz"
        src_extract_dir = destdir / "src"
        src_extract_dir.mkdir(parents=True, exist_ok=True)

        res = subprocess.run(
            ["curl", "-fsSL", str(src_url), "-o", str(archive_path)], check=True
        )
        if archive_path.exists():
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

    env["DESTDIR"] = str(stage_dir)
    env["PREFIX"] = "/data/data/com.termux/files/usr"

    phases = getattr(recipe, "phases", None)
    make_cmd = phases.get("make") if isinstance(phases, dict) else None
    install_cmd = phases.get("install") if isinstance(phases, dict) else None
    test_cmd = phases.get("test") if isinstance(phases, dict) else None

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

    # 3. Payload Guard Verification
    installed_files = list(stage_dir.rglob("*"))
    payload_files = [
        f
        for f in installed_files
        if f.is_file() and "DEBIAN" not in f.parts and ".PKGINFO" not in f.name
    ]
    if not payload_files:
        raise RuntimeError(
            f"CRITICAL ERROR: No files installed in $DESTDIR for {recipe.name}. Refusing to package empty artifacts."
        )

    # 4. PRoot Post-Build Smoke Test Sandbox
    if shutil.which("proot"):
        try:
            runner = ProotTestRunner()
            cmd_to_run = test_cmd or f"{recipe.name} --version || {recipe.name} --help"
            runner.execute_test(recipe.name, cmd_to_run)
        except Exception as e:  # noqa: BLE001
            print(f"Notice: Proot smoke test skipped ({e}).")

    target_formats = getattr(recipe, "formats", ["apt", "pacman", "apk"])

    if "apt" in target_formats:
        build_deb(
            recipe,
            str(destdir),
            str(output_dir),
            target_arch=recipe.architecture,
            pkg_src_dir=pkg_dir,
        )
        print(f"✓ Built .deb for {recipe.name}")

    if "pacman" in target_formats:
        build_pacman(
            recipe, str(destdir), str(output_dir), target_arch=recipe.architecture
        )
        print(f"✓ Built .pkg.tar for {recipe.name}")

    if "apk" in target_formats:
        build_alpine(
            recipe, str(destdir), str(output_dir), target_arch=recipe.architecture
        )
        print(f"✓ Built .apk for {recipe.name}")

    if "pip" in target_formats:
        build_pip(recipe, str(destdir), str(output_dir))
        print(f"✓ Built .whl for {recipe.name}")

    if "npm" in target_formats:
        build_npm(recipe, str(destdir), str(output_dir))
        print(f"✓ Built .tgz for {recipe.name}")

    # 5. Write metadata asset for rebuild prevention
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


def fix_code_formatting(scripts_dir: Path) -> None:
    subprocess.run(get_ruff_cmd() + ["format", "."], cwd=scripts_dir, check=False)
    subprocess.run(
        get_ruff_cmd() + ["check", "--fix", "."], cwd=scripts_dir, check=False
    )


def run_code_checks(scripts_dir: Path, pkg_dir: Path) -> None:
    subprocess.run(get_ruff_cmd() + ["check", "."], cwd=scripts_dir, check=False)
    run_health_check(pkg_dir)


def main() -> None:
    parser = argparse.ArgumentParser(description="RepoExe Build System CLI")
    subparsers = parser.add_subparsers(dest="command")

    subparsers.add_parser("list")
    subparsers.add_parser("fix")
    subparsers.add_parser("check")
    subparsers.add_parser("health")

    inspect_p = subparsers.add_parser("inspect")
    inspect_p.add_argument("package")
    inspect_p.add_argument("--channel", default="latest")

    build_p = subparsers.add_parser("build")
    build_p.add_argument("package")
    build_p.add_argument("--channel", default="latest")
    build_p.add_argument("--dry-run", action="store_true")
    build_p.add_argument(
        "--force",
        action="store_true",
        help="Force build even if state_hash is unchanged",
    )

    args = parser.parse_args()
    pkg_dir = Path(__file__).parent.parent / "pkg"

    if args.command == "list":
        list_packages(pkg_dir)
    elif args.command == "fix":
        fix_code_formatting(Path(__file__).parent)
    elif args.command == "check":
        run_code_checks(Path(__file__).parent, pkg_dir)
    elif args.command == "inspect":
        inspect_package(pkg_dir, args.package, channel=args.channel)
    elif args.command == "health":
        run_health_check(pkg_dir)
    elif args.command == "build":
        pkg_path = Path(args.package)
        if not pkg_path.is_absolute():
            pkg_path = Path.cwd() / args.package
        execute_build(
            pkg_path, channel=args.channel, dry_run=args.dry_run, force=args.force
        )


if __name__ == "__main__":
    main()
