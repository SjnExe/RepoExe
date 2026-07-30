import hashlib
import shutil
import subprocess
from pathlib import Path

from core.parser import PackageRecipe


def build_pip(recipe: PackageRecipe, destdir: str, output_dir: str) -> Path:
    """Builds a universal/Termux-compatible wheel from staged site-packages or reuses pre-built wheel."""
    out_path = Path(output_dir)
    out_path.mkdir(parents=True, exist_ok=True)

    pkg_name = recipe.name.replace("-", "_")
    existing_wheels = list(out_path.glob(f"{pkg_name}*.whl"))
    if existing_wheels:
        return existing_wheels[0]

    stage_dir = Path(destdir) / "stage"
    wheel_name = f"{pkg_name}-{recipe.version}-py3-none-any.whl"
    wheel_path = out_path / wheel_name

    wheel_build_dir = Path(destdir) / "wheel_build"
    if wheel_build_dir.exists():
        shutil.rmtree(wheel_build_dir)
    wheel_build_dir.mkdir(parents=True, exist_ok=True)

    python_staged = list(stage_dir.rglob("site-packages")) + list(stage_dir.rglob("dist-packages"))
    if python_staged:
        for p_dir in python_staged:
            for item in p_dir.iterdir():
                target = wheel_build_dir / item.name
                if item.is_dir():
                    shutil.copytree(item, target, dirs_exist_ok=True)
                else:
                    shutil.copy2(item, target)
    elif stage_dir.exists():
        for item in stage_dir.iterdir():
            if item.name in ("DEBIAN", ".PKGINFO", "npm_package", "wheel_build"):
                continue
            target = wheel_build_dir / item.name
            if item.is_dir():
                shutil.copytree(item, target, dirs_exist_ok=True)
            else:
                shutil.copy2(item, target)

    dist_info = wheel_build_dir / f"{pkg_name}-{recipe.version}.dist-info"
    dist_info.mkdir(parents=True, exist_ok=True)

    (dist_info / "METADATA").write_text(
        f"Metadata-Version: 2.1\nName: {recipe.name}\nVersion: {recipe.version}\nSummary: {recipe.description}\n",
        encoding="utf-8",
    )
    (dist_info / "WHEEL").write_text(
        "Wheel-Version: 1.0\nGenerator: repoexe-builder\nRoot-Is-Purelib: true\nTag: py3-none-any\n",
        encoding="utf-8",
    )

    subprocess.run(
        ["zip", "-q", "-r", str(wheel_path), "."],
        cwd=wheel_build_dir,
        check=True,
        capture_output=True,
    )
    return wheel_path


def generate_pip_index(output_dir: str | Path) -> None:
    """Generates a PEP 503 compliant PyPI simple repository index with SHA256 checksums."""
    base_dir = Path(output_dir)
    pip_dir = base_dir / "pip"
    pip_dir.mkdir(parents=True, exist_ok=True)

    whl_files = list(base_dir.rglob("*.whl"))
    packages: dict[str, list[Path]] = {}

    for whl in whl_files:
        raw_name = whl.name.split("-")[0].lower().replace("_", "-")
        packages.setdefault(raw_name, []).append(whl)

    root_links = []
    for pkg_name in sorted(packages.keys()):
        root_links.append(f'<li><a href="{pkg_name}/">{pkg_name}</a></li>')
        pkg_page_dir = pip_dir / pkg_name
        pkg_page_dir.mkdir(parents=True, exist_ok=True)

        pkg_links = []
        for whl_path in sorted(packages[pkg_name]):
            dest_file = pkg_page_dir / whl_path.name
            if whl_path != dest_file:
                shutil.copy2(whl_path, dest_file)

            file_bytes = dest_file.read_bytes()
            sha256_hash = hashlib.sha256(file_bytes).hexdigest()
            pkg_links.append(
                f'<li><a href="{whl_path.name}#sha256={sha256_hash}">{whl_path.name}</a></li>'
            )

        page_html = (
            "<!DOCTYPE html><html><head><title>Links for "
            + pkg_name
            + "</title></head><body><h1>Links for "
            + pkg_name
            + "</h1>"
            + "".join(pkg_links)
            + "</body></html>"
        )
        (pkg_page_dir / "index.html").write_text(page_html, encoding="utf-8")

    index_html = (
        "<!DOCTYPE html><html><head><title>Simple Index</title></head><body>"
        + "".join(root_links)
        + "</body></html>"
    )
    (pip_dir / "index.html").write_text(index_html, encoding="utf-8")
