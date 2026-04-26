from core.test import ProotTestRunner
import subprocess
from unittest.mock import patch


def test_test_runner_success() -> None:
    runner = ProotTestRunner()

    with patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(args=[], returncode=0, stdout="Success")

        result = runner.execute_test("dummy", "echo 'Hello World'")
        assert result is True
        assert mock_run.call_count == 1


def test_test_runner_flaky() -> None:
    runner = ProotTestRunner()

    with patch("subprocess.run") as mock_run:
        # First call fails, second succeeds
        mock_run.side_effect = [
            subprocess.CalledProcessError(1, [], "Fail"),
            subprocess.CompletedProcess(args=[], returncode=0, stdout="Success"),
        ]

        result = runner.execute_test("dummy", "echo 'Hello World'")
        assert result is True
        assert mock_run.call_count == 2


def test_test_runner_failure() -> None:
    runner = ProotTestRunner()

    with patch("subprocess.run") as mock_run:
        mock_run.side_effect = subprocess.CalledProcessError(1, [], "Fail")

        result = runner.execute_test("dummy", "echo 'Hello World'", max_retries=2)
        assert result is False
        assert mock_run.call_count == 2
