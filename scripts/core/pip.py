import os, shutil
from pathlib import Path

def generate_pip_index(output_dir: str):
    pip_dir = Path(output_dir) / "pip"
    pip_dir.mkdir(parents=True, exist_ok=True)

    whl_files = list(Path(output_dir).glob("**/*.whl"))
    packages = {}
    for whl in whl_files:
        name = whl.name.split("-")[0].lower().replace("_", "-")
        packages.setdefault(name, []).append(whl)

    root_links = "".join([f'<li><a href="{pkg}/">{pkg}</a></li>' for pkg in sorted(packages.keys())])
    root_html = f"<!DOCTYPE html><html><head><title>Simple Index</title></head><body>{root_links}</body></html>"
    (pip_dir / "index.html").write_text(root_html, encoding="utf-8")

    for pkg, files in packages.items():
        pkg_dir = pip_dir / pkg
        pkg_dir.mkdir(parents=True, exist_ok=True)
        links = ""
        for f in files:
            dest = pkg_dir / f.name
            if f != dest:
                shutil.copy2(f, dest)
            links += f'<li><a href="{f.name}">{f.name}</a></li>'
        (pkg_dir / "index.html").write_text(f"<!DOCTYPE html><html><body>{links}</body></html>", encoding="utf-8")
