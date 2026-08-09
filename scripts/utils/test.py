import os
import shutil
import subprocess
import tempfile
from pathlib import Path


class ProotTestRunner:
    def __init__(self, prefix: str = "/data/data/com.termux/files/usr", home: str = "/data/data/com.termux/files/home"):
        self.prefix = prefix
        self.home = home

    def execute_test(self, package_name: str, test_commands: str, destdir: Path = None) -> bool:
        print(f"[{package_name}] Running tests in Termux Docker sandbox...")

        stage_dir = destdir / "stage" if destdir else None
        
        repo_owner = os.environ.get("REPO_OWNER", "sjnexe").lower()
        default_image = f"ghcr.io/{repo_owner}/repoexe-tester:latest"
        termux_image = os.environ.get("TERMUX_TESTER_IMAGE", default_image)

        script_path = Path(tempfile.gettempdir()) / f"test_{package_name}.sh"
        script_lines = [
            "#!/data/data/com.termux/files/usr/bin/bash",
            "set -eo pipefail",
            f'export PREFIX="{self.prefix}"',
            f'export HOME="{self.home}"',
            'export PATH="/tmp/stage/data/data/com.termux/files/usr/bin:$PREFIX/bin:$PATH"',
            'export LD_LIBRARY_PATH="/tmp/stage/data/data/com.termux/files/usr/lib:/tmp/stage/usr/lib:$PREFIX/lib:$LD_LIBRARY_PATH"',
            'if command -v xvfb-run >/dev/null 2>&1 && [ -z "$DISPLAY" ]; then EXEC_PREFIX="xvfb-run -a "; else EXEC_PREFIX=""; fi',
            f'eval "${{EXEC_PREFIX}}{test_commands}"',
        ]
        script_content = "\n".join(script_lines) + "\n"
        script_path.write_text(script_content, encoding="utf-8")
        script_path.chmod(0o755)

        host_stage_dir = str(stage_dir) if stage_dir else ""
        github_workspace = os.environ.get("GITHUB_WORKSPACE")

        if github_workspace and host_stage_dir.startswith("/home/builder/RepoExe"):
            host_stage_dir = host_stage_dir.replace(
                "/home/builder/RepoExe", github_workspace
            )

        docker_cmd = ["docker", "run", "--rm", "-i"]
        if stage_dir and stage_dir.exists():
            docker_cmd.extend(["-v", f"{host_stage_dir}:/tmp/stage:ro"])

        docker_cmd.extend(
            [
                termux_image,
                "bash",
                "-c",
                "cat - > /tmp/runner.sh && chmod +x /tmp/runner.sh && /tmp/runner.sh",
            ]
        )

        has_docker = (
            bool(shutil.which("docker"))
            and subprocess.run(
                ["docker", "info"], capture_output=True, check=False
            ).returncode == 0
        )

        if not has_docker:
            raise RuntimeError(f"❌ [{package_name}] Docker is unavailable. Termux Docker sandbox is required for smoke tests.")

        with open(script_path, "rb") as stdin_f:
            res = subprocess.run(
                docker_cmd, stdin=stdin_f, capture_output=True, text=True, check=False
            )

        if res.returncode == 0:
            print(f"✓ [{package_name}] Smoke test passed successfully inside Termux Docker.")
            if res.stdout.strip():
                print(f"--- STDOUT ---\n{res.stdout.strip()}")
            if res.stderr.strip():
                print(f"--- STDERR ---\n{res.stderr.strip()}")
            return True

        err_msg = (
            f"❌ Smoke test failed inside Termux Docker for {package_name}:\n"
            f"--- STDOUT ---\n{res.stdout.strip()}\n"
            f"--- STDERR ---\n{res.stderr.strip()}"
        )
        print(err_msg)
        raise RuntimeError(err_msg)
