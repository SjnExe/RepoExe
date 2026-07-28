import json
import tarfile
from pathlib import Path

from core.parser import PackageRecipe


def build_npm(recipe: PackageRecipe, destdir: str, output_dir: str) -> Path:
    """Builds a standard npm package tarball (.tgz) from staging."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    stage_dir = Path(destdir) / "stage"
    npm_pkg_dir = Path(destdir) / "npm_package" / "package"
    npm_pkg_dir.mkdir(parents=True, exist_ok=True)

    pkg_json = {
        "name": recipe.name,
        "version": recipe.version,
        "description": recipe.description,
        "license": recipe.license,
        "bin": {recipe.name: f"bin/{recipe.name}"},
    }
    (npm_pkg_dir / "package.json").write_text(
        json.dumps(pkg_json, indent=2), encoding="utf-8"
    )

    bin_dir = npm_pkg_dir / "bin"
    bin_dir.mkdir(parents=True, exist_ok=True)

    # Copy binary from stage if available
    stage_bin = (
        stage_dir
        / "data"
        / "data"
        / "com.termux"
        / "files"
        / "usr"
        / "bin"
        / recipe.name
    )
    if stage_bin.exists():
        import shutil

        shutil.copy2(stage_bin, bin_dir / recipe.name)

    tgz_path = out_path / f"{recipe.name}-{recipe.version}.tgz"
    with tarfile.open(tgz_path, "w:gz") as tar:
        tar.add(npm_pkg_dir.parent, arcname="")

    return tgz_path
