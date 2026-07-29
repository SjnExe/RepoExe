import shutil
from pathlib import Path


def prepare_site_assets(site_dir: str | Path = "site") -> None:
    s_path = Path(site_dir)
    s_path.mkdir(parents=True, exist_ok=True)

    root_dir = Path(__file__).resolve().parents[2]
    for key in ["scripts/repoexe.gpg", "scripts/repoexe.rsa.pub"]:
        src = root_dir / key
        if src.exists():
            shutil.copy2(src, s_path / src.name)
