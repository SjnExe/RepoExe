"""Test execution sandbox for RepoExe using PRoot."""

import os
import subprocess

from core.properties import PREFIX


class ProotTestRunner:
    """Executes package tests inside a strict PRoot sandbox."""

    def __init__(
        self, prefix: str = PREFIX, home: str = "/data/data/com.termux/files/home"
    ):
        self.prefix = prefix
        self.home = home

    def execute_test(
        self, package_name: str, test_commands: str, max_retries: int = 3
    ) -> bool:
        """
        Executes a test snippet using PRoot.
        Features 'Flaky Test Isolation' by retrying up to max_retries.
        """
        print(f"[{package_name}] Running tests in PRoot sandbox...")

        # We construct a bash script from the test_commands snippet
        import tempfile

        script_path = f"{tempfile.gettempdir()}/test_{package_name}.sh"
        with open(script_path, "w") as f:
            f.write("#!/bin/bash\n")
            f.write("set -e\n")
            f.write(test_commands + "\n")

        os.chmod(script_path, 0o755)

        # Build PRoot command
        # It binds the host's actual prefix to the simulated Termux prefix
        # To strictly isolate the environment, we use an empty rootfs and bind
        # only essential directories (prefix, home, dev, proc, sys) to prevent
        # access to the builder's source tree and other host files.
        empty_root = f"{tempfile.gettempdir()}/empty_rootfs_for_proot"
        os.makedirs(empty_root, exist_ok=True)

        proot_cmd = [
            "proot",
            "-r",
            empty_root,
            "-0",  # Fake root privilege might be needed for proot isolated roots
            "-b",
            "/dev",
            "-b",
            "/proc",
            "-b",
            "/sys",
            "-b",
            f"{self.prefix}:{self.prefix}",  # Bind mount the prefix explicitly
            "-b",
            f"{self.home}:{self.home}",
            "-w",
            self.home,  # Working directory is the simulated home
            "--kill-on-exit",
            f"{self.prefix}/bin/bash",
            script_path,
        ]

        attempt = 1
        while attempt <= max_retries:
            try:
                subprocess.run(
                    proot_cmd,
                    check=True,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                )
                print(f"[{package_name}] Tests passed on attempt {attempt}.")
                return True
            except subprocess.CalledProcessError as e:
                print(
                    f"[{package_name}] Tests failed on attempt {attempt}:\n{e.stdout}"
                )
                attempt += 1

        print(f"[{package_name}] Tests failed after {max_retries} attempts.")
        return False
