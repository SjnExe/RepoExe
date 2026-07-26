import argparse
import json
import sys
from pathlib import Path
from core.parser import parse_recipe
from core.health import audit_repository_health
from core.dag import DependencyGraph
from core.toolchains import setup_build_environment


def list_packages(packages_dir: Path) -> None:
    print("Available packages:")
    for pkg_dir in sorted(packages_dir.iterdir()):
        recipe_file = pkg_dir / "build.yml"
        if pkg_dir.is_dir() and recipe_file.exists():
            try:
                recipe = parse_recipe(recipe_file)
                print(f"  • {recipe.name:<10} v{recipe.version:<8} ({recipe.build_system})")
            except Exception as e:
                print(f"  • {pkg_dir.name:<10} [INVALID: {e}]")


def inspect_package(packages_dir: Path, package_name: str) -> None:
    recipe_file = packages_dir / package_name / "build.yml"
    if not recipe_file.exists():
        print(f"Error: Package '{package_name}' not found at {recipe_file}", file=sys.stderr)
        sys.exit(1)

    recipe = parse_recipe(recipe_file)
    print(json.dumps(recipe.model_dump(), indent=2))


def run_health_check(packages_dir: Path) -> None:
    report = audit_repository_health(packages_dir)
    print("Repository Health Audit:")
    print("------------------------")
    print(f"Total Packages Found  : {report['total_packages']}")
    print(f"Valid Package Recipes : {report['valid_packages']}")
    print(f"Build System Breakdown : {json.dumps(report['build_systems'])}")
    if report["invalid_packages"]:
        print("\nInvalid Recipes:")
        for err in report["invalid_packages"]:
            print(f"  • {err['package']}: {err['error']}")


def simulate_build(packages_dir: Path, package_name: str, dry_run: bool = False) -> None:
    recipe_file = packages_dir / package_name / "build.yml"
    if not recipe_file.exists():
        print(f"Error: Package '{package_name}' not found.", file=sys.stderr)
        sys.exit(1)

    recipe = parse_recipe(recipe_file)
    env = setup_build_environment(recipe.build_system, recipe.architecture)

    print(f"[BUILD SIMULATION] Package: {recipe.name} v{recipe.version}")
    print(f"  • Target Arch : {recipe.architecture}")
    print(f"  • Build System: {recipe.build_system}")
    print(f"  • Environment : PREFIX={env.get('PREFIX')}")

    if dry_run:
        print("✓ Dry-run completed successfully. No compilation executed.")


def main() -> None:
    parser = argparse.ArgumentParser(description="RepoExe Orchestrator CLI")
    subparsers = parser.add_subparsers(dest="command", required=True)

    subparsers.add_parser("list", help="List all available package recipes")

    inspect_parser = subparsers.add_parser("inspect", help="Inspect a parsed package schema")
    inspect_parser.add_argument("package", help="Name of the package directory")

    subparsers.add_parser("health", help="Run repository health audit")

    build_parser = subparsers.add_parser("build", help="Build or simulate building a package")
    build_parser.add_argument("package", help="Name of the package directory")
    build_parser.add_argument("--dry-run", action="store_true", help="Simulate build without compiling")

    args = parser.parse_args()
    packages_dir = Path(__file__).parent.parent / "packages"

    if args.command == "list":
        list_packages(packages_dir)
    elif args.command == "inspect":
        inspect_package(packages_dir, args.package)
    elif args.command == "health":
        run_health_check(packages_dir)
    elif args.command == "build":
        simulate_build(packages_dir, args.package, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
