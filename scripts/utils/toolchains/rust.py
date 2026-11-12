from utils.properties import PREFIX


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
        """Returns Rust environment variables, bridging C/C++ NDK settings."""
        target_key = self.target.upper().replace("-", "_")
        linker = native_env.get("CC", "clang")
        env = {
            "CARGO_BUILD_TARGET": self.target,
            "RUSTFLAGS": f"-L{PREFIX}/lib -C linker={linker} -C link-arg=-fuse-ld=lld -C link-arg=--target={self.target}24 -C link-arg=-Wl,-z,max-page-size=16384",
            f"CARGO_TARGET_{target_key}_LINKER": linker,
        }
        return env

    def get_cargo_args(self) -> list[str]:
        return [
            "--target",
            self.target,
            "--release",
        ]
