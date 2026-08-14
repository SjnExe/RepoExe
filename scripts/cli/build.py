import argparse
import sys
from pathlib import Path

_scripts_dir = str(Path(__file__).resolve().parents[1])
if _scripts_dir not in sys.path:
    sys.path.insert(0, _scripts_dir)

from core.parser import parse_recipe
from core.pipeline import (
    execute_compile,
    execute_pack,
    execute_test,
)
from utils.health import audit_repository_health


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

        p_dir = pkg_path if pkg_path.is_dir() else pkg_path.parent
        recipe = parse_recipe(pkg_path, channel=args.channel)
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
