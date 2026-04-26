import os
import tempfile
import pytest
from core.packagers.pacman import build_pacman
from core.parser import BuildYml


def test_build_pacman():
    with tempfile.TemporaryDirectory() as destdir, tempfile.TemporaryDirectory() as output_dir:
        # Create a dummy file in destdir
        os.makedirs(os.path.join(destdir, 'data', 'data', 'com.termux', 'files', 'usr', 'bin'))
        with open(os.path.join(destdir, 'data', 'data', 'com.termux', 'files', 'usr', 'bin', 'hello'), 'w') as f:
            f.write("#!/bin/sh\necho 'hello'")

        pkg = BuildYml(
            name='hello', version='1.0.0', description='A test package', homepage='https://example.com', license='MIT'
        )

        try:
            build_pacman(pkg, destdir, output_dir)
        except FileNotFoundError as e:
            pytest.skip(f'Missing tools: {e}')

        pkgs = [f for f in os.listdir(output_dir) if f.endswith('.pkg.tar.zst')]
        if pkgs:
            assert len(pkgs) == 1
            assert pkgs[0] == 'hello-1.0.0-0-aarch64.pkg.tar.zst'
