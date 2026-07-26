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


import os

from core.properties import SystemProperties


def setup_build_environment(
    build_system: str, target_arch: str = "aarch64"
) -> dict[str, str]:
    """Configures environment variables for Go, Rust (Cargo), and C/C++ cross-compilation."""
    props = SystemProperties()
    env = os.environ.copy()
    env.update(props.get_env_vars())

    if build_system == "go":
        env.update(
            {
                "GOOS": "android",
                "GOARCH": "arm64"
                if target_arch in ["aarch64", "arm64"]
                else target_arch,
                "CGO_ENABLED": "0",
            }
        )
    elif build_system == "cargo":
        target_triple = (
            "aarch64-unknown-linux-musl" if target_arch == "aarch64" else target_arch
        )
        env.update(
            {
                "CARGO_BUILD_TARGET": target_triple,
            }
        )

    return env
