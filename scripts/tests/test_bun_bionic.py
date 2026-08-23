import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from pkg.bun.setup_bionic import patch_cmake


def test_bionic_compat_c_symbols():
    compat_p = Path("scripts/compat/bionic_compat.c")
    assert compat_p.exists(), "scripts/compat/bionic_compat.c not found"
    text = compat_p.read_text(encoding="utf-8")
    assert "WTFTimer__fire" in text
    assert "copy_file_range" in text
    assert "_ZSt20__throw_system_errori" in text
    assert "_ZNSt18condition_variable4waitERSt11unique_lockISt5mutexE" in text
    assert "_ZN2v85Array3New" in text
    assert "_ZSt11__once_call" in text


def test_bionic_stub_headers():
    stub_p = Path("scripts/compat/bionic_stub.h")
    assert stub_p.exists(), "scripts/compat/bionic_stub.h not found"
    text = stub_p.read_text(encoding="utf-8")
    assert "POSIX_SPAWN_RESETIDS" in text
    assert "POSIX_SPAWN_SETPGROUP" in text
    assert "posix_spawn" in text
    assert "reallocarray" in text
    assert "copy_file_range" in text


def test_cmake_options_jsc_patch(tmp_path):
    cmake_dir = tmp_path / "Source" / "cmake"
    cmake_dir.mkdir(parents=True)
    cmake_file = cmake_dir / "OptionsJSCOnly.cmake"
    cmake_file.write_text(
        "find_package(ICU REQUIRED COMPONENTS uc i18n data)\n", encoding="utf-8"
    )

    import pkg.bun.setup_bionic as sb

    orig_path = sb.Path
    try:
        sb.Path = lambda p: (
            tmp_path / str(p).removeprefix("/tmp/webkit-src/")
            if str(p).startswith("/tmp/webkit-src")
            else orig_path(p)
        )
        patch_cmake()
        content = cmake_file.read_text(encoding="utf-8")
        assert "add_library(ICU::uc UNKNOWN IMPORTED)" in content
        assert "ENABLE_BUN_JSC" in content
    finally:
        sb.Path = orig_path
