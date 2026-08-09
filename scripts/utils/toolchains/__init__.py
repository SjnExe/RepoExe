import os

from utils.properties import HOME, PREFIX

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
    env = os.environ.copy()

    env["PREFIX"] = PREFIX
    env["TERMUX_PREFIX"] = PREFIX
    env["HOME"] = HOME
    env["TERMUX_HOME"] = HOME
    env["TMPDIR"] = f"{PREFIX}/tmp"

    cflags = f"-I{PREFIX}/include -O2 -fPIC"
    ldflags = f"-L{PREFIX}/lib -Wl,-rpath={PREFIX}/lib"

    env["CFLAGS"] = cflags
    env["CPPFLAGS"] = f"-I{PREFIX}/include"
    env["CXXFLAGS"] = cflags
    env["LDFLAGS"] = ldflags

    if build_system == "cargo":
        native_tc = NativeToolchain(target_arch)
        native_env = native_tc.get_env()
        rust_tc = RustToolchain(target_arch)
        rust_env = rust_tc.get_env(native_env)
        env.update(native_env)
        env.update(rust_env)
        env["CARGO_BUILD_TARGET"] = "aarch64-linux-android" if target_arch in ["aarch64", "arm64"] else target_arch

    return env
