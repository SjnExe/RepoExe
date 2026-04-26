from core.properties import PREFIX


class PythonToolchain:
    def __init__(self, arch: str):
        self.arch = arch
        self._setup_target()

    def _setup_target(self):
        # We don't strictly need a Python arch map here if we rely on crossenv,
        # but keep it if we need specific tags.
        pass

    def get_env(self) -> dict:
        """Returns Python environment variables for cross-compilation."""
        env = {
            # Typically for Python we need to set PYTHONPATH to search the target PREFIX
            'PYTHONPATH': f'{PREFIX}/lib/python3.11/site-packages',  # We can make version dynamic later
            # Avoid writing pyc files during build which can have wrong permissions/paths
            'PYTHONDONTWRITEBYTECODE': '1',
            # Prevent pip from complaining about root/prefix
            'PIP_NO_WARN_SCRIPT_LOCATION': '0',
            'PIP_DISABLE_PIP_VERSION_CHECK': '1',
        }
        return env
