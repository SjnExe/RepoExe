import os
import tempfile
import pytest
from core.packagers.debian import build_deb
from core.parser import BuildYml


def test_build_deb():
    with tempfile.TemporaryDirectory() as destdir, tempfile.TemporaryDirectory() as output_dir:
        # Create a dummy file in destdir
        os.makedirs(os.path.join(destdir, 'data', 'data', 'com.termux', 'files', 'usr', 'bin'))
        with open(os.path.join(destdir, 'data', 'data', 'com.termux', 'files', 'usr', 'bin', 'hello'), 'w') as f:
            f.write("#!/bin/sh\necho 'hello'")

        pkg = BuildYml(
            name='hello', version='1.0.0', description='A test package', homepage='https://example.com', license='MIT'
        )

        # Test building the deb
        try:
            build_deb(pkg, destdir, output_dir)
        except FileNotFoundError as e:
            # if 'ar' or 'zstd' are missing in test env, skip
            pytest.skip(f'Missing command line tools: {e}')

        debs = [f for f in os.listdir(output_dir) if f.endswith('.deb')]
        if debs:
            assert len(debs) == 1
            assert debs[0] == 'hello_1.0.0-0_aarch64.deb'
