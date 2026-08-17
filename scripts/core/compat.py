import hashlib
import os
import shutil
import subprocess
from pathlib import Path


def resolve_ndk_tool(tool_name: str) -> str:
    """Dynamically locates an NDK tool binary in the environment or NDK filesystem."""
    if tool_name in os.environ and (
        Path(os.environ[tool_name]).exists() or shutil.which(os.environ[tool_name])
    ):
        return os.environ[tool_name]

    ndk_path = Path(os.environ.get("NDK", "/opt/android-ndk"))
    if ndk_path.exists():
        matches = list(ndk_path.rglob(tool_name))
        if matches:
            return str(matches[0])

    return shutil.which(tool_name) or tool_name


def setup_bionic_compat() -> None:
    """Compiles and caches the universal Bionic & Fortify polyfill library (libcompat.a)."""
    ndk_clang = resolve_ndk_tool("aarch64-linux-android24-clang")
    ndk_ar = resolve_ndk_tool("llvm-ar")
    if ndk_ar == "llvm-ar" and not shutil.which("llvm-ar"):
        ndk_ar = resolve_ndk_tool("ar")

    repo_root = Path(__file__).resolve().parents[2]
    compat_src = repo_root / "scripts" / "compat" / "bionic_compat.c"
    stub_src = repo_root / "scripts" / "compat" / "bionic_stub.h"

    if not compat_src.exists() or not stub_src.exists():
        raise FileNotFoundError(
            "Bionic compat source files not found in scripts/compat/"
        )

    # Content-addressable cache key based on source hash
    src_data = compat_src.read_bytes() + stub_src.read_bytes()
    src_hash = hashlib.sha256(src_data).hexdigest()[:16]

    cache_dir = repo_root / ".cache" / "compat"
    cache_dir.mkdir(parents=True, exist_ok=True)

    cached_obj = cache_dir / f"compat_{src_hash}.o"
    cached_lib = cache_dir / f"libcompat_{src_hash}.a"

    if not cached_obj.exists() or not cached_lib.exists():
        print(f"⚡ Compiling universal Bionic compat library (Hash: {src_hash})...")
        res_cc = subprocess.run(
            [
                ndk_clang,
                "-fPIC",
                "-O2",
                "-Wno-error",
                "-Wno-ignored-attributes",
                "-c",
                str(compat_src),
                "-o",
                str(cached_obj),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if res_cc.returncode != 0:
            raise RuntimeError(f"Failed to compile bionic_compat.c:\n{res_cc.stderr}")

        res_ar = subprocess.run(
            [ndk_ar, "rcs", str(cached_lib), str(cached_obj)],
            capture_output=True,
            text=True,
            check=False,
        )
        if res_ar.returncode != 0:
            raise RuntimeError(f"Failed to create libcompat.a:\n{res_ar.stderr}")
        print("✓ Bionic compat library built and cached.")

    # Populate /tmp artifacts and headers for compiler invocations
    Path("/tmp").mkdir(parents=True, exist_ok=True)
    shutil.copy2(cached_obj, "/tmp/bionic_compat.o")
    shutil.copy2(cached_lib, "/tmp/libcompat.a")
    shutil.copy2(cached_lib, "/tmp/libbionic_compat.a")  # Compatibility symlink
    shutil.copy2(stub_src, "/tmp/bionic_stub.h")
