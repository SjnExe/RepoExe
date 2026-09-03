import os
import subprocess
import tempfile
from pathlib import Path

INSTALL_SCRIPT = Path(__file__).parent.parent / "site" / "install"


def test_repoexe_cli_help_and_version():
    res = subprocess.run(
        ["sh", str(INSTALL_SCRIPT), "--version"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert res.returncode == 0
    assert "repoexe v2.0.0" in res.stdout

    res_help = subprocess.run(
        ["sh", str(INSTALL_SCRIPT), "--help"],
        capture_output=True,
        text=True,
        check=False,
    )
    assert res_help.returncode == 0
    assert "repoexe <command>" in res_help.stdout


def test_repoexe_enable_disable_multi_target():
    with tempfile.TemporaryDirectory() as tmpdir:
        home_dir = Path(tmpdir) / "home"
        prefix_dir = Path(tmpdir) / "usr"
        home_dir.mkdir()
        prefix_dir.mkdir()

        env = os.environ.copy()
        env["HOME"] = str(home_dir)
        env["PREFIX"] = str(prefix_dir)
        env["TMPDIR"] = str(tmpdir)

        # Test enable multi-target
        res_enable = subprocess.run(
            ["sh", str(INSTALL_SCRIPT), "enable", "apt"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert res_enable.returncode == 0, (
            f"stdout: {res_enable.stdout}, stderr: {res_enable.stderr}"
        )
        assert (prefix_dir / "etc" / "apt" / "sources.list.d" / "repoexe.list").exists()

        # Check status
        res_status = subprocess.run(
            ["sh", str(INSTALL_SCRIPT), "status"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert res_status.returncode == 0
        assert "APT Repository:      [ENABLED]" in res_status.stdout

        # Test disable multi-target
        res_disable = subprocess.run(
            ["sh", str(INSTALL_SCRIPT), "disable", "apt"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert res_disable.returncode == 0
        assert not (prefix_dir / "etc" / "apt" / "sources.list.d" / "repoexe.list").exists()

        res_status_after = subprocess.run(
            ["sh", str(INSTALL_SCRIPT), "status"],
            env=env,
            capture_output=True,
            text=True,
            check=False,
        )
        assert res_status_after.returncode == 0
        assert "APT Repository:      [DISABLED]" in res_status_after.stdout
