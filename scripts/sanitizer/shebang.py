import os
from pathlib import Path

PREFIX = "/data/data/com.termux/files/usr"
REPLACEMENTS = {
    "#!/bin/sh": f"#!{PREFIX}/bin/sh",
    "#!/bin/bash": f"#!{PREFIX}/bin/bash",
    "#!/usr/bin/env sh": f"#!{PREFIX}/bin/sh",
    "#!/usr/bin/env bash": f"#!{PREFIX}/bin/bash",
    "#!/usr/bin/env python": f"#!{PREFIX}/bin/python3",
    "#!/usr/bin/env python3": f"#!{PREFIX}/bin/python3",
    "#!/usr/bin/python": f"#!{PREFIX}/bin/python3",
    "#!/usr/bin/python3": f"#!{PREFIX}/bin/python3",
}

def sanitize_shebangs(stage_dir: Path) -> None:
    if not stage_dir or not stage_dir.exists():
        return
    for root, _, files in os.walk(stage_dir):
        for file in files:
            fpath = os.path.join(root, file)
            try:
                if os.path.islink(fpath) or os.path.getsize(fpath) > 2 * 1024 * 1024:
                    continue
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    first_line = f.readline().strip()
                for old_sb, new_sb in REPLACEMENTS.items():
                    if first_line == old_sb or first_line.startswith(f"{old_sb} "):
                        with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                            content = f.read()
                        new_content = content.replace(first_line, new_sb, 1)
                        with open(fpath, "w", encoding="utf-8") as f:
                            f.write(new_content)
                        os.chmod(fpath, 0o755)
                        break
            except Exception:
                pass
