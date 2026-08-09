from utils.properties import PREFIX
from utils.toolchains.golang import GolangToolchain
from utils.toolchains.python import PythonToolchain
from utils.toolchains.rust import RustToolchain
from utils.toolchains.swift import SwiftToolchain
from utils.toolchains.zig import ZigToolchain


def test_golang_toolchain():
    tc = GolangToolchain("aarch64")
    env = tc.get_env({"CC": "myclang"})
    assert env["GOOS"] == "android"
    assert env["GOARCH"] == "arm64"
    assert env["CGO_ENABLED"] == "1"
    assert env["CC"] == "myclang"


def test_python_toolchain():
    tc = PythonToolchain("aarch64")
    env = tc.get_env()
    assert env["PYTHONDONTWRITEBYTECODE"] == "1"
    assert PREFIX in env["PYTHONPATH"]


def test_rust_toolchain():
    tc = RustToolchain("aarch64")
    env = tc.get_env({"CC": "myclang"})
    assert env["CARGO_BUILD_TARGET"] == "aarch64-unknown-linux-musl"
    assert env["CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER"] == "myclang"


def test_swift_toolchain():
    tc = SwiftToolchain("aarch64")
    args = tc.get_swift_args()
    assert "-target" in args
    assert "aarch64-unknown-linux-android" in args


def test_zig_toolchain():
    tc = ZigToolchain("aarch64")
    args = tc.get_zig_args()
    assert "-Dtarget=aarch64-linux-android" in args
