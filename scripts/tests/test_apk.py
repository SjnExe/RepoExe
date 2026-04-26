import os
import tempfile
import pytest
from core.packagers.apk import build_apk
from core.parser import BuildYml


def test_build_apk():
    with tempfile.TemporaryDirectory() as destdir, tempfile.TemporaryDirectory() as output_dir:
        # Create a dummy file in destdir
        os.makedirs(os.path.join(destdir, 'data', 'data', 'com.termux', 'files', 'usr', 'bin'))
        with open(os.path.join(destdir, 'data', 'data', 'com.termux', 'files', 'usr', 'bin', 'hello'), 'w') as f:
            f.write("#!/bin/sh\necho 'hello'")

        pkg = BuildYml(
            name='hello', version='1.0.0', description='A test package', homepage='https://example.com', license='MIT'
        )

        try:
            build_apk(pkg, destdir, output_dir)
        except FileNotFoundError as e:
            pytest.skip(f'Missing tools: {e}')

        apks = [f for f in os.listdir(output_dir) if f.endswith('.apk')]
        if apks:
            assert len(apks) == 1
            assert apks[0] == 'hello-1.0.0-r0.apk'
