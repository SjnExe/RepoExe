import concurrent.futures
import gzip
import hashlib
import os
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

from core.parser import PackageRecipe

ARCH_MAP = {
    "aarch64": "aarch64",
    "x86_64": "x86_64",
    "arm": "arm",
    "i686": "i686",
}


def generate_control_file(recipe: PackageRecipe) -> str:
    """Generates standard Debian control file content from a PackageRecipe."""
    version_str = (
        f"{recipe.version}-{recipe.revision}" if recipe.revision > 0 else recipe.version
    )
    deb_arch = ARCH_MAP.get(recipe.architecture, recipe.architecture)

    control_lines = [
        f"Package: {recipe.name}",
        f"Version: {version_str}",
        f"Architecture: {deb_arch}",
        f"Maintainer: {recipe.maintainer or 'SjnExe'}",
        f"Description: {recipe.description or 'RepoExe package'}",
    ]

    if recipe.homepage:
        control_lines.append(f"Homepage: {recipe.homepage}")

    return "\n".join(control_lines) + "\n"


def prepare_debian_dir(
    recipe: PackageRecipe, build_dir: Path, pkg_src_dir: Path | None = None
) -> Path:
    """Prepares DEBIAN staging folder, copies payload files, and writes control file."""
    stage_dir = build_dir / "stage"
    debian_dir = stage_dir / "DEBIAN"
    debian_dir.mkdir(parents=True, exist_ok=True)
    debian_dir.chmod(0o755)

    control_content = generate_control_file(recipe)
    control_file = debian_dir / "control"
    control_file.write_text(control_content, encoding="utf-8")
    control_file.chmod(0o644)

    if pkg_src_dir and pkg_src_dir.exists():
        for item in pkg_src_dir.iterdir():
            if item.name in ("build.yml", "build.sh", "subpackages"):
                continue
            target = stage_dir / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)

    return stage_dir


def build_deb(
    recipe: PackageRecipe,
    destdir: str,
    output_dir: str,
    target_arch: str = "aarch64",
    pkg_src_dir: Path | None = None,
) -> Path:
    """Builds a .deb package from staging/recipe using fast zstd compression."""
    build_path = Path(destdir)
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    stage_dir = prepare_debian_dir(recipe, build_path, pkg_src_dir=pkg_src_dir)

    version_str = (
        f"{recipe.version}-{recipe.revision}" if recipe.revision > 0 else recipe.version
    )
    raw_arch = recipe.architecture or target_arch
    arch = ARCH_MAP.get(raw_arch, raw_arch)
    deb_filename = f"{recipe.name}_{version_str}_{arch}.deb"
    deb_path = out_path / deb_filename

    cmd = ["dpkg-deb", "--build", "-Zzstd", "-z1", str(stage_dir), str(deb_path)]
    res = subprocess.run(cmd, capture_output=True, text=True, check=False)
    if res.returncode != 0:
        print(
            f"Notice: dpkg-deb zstd build failed ({res.stderr.strip()}), retrying standard build..."
        )
        cmd = ["dpkg-deb", "--build", str(stage_dir), str(deb_path)]
        res2 = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if res2.returncode != 0:
            raise RuntimeError(
                f"dpkg-deb failed for {recipe.name}: {res2.stderr.strip()}"
            )

    return deb_path


def _process_single_deb(deb_file: Path) -> str | None:
    """Worker function to extract control metadata and hash a .deb package in parallel."""
    try:
        res = subprocess.run(
            ["dpkg-deb", "-f", str(deb_file)],
            capture_output=True,
            text=True,
            check=True,
        )
        control_info = res.stdout.strip()

        content = deb_file.read_bytes()
        size = len(content)
        md5 = hashlib.md5(content).hexdigest()
        sha256 = hashlib.sha256(content).hexdigest()

        return (
            f"{control_info}\nFilename: {deb_file.name}\nSize: {size}\n"
            f"MD5sum: {md5}\nSHA256: {sha256}\n\n"
        )
    except (subprocess.CalledProcessError, OSError):
        return None


def generate_apt_metadata(
    output_dir: str, component: str = "main", arch: str = "aarch64"
) -> None:
    """Generates APT Packages index concurrently for all deb archives in output_dir."""
    binary_dir = os.path.join(
        output_dir, "dists", "stable", component, f"binary-{arch}"
    )
    os.makedirs(binary_dir, exist_ok=True)

    packages_path = os.path.join(binary_dir, "Packages")
    deb_files = sorted(Path(output_dir).glob("*.deb"))

    packages_entries = []
    with concurrent.futures.ThreadPoolExecutor() as executor:
        results = executor.map(_process_single_deb, deb_files)
        for entry in results:
            if entry:
                packages_entries.append(entry)

    packages_content = "".join(packages_entries)
    with open(packages_path, "w", encoding="utf-8") as f:
        f.write(packages_content)

    with gzip.open(f"{packages_path}.gz", "wb") as f_gz:
        f_gz.write(packages_content.encode("utf-8"))


def generate_release_file(
    output_dir: str, suite: str = "stable", component: str = "main"
) -> None:
    """Generates APT Release, InRelease, and Release.gpg metadata files."""
    dists_dir = os.path.join(output_dir, "dists", suite)
    os.makedirs(dists_dir, exist_ok=True)
    release_path = os.path.join(dists_dir, "Release")

    arches = set()
    file_entries = []

    for root, _, files in os.walk(dists_dir):
        for file in files:
            if file in ("Packages", "Packages.gz"):
                full_path = os.path.join(root, file)
                rel_path = os.path.relpath(full_path, dists_dir)

                for p in rel_path.split(os.sep):
                    if p.startswith("binary-"):
                        arches.add(p.replace("binary-", ""))

                data = Path(full_path).read_bytes()
                size = len(data)
                sha256 = hashlib.sha256(data).hexdigest()
                file_entries.append(f" {sha256} {size} {rel_path}")

    arch_str = " ".join(sorted(arches)) or "aarch64"

    release_content = (
        f"Origin: RepoExe\n"
        f"Date: {datetime.now(timezone.utc).strftime('%a, %d %b %Y %H:%M:%S UTC')}\n"
        f"Label: RepoExe\n"
        f"Suite: {suite}\n"
        f"Codename: {suite}\n"
        f"Architectures: {arch_str}\n"
        f"Components: {component}\n"
        f"Description: RepoExe Package Repository\n"
        f"SHA256:\n" + "\n".join(file_entries) + "\n"
    )

    with open(release_path, "w", encoding="utf-8") as f:
        f.write(release_content)

    key_path = Path("scripts/repoexe.gpg")
    if not key_path.exists():
        key_path = Path("repoexe.gpg")

    if key_path.exists():
        subprocess.run(
            ["gpg", "--import", str(key_path)], capture_output=True, check=False
        )
        subprocess.run(
            [
                "gpg",
                "--clearsign",
                "-o",
                os.path.join(dists_dir, "InRelease"),
                release_path,
            ],
            capture_output=True,
            check=False,
        )
        subprocess.run(
            ["gpg", "-abs", "-o", os.path.join(dists_dir, "Release.gpg"), release_path],
            capture_output=True,
            check=False,
        )
