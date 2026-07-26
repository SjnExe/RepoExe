import os
import tempfile

from core.properties import PREFIX
from core.toolchains.native import NativeToolchain, generate_cmake_toolchain


def test_generate_cmake_toolchain():
    with tempfile.TemporaryDirectory() as td:
        output_file = os.path.join(td, "android.toolchain.cmake")
        generate_cmake_toolchain("aarch64", "/opt/android-ndk", output_file)
        assert os.path.exists(output_file)
        with open(output_file, "r") as f:
            content = f.read()
            assert "CMAKE_SYSTEM_NAME Android" in content
            assert "CMAKE_ANDROID_ARCH_ABI arm64-v8a" in content
            assert f"CMAKE_INSTALL_PREFIX {PREFIX}" in content
            assert "ninja" in content


def test_native_toolchain_env():
    toolchain = NativeToolchain("aarch64")
    env = toolchain.get_env()
    assert "aarch64-linux-android24-clang" in env["CC"]
    assert "flang" in env["FC"]
    assert f"-I{PREFIX}/include" in env["CFLAGS"]


def test_native_toolchain_multilib():
    toolchain = NativeToolchain("aarch64", build_multilib=True)
    assert toolchain.target_arch == "arm"
    env = toolchain.get_env()
    assert "armv7a-linux-androideabi24-clang" in env["CC"]


def test_native_toolchain_cmake_args():
    toolchain = NativeToolchain("x86_64")
    with tempfile.TemporaryDirectory() as td:
        args = toolchain.get_cmake_args(td)
        assert any("-GNinja" in arg for arg in args)
        assert any(f"-DCMAKE_INSTALL_PREFIX={PREFIX}" in arg for arg in args)
        assert os.path.exists(os.path.join(td, "android.toolchain.cmake"))
