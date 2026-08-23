import re
import tempfile
from pathlib import Path

from pkg.bun.setup_bionic import patch_ninja


def test_bionic_compat_c_symbols():
    compat_p = Path("scripts/compat/bionic_compat.c")
    assert compat_p.exists(), "scripts/compat/bionic_compat.c not found"
    text = compat_p.read_text(encoding="utf-8")
    assert "WTFTimer__fire" in text
    assert "_ZSt20__throw_system_errori" in text
    assert "_ZNSt18condition_variable4waitERSt11unique_lockISt5mutexE" in text
    assert "_ZN2v85Array3New" in text
    assert "_ZSt11__once_call" in text


def test_build_zig_sysroot_unwrap():
    sample_build_zig = """
    pub fn getTranslateC(b: *std.Build, target: anytype, optimize: anytype, android_ndk_sysroot: ?[]const u8, freebsd_sysroot: ?[]const u8) *std.Build.Step.TranslateC {
        if (target.result.os.tag == .android) {
            const sysroot = android_ndk_sysroot orelse {
                std.debug.panic("translate-c for Android requires -Dandroid_ndk_sysroot", .{});
            };
            return b.addTranslateC(.{
                .root_source_file = b.path("src/bun.js/bindings/c.zig"),
                .target = target,
                .optimize = optimize,
            });
        }
    }
    const sysroot_opt = b.option([]const u8, "android_ndk_sysroot", "path to android ndk sysroot");
    """
    sysroot = "/opt/android-ndk/toolchains/llvm/prebuilt/linux-x86_64/sysroot"

    # Verify regex matches multiline panic blocks with inner .{} struct literals
    patched = re.sub(
        r"android_ndk_sysroot\s+orelse\s*\{[\s\S]*?panic\([\s\S]*?\);?[\s\S]*?\};?",
        f'android_ndk_sysroot orelse "{sysroot}";',
        sample_build_zig,
    )
    patched = patched.replace(
        'b.option([]const u8, "android_ndk_sysroot", "path to android ndk sysroot")',
        f'b.option([]const u8, "android_ndk_sysroot", "path to android ndk sysroot") orelse "{sysroot}"',
    )

    assert "std.debug.panic" not in patched
    assert f'android_ndk_sysroot orelse "{sysroot}";' in patched
    assert (
        f'b.option([]const u8, "android_ndk_sysroot", "path to android ndk sysroot") orelse "{sysroot}"'
        in patched
    )


def test_patch_ninja_substitutions(monkeypatch):
    with tempfile.TemporaryDirectory() as tmpdir:
        tmp_p = Path(tmpdir)
        sysroot_dir = (
            tmp_p / "opt/android-ndk/toolchains/llvm/prebuilt/linux-arm64/sysroot"
        )
        (sysroot_dir / "usr/include").mkdir(parents=True, exist_ok=True)
        monkeypatch.setenv("NDK", str(tmp_p / "opt/android-ndk"))

        ninja_file = tmp_p / "build.ninja"
        ninja_file.write_text(
            "build bun-zig.o: zig ... -Dtarget=aarch64-linux-gnu ... aarch64-linux-gnu.2.17 ... linux-aarch64-gnu\n",
            encoding="utf-8",
        )

        import os

        cwd = Path.cwd()
        try:
            os.chdir(tmpdir)
            patch_ninja()
            content = ninja_file.read_text(encoding="utf-8")
            assert "-Dtarget=aarch64-linux-android" in content
            assert f"-Dandroid_ndk_sysroot={sysroot_dir}" in content
            assert "aarch64-linux-gnu" not in content
            assert "linux-aarch64-gnu" not in content
        finally:
            os.chdir(cwd)
