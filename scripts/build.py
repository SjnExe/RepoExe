import shutil


def get_ruff_cmd() -> list[str]:
    if shutil.which("ruff"):
        return ["ruff"]
    return ["uvx", "ruff"]


import argparse
import json
import sys
from pathlib import Path

from core.health import audit_repository_health
from core.parser import parse_recipe
from core.toolchains import setup_build_environment


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
                print(
                    f"  • {recipe.name:<12} v{recipe.version:<8} [{', '.join(ch_list)}]"
                )
            except Exception as e:  # noqa: BLE001  # noqa: BLE001
                print(f"  • {pkg_dir.name:<12} [INVALID: {e}]")


def inspect_package(
    packages_dir: Path, package_name: str, channel: str = "latest"
) -> None:
    recipe_file = packages_dir / package_name / "build.yml"
    if not recipe_file.exists():
        print(
            f"Error: Package '{package_name}' not found at {recipe_file}",
            file=sys.stderr,
        )
        sys.exit(1)

    recipe = parse_recipe(recipe_file, channel=channel)
    print(json.dumps(recipe.model_dump(), indent=2))


def run_health_check(packages_dir: Path) -> None:
    report = audit_repository_health(packages_dir)
    print("Repository Health Audit:")
    print("------------------------")
    print(f"Total Packages Found  : {report['total_packages']}")
    print(f"Valid Package Recipes : {report['valid_packages']}")
    print(f"Build System Breakdown : {json.dumps(report['build_systems'])}")


def simulate_build(
    packages_dir: Path,
    package_name: str,
    channel: str = "latest",
    dry_run: bool = False,
) -> None:
    recipe_file = packages_dir / package_name / "build.yml"
    if not recipe_file.exists():
        print(f"Error: Package '{package_name}' not found.", file=sys.stderr)
        sys.exit(1)

    recipe = parse_recipe(recipe_file, channel=channel)
    env = setup_build_environment(recipe.build_system, recipe.architecture)

    print(
        f"[BUILD SIMULATION] Package: {recipe.name} (Channel: {recipe.active_channel})"
    )
    print(f"  • Version      : v{recipe.version}")
    print(f"  • Target Arch  : {recipe.architecture}")
    print(f"  • State Hash   : {recipe.state_hash}")
    print(f"  • Auto-Update  : {recipe.auto_update}")
    print(f"  • Environment  : PREFIX={env.get('PREFIX')}")

    if dry_run:
        print("✓ Dry-run completed successfully. No compilation executed.")


import subprocess


def fix_code_formatting(scripts_dir: Path) -> None:
    print("🧹 Running automatic code formatting and lint fixes...")
    subprocess.run(get_ruff_cmd() + ["format", "."], cwd=scripts_dir, check=False)
    subprocess.run(
        get_ruff_cmd() + ["check", "--fix", "."], cwd=scripts_dir, check=False
    )
    print("✓ Formatting and linting complete.")


def run_code_checks(scripts_dir: Path, packages_dir: Path) -> None:
    print("🔎 Running full codebase verification...")

    print("\n[1/3] Checking code formatting & linting...")
    fmt_res = subprocess.run(
        get_ruff_cmd() + ["check", "."], cwd=scripts_dir, check=False
    )
    if fmt_res.returncode != 0:
        print("❌ Linting checks failed. Run 'python build.py fix' to auto-fix.")
        sys.exit(1)

    print("\n[2/3] Auditing package recipes health...")
    run_health_check(packages_dir)

    print("\n[3/3] Running Pytest test suite...")
    test_res = subprocess.run(
        ["uv", "run", "pytest", "tests/"], cwd=scripts_dir, check=False
    )
    if test_res.returncode != 0:
        print("❌ Test suite failed.")
        sys.exit(1)

    print("\n✨ All checks passed cleanly!")


def main() -> None:
    parser = argparse.ArgumentParser(description="RepoExe Orchestrator CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List all available package recipes")
    subparsers.add_parser("fix", help="Auto-format and fix linting issues")
    subparsers.add_parser(
        "check", help="Run full code linting, health check, and unit tests"
    )

    inspect_parser = subparsers.add_parser(
        "inspect", help="Inspect a parsed package schema"
    )
    inspect_parser.add_argument("package", help="Name of the package directory")
    inspect_parser.add_argument(
        "--channel", default="latest", help="Channel to inspect"
    )

    subparsers.add_parser("health", help="Run repository health audit")

    build_parser = subparsers.add_parser(
        "build", help="Build or simulate building a package"
    )
    build_parser.add_argument("package", help="Name of the package directory")
    build_parser.add_argument(
        "--channel", default="latest", help="Channel to build (e.g. latest, v1)"
    )
    build_parser.add_argument(
        "--dry-run", action="store_true", help="Simulate build without compiling"
    )

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
        simulate_build(
            packages_dir, args.package, channel=args.channel, dry_run=args.dry_run
        )


if __name__ == "__main__":
    main()
