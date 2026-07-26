from pathlib import Path

PREFIX = "/data/data/com.termux/files/usr"
HOME = "/data/data/com.termux/files/home"
TERMUX_PREFIX = PREFIX
TERMUX_HOME = HOME


class SystemProperties:
    @property
    def prefix(self) -> str:
        return PREFIX

    @property
    def bin_dir(self) -> str:
        return f"{PREFIX}/bin"

    @property
    def lib_dir(self) -> str:
        return f"{PREFIX}/lib"

    @property
    def include_dir(self) -> str:
        return f"{PREFIX}/include"

    def get_env_vars(self) -> dict[str, str]:
        return {
            "PREFIX": self.prefix,
            "CFLAGS": f"-I{self.include_dir}",
            "CPPFLAGS": f"-I{self.include_dir}",
            "LDFLAGS": f"-L{self.lib_dir} -Wl,-rpath={self.lib_dir}",
        }
