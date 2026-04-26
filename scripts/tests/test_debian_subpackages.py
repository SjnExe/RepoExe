import os
import tempfile
from core.packagers.debian import build_deb
from core.parser import BuildYml


def test_build_deb_subpackages():
    with tempfile.TemporaryDirectory() as output_dir:
        # We need a proper structure in destdir to trigger doc and locale
        with tempfile.TemporaryDirectory() as destdir:
            # Create man pages
            man_dir = os.path.join(destdir, 'data/data/com.termux/files/usr/share/man/man1')
            os.makedirs(man_dir)
            with open(os.path.join(man_dir, 'hello.1'), 'w') as f:
                f.write('man page')

            # Create locale
            locale_dir = os.path.join(destdir, 'data/data/com.termux/files/usr/share/locale/fr/LC_MESSAGES')
            os.makedirs(locale_dir)
            with open(os.path.join(locale_dir, 'hello.mo'), 'w') as f:
                f.write('locale file')

            # Create binary
            bin_dir = os.path.join(destdir, 'data/data/com.termux/files/usr/bin')
            os.makedirs(bin_dir)
            with open(os.path.join(bin_dir, 'hello'), 'w') as f:
                f.write('#!/bin/sh\necho "hello"')
            os.chmod(os.path.join(bin_dir, 'hello'), 0o755)

            pkg = BuildYml(
                name='hello',
                version='1.0.0',
                description='A test package',
                homepage='https://example.com',
                license='MIT',
                recommends_doc=True,
                recommends_locale=True,
            )

            build_deb(pkg, destdir, output_dir)

            # Assert .deb files are generated
            files = os.listdir(output_dir)
            assert 'hello_1.0.0-0_aarch64.deb' in files
            assert 'hello-doc_1.0.0-0_all.deb' in files
            assert 'hello-locale_1.0.0-0_all.deb' in files
