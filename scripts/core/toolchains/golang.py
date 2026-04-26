class GolangToolchain:
    def __init__(self, arch: str):
        self.arch = arch
        self._setup_target()

    def _setup_target(self):
        arch_map = {
            'aarch64': 'arm64',
            'arm': 'arm',
            'x86_64': 'amd64',
            'i686': '386',
        }
        self.goarch = arch_map.get(self.arch)
        if not self.goarch:
            raise ValueError(f'Unsupported architecture for Golang: {self.arch}')

    def get_env(self, native_env: dict) -> dict:
        """Returns Golang environment variables, enabling CGO."""
        env = {
            'GOOS': 'android',
            'GOARCH': self.goarch,
            'CGO_ENABLED': '1',
            'CC': native_env.get('CC', 'clang'),
            'CXX': native_env.get('CXX', 'clang++'),
            'CGO_CFLAGS': native_env.get('CFLAGS', ''),
            'CGO_CPPFLAGS': native_env.get('CPPFLAGS', ''),
            'CGO_CXXFLAGS': native_env.get('CXXFLAGS', ''),
            'CGO_LDFLAGS': native_env.get('LDFLAGS', ''),
        }

        if self.arch == 'arm':
            env['GOARM'] = '7'

        return env
