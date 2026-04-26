import os
import subprocess
from typing import List, Dict

from ..parser import BuildYml
from .cleanup import run_all_cleanups


def build_apk(pkg: BuildYml, destdir: str, output_dir: str) -> None:
    """Builds an .apk package from the given destdir."""
    run_all_cleanups(destdir)

    pkg_name = pkg.name
    if pkg.libc == 'glibc':
        pkg_name += '-glibc'

    version = pkg.apk_version
    arch = 'noarch' if pkg.platform_independent else 'aarch64'

    install_size_bytes = sum(
        os.path.getsize(os.path.join(dirpath, filename))
        for dirpath, _, filenames in os.walk(destdir)
        for filename in filenames
    )

    pkginfo_path = os.path.join(destdir, '.PKGINFO')

    def format_deps(deps: Dict[str, List[str]]) -> List[str]:
        flattened = []
        for repo, pkgs in deps.items():
            for p in pkgs:
                if pkg.libc == 'glibc' and 'glibc' not in p:
                    flattened.append(f'{p}-glibc')
                else:
                    flattened.append(p)
        return flattened

    depends = format_deps(pkg.depends)

    with open(pkginfo_path, 'w') as f:
        f.write(f'pkgname = {pkg_name}\n')
        f.write(f'pkgver = {version}\n')
        f.write(f'pkgdesc = {pkg.description}\n')
        f.write(f'url = {pkg.homepage}\n')
        f.write('builddate = 1\n')  # This should be SOURCE_DATE_EPOCH or similar
        f.write(f'packager = {pkg.maintainer or "RepoExe <admin@repoexe.com>"}\n')
        f.write(f'size = {install_size_bytes}\n')
        f.write(f'arch = {arch}\n')
        f.write(f'license = {pkg.license}\n')

        for dep in depends:
            f.write(f'depend = {dep}\n')

    tar_filename = f'{pkg_name}-{version}.apk'
    tar_filepath = os.path.join(output_dir, tar_filename)

    # Note: A real apk requires generating a control.tar.gz and a data.tar.gz, optionally concatenated
    # with an RSA signature tarball prepended. For now, we will create a basic tarball similar to pacman.
    # The RSA signature appending logic would typically read ALPINE_PRIVATE_KEY and use `abuild-sign`.
    # Create data.tar.gz
    data_tar_path = os.path.join(output_dir, 'data.tar.gz')
    subprocess.run(['tar', '-czf', data_tar_path, '--owner=0', '--group=0', '-C', destdir, '.'], check=True)

    # Create control.tar.gz
    control_tar_path = os.path.join(output_dir, 'control.tar.gz')
    control_dir = os.path.join(output_dir, 'apk_control_tmp')
    os.makedirs(control_dir, exist_ok=True)
    import shutil

    shutil.copy2(pkginfo_path, os.path.join(control_dir, '.PKGINFO'))
    subprocess.run(['tar', '-czf', control_tar_path, '--owner=0', '--group=0', '-C', control_dir, '.'], check=True)

    # Concatenate to create final apk
    with open(tar_filepath, 'wb') as outfile:
        with open(control_tar_path, 'rb') as infile:
            shutil.copyfileobj(infile, outfile)
        with open(data_tar_path, 'rb') as infile:
            shutil.copyfileobj(infile, outfile)

    os.remove(data_tar_path)
    os.remove(control_tar_path)
    shutil.rmtree(control_dir)
    print(f'Successfully generated {tar_filepath}')


def generate_apk_metadata(output_dir: str, arch: str = 'aarch64') -> None:
    """Generates APKINDEX.tar.gz from .apk files in the output directory."""
    # Stub for the index generator.
    pass
