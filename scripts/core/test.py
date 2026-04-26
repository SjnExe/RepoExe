"""Test Execution Sandbox."""

import os
import subprocess
import sys
import tempfile
import textwrap
import time

from core.properties import PREFIX


def execute_test(pkg_name: str, test_script: str, max_retries: int = 3, retry_delay: int = 2) -> None:
    """Executes a test script inside a PRoot simulated Termux environment with flaky isolation."""

    # Check if proot is installed
    try:
        subprocess.run(["proot", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except (FileNotFoundError, subprocess.CalledProcessError):
        print("Error: 'proot' is not installed or not working on this host.", file=sys.stderr)
        print("Please ensure it is installed (e.g., via 'apt-get install proot').", file=sys.stderr)
        sys.exit(1)

    print(f"[{pkg_name}] Running tests inside PRoot sandbox...")

    # Create a temporary directory to act as the rootfs wrapper for PRoot
    with tempfile.TemporaryDirectory() as temp_root:
        # Wrap the test script with the standard Termux assertions
        # This replaces the legacy Termux test-runner.sh logic
        wrapped_script = textwrap.dedent(f"""\
            #!/bin/sh
            set -e -u

            assert_equals() {{
                FIRST=$1
                SECOND=$2
                if [ "$FIRST" != "$SECOND" ]; then
                    echo "assertion failed - expected '$FIRST', got '$SECOND'"
                    exit 1
                fi
            }}

            # Add internal prefix to PATH
            export PATH="{PREFIX}/bin:$PATH"

            # Execute user provided script
            {test_script}
            """)

        test_file_path = os.path.join(temp_root, "run_test.sh")
        with open(test_file_path, "w", encoding="utf-8") as f:
            f.write(wrapped_script)

        # Make the test script executable
        os.chmod(test_file_path, 0o755)

        # Proot arguments to bind-mount the true prefix path to our current execution context
        # We enforce a strict isolated root (an empty temp dir) and only map the necessary Termux prefix
        with tempfile.TemporaryDirectory() as strict_rootfs:
            proot_cmd = [
                "proot",
                "-r",
                strict_rootfs,  # Strict isolated empty root
                "-0",  # Simulate root privileges locally for standard files
                "-b",
                "/bin:/bin",  # Bind essential host bins for testing commands
                "-b",
                "/usr:/usr",  # Bind /usr for dynamic linker and libs
                "-b",
                "/lib:/lib",  # Bind /lib for libs
                "-b",
                "/lib64:/lib64",  # Bind /lib64 for x86_64 libs
                "-b",
                "/dev:/dev",  # Bind /dev for /dev/null
                "-b",
                "/proc:/proc",  # Bind /proc for bash process substitution
                "-b",
                f"{PREFIX}:{PREFIX}",  # Only map the isolated prefix
                "-b",
                f"{temp_root}:/tmp_test",
                "-w",
                "/tmp_test",
                "/tmp_test/run_test.sh",
            ]

            attempt = 1
            while attempt <= max_retries:
                try:
                    # We execute it inside PRoot
                    subprocess.run(proot_cmd, check=True, stdout=sys.stdout, stderr=sys.stderr)

                    # If we succeeded on a retry, mark it as flaky but successful
                    if attempt > 1:
                        print(f"[{pkg_name}] Tests FLAKY but PASSED on retry {attempt}/{max_retries}.")
                    else:
                        print(f"[{pkg_name}] Tests PASSED successfully.")
                    return

                except subprocess.CalledProcessError as e:
                    print(
                        f"[{pkg_name}] Test execution attempt {attempt} failed (exit code {e.returncode})",
                        file=sys.stderr,
                    )
                    if attempt < max_retries:
                        print(f"[{pkg_name}] Retrying in {retry_delay} seconds...", file=sys.stderr)
                        time.sleep(retry_delay)
                    attempt += 1

            # If it falls through the loop, it completely failed
            print(f"[{pkg_name}] Tests FAILED consistently after {max_retries} attempts.", file=sys.stderr)
            sys.exit(1)
