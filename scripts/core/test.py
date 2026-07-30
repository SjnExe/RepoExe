import contextlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from core.properties import HOME, PREFIX


class ProotTestRunner:
    """Executes package tests inside a strict PRoot sandbox with direct fallback."""

    def __init__(self, prefix: str = PREFIX, home: str = HOME):
        self.prefix = prefix
        self.home = home

    def execute_test(
        self, package_name: str, test_commands: str, destdir: Path | None = None
    ) -> bool:
        print(f"[{package_name}] Running tests in PRoot sandbox...")

        with contextlib.suppress(OSError):
            Path(self.prefix).mkdir(parents=True, exist_ok=True)
            Path(self.home).mkdir(parents=True, exist_ok=True)

        script_path = Path(tempfile.gettempdir()) / f"test_{package_name}.sh"
        script_content = (
            f"#!/bin/bash\n"
            f"set -e\n"
            f"export PREFIX=\"{self.prefix}\"\n"
            f"export HOME=\"{self.home}\"\n"
            f"export PATH=\"{self.prefix}/bin:$PATH\"\n"
            f"export LD_LIBRARY_PATH=\"{self.prefix}/lib:$LD_LIBRARY_PATH\"\n"
            f"{test_commands}\n"
        )
        script_path.write_text(script_content, encoding="utf-8")
        script_path.chmod(0o755)

        empty_root = Path(tempfile.gettempdir()) / "empty_rootfs_for_proot"
        empty_root.mkdir(parents=True, exist_ok=True)

        rel_prefix = Path(self.prefix).relative_to("/")
        (empty_root / rel_prefix).mkdir(parents=True, exist_ok=True)

        stage_bind = f"{self.prefix}:{self.prefix}"
        if destdir:
            staged_prefix = destdir / "stage" / rel_prefix
            if staged_prefix.exists():
                stage_bind = f"{staged_prefix}:{self.prefix}"

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
            stage_bind,
            "-b",
            f"{self.home}:{self.home}",
            "-w",
            self.home,
            target_bash,
            str(script_path),
        ]

        res = subprocess.run(proot_cmd, capture_output=True, text=True, check=False)
        if res.returncode == 0:
            print(f"✓ [{package_name}] Smoke test passed successfully via PRoot.")
            return True

        # Fallback to direct execution if PRoot hits signal 11 / segfault
        if res.returncode in (139, -11) or "terminated with signal 11" in res.stderr:
            print(f"⚠️ [{package_name}] PRoot hit signal 11, falling back to direct execution...")
            test_env = os.environ.copy()
            staged_bin_dir = destdir / "stage" / rel_prefix / "bin" if destdir else Path()
            test_env["PATH"] = f"{staged_bin_dir}:{test_env.get('PATH', '')}"
            test_env["PREFIX"] = self.prefix
            test_env["HOME"] = self.home

            res_direct = subprocess.run(["/bin/bash", str(script_path)], capture_output=True, text=True, env=test_env, check=False)
            if res_direct.returncode == 0:
                print(f"✓ [{package_name}] Smoke test passed via direct execution.")
                return True
            res = res_direct

        err_msg = (
            f"Smoke test failed for {package_name}:\n"
            f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        )
        print(f"❌ {err_msg}")
        raise RuntimeError(err_msg)
