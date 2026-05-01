import os
import subprocess
from typing import List, Dict

from ..parser import BuildYml
from .cleanup import run_all_cleanups


def build_pacman(pkg: BuildYml, destdir: str, output_dir: str) -> None:
    """Builds a .pkg.tar.zst package from the given destdir."""
    run_all_cleanups(destdir, pkg=pkg)

    # Automatically build a -dbg subpackage if any .dbg files were generated
    # Assuming target arch is aarch64 if not passed
    _build_dbg_subpackage(pkg, destdir, output_dir, "aarch64")

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


def _build_dbg_subpackage(pkg: BuildYml, destdir: str, output_dir: str, target_arch: str) -> None:
    """Builds a -dbg subpackage dynamically by collecting all .dbg files."""
    import os
    import shutil
    import subprocess
    import tempfile

    # Search for any .dbg files
    has_dbg = False
    for root, _, files in os.walk(destdir):
        if any(f.endswith('.dbg') for f in files):
            has_dbg = True
            break

    if not has_dbg:
        return

    pkg_name = f"{pkg.name}-dbg"
    if pkg.libc == 'glibc':
        pkg_name += '-glibc'

    with tempfile.TemporaryDirectory() as tmp_subpkg:
        # Move all .dbg files
        for root, _, files in os.walk(destdir):
            for file in files:
                if file.endswith('.dbg'):
                    src = os.path.join(root, file)
                    rel_path = os.path.relpath(src, destdir)
                    dst = os.path.join(tmp_subpkg, rel_path)
                    os.makedirs(os.path.dirname(dst), exist_ok=True)
                    shutil.move(src, dst)

        # Generate .PKGINFO for -dbg
        pkginfo_path = os.path.join(tmp_subpkg, '.PKGINFO')
        # For pacman, arch should be the target architecture or "any". However, debug symbols are architecture-specific
        # so we pass target_arch
        pkginfo_content = [
            f'pkgname = {pkg_name}',
            f'pkgver = {pkg.pacman_version}',
            f'pkgdesc = Debug symbols for {pkg.name}',
            f'url = {pkg.homepage}',
            f'builddate = 0',
            f'packager = {pkg.maintainer}',
            f'size = 0',
            f'arch = {target_arch}',
            f'depend = {pkg.name}={pkg.pacman_version}'
        ]

        with open(pkginfo_path, 'w') as f:
            f.write('\\n'.join(pkginfo_content) + '\\n')

        pkg_filename = f'{pkg_name}-{pkg.pacman_version}-{target_arch}.pkg.tar.zst'
        pkg_path = os.path.join(output_dir, pkg_filename)

        subprocess.run(
            ['tar', '-I', 'zstd -c -T0 --ultra -20 -', '-cf', pkg_path, '-C', tmp_subpkg, '.'],
            check=True
        )

def generate_pacman_metadata(output_dir: str, arch: str = 'aarch64') -> None:
    """Generates Pacman database (.db) from .pkg.tar.zst files in the output directory."""
    # Stub for the database generator.
    pass
