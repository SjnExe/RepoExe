from pathlib import Path
from core.parser import parse_recipe
from core.debian import generate_control_file
from core.dag import DependencyGraph
from core.prune import identify_outdated_assets
from core.health import audit_repository_health


def test_parser_tsc():
    recipe = parse_recipe(Path("packages/tsc/build.yml"))
    assert recipe.name == "tsc"
    assert recipe.version == "0.1.0"
    assert recipe.build_system == "go"
    assert recipe.architecture == "aarch64"


def test_parser_jscpd():
    recipe = parse_recipe(Path("packages/jscpd/build.yml"))
    assert recipe.name == "jscpd"
    assert recipe.version == "0.1.0"
    assert recipe.build_system == "cargo"


def test_debian_control_generation():
    recipe = parse_recipe(Path("packages/tsc/build.yml"))
    control = generate_control_file(recipe)
    assert "Package: tsc" in control
    assert "Version: 0.1.0" in control
    assert "Architecture: aarch64" in control
    assert "Maintainer: SjnExe" in control


def test_dag_resolution():
    dag = DependencyGraph(Path("packages"))
    order = dag.resolve_build_order()
    assert "tsc" in order
    assert "jscpd" in order


def test_prune_assets():
    mock_assets = [
        {"id": 1, "name": "tsc_0.0.9_aarch64.deb"},
        {"id": 2, "name": "tsc_0.1.0_aarch64.deb"},
    ]
    outdated = identify_outdated_assets(mock_assets, target_version="0.1.0")
    assert len(outdated) == 1
    assert outdated[0]["name"] == "tsc_0.0.9_aarch64.deb"


def test_health_audit():
    report = audit_repository_health(Path("packages"))
    assert report["total_packages"] == 3
    assert report["valid_packages"] == 3
    assert len(report["invalid_packages"]) == 0
