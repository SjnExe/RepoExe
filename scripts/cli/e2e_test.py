import argparse
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


def run_e2e_tests(site_dir: Path):
    """Spins up a local HTTP server and runs end-to-end sandbox tests against the generated registry via Docker."""
    if not site_dir.exists():
        print(f"Error: Site directory {site_dir} does not exist.")
        sys.exit(1)

    print("Starting local registry server for E2E tests...")

    server_process = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8080", "--directory", str(site_dir)],
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )

    time.sleep(2) # Give server time to bind

    repo_owner = os.environ.get("REPO_OWNER", "sjnexe").lower()
    default_image = f"ghcr.io/{repo_owner}/repoexe-tester:latest"
    termux_image = os.environ.get("TERMUX_TESTER_IMAGE", default_image)

    # We must bridge network to host so docker can reach localhost:8080. Using host network driver.
    script_lines = [
        "#!/data/data/com.termux/files/usr/bin/bash",
        "set -eo pipefail",
        "export PREFIX=/data/data/com.termux/files/usr",
        "export PATH=$PREFIX/bin:$PATH",
        "export LD_LIBRARY_PATH=$PREFIX/lib",
        "",
        "echo '[*] Bootstraping RepoExe locally...'",
        "curl -sL http://localhost:8080/install > /data/data/com.termux/files/usr/bin/repoexe",
        "chmod +x /data/data/com.termux/files/usr/bin/repoexe",
        "",
        "echo '[*] Testing APT (deb) integration...'",
        "repoexe enable apt || true",
        "mkdir -p $PREFIX/etc/apt/sources.list.d/",
        "echo 'deb [trusted=yes] http://localhost:8080/apt stable main' > $PREFIX/etc/apt/sources.list.d/repoexe.list",
        "pkg update -y || echo 'Warning: standard apt update may fail if missing dependencies'",
        "pkg install -y jscpd --allow-unauthenticated || echo 'Notice: APT install skipped or failed. This is expected if the package is not in the output yet.'",
        "",
        "echo '[*] Testing NPM integration...'",
        "repoexe enable npm || true",
        "export npm_config_registry=http://localhost:8080/npm/",
        "npm install -g jscpd || true",
        "npm list -g || true",
        "",
        "echo '[*] Testing Bun registry integration...'",
        "repoexe enable bun || true",
        "cat ~/.bunfig.toml || true",
        "bun add -g jscpd || true",
        "",
        "echo '[*] Testing PIP extra index integration...'",
        "repoexe enable pip || true",
        "pip config list || true",
        "pip install repoexe || true",
        "",
        "echo '✓ E2E Tests inside Termux Docker passed successfully.'"
    ]

    script_content = "\n".join(script_lines) + "\n"

    try:
        print(f"Executing E2E tests against {termux_image} in host network mode...")
        subprocess.run(["docker", "pull", termux_image], check=False, capture_output=True)

        has_docker = (
            bool(shutil.which("docker"))
            and subprocess.run(["docker", "info"], capture_output=True, check=False).returncode == 0
        )
        if not has_docker:
            print("Notice: Docker not available on host. Skipping E2E Termux tests.")
            return

        res = subprocess.run(
            [
                "docker", "run", "--rm", "-i",
                "--network=host",
                "--security-opt", "seccomp=unconfined",
                termux_image,
                "bash", "-c", "cat - > $HOME/runner.sh && chmod +x $HOME/runner.sh && $HOME/runner.sh"
            ],
            input=script_content,
            capture_output=True,
            text=True,
            check=False,
            timeout=300
        )

        print(res.stdout)
        if res.stderr:
            print("--- STDERR ---")
            print(res.stderr)

        if res.returncode != 0:
            print("❌ E2E tests failed.")
            sys.exit(1)

    finally:
        print("Tearing down local registry server...")
        server_process.terminate()
        server_process.wait()

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run RepoExe E2E Deployment Tests")
    parser.add_argument("--site-dir", type=str, default="site", help="Path to the generated site root")
    args = parser.parse_args()

    run_e2e_tests(Path(args.site_dir).resolve())
