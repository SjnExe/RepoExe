from cli.upstream_check import extract_semver
from packaging.version import Version


def test_extract_semver_standard():
    assert extract_semver("1.2.3") == Version("1.2.3")
    assert extract_semver("v1.2.3") == Version("1.2.3")
    assert extract_semver("V1.2.3") == Version("1.2.3")


def test_extract_semver_four_components():
    assert extract_semver("3.4.0.1") == Version("3.4.0.1")
    assert extract_semver("v1.2.3.4") == Version("1.2.3.4")


def test_extract_semver_prefixes_and_suffixes():
    assert extract_semver("release-3.22.35") == Version("3.22.35")
    assert extract_semver("aisleriot-3.14.0") == Version("3.14.0")
    assert extract_semver("v2.0.0-rc1") == Version("2.0.0rc1")
