import json
import shutil
import tarfile
from pathlib import Path

from core.parser import PackageRecipe


def build_npm(recipe: PackageRecipe, destdir: str, output_dir: str) -> Path:
    """Builds a standard npm package tarball (.tgz) ensuring executable bit (0o755) permissions."""
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

    stage_bin = next(
        (f for f in stage_dir.rglob(recipe.name) if f.is_file() and "DEBIAN" not in f.parts and f.name == recipe.name),
        None,
    )
    if stage_bin and stage_bin.exists():
        bin_target = bin_dir / recipe.name
        shutil.copy2(stage_bin, bin_target)
        bin_target.chmod(0o755)

    tgz_path = out_path / f"{recipe.name}-{recipe.version}.tgz"

    def set_exec_perms(tarinfo: tarfile.TarInfo) -> tarfile.TarInfo:
        if "bin/" in tarinfo.name:
            tarinfo.mode = 0o755
        return tarinfo

    with tarfile.open(tgz_path, "w:gz") as tar:
        tar.add(npm_pkg_dir, arcname="package", filter=set_exec_perms)

    return tgz_path


def generate_npm_index(output_dir: str | Path) -> None:
    """Generates standard NPM registry package manifests routing to Cloudflare Worker."""
    base_dir = Path(output_dir)
    npm_dir = base_dir / "npm"
    npm_dir.mkdir(parents=True, exist_ok=True)

    tgz_files = list(base_dir.rglob("*.tgz"))
    packages: dict[str, list[Path]] = {}

    for tgz in tgz_files:
        parts = tgz.name.replace(".tgz", "").split("-")
        ver_idx = len(parts) - 1
        for i, p in enumerate(parts):
            if p and p[0].isdigit():
                ver_idx = i
                break
        
        name = "-".join(parts[:ver_idx]) if ver_idx > 0 else parts[0]
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

            filename = tgz_path.name.replace(".tgz", "")
            ver = filename[len(pkg_name)+1:] if filename.startswith(f"{pkg_name}-") else "1.0.0"
            latest_ver = ver

            versions_manifest[ver] = {
                "name": pkg_name,
                "version": ver,
                "dist": {
                    "tarball": f"https://repoexe-npm-proxy.sjn.workers.dev/{pkg_name}/{tgz_path.name}"
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
