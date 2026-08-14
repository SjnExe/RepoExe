import subprocess
from pathlib import Path
from unittest.mock import patch

import pytest
from utils.test import ProotTestRunner


def test_test_runner_success(tmp_path: Path) -> None:
    prefix = str(tmp_path / "usr")
    home = str(tmp_path / "home")
    runner = ProotTestRunner(prefix=prefix, home=home)

    with patch("shutil.which", return_value="/usr/bin/docker"), patch("subprocess.run") as mock_run:
        mock_run.side_effect = [
            subprocess.CompletedProcess(args=["docker", "info"], returncode=0, stdout="", stderr=""),
            subprocess.CompletedProcess(args=["docker", "pull"], returncode=0, stdout="", stderr=""),
            subprocess.CompletedProcess(args=["docker", "run"], returncode=0, stdout="OK", stderr=""),
        ]
        assert runner.execute_test("dummy", "echo OK") is True


def test_test_runner_failure(tmp_path: Path) -> None:
    prefix = str(tmp_path / "usr")
    home = str(tmp_path / "home")
    runner = ProotTestRunner(prefix=prefix, home=home)

    with patch("shutil.which", return_value="/usr/bin/docker"), patch("subprocess.run") as mock_run:
        mock_run.side_effect = [
            subprocess.CompletedProcess(args=["docker", "info"], returncode=0, stdout="", stderr=""),
            subprocess.CompletedProcess(args=["docker", "pull"], returncode=0, stdout="", stderr=""),
            subprocess.CompletedProcess(args=["docker", "run"], returncode=1, stdout="", stderr="Command failed"),
        ]
        with pytest.raises(RuntimeError) as exc_info:
            runner.execute_test("dummy", "exit 1")
        assert "Smoke test failed" in str(exc_info.value)
