import subprocess
from pathlib import Path

from core.parser import PackageRecipe


def build_pacman(
    recipe: PackageRecipe, destdir: str, output_dir: str, target_arch: str = "aarch64"
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

    pkginfo = f"pkgname = {recipe.name}\npkgver = {version_str}\npkgdesc = {recipe.description or 'RepoExe package'}\nurl = {recipe.homepage or 'https://github.com/SjnExe/RepoExe'}\narch = {pkg_arch}\nlicense = {recipe.license or 'MIT'}\n"
    (stage_dir / ".PKGINFO").write_text(pkginfo, encoding="utf-8")

    filename = f"{recipe.name}-{version_str}-{pkg_arch}.pkg.tar.zst"
    tar_path = out_path / filename

    subprocess.run(
        ["tar", "--zstd", "-cf", str(tar_path), "-C", str(stage_dir), "."], check=True
    )
    return tar_path
