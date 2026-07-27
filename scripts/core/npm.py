import json
import shutil
from pathlib import Path


def generate_npm_index(output_dir: str):
    npm_dir = Path(output_dir) / "npm"
    npm_dir.mkdir(parents=True, exist_ok=True)

    tgz_files = list(Path(output_dir).glob("**/*.tgz"))
    for tgz in tgz_files:
        name = tgz.name.split("-")[0]
        pkg_dir = npm_dir / name
        pkg_dir.mkdir(parents=True, exist_ok=True)
        dest = pkg_dir / tgz.name
        if tgz != dest:
            shutil.copy2(tgz, dest)
        meta = {"name": name, "versions": {}}
        (pkg_dir / "package.json").write_text(
            json.dumps(meta, indent=2), encoding="utf-8"
        )
