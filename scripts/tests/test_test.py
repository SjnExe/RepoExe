import pytest
from unittest.mock import patch, MagicMock
from core.test import execute_test
import subprocess


def test_execute_test_proot_missing():
    with patch("subprocess.run") as mock_run:
        mock_run.side_effect = FileNotFoundError()
        with pytest.raises(SystemExit) as e:
            execute_test("testpkg", "echo 1")
        assert e.value.code == 1


def test_execute_test_success():
    with patch("subprocess.run") as mock_run:
        execute_test("testpkg", "echo 1")
        assert mock_run.call_count == 2  # 1 for version, 1 for actual test run


def test_execute_test_failure():
    with patch("subprocess.run") as mock_run:
        # First call succeeds (version), then 3 fails for max_retries
        mock_run.side_effect = [
            MagicMock(),
            subprocess.CalledProcessError(1, []),
            subprocess.CalledProcessError(1, []),
            subprocess.CalledProcessError(1, []),
        ]
        with patch("time.sleep"):
            with pytest.raises(SystemExit) as e:
                execute_test("testpkg", "exit 1", max_retries=3, retry_delay=0)
            assert e.value.code == 1
        assert mock_run.call_count == 4


def test_execute_test_flaky_success():
    with patch("subprocess.run") as mock_run:
        # First call succeeds (version), 1 fail, then success
        mock_run.side_effect = [MagicMock(), subprocess.CalledProcessError(1, []), MagicMock()]
        with patch("time.sleep"):
            execute_test("testpkg", "echo 1", max_retries=3, retry_delay=0)
        assert mock_run.call_count == 3
