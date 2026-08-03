class ZigToolchain:
    def __init__(self, arch: str):
        self.arch = arch
        self._setup_target()

    def _setup_target(self):
        target_map = {
            "aarch64": "aarch64-linux-android",
            "arm": "arm-linux-androideabi",
            "x86_64": "x86_64-linux-android",
            "i686": "x86-linux-android",
        }
        self.target = target_map.get(self.arch)
        if not self.target:
            raise ValueError(f"Unsupported architecture for Zig: {self.arch}")

    def get_env(self) -> dict:
        """Returns Zig environment variables."""
        return {}

    def get_zig_args(self) -> list[str]:
        return [
            "-Dtarget=" + self.target,
            "-Dcpu=baseline",
            "-O",
            "ReleaseSafe",
        ]
