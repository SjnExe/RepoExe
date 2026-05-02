import os
import shutil
import subprocess
from typing import List, Dict

from ..parser import BuildYml
from ..properties import PREFIX
from .cleanup import run_all_cleanups


def build_deb(pkg: BuildYml, destdir: str, output_dir: str, target_arch: str = 'aarch64') -> None:
    """Builds a .deb package from the given destdir."""
    run_all_cleanups(destdir, pkg=pkg)

    # 1. Prepare subpackages (doc, locale, dbg) if configured
    if pkg.recommends_doc:
        _build_subpackage(pkg, destdir, output_dir, 'doc', ['share/man', 'share/info'])
    if pkg.recommends_locale:
        _build_subpackage(pkg, destdir, output_dir, 'locale', ['share/locale'])

    # Automatically build a -dbg subpackage if any .dbg files were generated
    _build_dbg_subpackage(pkg, destdir, output_dir, target_arch)

    # 2. Add -glibc suffix if libc == 'glibc'
    pkg_name = pkg.name
    if pkg.libc == 'glibc':
        pkg_name += '-glibc'

    version = pkg.deb_version
    arch = 'all' if pkg.platform_independent else target_arch

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

    pkg_name = f'{pkg.name}-dbg'
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

        # Generate control file for -dbg
        ctrl_dir = os.path.join(tmp_subpkg, 'DEBIAN')
        os.makedirs(ctrl_dir, exist_ok=True)

        control_content = [
            f'Package: {pkg_name}',
            f'Version: {pkg.deb_version}',
            f'Architecture: {target_arch}',
            f'Maintainer: {pkg.maintainer}',
            f'Description: Debug symbols for {pkg.name}',
            f'Depends: {pkg.name} (= {pkg.deb_version})',
        ]

        with open(os.path.join(ctrl_dir, 'control'), 'w') as f:
            f.write('\\n'.join(control_content) + '\\n')

        deb_filename = f'{pkg_name}_{pkg.deb_version}_{target_arch}.deb'
        deb_path = os.path.join(output_dir, deb_filename)

        subprocess.run(['dpkg-deb', '-Zzstd', '--build', tmp_subpkg, deb_path], check=True, stdout=subprocess.DEVNULL)


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
    """Generates Packages, Release, and InRelease files statically.
    Also implements incremental Pdiff generation.
    """
    import hashlib
    from glob import glob

    dists_dir = os.path.join(output_dir, 'dists', 'stable')
    binary_dir = os.path.join(dists_dir, component, f'binary-{arch}')
    os.makedirs(binary_dir, exist_ok=True)

    packages_path = os.path.join(binary_dir, 'Packages')

    # Check for existing Packages to do pdiff
    existing_packages_content = None
    if os.path.exists(packages_path):
        with open(packages_path, 'r', encoding='utf-8') as f:
            existing_packages_content = f.read()

    # 1. Generate Packages file by extracting control files from all .deb files in output_dir
    deb_files = glob(os.path.join(output_dir, f'*_{arch}.deb')) + glob(os.path.join(output_dir, '*_all.deb'))

    new_packages_dict = {}

    for deb in sorted(deb_files):
        # Extract control file from the .deb using dpkg-deb
        try:
            result = subprocess.run(['dpkg-deb', '-f', deb], capture_output=True, text=True, check=True)
            control_data = result.stdout.strip()

            # Parse package name to use as key
            pkg_name = None
            for line in control_data.split('\n'):
                if line.startswith('Package:'):
                    pkg_name = line.split(':', 1)[1].strip()
                    break

            if not pkg_name:
                continue

            # Need to append Filename, Size, SHA256, etc.
            filename = os.path.relpath(deb, output_dir)
            size = os.path.getsize(deb)

            with open(deb, 'rb') as f:
                sha256 = hashlib.sha256(f.read()).hexdigest()

            control_data += f'\nFilename: {filename}\nSize: {size}\nSHA256: {sha256}\n\n'
            new_packages_dict[pkg_name] = control_data
        except subprocess.CalledProcessError as e:
            print(f'Error extracting control from {deb}: {e}')

    packages_content = ''
    # Merge with existing
    if existing_packages_content:
        # We need to split existing_packages_content by paragraphs
        paragraphs = existing_packages_content.strip().split('\n\n')
        for p in paragraphs:
            if not p.strip():
                continue
            pkg_name = None
            for line in p.split('\n'):
                if line.startswith('Package:'):
                    pkg_name = line.split(':', 1)[1].strip()
                    break
            if pkg_name:
                if pkg_name in new_packages_dict:
                    # New package replaces old package
                    packages_content += new_packages_dict[pkg_name]
                    del new_packages_dict[pkg_name]
                else:
                    # Keep old package
                    packages_content += p + '\n\n'

    # Add any remaining new packages
    for pkg_name, data in new_packages_dict.items():
        packages_content += data

    with open(packages_path, 'w', encoding='utf-8') as f:
        f.write(packages_content)

    # Compress Packages
    subprocess.run(['gzip', '-k', '-f', packages_path], check=True)
    subprocess.run(['xz', '-k', '-f', packages_path], check=True)

    # 2. Pdiff Generation
    if existing_packages_content is not None and existing_packages_content != packages_content:
        _generate_pdiff(binary_dir, existing_packages_content, packages_content)

    # 3. Generate Release file
    release_path = os.path.join(dists_dir, 'Release')
    _generate_release(dists_dir, release_path, component, arch)

    # 4. Sign Release file (InRelease)
    _sign_release(release_path)


def _generate_pdiff(binary_dir: str, old_content: str, new_content: str) -> None:
    import tempfile
    import datetime
    import hashlib

    diff_dir = os.path.join(binary_dir, 'Packages.diff')
    os.makedirs(diff_dir, exist_ok=True)

    with (
        tempfile.NamedTemporaryFile(mode='w', delete=False) as old_f,
        tempfile.NamedTemporaryFile(mode='w', delete=False) as new_f,
    ):
        old_f.write(old_content)
        new_f.write(new_content)
        old_path = old_f.name
        new_path = new_f.name

    diff_name = datetime.datetime.utcnow().strftime('%Y-%m-%d-%H%M.%S')
    patch_path = os.path.join(diff_dir, diff_name)

    # Generate ed-style diff
    subprocess.run(['diff', '--ed', old_path, new_path], stdout=open(patch_path, 'w'))
    subprocess.run(['gzip', '-9', '-k', '-f', patch_path], check=True)

    # Clean up temp files
    os.remove(old_path)
    os.remove(new_path)

    # Update Index file
    index_path = os.path.join(diff_dir, 'Index')

    old_sha1 = hashlib.sha1(old_content.encode('utf-8')).hexdigest()
    old_size = len(old_content.encode('utf-8'))

    new_sha1 = hashlib.sha1(new_content.encode('utf-8')).hexdigest()
    new_size = len(new_content.encode('utf-8'))

    # Load existing Index if any
    history = []
    if os.path.exists(index_path):
        with open(index_path, 'r') as f:
            lines = f.read().splitlines()
            in_history = False
            for line in lines:
                if line.startswith('SHA1-History:'):
                    in_history = True
                    continue
                if line.startswith('SHA1-Patches:'):
                    in_history = False
                    continue
                if in_history and line.startswith(' '):
                    parts = line.strip().split()
                    if len(parts) == 3:
                        history.append({'sha1': parts[0], 'size': parts[1], 'name': parts[2]})

    # Prune history to max 255 items (so adding new makes 256)
    history = history[-255:]
    history.append({'sha1': old_sha1, 'size': str(old_size), 'name': diff_name})

    # Prune old patch files not in history
    valid_names = {h['name'] for h in history}
    for file in os.listdir(diff_dir):
        if file != 'Index' and not file.endswith('.gz') and file not in valid_names:
            os.remove(os.path.join(diff_dir, file))
            if os.path.exists(os.path.join(diff_dir, f'{file}.gz')):
                os.remove(os.path.join(diff_dir, f'{file}.gz'))

    with open(index_path, 'w') as f:
        f.write('SHA1-Current: {} {}\n'.format(new_sha1, new_size))
        f.write('SHA1-History:\n')
        for h in history:
            f.write(' {} {} {}\n'.format(h['sha1'], h['size'], h['name']))
        f.write('SHA1-Patches:\n')
        # For simplicity, patches just list the patch file's sha1 and size
        for h in history:
            # Re-read or calculate patch sha1 if needed. Here we assume the patch name corresponds to the patch.
            p_path = os.path.join(diff_dir, h['name'])
            # Since we download old patches as .gz from pages, the raw patch may not exist locally unless generated now.
            # But the APT Index specifies the size and hash of the uncompressed patch.
            # Actually, standard Pdiff requires the hash of the uncompressed patch.
            # If we don't have it, we should probably gzip -d it temporarily.
            p_sha1 = None
            p_size = None
            if os.path.exists(p_path):
                with open(p_path, 'rb') as pf:
                    p_sha1 = hashlib.sha1(pf.read()).hexdigest()
                p_size = os.path.getsize(p_path)
            elif os.path.exists(p_path + '.gz'):
                import gzip

                with gzip.open(p_path + '.gz', 'rb') as pf:
                    uncompressed = pf.read()
                    p_sha1 = hashlib.sha1(uncompressed).hexdigest()
                    p_size = len(uncompressed)

            if p_sha1 is not None and p_size is not None:
                f.write(' {} {} {}\n'.format(p_sha1, p_size, h['name']))


def _generate_release(dists_dir: str, release_path: str, component: str, arch: str) -> None:
    import hashlib
    import datetime

    date_str = datetime.datetime.utcnow().strftime('%a, %d %b %Y %H:%M:%S UTC')

    release_content = [
        'Origin: RepoExe',
        'Label: RepoExe',
        'Suite: stable',
        'Codename: stable',
        f'Date: {date_str}',
        f'Architectures: {arch}',
        f'Components: {component}',
        'Description: RepoExe package repository',
        'MD5Sum:',
    ]

    md5_lines = []
    sha1_lines = []
    sha256_lines = []

    for root, _, files in os.walk(dists_dir):
        for file in files:
            if file in ['Release', 'InRelease']:
                continue

            filepath = os.path.join(root, file)
            relpath = os.path.relpath(filepath, dists_dir)

            with open(filepath, 'rb') as f:
                data = f.read()
                size = len(data)
                md5 = hashlib.md5(data).hexdigest()
                sha1 = hashlib.sha1(data).hexdigest()
                sha256 = hashlib.sha256(data).hexdigest()

            md5_lines.append(f' {md5} {size} {relpath}')
            sha1_lines.append(f' {sha1} {size} {relpath}')
            sha256_lines.append(f' {sha256} {size} {relpath}')

    release_content.extend(md5_lines)
    release_content.append('SHA1:')
    release_content.extend(sha1_lines)
    release_content.append('SHA256:')
    release_content.extend(sha256_lines)

    with open(release_path, 'w', encoding='utf-8') as f:
        f.write('\n'.join(release_content) + '\n')


def _sign_release(release_path: str) -> None:
    gpg_key_path = os.path.join('scripts', 'keys', 'repoexe.gpg')

    if not os.path.exists(gpg_key_path):
        print('Warning: GPG key not found at scripts/keys/repoexe.gpg, skipping repository signing.')
        return

    inrelease_path = os.path.join(os.path.dirname(release_path), 'InRelease')

    # Import key if needed
    subprocess.run(['gpg', '--import', gpg_key_path], check=False, stderr=subprocess.DEVNULL)

    # Delete old InRelease if exists
    if os.path.exists(inrelease_path):
        os.remove(inrelease_path)

    # Sign
    # We might not know the exact key ID, so we sign with the default or all imported keys.
    # --clearsign creates InRelease
    subprocess.run(['gpg', '--clearsign', '--digest-algo', 'SHA512', '-o', inrelease_path, release_path], check=True)
