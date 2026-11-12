import os

from utils.properties import PREFIX


class SwiftToolchain:
    def __init__(self, arch: str):
        self.arch = arch
        self._setup_target()

    def _setup_target(self):
        target_map = {
            "aarch64": "aarch64-unknown-linux-android",
            "arm": "armv7-unknown-linux-androideabi",
            "x86_64": "x86_64-unknown-linux-android",
            "i686": "i686-unknown-linux-android",
        }
        self.target = target_map.get(self.arch)
        if not self.target:
            raise ValueError(f"Unsupported architecture for Swift: {self.arch}")

    def get_env(self) -> dict:
        """Returns Swift environment variables."""
        return {}

    def get_swift_args(self) -> list[str]:
        ndk = os.environ.get("NDK", "/opt/android-ndk")
        prebuilt_base = os.path.join(ndk, "toolchains", "llvm", "prebuilt")
        prebuilts = (
            [d for d in os.listdir(prebuilt_base) if not d.startswith(".")]
            if os.path.exists(prebuilt_base)
            else []
        )
        prebuilt_dir = prebuilts[0] if prebuilts else "linux-arm64"
        return [
            "-target",
            self.target,
            "-sdk",
            f"{ndk}/toolchains/llvm/prebuilt/{prebuilt_dir}/sysroot",
            "-L",
            f"{PREFIX}/lib",
            "-I",
            f"{PREFIX}/include",
        ]
