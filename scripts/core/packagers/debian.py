import os
import shutil
import subprocess
from typing import List, Dict

from ..parser import BuildYml
from ..properties import PREFIX
from .cleanup import run_all_cleanups


def build_deb(pkg: BuildYml, destdir: str, output_dir: str) -> None:
    """Builds a .deb package from the given destdir."""
    run_all_cleanups(destdir)

    # 1. Prepare subpackages (doc, locale) if configured
    if pkg.recommends_doc:
        _build_subpackage(pkg, destdir, output_dir, 'doc', ['share/man', 'share/info'])
    if pkg.recommends_locale:
        _build_subpackage(pkg, destdir, output_dir, 'locale', ['share/locale'])

    # 2. Add -glibc suffix if libc == 'glibc'
    pkg_name = pkg.name
    if pkg.libc == 'glibc':
        pkg_name += '-glibc'

    version = pkg.deb_version
    arch = 'all' if pkg.platform_independent else 'aarch64'  # TODO: dynamic arch based on target

    import math

    # Calculate installed size in KB
    install_size_kb = math.ceil(
        sum(
            os.path.getsize(os.path.join(dirpath, filename))
            for dirpath, _, filenames in os.walk(destdir)
            for filename in filenames
        )
        / 1024.0
    )

    control_dir = os.path.join(output_dir, f'{pkg_name}_control_tmp')
    os.makedirs(control_dir, exist_ok=True)

    # Generate control file
    control_content = f"""Package: {pkg_name}
Architecture: {arch}
Installed-Size: {install_size_kb}
Maintainer: {pkg.maintainer or 'RepoExe <admin@repoexe.com>'}
Version: {version}
Homepage: {pkg.homepage}
Description: {pkg.description}
"""

    # Handle dependencies and -glibc suffixing
    def format_deps(deps: Dict[str, List[str]]) -> str:
        flattened = []
        for repo, pkgs in deps.items():
            for p in pkgs:
                if pkg.libc == 'glibc' and 'glibc' not in p:
                    flattened.append(f'{p}-glibc')
                else:
                    flattened.append(p)
        return ', '.join(flattened)

    if pkg.depends:
        control_content += f'Depends: {format_deps(pkg.depends)}\n'
    if pkg.pre_depends:
        control_content += f'Pre-Depends: {format_deps(pkg.pre_depends)}\n'
    if pkg.essential:
        control_content += 'Essential: yes\n'

    with open(os.path.join(control_dir, 'control'), 'w') as f:
        f.write(control_content)

    if pkg.conffiles:
        with open(os.path.join(control_dir, 'conffiles'), 'w') as f:
            for conf in pkg.conffiles:
                f.write(f'{PREFIX}/{conf}\n')

    # Create data.tar.zst
    data_tar_path = os.path.join(output_dir, 'data.tar.zst')
    # using shell command for zstd to ensure standard zstd format
    subprocess.run(['tar', '--zstd', '-cf', data_tar_path, '-C', destdir, '.'], check=True)

    # Create control.tar.zst
    control_tar_path = os.path.join(output_dir, 'control.tar.zst')
    subprocess.run(['tar', '--zstd', '-cf', control_tar_path, '-C', control_dir, '.'], check=True)

    # Create debian-binary
    debian_binary_path = os.path.join(output_dir, 'debian-binary')
    with open(debian_binary_path, 'w') as f:
        f.write('2.0\n')

    # Create final .deb using ar
    deb_filename = f'{pkg_name}_{version}_{arch}.deb'
    deb_filepath = os.path.join(output_dir, deb_filename)

    subprocess.run(
        ['ar', 'qc', deb_filepath, 'debian-binary', 'control.tar.zst', 'data.tar.zst'], cwd=output_dir, check=True
    )

    # Clean up temp files
    os.remove(data_tar_path)
    os.remove(control_tar_path)
    os.remove(debian_binary_path)
    shutil.rmtree(control_dir)

    print(f'Successfully generated {deb_filepath}')


def _build_subpackage(pkg: BuildYml, destdir: str, output_dir: str, subpkg_type: str, subdirs: List[str]) -> None:
    """Extracts subpackage files from destdir and builds a discrete .deb package."""
    subpkg_name = f'{pkg.name}-{subpkg_type}'
    if pkg.libc == 'glibc':
        subpkg_name += '-glibc'

    version = pkg.deb_version
    arch = 'all'  # Documentation and locales are architecture independent

    # Create temporary subpackage destdir
    sub_destdir = os.path.join(output_dir, f'{subpkg_name}_destdir_tmp')
    os.makedirs(sub_destdir, exist_ok=True)

    files_moved = False

    # Move files from destdir to sub_destdir
    prefix_path = PREFIX.lstrip('/')
    for subdir in subdirs:
        src_path = os.path.join(destdir, prefix_path, subdir)
        if os.path.exists(src_path):
            dst_path = os.path.join(sub_destdir, prefix_path, subdir)
            os.makedirs(os.path.dirname(dst_path), exist_ok=True)
            shutil.move(src_path, dst_path)
            files_moved = True

    if not files_moved:
        shutil.rmtree(sub_destdir)
        return

    import math

    # Calculate installed size in KB
    install_size_kb = math.ceil(
        sum(
            os.path.getsize(os.path.join(dirpath, filename))
            for dirpath, _, filenames in os.walk(sub_destdir)
            for filename in filenames
        )
        / 1024.0
    )

    control_dir = os.path.join(output_dir, f'{subpkg_name}_control_tmp')
    os.makedirs(control_dir, exist_ok=True)

    # Generate control file
    control_content = f"""Package: {subpkg_name}
Architecture: {arch}
Installed-Size: {install_size_kb}
Maintainer: {pkg.maintainer or 'RepoExe <admin@repoexe.com>'}
Version: {version}
Homepage: {pkg.homepage}
Description: {pkg.description} ({subpkg_type})
"""

    # If it's a subpackage, it usually depends on the main package
    main_pkg_name = pkg.name
    if pkg.libc == 'glibc':
        main_pkg_name += '-glibc'
    # Actually termux recommends_doc/locale logic means the main pkg RECOMMENDS them, not the other way around.
    # But wait, does the doc pkg depend on the main pkg? Usually yes or nothing.
    # For now, let's keep it clean without explicit dependency back to the main pkg to avoid cycles unless needed.

    with open(os.path.join(control_dir, 'control'), 'w') as f:
        f.write(control_content)

    # Create temporary directory for ar members
    ar_dir = os.path.join(output_dir, f'{subpkg_name}_ar_tmp')
    os.makedirs(ar_dir, exist_ok=True)

    # Create data.tar.zst
    data_tar_path = os.path.join(ar_dir, 'data.tar.zst')
    subprocess.run(['tar', '--zstd', '-cf', data_tar_path, '-C', sub_destdir, '.'], check=True)

    # Create control.tar.zst
    control_tar_path = os.path.join(ar_dir, 'control.tar.zst')
    subprocess.run(['tar', '--zstd', '-cf', control_tar_path, '-C', control_dir, '.'], check=True)

    # Create debian-binary
    debian_binary_path = os.path.join(ar_dir, 'debian-binary')
    with open(debian_binary_path, 'w') as f:
        f.write('2.0\n')

    # Create final .deb using ar
    deb_filename = f'{subpkg_name}_{version}_{arch}.deb'
    deb_filepath = os.path.join(output_dir, deb_filename)

    # We must run ar from within the ar_dir so the paths inside the ar archive are relative basenames
    subprocess.run(
        ['ar', 'qc', deb_filepath, 'debian-binary', 'control.tar.zst', 'data.tar.zst'], cwd=ar_dir, check=True
    )

    # Clean up temp files
    shutil.rmtree(ar_dir)
    shutil.rmtree(control_dir)
    shutil.rmtree(sub_destdir)

    print(f'Successfully generated {deb_filepath}')


def generate_apt_metadata(output_dir: str, component: str = 'main', arch: str = 'aarch64') -> None:
    """Generates Packages, Release, and InRelease files statically."""
    # This is a stub for the static APT generator.
    # It would normally iterate over all .deb files in output_dir, extract their control files,
    # generate the Packages file, compress it, then generate the Release file with checksums,
    # and finally sign it using GPG to create InRelease.
    pass
