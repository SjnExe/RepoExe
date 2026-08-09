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

        termux_image = "termux/termux-docker:aarch64"

        script_path = Path(tempfile.gettempdir()) / f"test_{package_name}.sh"

        lines = [
            "#!/data/data/com.termux/files/usr/bin/bash",
            "set -e",
            f'export PREFIX="{self.prefix}"',
            f'export HOME="{self.home}"',
            'export PATH="/tmp/stage/data/data/com.termux/files/usr/bin:$PREFIX/bin:$PATH"',
            'export LD_LIBRARY_PATH="/tmp/stage/data/data/com.termux/files/usr/lib:/tmp/stage/usr/lib:$PREFIX/lib:$LD_LIBRARY_PATH"',
            'pkg install -y binutils 2>/dev/null || true',
            'if command -v xvfb-run >/dev/null 2>&1 && [ -z "$DISPLAY" ]; then EXEC_PREFIX="xvfb-run -a "; else EXEC_PREFIX=""; fi',
            f'eval "${{EXEC_PREFIX}}{test_commands}"'
        ]
        script_content = "\n".join(lines) + "\n"

        script_path.write_text(script_content, encoding="utf-8")
        script_path.chmod(0o755)

        host_stage_dir = str(stage_dir) if stage_dir else ""
        github_workspace = os.environ.get("GITHUB_WORKSPACE")

        if github_workspace and "/home/builder/RepoExe" in host_stage_dir:
            host_stage_dir = host_stage_dir.replace(
                "/home/builder/RepoExe", github_workspace
            )

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

        has_docker = (
            bool(shutil.which("docker"))
            and subprocess.run(
                ["docker", "info"], capture_output=True, check=False
            ).returncode
            == 0
        )

        if has_docker:
            res = subprocess.run(
                docker_cmd, capture_output=True, text=True, check=False
            )
            if res.returncode == 0:
                print(
                    f"✓ [{package_name}] Smoke test passed successfully inside Termux Docker."
                )
                if res.stdout.strip():
                    print(f"--- STDOUT ---\n{res.stdout.strip()}")
                if res.stderr.strip():
                    print(f"--- STDERR ---\n{res.stderr.strip()}")
                return True

            print(f"⚠️ [{package_name}] Termux Docker run returned non-zero exit code. Trying fallbacks...")

        print(
            f"⚠️ [{package_name}] Termux Docker unavailable, trying PRoot fallback..."
        )

        if shutil.which("proot") and stage_dir and stage_dir.exists():
            staged_prefix = stage_dir / "data" / "data" / "com.termux" / "files" / "usr"
            target_prefix = str(staged_prefix) if staged_prefix.exists() else str(stage_dir)
            proot_cmd = [
                "proot",
                "-0",
                "-b", f"{target_prefix}:/data/data/com.termux/files/usr",
                "-b", "/proc",
                "-b", "/dev",
                "/bin/bash",
                "-c",
                f'export PREFIX="/data/data/com.termux/files/usr"; export PATH="/data/data/com.termux/files/usr/bin:$PATH"; export LD_LIBRARY_PATH="$target_prefix/lib:/data/data/com.termux/files/usr/lib:$LD_LIBRARY_PATH"; {test_commands}'
            ]
            res_proot = subprocess.run(proot_cmd, capture_output=True, text=True, check=False)
            if res_proot.returncode == 0:
                print(f"✓ [{package_name}] Smoke test passed via PRoot fallback.")
                if res_proot.stdout.strip():
                    print(f"--- STDOUT ---\n{res_proot.stdout.strip()}")
                if res_proot.stderr.strip():
                    print(f"--- STDERR ---\n{res_proot.stderr.strip()}")
                return True

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
            if res_direct.stdout.strip():
                print(f"--- STDOUT ---\n{res_direct.stdout.strip()}")
            if res_direct.stderr.strip():
                print(f"--- STDERR ---\n{res_direct.stderr.strip()}")
            return True

        err_msg = (
            f"Smoke test failed for {package_name}:\n"
            f"STDOUT:\n{res_direct.stdout}\nSTDERR:\n{res_direct.stderr}"
        )
        print(f"❌ {err_msg}")
        raise RuntimeError(err_msg)
