import json
import shutil
import subprocess
from pathlib import Path

from builders.debian import generate_apt_metadata, generate_release_file
from builders.npm import generate_npm_index
from builders.pip import generate_pip_index
from utils.metadata import generate_packages_json


def get_exact_package_artifacts(art_path: Path, pkg_name: str) -> list[Path]:
    """Finds exact artifact files belonging strictly to pkg_name to prevent cross-package asset leakage."""
    matching = []
    clean_pkg = pkg_name.replace("-", "_")

    for f in art_path.rglob("*"):
        if not f.is_file():
            continue
        name = f.name

        # 1. Metadata file
        if (
            name == f"{pkg_name}_metadata.json"
            or name.startswith(f"{pkg_name}_")
            and name.endswith(".deb")
            or name.startswith(f"{pkg_name}-")
            and (".pkg.tar.zst" in name or ".pkg.tar.gz" in name)
            or name.startswith(f"{pkg_name}-")
            and name.endswith(".apk")
            or name.startswith(f"{pkg_name}-")
            and name.endswith(".tgz")
            or name.startswith(f"{clean_pkg}-")
            and name.endswith(".whl")
        ):
            matching.append(f)

    return sorted(set(matching))


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

    npm_staging = Path("npm_staging")
    npm_staging.mkdir(parents=True, exist_ok=True)

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
                shutil.copy2(f, npm_staging / f.name)

    # 2. Generate APT Metadata and Release File
    deb_files = list(apt_staging.glob("*.deb"))
    arches = set()
    for f in deb_files:
        arch = f.name.split("_")[-1].replace(".deb", "")
        if arch != "all":
            arches.add(arch)
            if arch == "arm64":
                arches.add("aarch64")
            elif arch == "aarch64":
                arches.add("arm64")

    if not arches:
        arches.update(["arm64", "aarch64"])

    for arch in arches:
        generate_apt_metadata(str(apt_staging), component="main", arch=arch)

    generate_release_file(str(apt_staging), suite="stable", component="main")

    if (apt_staging / "dists").exists():
        shutil.copytree(
            apt_staging / "dists", s_path / "apt" / "dists", dirs_exist_ok=True
        )

    # 3. Generate Pip, NPM, & packages.json Store Manifests
    generate_pip_index(s_path)

    if npm_staging.exists():
        pkg_recipes_dir = Path(__file__).resolve().parents[2] / "pkg"
        generate_npm_index(str(npm_staging), pkg_dir=pkg_recipes_dir)
        if (npm_staging / "npm").exists():
            shutil.copytree(npm_staging / "npm", s_path / "npm", dirs_exist_ok=True)
        shutil.rmtree(npm_staging, ignore_errors=True)

    generate_packages_json(
        Path(__file__).resolve().parents[2] / "pkg",
        s_path / "packages.json",
        artifacts_dir=art_path,
    )

    # 4. Copy Frontend Source & Security Keyrings to site/ root
    root_dir = Path(__file__).resolve().parents[2]

    # Copy frontend static files
    site_src_dir = root_dir / "scripts" / "site"
    if site_src_dir.exists():
        shutil.copytree(site_src_dir, s_path, dirs_exist_ok=True)

    for key in ["scripts/repoexe.gpg", "scripts/repoexe.rsa.pub"]:
        src = root_dir / key
        if src.exists():
            shutil.copy2(src, s_path / src.name)

    # 5. Create / Update GitHub Release tags for built package artifacts with exact matching
    if art_path.exists() and shutil.which("gh"):
        print("⚡ Publishing release artifacts to GitHub Releases...")
        for pkg_meta_file in art_path.rglob("*_metadata.json"):
            try:
                meta = json.loads(pkg_meta_file.read_text(encoding="utf-8"))
                pkg_name = meta.get("name")
                channel = meta.get("channel", "latest")
                tag = f"{pkg_name}@{channel}"

                matching_files = get_exact_package_artifacts(art_path, pkg_name)
                if not matching_files:
                    print(f"Notice: No artifact files matched for tag {tag}")
                    continue

                upload_args = [str(f) for f in matching_files]

                subprocess.run(
                    ["gh", "release", "view", tag], capture_output=True, check=False
                )
                res = subprocess.run(
                    ["gh", "release", "create", tag]
                    + upload_args
                    + [
                        "--title",
                        tag,
                        "--notes",
                        f"Automated release for {tag}",
                    ],
                    capture_output=True,
                    text=True,
                    check=False,
                )
                if res.returncode == 0:
                    print(f"✓ Successfully published GitHub release tag: {tag}")
                else:
                    res_up = subprocess.run(
                        ["gh", "release", "upload", tag] + upload_args + ["--clobber"],
                        capture_output=True,
                        text=True,
                        check=False,
                    )
                    if res_up.returncode == 0:
                        print(f"✓ Uploaded release assets to existing tag: {tag}")
                    else:
                        print(
                            f"::warning:: Failed to upload release assets for {tag}: {res_up.stderr.strip()}"
                        )
            except Exception as e:
                print(
                    f"::warning:: Failed publishing release tag for {pkg_meta_file.name}: {e}"
                )

    (s_path / ".nojekyll").touch()
    print(f"✓ Complete RepoExe site environment successfully generated at {s_path}")


if __name__ == "__main__":
    prepare_site()
