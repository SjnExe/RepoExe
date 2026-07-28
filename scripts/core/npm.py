import json
import shutil
import tarfile
from pathlib import Path

from core.parser import PackageRecipe


def build_npm(recipe: PackageRecipe, destdir: str, output_dir: str) -> Path:
    """Builds a standard npm package tarball (.tgz) with post-install launcher support."""
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
        shutil.copy2(stage_bin, bin_dir / recipe.name)

    tgz_path = out_path / f"{recipe.name}-{recipe.version}.tgz"
    with tarfile.open(tgz_path, "w:gz") as tar:
        tar.add(npm_pkg_dir.parent, arcname="")

    return tgz_path


def generate_npm_index(output_dir: str | Path) -> None:
    """Generates standard NPM registry package manifests and handles multi-version dist-tags."""
    base_dir = Path(output_dir)
    npm_dir = base_dir / "npm"
    npm_dir.mkdir(parents=True, exist_ok=True)

    tgz_files = list(base_dir.rglob("*.tgz"))
    packages: dict[str, list[Path]] = {}

    for tgz in tgz_files:
        name = tgz.name.split("-")[0]
        packages.setdefault(name, []).append(tgz)

    for pkg_name, files in packages.items():
        pkg_dir = npm_dir / pkg_name
        pkg_dir.mkdir(parents=True, exist_ok=True)

        versions_manifest = {}
        latest_ver = "0.0.0"

        for tgz_path in files:
            dest = pkg_dir / tgz_path.name
            if tgz_path != dest:
                shutil.copy2(tgz_path, dest)

            parts = tgz_path.name.replace(".tgz", "").split("-")
            ver = parts[-1] if len(parts) > 1 else "1.0.0"
            latest_ver = ver

            versions_manifest[ver] = {
                "name": pkg_name,
                "version": ver,
                "dist": {
                    "tarball": f"https://sjnexe.github.io/RepoExe/npm/{pkg_name}/{tgz_path.name}"
                },
            }

        meta = {
            "name": pkg_name,
            "dist-tags": {"latest": latest_ver},
            "versions": versions_manifest,
        }
        (pkg_dir / "package.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
