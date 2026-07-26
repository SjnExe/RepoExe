from pathlib import Path

from core.parser import PackageRecipe


def generate_control_file(recipe: PackageRecipe) -> str:
    """Generates standard Debian control file content from a PackageRecipe."""
    version_str = (
        f"{recipe.version}-{recipe.revision}" if recipe.revision > 0 else recipe.version
    )

    control_lines = [
        f"Package: {recipe.name}",
        f"Version: {version_str}",
        f"Architecture: {recipe.architecture}",
        f"Maintainer: {recipe.maintainer or 'SjnExe'}",
        f"Description: {recipe.description}",
    ]

    if recipe.homepage:
        control_lines.append(f"Homepage: {recipe.homepage}")

    return "\n".join(control_lines) + "\n"


def prepare_debian_dir(recipe: PackageRecipe, build_dir: Path) -> Path:
    """Prepares DEBIAN staging folder and writes control file."""
    stage_dir = build_dir / "stage"
    debian_dir = stage_dir / "DEBIAN"
    debian_dir.mkdir(parents=True, exist_ok=True)

    control_content = generate_control_file(recipe)
    (debian_dir / "control").write_text(control_content, encoding="utf-8")

    return stage_dir
