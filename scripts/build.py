import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

from core.debian import build_deb
from core.health import audit_repository_health
from core.parser import parse_recipe
from core.toolchains import setup_build_environment


def get_ruff_cmd() -> list[str]:
    if shutil.which("ruff"):
        return ["ruff"]
    return ["uvx", "ruff"]


def list_packages(packages_dir: Path) -> None:
    print("Available packages:")
    for pkg_dir in sorted(packages_dir.iterdir()):
        recipe_file = pkg_dir / "build.yml"
        if pkg_dir.is_dir() and recipe_file.exists():
            try:
                recipe = parse_recipe(recipe_file, channel="latest")
                ch_list = (
                    list(recipe.channels.keys()) if recipe.channels else ["latest"]
                )
                channels_str = ", ".join(ch_list)
                print(f"  • {recipe.name:<12} v{recipe.version:<8} [{channels_str}]")
            except Exception as e:  # noqa: BLE001
                print(f"  • {pkg_dir.name:<12} [INVALID: {e}]")


def inspect_package(
    packages_dir: Path, package_name: str, channel: str = "latest"
) -> None:
    recipe_file = packages_dir / package_name / "build.yml"
    if not recipe_file.exists():
        print(f"Error: Package '{package_name}' not found", file=sys.stderr)
        sys.exit(1)

    recipe = parse_recipe(recipe_file, channel=channel)
    print(json.dumps(recipe.model_dump(), indent=2))


def run_health_check(packages_dir: Path) -> None:
    report = audit_repository_health(packages_dir)
    print("Repository Health Audit:")
    print("------------------------")
    print(f"Total Packages Found  : {report['total_packages']}")
    print(f"Valid Package Recipes : {report['valid_packages']}")


def execute_build(
    package_path: Path,
    channel: str = "latest",
    dry_run: bool = False,
) -> None:
    recipe_file = package_path / "build.yml" if package_path.is_dir() else package_path
    if not recipe_file.exists():
        print(f"Error: Recipe not found at {recipe_file}", file=sys.stderr)
        sys.exit(1)

    pkg_dir = recipe_file.parent
    recipe = parse_recipe(recipe_file, channel=channel)

    build_sys = getattr(recipe, "build_system", None) or getattr(
        recipe, "build_type", None
    )
    if build_sys:
        try:
            setup_build_environment(build_sys, recipe.architecture)
        except Exception:  # noqa: BLE001
            pass

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

    build_sh = pkg_dir / "build.sh"
    if build_sh.exists():
        print(f"Running build.sh for {recipe.name}...")
        env = os.environ.copy()
        env["TERMUX_PREFIX"] = "/data/data/com.termux/files/usr"
        env["DESTDIR"] = str(destdir / "stage")
        res = subprocess.run(["bash", str(build_sh)], cwd=pkg_dir, env=env, check=False)
        if res.returncode != 0:
            print(
                f"Warning: build.sh for {recipe.name} exited with code {res.returncode}",
                file=sys.stderr,
            )

    try:
        build_deb(
            recipe,
            str(destdir),
            str(output_dir),
            target_arch=recipe.architecture,
            pkg_src_dir=pkg_dir,
        )
        print(f"✓ Successfully built package {recipe.name}")
    except Exception as e:  # noqa: BLE001
        print(f"Build failed for {recipe.name}: {e}", file=sys.stderr)
        sys.exit(1)


def fix_code_formatting(scripts_dir: Path) -> None:
    print("🧹 Running automatic code formatting and lint fixes...")
    subprocess.run(get_ruff_cmd() + ["format", "."], cwd=scripts_dir, check=False)
    subprocess.run(
        get_ruff_cmd() + ["check", "--fix", "."], cwd=scripts_dir, check=False
    )


def run_code_checks(scripts_dir: Path, packages_dir: Path) -> None:
    print("🔎 Running full codebase verification...")
    subprocess.run(get_ruff_cmd() + ["check", "."], cwd=scripts_dir, check=False)
    run_health_check(packages_dir)


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

    args = parser.parse_args()
    packages_dir = Path(__file__).parent.parent / "packages"

    if args.command == "list":
        list_packages(packages_dir)
    elif args.command == "fix":
        fix_code_formatting(Path(__file__).parent)
    elif args.command == "check":
        run_code_checks(Path(__file__).parent, packages_dir)
    elif args.command == "inspect":
        inspect_package(packages_dir, args.package, channel=args.channel)
    elif args.command == "health":
        run_health_check(packages_dir)
    elif args.command == "build":
        pkg_path = Path(args.package)
        if not pkg_path.is_absolute():
            pkg_path = Path.cwd() / args.package
        execute_build(pkg_path, channel=args.channel, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
