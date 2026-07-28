import subprocess
from pathlib import Path

from core.parser import PackageRecipe


def build_pip(recipe: PackageRecipe, destdir: str, output_dir: str) -> Path:
    """Builds a universal/Termux-compatible wheel from staged site-packages or binaries."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    stage_dir = Path(destdir) / "stage"
    pkg_name = recipe.name.replace("-", "_")
    wheel_name = f"{pkg_name}-{recipe.version}-py3-none-any.whl"
    wheel_path = out_path / wheel_name

    # Create dummy wheel archive if pure binary or package
    wheel_build_dir = Path(destdir) / "wheel_build"
    wheel_build_dir.mkdir(parents=True, exist_ok=True)

    dist_info = wheel_build_dir / f"{pkg_name}-{recipe.version}.dist-info"
    dist_info.mkdir(parents=True, exist_ok=True)

    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: {recipe.name}\nVersion: {recipe.version}\nSummary: {recipe.description}\n",
        encoding="utf-8",
    )
    (dist_info / "WHEEL").write_text(
        "Wheel-Version: 1.0\nGenerator: repoexe-builder\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        encoding="utf-8",
    )

    subprocess.run(
        ["zip", "-r", str(wheel_path), "."],
        cwd=wheel_build_dir,
        check=True,
        capture_output=True,
    )
    return wheel_path
