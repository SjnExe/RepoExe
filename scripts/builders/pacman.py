import shutil
import subprocess
from pathlib import Path

from utils.parser import PackageRecipe


def build_pacman(
    recipe: PackageRecipe,
    destdir: str,
    output_dir: str,
    target_arch: str = "aarch64",
) -> Path:
    stage_dir = Path(destdir) / "stage"
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    arch_map = {
        "aarch64": "aarch64",
        "x86_64": "x86_64",
        "arm": "armv7h",
        "i686": "pentium4",
    }
    pkg_arch = arch_map.get(recipe.architecture or target_arch, "aarch64")
    version_str = (
        f"{recipe.version}-{recipe.revision}"
        if recipe.revision > 0
        else f"{recipe.version}-1"
    )

    pkginfo_lines = [
        f"pkgname = {recipe.name}",
        f"pkgver = {version_str}",
        f"pkgdesc = {recipe.description or 'RepoExe package'}",
        f"url = {recipe.homepage or 'https://github.com/SjnExe/RepoExe'}",
        f"arch = {pkg_arch}",
        f"license = {recipe.license or 'MIT'}",
    ]
    (stage_dir / ".PKGINFO").write_text(
        "\n".join(pkginfo_lines) + "\n", encoding="utf-8"
    )

    filename = f"{recipe.name}-{version_str}-{pkg_arch}.pkg.tar.zst"
    tar_path = out_path / filename

    if shutil.which("zstd"):
        res = subprocess.run(
            [
                "tar",
                "--exclude=DEBIAN",
                "--zstd",
                "-cf",
                str(tar_path),
                "-C",
                str(stage_dir),
                ".",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0 and tar_path.exists():
            return tar_path

    fallback_filename = f"{recipe.name}-{version_str}-{pkg_arch}.pkg.tar.gz"
    fallback_path = out_path / fallback_filename
    subprocess.run(
        [
            "tar",
            "--exclude=DEBIAN",
            "-czf",
            str(fallback_path),
            "-C",
            str(stage_dir),
            ".",
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return fallback_path
