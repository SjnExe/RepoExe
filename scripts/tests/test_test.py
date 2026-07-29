import subprocess
from unittest.mock import patch

import pytest
from core.test import ProotTestRunner


def test_test_runner_success() -> None:
    runner = ProotTestRunner()
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=0, stdout="Success", stderr=""
        )
        result = runner.execute_test("dummy", "echo 'Hello World'")
        assert result is True
        assert mock_run.call_count == 1


def test_test_runner_failure() -> None:
    runner = ProotTestRunner()
    with patch("subprocess.run") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess(
            args=[], returncode=1, stdout="", stderr="Command failed"
        )
        with pytest.raises(RuntimeError) as exc_info:
            runner.execute_test("dummy", "exit 1")
        assert "Smoke test failed for dummy" in str(exc_info.value)
        assert mock_run.call_count == 1
