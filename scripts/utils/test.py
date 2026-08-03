import contextlib
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from utils.properties import HOME, PREFIX


class ProotTestRunner:
    """Executes package tests inside a strict Termux Docker sandbox."""

    def __init__(self, prefix: str = PREFIX, home: str = HOME):
        self.prefix = prefix
        self.home = home

    def execute_test(
        self, package_name: str, test_commands: str, destdir: Path | None = None
    ) -> bool:
        print(f"[{package_name}] Running tests in Termux Docker sandbox...")

        stage_dir = destdir / "stage" if destdir else None

        # We use a dedicated Termux testing docker image to run binaries compiled for Termux.
        # This properly handles linker64 and Termux library paths.
        termux_image = "termux/termux-docker:aarch64"

        script_path = Path(tempfile.gettempdir()) / f"test_{package_name}.sh"
        script_content = (
            "#!/data/data/com.termux/files/usr/bin/bash\n"
            "set -e\n"
            f'export PREFIX="{self.prefix}"\n'
            f'export HOME="{self.home}"\n'
            'export PATH="/tmp/stage/data/data/com.termux/files/usr/bin:$PREFIX/bin:$PATH"\n'
            'export LD_LIBRARY_PATH="/tmp/stage/data/data/com.termux/files/usr/lib:$PREFIX/lib:$LD_LIBRARY_PATH"\n'
            f"{test_commands}\n"
        )
        script_path.write_text(script_content, encoding="utf-8")
        script_path.chmod(0o755)

        # When running inside GitHub Actions (Docker-in-Docker via socket), we must map internal paths
        # to host paths so the host Docker daemon can find them to mount into the test container.
        host_stage_dir = str(stage_dir) if stage_dir else ""
        github_workspace = os.environ.get("GITHUB_WORKSPACE")

        if github_workspace and "/home/builder/RepoExe" in host_stage_dir:
            host_stage_dir = host_stage_dir.replace(
                "/home/builder/RepoExe", github_workspace
            )

        # Instead of mounting the script file (which is complicated with host paths), we pipe it via STDIN
        docker_cmd = ["docker", "run", "--rm", "-i"]
        if stage_dir and stage_dir.exists():
            docker_cmd.extend(["-v", f"{host_stage_dir}:/tmp/stage:ro"])

        docker_cmd.extend(
            [
                termux_image,
                "/data/data/com.termux/files/usr/bin/bash",
                "-c",
                script_content,
            ]
        )

        # Check if docker is available and we can run termux-docker
        has_docker = (
            bool(shutil.which("docker"))
            and subprocess.run(
                ["docker", "info"], capture_output=True, check=False
            ).returncode
            == 0
        )

        if has_docker:
            # We must be on arm64 or have qemu-user-static configured to run termux/termux-docker:aarch64
            res = subprocess.run(
                docker_cmd, capture_output=True, text=True, check=False
            )
            if res.returncode == 0:
                print(
                    f"✓ [{package_name}] Smoke test passed successfully inside Termux Docker."
                )
                return True

            err_msg = (
                f"Smoke test failed for {package_name}:\n"
                f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
            )
            print(f"❌ {err_msg}")

            # If the image was missing, it might output a specific error we can fallback on
            if (
                "Unable to find image" not in res.stderr
                and "exec format error" not in res.stderr
            ):
                raise RuntimeError(err_msg)

        print(
            f"⚠️ [{package_name}] Termux Docker unavailable (no Docker or arch mismatch), falling back to native wrapper execution..."
        )

        test_env = os.environ.copy()

        wrapper_bin = Path(tempfile.gettempdir()) / f"wrapper_bin_{package_name}"
        with contextlib.suppress(OSError):
            shutil.rmtree(wrapper_bin)
        wrapper_bin.mkdir(parents=True, exist_ok=True)

        pypath_items = []
        bin_dirs = []

        staged_prefix = None
        if stage_dir and stage_dir.exists():
            staged_prefix = stage_dir / Path(self.prefix).relative_to("/")
            test_env["PREFIX"] = (
                str(staged_prefix) if staged_prefix.exists() else str(stage_dir)
            )
            bin_dirs = [d for d in stage_dir.rglob("bin") if d.is_dir()]

            for bdir in bin_dirs:
                for item in bdir.iterdir():
                    if item.is_file():
                        wrapper_file = wrapper_bin / item.name
                        is_python = False
                        try:
                            first_line = item.read_text(
                                encoding="utf-8", errors="ignore"
                            ).splitlines()[0]
                            if "python" in first_line:
                                is_python = True
                        except Exception:
                            pass

                        if is_python:
                            wrapper_file.write_text(
                                f'#!/bin/bash\nexec python3 "{item.resolve()}" "$@"\n',
                                encoding="utf-8",
                            )
                        else:
                            wrapper_file.write_text(
                                f'#!/bin/bash\nexec "{item.resolve()}" "$@"\n',
                                encoding="utf-8",
                            )
                        wrapper_file.chmod(0o755)

            for p in stage_dir.rglob("*packages"):
                if p.is_dir():
                    pypath_items.append(str(p))

        if test_env.get("PYTHONPATH"):
            pypath_items.append(test_env["PYTHONPATH"])
        combined_pypath = ":".join(pypath_items)
        test_env["PYTHONPATH"] = combined_pypath

        bin_path_parts = [str(wrapper_bin)] + [str(d) for d in bin_dirs]
        bin_path_str = ":".join(bin_path_parts) + ":$PATH"

        direct_script_path = (
            Path(tempfile.gettempdir()) / f"test_direct_{package_name}.sh"
        )

        direct_script_content = (
            "#!/bin/bash\n"
            "set -e\n"
            f'export PREFIX="{staged_prefix if staged_prefix and staged_prefix.exists() else self.prefix}"\n'
            f'export HOME="{self.home}"\n'
            f'export PATH="{bin_path_str}"\n'
            f'export PYTHONPATH="{combined_pypath}"\n'
            f"{test_commands}\n"
        )
        direct_script_path.write_text(direct_script_content, encoding="utf-8")
        direct_script_path.chmod(0o755)

        res_direct = subprocess.run(
            ["/bin/bash", str(direct_script_path)],
            capture_output=True,
            text=True,
            env=test_env,
            check=False,
        )
        if res_direct.returncode == 0:
            print(
                f"✓ [{package_name}] Smoke test passed via direct execution fallback."
            )
            return True

        err_msg = (
            f"Smoke test failed for {package_name}:\n"
            f"STDOUT:\n{res_direct.stdout}\nSTDERR:\n{res_direct.stderr}"
        )
        print(f"❌ {err_msg}")
        raise RuntimeError(err_msg)
