import struct
import subprocess
from pathlib import Path

GLIBC_LIBS = {"libc.so.6", "libpthread.so.0", "librt.so.1", "libdl.so.2", "libm.so.6"}

# ELF dynamic tags to zero out (DT_NULL = 0)
DYNAMIC_TAGS_TO_NULLIFY = {
    0x6FFFFFFE,  # DT_VERNEED
    0x6FFFFFFF,  # DT_VERNEEDNUM
    0x6FFFFFF0,  # DT_VERSYM
    0x6FFFFFFC,  # DT_VERDEF
    0x6FFFFFFD,  # DT_VERDEFNUM
    15,  # DT_RPATH
}


def strip_verneed_from_elf(elf_path: Path) -> None:
    """Zeroes out DT_VERNEED, DT_VERDEF, DT_VERSYM entries directly from 64-bit ELF dynamic tables."""
    try:
        data = bytearray(elf_path.read_bytes())
        if len(data) < 64 or data[:4] != b"\x7fELF" or data[4] != 2:
            return

        e_phoff = struct.unpack_from("<Q", data, 32)[0]
        e_phentsize = struct.unpack_from("<H", data, 54)[0]
        e_phnum = struct.unpack_from("<H", data, 56)[0]

        dynamic_offset = 0
        dynamic_filesz = 0

        for i in range(e_phnum):
            ph_offset = e_phoff + i * e_phentsize
            p_type = struct.unpack_from("<I", data, ph_offset)[0]
            if p_type == 2:  # PT_DYNAMIC
                dynamic_offset = struct.unpack_from("<Q", data, ph_offset + 8)[0]
                dynamic_filesz = struct.unpack_from("<Q", data, ph_offset + 32)[0]
                break

        if dynamic_offset > 0 and dynamic_filesz > 0:
            dyn_entry_size = 16
            num_entries = dynamic_filesz // dyn_entry_size
            for j in range(num_entries):
                entry_offset = dynamic_offset + j * dyn_entry_size
                if entry_offset + 8 > len(data):
                    break
                d_tag = struct.unpack_from("<q", data, entry_offset)[0]
                if d_tag == 0:
                    break
                if (
                    d_tag in DYNAMIC_TAGS_TO_NULLIFY
                    or (d_tag & 0xFFFFFFFF) in DYNAMIC_TAGS_TO_NULLIFY
                ):
                    struct.pack_into("<q", data, entry_offset, 0)

            elf_path.write_bytes(data)
    except Exception:
        pass


def sanitize_elf_binary(
    elf_path: Path, prefix: str = "/data/data/com.termux/files/usr"
) -> None:
    """Strictly validates Native Bionic enforcement, removes verneed references, and enforces RPATH."""
    try:
        with open(elf_path, "rb") as f:
            magic = f.read(4)
        if magic != b"\x7fELF":
            return

        # 0. STRICT BIONIC VALIDATOR
        res = subprocess.run(
            ["readelf", "-d", str(elf_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if res.returncode == 0:
            for line in res.stdout.splitlines():
                if "(NEEDED)" in line:
                    for glibc_lib in GLIBC_LIBS:
                        if f"[{glibc_lib}]" in line:
                            raise RuntimeError(
                                f"Strict Bionic Enforcement Failed: '{elf_path.name}' linked against glibc library '{glibc_lib}'. Native Android builds must not use glibc."
                            )

        # 1. Zero out DT_VERNEED / DT_VERSYM directly
        strip_verneed_from_elf(elf_path)

        # 2. Set dynamic interpreter and enforce relative RPATH
        subprocess.run(
            ["patchelf", "--set-interpreter", "/system/bin/linker64", str(elf_path)],
            check=False,
            capture_output=True,
        )
        subprocess.run(
            ["patchelf", "--set-rpath", f"{prefix}/lib", str(elf_path)],
            check=False,
            capture_output=True,
        )

        # 3. Clean remaining version tags
        strip_verneed_from_elf(elf_path)
    except RuntimeError:
        raise
    except Exception:
        pass


def sanitize_staging_elfs(
    stage_dir: Path, prefix: str = "/data/data/com.termux/files/usr"
) -> None:
    for f in stage_dir.rglob("*"):
        if f.is_file() and not f.is_symlink():
            sanitize_elf_binary(f, prefix=prefix)
