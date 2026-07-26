import os

from core.properties import HOME, PREFIX

from .golang import GolangToolchain
from .native import NativeToolchain
from .python import PythonToolchain
from .rust import RustToolchain
from .swift import SwiftToolchain
from .zig import ZigToolchain

__all__ = [
    "GolangToolchain",
    "NativeToolchain",
    "PythonToolchain",
    "RustToolchain",
    "SwiftToolchain",
    "ZigToolchain",
]


def setup_build_environment(
    build_system: str, target_arch: str = "aarch64"
) -> dict[str, str]:
    """Standardizes Android and Termux environment variables across all compilation frameworks."""
    env = os.environ.copy()

    # Core Termux Path Standardizations
    env["PREFIX"] = PREFIX
    env["TERMUX_PREFIX"] = PREFIX
    env["HOME"] = HOME
    env["TERMUX_HOME"] = HOME
    env["TMPDIR"] = f"{PREFIX}/tmp"

    # Compiler and Linker rpath flags for Termux shared libraries
    cflags = f"-I{PREFIX}/include -O2 -fPIC"
    ldflags = f"-L{PREFIX}/lib -Wl,-rpath={PREFIX}/lib"

    env["CFLAGS"] = cflags
    env["CPPFLAGS"] = f"-I{PREFIX}/include"
    env["CXXFLAGS"] = cflags
    env["LDFLAGS"] = ldflags

    # Toolchain Specific Overrides
    if build_system == "go":
        env.update(
            {
                "GOOS": "android",
                "GOARCH": "arm64"
                if target_arch in ["aarch64", "arm64"]
                else target_arch,
                "CGO_ENABLED": "0",
                "GOTOOLCHAIN": "local",
            }
        )
    elif build_system == "cargo":
        target_triple = (
            "aarch64-unknown-linux-musl" if target_arch == "aarch64" else target_arch
        )
        env.update(
            {
                "CARGO_BUILD_TARGET": target_triple,
                "RUSTFLAGS": f"-L{PREFIX}/lib",
            }
        )

    return env
