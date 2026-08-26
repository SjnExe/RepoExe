import contextlib
import json
import shutil
import tarfile
from pathlib import Path

from utils.parser import PackageRecipe


def build_npm(recipe: PackageRecipe, destdir: str, output_dir: str) -> Path:
    """Builds a standard npm package tarball (.tgz) ensuring executable bit (0o755) permissions."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    stage_dir = Path(destdir) / "stage"
    npm_pkg_dir = Path(destdir) / "npm_package" / "package"
    npm_pkg_dir.mkdir(parents=True, exist_ok=True)

    # Construct revisioned NPM version (e.g., 5.0.14-repoexe.1)
    # Note: NPM semver handles pre-release tags well, but adding +build isn't universally supported in all clients.
    npm_version = recipe.version
    if recipe.revision > 0:
        npm_version = f"{recipe.version}-repoexe.{recipe.revision}"

    npm_name = recipe.vars.get("npm_name", recipe.name) if recipe.vars else recipe.name
    npm_bin_dir_name = recipe.vars.get("npm_bin_dir", "bin") if recipe.vars else "bin"

    pkg_json = {
        "name": npm_name,
        "version": npm_version,
        "description": recipe.description,
        "license": recipe.license,
        "bin": {recipe.name: f"{npm_bin_dir_name}/{recipe.name}"},
    }
    (npm_pkg_dir / "package.json").write_text(
        json.dumps(pkg_json, indent=2), encoding="utf-8"
    )

    bin_dir = npm_pkg_dir / npm_bin_dir_name
    bin_dir.mkdir(parents=True, exist_ok=True)

    # Copy the entire Termux structure into the NPM package to preserve shared libraries and resources
    usr_stage_dir = stage_dir / "data" / "data" / "com.termux" / "files" / "usr"
    if usr_stage_dir.exists():
        shutil.copytree(usr_stage_dir, npm_pkg_dir / "usr", dirs_exist_ok=True)
    else:
        # Fallback if it's a flat build structure without full Termux prefix
        for item in stage_dir.iterdir():
            if item.is_dir() and item.name not in (
                "DEBIAN",
                "npm_package",
                "wheel_build",
            ):
                shutil.copytree(
                    item, npm_pkg_dir / "usr" / item.name, dirs_exist_ok=True
                )

    # Generate a robust bash wrapper to execute the deep-nested binary with the correct dynamic linker and library paths
    # Using dynamic relative path to account for custom bin dir
    wrapper_script = (
        "#!/data/data/com.termux/files/usr/bin/bash\n"
        "set -e\n"
        'DIR="$(dirname "$(readlink -f "$0" 2>/dev/null || realpath "$0" 2>/dev/null || echo "$0")")"\n'
        'export LD_LIBRARY_PATH="${DIR}/../usr/lib:$LD_LIBRARY_PATH"\n'
        'exec "${DIR}/../usr/bin/' + recipe.name + '" "$@"\n'
    )

    bin_target = bin_dir / recipe.name
    bin_target.write_text(wrapper_script, encoding="utf-8")
    bin_target.chmod(0o755)

    tgz_path = out_path / f"{recipe.name}-{npm_version}.tgz"

    def set_exec_perms(tarinfo: tarfile.TarInfo, path: str = "") -> tarfile.TarInfo:
        if f"{npm_bin_dir_name}/" in tarinfo.name:
            tarinfo.mode = 0o755
        return tarinfo

    with tarfile.open(tgz_path, "w:gz") as tar:
        tar.add(npm_pkg_dir, arcname="package", filter=set_exec_perms)

    return tgz_path


def generate_npm_index(output_dir: str | Path, pkg_dir: str | Path | None = None) -> None:
    """Generates standard NPM registry package manifests containing complete bin mappings."""
    base_dir = Path(output_dir)
    npm_dir = base_dir / "npm"
    npm_dir.mkdir(parents=True, exist_ok=True)

    tgz_files = list(base_dir.rglob("*.tgz"))
    packages: dict[str, list[tuple[Path, dict]]] = {}

    for tgz in tgz_files:
        inner_meta = {}
        try:
            with tarfile.open(tgz, "r:gz") as tar:
                member = tar.getmember("package/package.json")
                f = tar.extractfile(member)
                if f:
                    inner_meta = json.loads(f.read().decode("utf-8"))
        except Exception:
            pass

        # Fallback to filename parsing if inner_meta fails
        if not inner_meta:
            parts = tgz.name.replace(".tgz", "").split("-")
            ver_idx = len(parts) - 1
            for i, p in enumerate(parts):
                if p and p[0].isdigit():
                    ver_idx = i
                    break
            pkg_name = "-".join(parts[:ver_idx]) if ver_idx > 0 else parts[0]

            filename = tgz.name.replace(".tgz", "")
            filename_ver = (
                filename[len(pkg_name) + 1 :]
                if filename.startswith(f"{pkg_name}-")
                else "1.0.0"
            )
            inner_meta = {"name": pkg_name, "version": filename_ver}
        else:
            pkg_name = inner_meta.get("name", "")

        if pkg_name:
            packages.setdefault(pkg_name, []).append((tgz, inner_meta))

    for pkg_name, files_with_meta in packages.items():
        pkg_dir_target = npm_dir / pkg_name
        pkg_dir_target.mkdir(parents=True, exist_ok=True)

        versions_manifest = {}
        latest_ver = "0.0.0"

        for tgz_path, inner_meta in files_with_meta:
            dest = pkg_dir_target / tgz_path.name
            if tgz_path != dest:
                shutil.copy2(tgz_path, dest)

            ver = inner_meta.get("version", "1.0.0")
            latest_ver = ver

            if "bin" not in inner_meta:
                inner_meta["bin"] = {pkg_name: f"bin/{pkg_name}"}

            inner_meta["dist"] = {
                "tarball": f"https://repoexe-npm-proxy.sjn.workers.dev/{pkg_name}/{tgz_path.name}"
            }

            versions_manifest[ver] = inner_meta

        patched_range = None
        if pkg_dir:
            p_recipe = Path(pkg_dir) / pkg_name / "pkg.yml"
            if p_recipe.exists():
                try:
                    from core.parser import parse_recipe
                    r_obj = parse_recipe(p_recipe)
                    if getattr(r_obj, "patched_version_range", None):
                        patched_range = r_obj.patched_version_range
                except Exception as e:
                    print(f"Notice: failed to parse recipe for {pkg_name} in npm index gen: {e}")

        meta = {
            "name": pkg_name,
            "dist-tags": {"latest": latest_ver},
            "versions": versions_manifest,
        }
        if patched_range:
            meta["patched_version_range"] = patched_range

        (pkg_dir_target / "package.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
