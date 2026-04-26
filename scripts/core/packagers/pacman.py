import os
import subprocess
from typing import List, Dict

from ..parser import BuildYml
from .cleanup import run_all_cleanups


def build_pacman(pkg: BuildYml, destdir: str, output_dir: str) -> None:
    """Builds a .pkg.tar.zst package from the given destdir."""
    run_all_cleanups(destdir)

    pkg_name = pkg.name
    if pkg.libc == 'glibc':
        pkg_name += '-glibc'

    version = pkg.pacman_version
    arch = 'any' if pkg.platform_independent else 'aarch64'

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

    tar_filename = f'{pkg_name}-{version}-{arch}.pkg.tar.zst'
    tar_filepath = os.path.join(output_dir, tar_filename)

    subprocess.run(['tar', '--zstd', '-cf', tar_filepath, '-C', destdir, '.'], check=True)

    # Clean up .PKGINFO from destdir
    os.remove(pkginfo_path)

    print(f'Successfully generated {tar_filepath}')


def generate_pacman_metadata(output_dir: str, arch: str = 'aarch64') -> None:
    """Generates Pacman database (.db) from .pkg.tar.zst files in the output directory."""
    # Stub for the database generator.
    pass
