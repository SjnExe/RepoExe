import gzip
import hashlib
import os
import subprocess
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


def generate_apt_metadata(
    output_dir: str, component: str = "main", arch: str = "aarch64"
) -> None:
    """Generates APT Packages index and compressed variants for a given architecture."""
    binary_dir = os.path.join(
        output_dir, "dists", "stable", component, f"binary-{arch}"
    )
    os.makedirs(binary_dir, exist_ok=True)

    packages_path = os.path.join(binary_dir, "Packages")
    packages_entries = []

    for deb_file in sorted(Path(output_dir).glob("*.deb")):
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

            file_entry = f"{control_info}\nFilename: {deb_file.name}\nSize: {size}\nMD5sum: {md5}\nSHA256: {sha256}\n\n"
            packages_entries.append(file_entry)
        except (subprocess.CalledProcessError, OSError):
            continue

    packages_content = "".join(packages_entries)
    with open(packages_path, "w", encoding="utf-8") as f:
        f.write(packages_content)

    with gzip.open(f"{packages_path}.gz", "wb") as f_gz:
        f_gz.write(packages_content.encode("utf-8"))
