from pathlib import Path

import yaml


def test_repo_yml_exists_and_valid():
    repo_path = Path(__file__).parent.parent / "repo.yml"
    assert repo_path.exists(), "repo.yml should exist in scripts/"

    with open(repo_path, "r") as f:
        data = yaml.safe_load(f)

    assert "repositories" in data

    repos = data["repositories"]
    assert "termux-main" in repos
    assert repos["termux-main"]["format"] == "apt"
    assert "termux-pacman-main" in repos
    assert repos["termux-pacman-main"]["format"] == "pacman"
