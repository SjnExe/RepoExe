import pytest
from core.parser import BuildYml
from pydantic import ValidationError


def test_valid_build_yml():
    build_yml = BuildYml(
        name='test-package',
        version='1.0.0',
        description='A test package',
        homepage='https://example.com',
        license='MIT',
    )
    assert build_yml.name == 'test-package'


def test_version_must_not_start_with_v():
    pkg = BuildYml(
        name='test-package',
        version='v1.0.0',
        description='A test package',
        homepage='https://example.com',
        license='MIT',
    )
    assert pkg.version == '1.0.0'


def test_invalid_license():
    with pytest.raises(ValidationError):
        BuildYml(
            name='test-package',
            version='1.0.0',
            description='A test package',
            homepage='https://example.com',
            license='FakeLicense',
        )


def test_github_url_archive():
    with pytest.raises(ValidationError):
        BuildYml(
            name='test-package',
            version='1.0.0',
            description='A test package',
            homepage='https://example.com',
            license='MIT',
            source=[{"url": 'https://github.com/user/repo/archive/1.0.0.tar.gz'}],
        )


def test_version_normalization():
    # Test valid parsing
    pkg = BuildYml(
        name='test',
        version='v16.0.0-r4',
        revision=2,
        description='Test desc',
        homepage='http://test.com',
        license='MIT',
    )

    assert pkg.version == '16.0.0-r4'
    assert pkg.deb_version == '16.0.0+r4-2'
    assert pkg.pacman_version == '16.0.0.r4-2'
    assert pkg.apk_version == '16.0.0_p4-r2'

    pkg2 = BuildYml(
        name='test2',
        version='1.0.0-rc1',
        revision=3,
        description='Test desc',
        homepage='http://test.com',
        license='MIT',
    )
    assert pkg2.deb_version == '1.0.0~rc1-3'
    assert pkg2.pacman_version == '1.0.0.rc1-3'
    assert pkg2.apk_version == '1.0.0_rc1-r3'
