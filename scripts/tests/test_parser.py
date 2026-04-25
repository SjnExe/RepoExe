import pytest
from core.parser import BuildYml, parse_build_yml
from pydantic import ValidationError

def test_valid_build_yml():
    build_yml = BuildYml(
        name="test-package",
        version="1.0.0",
        description="A test package",
        homepage="https://example.com",
        license="MIT"
    )
    assert build_yml.name == "test-package"

def test_version_must_not_start_with_v():
    with pytest.raises(ValidationError):
        BuildYml(
            name="test-package",
            version="v1.0.0",
            description="A test package",
            homepage="https://example.com",
            license="MIT"
        )

def test_invalid_license():
    with pytest.raises(ValidationError):
        BuildYml(
            name="test-package",
            version="1.0.0",
            description="A test package",
            homepage="https://example.com",
            license="FakeLicense"
        )

def test_github_url_archive():
    with pytest.raises(ValidationError):
        BuildYml(
            name="test-package",
            version="1.0.0",
            description="A test package",
            homepage="https://example.com",
            license="MIT",
            source_url="https://github.com/user/repo/archive/1.0.0.tar.gz"
        )
