from scripts.utils.properties import PREFIX


class RustToolchain:
    def __init__(self, arch: str):
        self.arch = arch
        self._setup_target()

    def _setup_target(self):
        target_map = {
            "aarch64": "aarch64-linux-android",
            "arm": "armv7-linux-androideabi",
            "x86_64": "x86_64-linux-android",
            "i686": "i686-linux-android",
        }
        self.target = target_map.get(self.arch)
        if not self.target:
            raise ValueError(f"Unsupported architecture for Rust: {self.arch}")

    def get_env(self, native_env: dict) -> dict:
        """Returns Rust environment variables, bridging C/C++ settings."""
        env = {
            "CARGO_TARGET_NAME": self.target,
            "RUSTFLAGS": f"-L{PREFIX}/lib",
            # Set the linker for the target to use the NDK clang
            f"CARGO_TARGET_{self.target.upper().replace('-', '_')}_LINKER": native_env.get(
                "CC", "clang"
            ),
        }
        return env

    def get_cargo_args(self) -> list[str]:
        return [
            "--target",
            self.target,
            "--release",
        ]
