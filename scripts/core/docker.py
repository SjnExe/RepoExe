import os
import signal
import subprocess
from dataclasses import dataclass
from typing import List, Optional


@dataclass
class DockerConfig:
    image: str = 'repoexe-builder:latest'
    user: str = '1000:1000'
    workdir: str = '/home/builder/RepoExe'
    env: dict | None = None
    seccomp_profile: str = 'docker/profile.json'
    apparmor_profile: str = 'profile-relaxed.apparmor'


class DockerRunner:
    def __init__(self, config: DockerConfig):
        self.config = config
        self.process: Optional[subprocess.Popen] = None

        # Setup signal handlers to propagate cancellation to the docker container gracefully
        signal.signal(signal.SIGINT, self._signal_handler)
        signal.signal(signal.SIGTERM, self._signal_handler)

    def _signal_handler(self, sig: int, frame) -> None:
        """Handles graceful cancellation by terminating the running docker process."""
        if self.process and self.process.poll() is None:
            print(f'\n[DockerRunner] Received signal {sig}, terminating docker process...')
            self.process.send_signal(signal.SIGTERM)
            try:
                self.process.wait(timeout=10)
            except subprocess.TimeoutExpired:
                print('[DockerRunner] Docker process did not terminate, forcing kill...')
                self.process.kill()

    def build_command(self, cmd: List[str]) -> List[str]:
        """Constructs the base docker run command with all hermetic constraints."""
        repo_root = os.environ.get('REPO_ROOT', os.getcwd())

        docker_cmd = [
            'docker',
            'run',
            '--rm',
            '-i',
            f'--user={self.config.user}',
            f'--workdir={self.config.workdir}',
            f'--volume={repo_root}:{self.config.workdir}',
        ]

        # Add security profiles if they exist locally
        if os.path.exists(self.config.seccomp_profile):
            docker_cmd.append(f'--security-opt=seccomp={os.path.abspath(self.config.seccomp_profile)}')
        else:
            docker_cmd.append('--security-opt=seccomp=unconfined')

        if os.path.exists(self.config.apparmor_profile):
            # Typically AppArmor profiles need to be loaded into the host kernel first,
            # but we pass the arg for completeness based on specs.
            docker_cmd.append(f'--security-opt=apparmor={self.config.apparmor_profile}')
        else:
            docker_cmd.append('--security-opt=apparmor=unconfined')

        if self.config.env:
            for key, value in self.config.env.items():
                docker_cmd.extend(['-e', f'{key}={value}'])

        docker_cmd.append(self.config.image)
        docker_cmd.extend(cmd)
        return docker_cmd

    def run(
        self, cmd: List[str], capture_output: bool = False, network_disabled: bool = False
    ) -> subprocess.CompletedProcess:
        """Executes a command synchronously inside the docker container."""
        full_cmd = self.build_command(cmd)

        # If hermetic mode is explicitly requested, drop network
        if network_disabled:
            # We insert --network=none before the image name
            image_idx = full_cmd.index(self.config.image)
            full_cmd.insert(image_idx, '--network=none')

        print(f'[DockerRunner] Executing: {" ".join(full_cmd)}')
        self.process = subprocess.Popen(
            full_cmd,
            stdout=subprocess.PIPE if capture_output else None,
            stderr=subprocess.PIPE if capture_output else None,
            text=True,
        )

        stdout, stderr = self.process.communicate()
        return subprocess.CompletedProcess(
            args=full_cmd, returncode=self.process.returncode, stdout=stdout, stderr=stderr
        )


class DockerBackgroundExec:
    """Manages a long-running background docker container to avoid `docker run` overhead per step."""

    def __init__(self, config: DockerConfig, container_name: str = 'repoexe-daemon'):
        self.config = config
        self.container_name = container_name
        self.process: Optional[subprocess.Popen] = None

        import atexit

        atexit.register(self.stop)

    def start(self, network_disabled: bool = False) -> None:
        """Starts the background container in sleep mode."""
        repo_root = os.environ.get('REPO_ROOT', os.getcwd())

        docker_cmd = [
            'docker',
            'run',
            '-d',
            '--rm',
            f'--name={self.container_name}',
            f'--user={self.config.user}',
            f'--workdir={self.config.workdir}',
            f'--volume={repo_root}:{self.config.workdir}',
        ]

        if os.path.exists(self.config.seccomp_profile):
            docker_cmd.append(f'--security-opt=seccomp={os.path.abspath(self.config.seccomp_profile)}')
        else:
            docker_cmd.append('--security-opt=seccomp=unconfined')

        if os.path.exists(self.config.apparmor_profile):
            docker_cmd.append(f'--security-opt=apparmor={self.config.apparmor_profile}')
        else:
            docker_cmd.append('--security-opt=apparmor=unconfined')

        if network_disabled:
            docker_cmd.append('--network=none')

        if self.config.env:
            for key, value in self.config.env.items():
                docker_cmd.extend(['-e', f'{key}={value}'])

        docker_cmd.append(self.config.image)
        docker_cmd.extend(['sleep', 'infinity'])

        print(f'[DockerBackgroundExec] Starting background container {self.container_name}...')
        subprocess.run(docker_cmd, check=True)

    def exec(self, cmd: List[str], capture_output: bool = False) -> subprocess.CompletedProcess:
        """Executes a command inside the running background container."""
        exec_cmd = ['docker', 'exec', '-i', f'--user={self.config.user}', self.container_name]

        if self.config.env:
            for key, value in self.config.env.items():
                exec_cmd.extend(['-e', f'{key}={value}'])

        exec_cmd.extend(cmd)

        print(f'[DockerBackgroundExec] Executing: {" ".join(exec_cmd)}')
        self.process = subprocess.Popen(
            exec_cmd,
            stdout=subprocess.PIPE if capture_output else None,
            stderr=subprocess.PIPE if capture_output else None,
            text=True,
        )

        stdout, stderr = self.process.communicate()
        return subprocess.CompletedProcess(
            args=exec_cmd, returncode=self.process.returncode, stdout=stdout, stderr=stderr
        )

    def stop(self) -> None:
        """Stops the background container."""
        print(f'\n[DockerBackgroundExec] Stopping background container {self.container_name}...')
        subprocess.run(
            ['docker', 'stop', self.container_name], check=False, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
        )
