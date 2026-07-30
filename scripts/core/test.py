import contextlib
import os
import platform
import shutil
import subprocess
import tempfile
from pathlib import Path

from core.properties import HOME, PREFIX


class ProotTestRunner:
    """Executes package tests inside a strict PRoot + QEMU sandbox."""

    def __init__(self, prefix: str = PREFIX, home: str = HOME):
        self.prefix = prefix
        self.home = home

    def execute_test(self, package_name: str, test_commands: str) -> bool:
        print(f"[{package_name}] Running tests in PRoot + QEMU sandbox...")

        with contextlib.suppress(OSError):
            Path(self.prefix).mkdir(parents=True, exist_ok=True)
            Path(self.home).mkdir(parents=True, exist_ok=True)

        script_path = Path(tempfile.gettempdir()) / f"test_{package_name}.sh"
        script_path.write_text(f"#!/bin/bash\nset -e\n{test_commands}\n", encoding="utf-8")
        script_path.chmod(0o755)

        empty_root = Path(tempfile.gettempdir()) / "empty_rootfs_for_proot"
        empty_root.mkdir(parents=True, exist_ok=True)

        target_bash = f"{self.prefix}/bin/bash"
        extra_binds = []
        if not Path(target_bash).exists():
            target_bash = "/bin/bash"
            for p in ["/bin", "/usr", "/lib", "/lib64"]:
                if Path(p).exists():
                    extra_binds.extend(["-b", f"{p}:{p}"])

        proot_cmd = [
            "proot",
            "-r",
            str(empty_root),
            "-0",
            "-b",
            "/dev",
            "-b",
            "/proc",
            "-b",
            "/sys",
            "-b",
            "/tmp:/tmp",
            *extra_binds,
            "-b",
            f"{self.prefix}:{self.prefix}",
            "-b",
            f"{self.home}:{self.home}",
            "-w",
            self.home,
        ]

        host_arch = platform.machine().lower()
        if host_arch in ("x86_64", "amd64") and shutil.which("qemu-aarch64-static"):
            proot_cmd.extend(["-q", "qemu-aarch64-static"])

        proot_cmd.extend([target_bash, str(script_path)])

        res = subprocess.run(proot_cmd, capture_output=True, text=True, check=False)
        if res.returncode == 0:
            print(f"✓ [{package_name}] Smoke test passed successfully.")
            return True

        err_msg = f"Smoke test failed for {package_name}:\nSTDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        print(f"❌ {err_msg}")
        raise RuntimeError(err_msg)
