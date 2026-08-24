import os
import re
import subprocess
from pathlib import Path

GLIBC_LIBS = {"libc.so.6", "libpthread.so.0", "librt.so.1", "libdl.so.2", "libm.so.6"}

KNOWN_GLIBC_UNRESOLVED_PATTERNS = [
    r"^__nl_langinfo_l$",
    r"^__duplocale$",
    r"^__newlocale$",
    r"^__freelocale$",
    r"^__uselocale$",
    r"^_dl_find_object$",
    r"^dl_find_object$",
    r"^__cxa_at_quick_exit$",
    r"^__cxa_thread_atexit_impl$",
    r"^__timezone$",
    r"^__daylight$",
    r"^__tzname$",
    r"^__isoc(99|23)_",
    r"^__.*_finite$",
    r"^__xstat.*$",
    r"^__fxstat.*$",
    r"^__lxstat.*$",
    r"^d?c?n?gettext$",
    r"^bind(_textdomain_codeset|textdomain)$",
    r"^textdomain$",
    r"^error(_at_line)?$",
    r"^__fpurge$",
    r"^fpurge$",
    r"^__.*_chk$",
]


def check_undefined_symbols(elf_path: Path) -> list[str]:
    """Extracts and audits all unresolved dynamic symbols in bulk via readelf."""
    res = subprocess.run(
        ["readelf", "-s", "-W", str(elf_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        return []

    unresolved_glibc = []
    for line in res.stdout.splitlines():
        parts = line.split()
        if len(parts) >= 8 and parts[6] == "UND" and parts[4] == "GLOBAL":
            sym_name = parts[7].split("@")[0]
            for pattern in KNOWN_GLIBC_UNRESOLVED_PATTERNS:
                if re.match(pattern, sym_name):
                    unresolved_glibc.append(sym_name)
                    break

    return sorted(set(unresolved_glibc))


def lint_elf_file(elf_path: Path) -> list[str]:
    """Audits an ELF binary for glibc leakage, undefined symbols, 16KB page alignment, and interpreter."""
    errors = []

    res = subprocess.run(
        ["readelf", "-l", "-d", str(elf_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if res.returncode != 0:
        return []

    output = res.stdout

    # Check 1: glibc Shared Library Dependency Leakage
    for line in output.splitlines():
        if "(NEEDED)" in line:
            for glibc_lib in GLIBC_LIBS:
                if f"[{glibc_lib}]" in line:
                    errors.append(f"Contains glibc dependency: {glibc_lib}")

    # Check 1.5: Versioned glibc symbol requirements
    for line in output.splitlines():
        if "@GLIBC_" in line:
            errors.append("Requires versioned glibc symbols (@GLIBC_*)")
            break

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

    # Check 4: Bulk Unresolved glibc Dynamic Symbol Audit
    missing_syms = check_undefined_symbols(elf_path)
    if missing_syms:
        errors.append(
            f"Contains {len(missing_syms)} unresolved glibc symbols: {', '.join(missing_syms)}"
        )

    return errors


def audit_directory_elfs(target_dir: Path) -> list[str]:
    all_errors = []
    for root, _, files in os.walk(target_dir):
        for f in files:
            file_path = Path(root) / f
            if file_path.is_file() and not file_path.is_symlink():
                try:
                    with open(file_path, "rb") as fp:
                        magic = fp.read(4)
                    if magic == b"\x7fELF":
                        errs = lint_elf_file(file_path)
                        if errs:
                            all_errors.append(f"{file_path.name}: " + ", ".join(errs))
                except Exception:
                    pass
    return all_errors
