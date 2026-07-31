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

        empty_root = Path(tempfile.gettempdir()) / "empty_rootfs_for_proot"
        empty_root.mkdir(parents=True, exist_ok=True)

        rel_prefix = Path(self.prefix).relative_to("/")
        rel_home = Path(self.home).relative_to("/")
        (empty_root / rel_prefix).mkdir(parents=True, exist_ok=True)
        (empty_root / rel_home).mkdir(parents=True, exist_ok=True)

        staged_prefix = destdir / "stage" / rel_prefix if destdir else None
        stage_bind = f"{self.prefix}:{self.prefix}"
        if staged_prefix and staged_prefix.exists():
            stage_bind = f"{staged_prefix}:{self.prefix}"

        script_path = Path(tempfile.gettempdir()) / f"test_{package_name}.sh"
        script_content = (
            "#!/bin/bash\n"
            "set -e\n"
            f'export PREFIX="${{PREFIX:-{self.prefix}}}"\n'
            f'export HOME="${{HOME:-{self.home}}}"\n'
            'export PATH="$PREFIX/bin:$PATH"\n'
            'export LD_LIBRARY_PATH="$PREFIX/lib:$LD_LIBRARY_PATH"\n'
            f"{test_commands}\n"
        )
        script_path.write_text(script_content, encoding="utf-8")
        script_path.chmod(0o755)

        target_bash = f"{self.prefix}/bin/bash"
        extra_binds = []
        if not Path(target_bash).exists():
            target_bash = "/bin/bash"
            for p in ["/bin", "/usr", "/lib", "/lib64"]:
                if Path(p).exists():
                    (empty_root / Path(p).relative_to("/")).mkdir(
                        parents=True, exist_ok=True
                    )
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

        if res.returncode in (139, -11) or "terminated with signal 11" in res.stderr:
            print(
                f"⚠️ [{package_name}] PRoot hit signal 11, falling back to direct execution..."
            )
            test_env = os.environ.copy()

            wrapper_bin = Path(tempfile.gettempdir()) / f"wrapper_bin_{package_name}"
            with contextlib.suppress(OSError):
                shutil.rmtree(wrapper_bin)
            wrapper_bin.mkdir(parents=True, exist_ok=True)

            stage_dir = destdir / "stage" if destdir else None
            pypath_items = []
            bin_dirs = []

            if stage_dir and stage_dir.exists():
                test_env["PREFIX"] = str(staged_prefix) if staged_prefix else str(stage_dir)
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
                f'export PREFIX="{staged_prefix if staged_prefix else self.prefix}"\n'
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
                print(f"✓ [{package_name}] Smoke test passed via direct execution.")
                return True
            res = res_direct

        err_msg = (
            f"Smoke test failed for {package_name}:\n"
            f"STDOUT:\n{res.stdout}\nSTDERR:\n{res.stderr}"
        )
        print(f"❌ {err_msg}")
        raise RuntimeError(err_msg)
