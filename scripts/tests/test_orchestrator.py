from pathlib import Path

from core.dag import DependencyGraph
from core.debian import generate_control_file
from core.health import audit_repository_health
from core.parser import parse_recipe
from core.prune import identify_outdated_assets

REPO_ROOT = Path(__file__).resolve().parents[2]


def test_parser_tsc():
    recipe = parse_recipe(REPO_ROOT / Path("pkg/tsc/build.yml"))
    assert recipe.name == "tsc"
    assert recipe.version == "7.0.2"
    assert recipe.build_system == "go"
    assert recipe.architecture == "aarch64"


def test_parser_jscpd():
    recipe = parse_recipe(REPO_ROOT / Path("pkg/jscpd/build.yml"))
    assert recipe.name == "jscpd"
    assert recipe.version == "5.0.14"
    assert recipe.build_system == "cargo"


def test_debian_control_generation():
    recipe = parse_recipe(REPO_ROOT / Path("pkg/tsc/build.yml"))
    control = generate_control_file(recipe)
    assert "Package: tsc" in control
    assert "Version: 7.0.2" in control
    assert "Architecture: aarch64" in control
    assert "Maintainer: SjnExe" in control


def test_dag_resolution():
    dag = DependencyGraph(REPO_ROOT / Path("pkg"))
    order = dag.resolve_build_order()
    assert "tsc" in order
    assert "jscpd" in order


def test_prune_assets():
    mock_assets = [
        {"id": 1, "name": "tsc_0.0.9_aarch64.deb"},
        {"id": 2, "name": "tsc_0.1.0_aarch64.deb"},
    ]
    outdated = identify_outdated_assets(
        mock_assets, target_version="0.1.0", pkg_name="tsc"
    )
    assert len(outdated) == 1
    assert outdated[0]["name"] == "tsc_0.0.9_aarch64.deb"


def test_health_audit():
    report = audit_repository_health(REPO_ROOT / Path("pkg"))
    assert report["total_packages"] == 7
    assert report["valid_packages"] == 7
    assert len(report["invalid_packages"]) == 0
