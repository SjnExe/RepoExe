import subprocess
from pathlib import Path

from scripts.utils.parser import PackageRecipe


def build_alpine(
    recipe: PackageRecipe,
    destdir: str,
    output_dir: str,
    target_arch: str = "aarch64",
) -> Path:
    stage_dir = Path(destdir) / "stage"
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    arch_map = {"aarch64": "aarch64", "x86_64": "x86_64", "arm": "armhf"}
    pkg_arch = arch_map.get(recipe.architecture or target_arch, "aarch64")
    version_str = (
        f"{recipe.version}-r{recipe.revision}"
        if recipe.revision > 0
        else f"{recipe.version}-r0"
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

    filename = f"{recipe.name}-{version_str}.apk"
    apk_path = out_path / filename

    subprocess.run(
        ["tar", "--exclude=DEBIAN", "-czf", str(apk_path), "-C", str(stage_dir), "."],
        check=True,
        capture_output=True,
        text=True,
    )
    return apk_path
