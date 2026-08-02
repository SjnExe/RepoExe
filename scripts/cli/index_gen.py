import shutil
from pathlib import Path

from builders.debian import generate_apt_metadata, generate_release_file
from builders.metadata import generate_packages_json
from builders.npm import generate_npm_index
from builders.pip import generate_pip_index


def prepare_site(
    site_dir: str | Path = "site", artifacts_dir: str | Path = "artifacts"
) -> None:
    """Builds full multi-format repository index from release artifacts supporting both arm64 and aarch64."""
    s_path = Path(site_dir)
    art_path = Path(artifacts_dir)

    for sub in ["apt", "pacman", "alpine", "pip", "npm"]:
        (s_path / sub).mkdir(parents=True, exist_ok=True)

    apt_staging = Path("apt_staging")
    apt_staging.mkdir(parents=True, exist_ok=True)

    # 1. Copy downloaded artifacts to respective format directories
    if art_path.exists():
        for f in art_path.rglob("*"):
            if not f.is_file():
                continue
            if f.name.endswith(".deb"):
                shutil.copy2(f, apt_staging / f.name)
                shutil.copy2(f, s_path / "apt" / f.name)
            elif f.name.endswith(".pkg.tar.zst") or f.name.endswith(".pkg.tar.gz"):
                shutil.copy2(f, s_path / "pacman" / f.name)
            elif f.name.endswith(".apk"):
                shutil.copy2(f, s_path / "alpine" / f.name)
            elif f.name.endswith(".whl"):
                shutil.copy2(f, s_path / "pip" / f.name)
            elif f.name.endswith(".tgz"):
                parts = f.name.replace(".tgz", "").split("-")
                ver_idx = len(parts) - 1
                for i, p in enumerate(parts):
                    if p and p[0].isdigit():
                        ver_idx = i
                        break
                pkg_name = "-".join(parts[:ver_idx]) if ver_idx > 0 else parts[0]
                pkg_npm_dir = s_path / "npm" / pkg_name
                pkg_npm_dir.mkdir(parents=True, exist_ok=True)
                shutil.copy2(f, pkg_npm_dir / f.name)

    # 2. Generate APT Metadata and Release File
    from utils.parser import parse_recipe

    deb_files = list(apt_staging.glob("*.deb"))

    # We must scan original recipes to figure out which component each deb belongs to.
    pkg_dir = Path(__file__).resolve().parents[2] / "pkg"
    components_map = {}

    for f in deb_files:
        pkg_name = f.name.split("_")[0]
        component = "main"
        recipe_path = pkg_dir / pkg_name / "build.yml"
        if recipe_path.exists():
            try:
                recipe = parse_recipe(str(recipe_path))
                component = recipe.component
            except Exception:
                pass

        arch = f.name.split("_")[-1].replace(".deb", "")

        comp_dict = components_map.setdefault(component, {"files": [], "arches": set()})
        comp_dict["files"].append(f)
        if arch != "all":
            comp_dict["arches"].add(arch)
            if arch == "arm64":
                comp_dict["arches"].add("aarch64")
            elif arch == "aarch64":
                comp_dict["arches"].add("arm64")

    if not components_map:
        components_map["main"] = {"files": [], "arches": {"arm64", "aarch64"}}

    for comp, data in components_map.items():
        arches = data["arches"]
        if not arches:
            arches.update(["arm64", "aarch64"])
        for arch in arches:
            generate_apt_metadata(str(apt_staging), deb_files=data["files"], component=comp, arch=arch)

    generate_release_file(str(apt_staging), suite="stable", components=list(components_map.keys()))

    if (apt_staging / "dists").exists():
        shutil.copytree(
            apt_staging / "dists", s_path / "apt" / "dists", dirs_exist_ok=True
        )

    # 3. Generate Pip, NPM, & packages.json Store Manifests
    generate_pip_index(s_path)
    generate_npm_index(s_path)
    generate_packages_json(
        Path(__file__).resolve().parents[2] / "pkg",
        s_path / "packages.json",
        artifacts_dir=art_path,
    )

    # 4. Copy Security Keyrings to site/ root
    root_dir = Path(__file__).resolve().parents[2]
    for key in ["scripts/repoexe.gpg", "scripts/repoexe.rsa.pub"]:
        src = root_dir / key
        if src.exists():
            shutil.copy2(src, s_path / src.name)

    (s_path / ".nojekyll").touch()
    print(f"✓ Complete RepoExe site environment successfully generated at {s_path}")


if __name__ == "__main__":
    prepare_site()
