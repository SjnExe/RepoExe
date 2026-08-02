import os

from utils.properties import PREFIX


def generate_cmake_toolchain(arch: str, ndk_path: str, output_path: str) -> str:
    """Generates an android.toolchain.cmake file strictly targeting the architecture."""
    abi_map = {
        "aarch64": "arm64-v8a",
        "arm": "armeabi-v7a",
        "x86_64": "x86_64",
        "i686": "x86",
    }
    abi = abi_map.get(arch)
    if not abi:
        raise ValueError(f"Unsupported architecture for CMake generation: {arch}")

    api_level = "24"
    prebuilt_dir = (
        "linux-aarch64"
        if os.path.exists(f"{ndk_path}/toolchains/llvm/prebuilt/linux-aarch64")
        else "linux-x86_64"
    )

    cmake_content = f"""
set(CMAKE_SYSTEM_NAME Android)
set(CMAKE_SYSTEM_VERSION {api_level})
set(CMAKE_ANDROID_ARCH_ABI {abi})
set(CMAKE_ANDROID_NDK {ndk_path})
set(CMAKE_EXPORT_NO_PACKAGE_REGISTRY ON)
set(CMAKE_FIND_PACKAGE_NO_PACKAGE_REGISTRY ON)
set(CMAKE_INSTALL_PREFIX {PREFIX})
set(CMAKE_BUILD_TYPE Release)
set(CMAKE_MAKE_PROGRAM ninja)
set(CMAKE_C_COMPILER "{ndk_path}/toolchains/llvm/prebuilt/{prebuilt_dir}/bin/clang")
set(CMAKE_CXX_COMPILER "{ndk_path}/toolchains/llvm/prebuilt/{prebuilt_dir}/bin/clang++")
set(CMAKE_FIND_ROOT_PATH {PREFIX})
set(CMAKE_FIND_ROOT_PATH_MODE_PROGRAM NEVER)
set(CMAKE_FIND_ROOT_PATH_MODE_LIBRARY ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_INCLUDE ONLY)
set(CMAKE_FIND_ROOT_PATH_MODE_PACKAGE ONLY)
"""
    with open(output_path, "w") as f:
        f.write(cmake_content.strip() + "\n")
    return output_path


class NativeToolchain:
    def __init__(self, arch: str, build_multilib: bool = False):
        self.arch = arch
        self.build_multilib = build_multilib
        self.ndk_path = os.environ.get("NDK", "/opt/android-ndk")
        self.api_level = "24"
        self._setup_target()

    def _setup_target(self):
        if self.build_multilib:
            if self.arch == "aarch64":
                self.target_arch = "arm"
            elif self.arch == "x86_64":
                self.target_arch = "i686"
            else:
                self.target_arch = self.arch
        else:
            self.target_arch = self.arch

        target_triple_map = {
            "aarch64": "aarch64-linux-android",
            "arm": "armv7a-linux-androideabi",
            "x86_64": "x86_64-linux-android",
            "i686": "i686-linux-android",
        }
        self.target_triple = target_triple_map.get(self.target_arch)
        if not self.target_triple:
            raise ValueError(f"Unsupported target architecture: {self.target_arch}")

        self.clang_target = f"{self.target_triple}{self.api_level}"

    def get_env(self) -> dict:
        prebuilt_dir = (
            "linux-aarch64"
            if os.path.exists(f"{self.ndk_path}/toolchains/llvm/prebuilt/linux-aarch64")
            else "linux-x86_64"
        )
        llvm_bin = f"{self.ndk_path}/toolchains/llvm/prebuilt/{prebuilt_dir}/bin"

        env = {
            "CC": f"{llvm_bin}/{self.clang_target}-clang",
            "CXX": f"{llvm_bin}/{self.clang_target}-clang++",
            "CPP": f"{llvm_bin}/{self.clang_target}-clang -E",
            "AR": f"{llvm_bin}/llvm-ar",
            "AS": f"{llvm_bin}/{self.clang_target}-clang",
            "LD": f"{llvm_bin}/ld.lld",
            "RANLIB": f"{llvm_bin}/llvm-ranlib",
            "STRIP": f"{llvm_bin}/llvm-strip",
            "NM": f"{llvm_bin}/llvm-nm",
            "OBJCOPY": f"{llvm_bin}/llvm-objcopy",
            "OBJDUMP": f"{llvm_bin}/llvm-objdump",
            "READELF": f"{llvm_bin}/llvm-readelf",
            "FC": f"{llvm_bin}/flang",
            "F77": f"{llvm_bin}/flang",
            "F90": f"{llvm_bin}/flang",
            "CFLAGS": f"-I{PREFIX}/include -O2 -fPIC",
            "CXXFLAGS": f"-I{PREFIX}/include -O2 -fPIC",
            "CPPFLAGS": f"-I{PREFIX}/include",
            "LDFLAGS": f"-L{PREFIX}/lib -Wl,-rpath={PREFIX}/lib",
            "PKG_CONFIG_PATH": f"{PREFIX}/lib/pkgconfig:{PREFIX}/share/pkgconfig",
            "PKG_CONFIG_LIBDIR": f"{PREFIX}/lib/pkgconfig",
            "PREFIX": PREFIX,
            "CMAKE_INSTALL_PREFIX": PREFIX,
            "CMAKE_GENERATOR": "Ninja",
        }
        return env

    def get_cmake_args(self, build_dir: str) -> list[str]:
        os.makedirs(build_dir, exist_ok=True)
        toolchain_file = os.path.join(build_dir, "android.toolchain.cmake")
        generate_cmake_toolchain(self.target_arch, self.ndk_path, toolchain_file)

        args = [
            f"-DCMAKE_TOOLCHAIN_FILE={toolchain_file}",
            "-GNinja",
            f"-DCMAKE_INSTALL_PREFIX={PREFIX}",
            "-DCMAKE_BUILD_TYPE=Release",
            "-DBUILD_TESTING=OFF",
        ]
        return args

    def get_meson_args(self) -> list[str]:
        args = [
            f"--prefix={PREFIX}",
            "--libdir=lib",
            "--buildtype=release",
            "--default-library=shared",
            "--cross-file=android_cross_file.txt",
        ]
        return args
