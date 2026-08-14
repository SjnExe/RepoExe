import re
import subprocess
from pathlib import Path

GLIBC_LIBS = {"libc.so.6", "libpthread.so.0", "librt.so.1", "libdl.so.2", "libm.so.6"}


def lint_elf_file(elf_path: Path) -> list[str]:
    """Audits an ELF binary for glibc leakage, 16KB page alignment, and dynamic linker paths."""
    errors = []

    # Read headers via readelf
    res = subprocess.run(
        ["readelf", "-l", "-d", str(elf_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        return []  # Not a valid ELF or readelf failed

    output = res.stdout

    # Check 1: glibc Shared Library Dependency Leakage
    for line in output.splitlines():
        if "(NEEDED)" in line:
            for glibc_lib in GLIBC_LIBS:
                if f"[{glibc_lib}]" in line:
                    errors.append(f"Contains glibc dependency: {glibc_lib}")

    # Check 2: Invalid glibc ELF Interpreter Path
    if "/lib/ld-linux" in output or "/lib64/ld-linux" in output:
        errors.append(
            "Uses glibc dynamic interpreter (ld-linux) instead of Android Bionic linker"
        )

    # Check 3: 16KB Page Size Alignment (Android 15+ Requirement)
    for line in output.splitlines():
        if "LOAD" in line and "Align" in line:
            match = re.search(r"Align\s+(0x[0-9a-fA-F]+)", line)
            if match:
                align_val = int(match.group(1), 16)
                if align_val < 0x4000:
                    errors.append(
                        f"Segment alignment {hex(align_val)} is less than 16KB (0x4000)"
                    )
                    break

    return errors


def audit_directory_elfs(target_dir: Path) -> list[str]:
    all_errors = []
    for file_path in target_dir.rglob("*"):
        if file_path.is_file() and not file_path.is_symlink():
            try:
                with open(file_path, "rb") as f:
                    magic = f.read(4)
                if magic == b"\x7fELF":
                    errs = lint_elf_file(file_path)
                    if errs:
                        all_errors.append(f"{file_path.name}: " + ", ".join(errs))
            except Exception:
                pass
    return all_errors
