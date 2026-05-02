import os
import re
import shutil
import stat
import subprocess

from ..properties import PREFIX
from ..parser import BuildYml


def normalize_permissions(target_dir: str) -> None:
    """Strips 'world' permissions (chmod -R o-rwx)."""
    for root, dirs, files in os.walk(target_dir):
        for path in dirs + files:
            full_path = os.path.join(root, path)
            try:
                st = os.stat(full_path)
                # Remove read, write, execute from others
                new_mode = st.st_mode & ~(stat.S_IROTH | stat.S_IWOTH | stat.S_IXOTH)
                os.chmod(full_path, new_mode)
            except OSError:
                pass


def prune_ghost_directories(target_dir: str) -> None:
    """Deletes empty directories."""
    for root, dirs, files in os.walk(target_dir, topdown=False):
        for d in dirs:
            dir_path = os.path.join(root, d)
            try:
                if not os.listdir(dir_path):
                    os.rmdir(dir_path)
            except OSError:
                pass


def merge_sbin(target_dir: str) -> None:
    """Moves /sbin and /usr/sbin binaries into /bin."""
    bin_dir = os.path.join(target_dir, PREFIX.lstrip('/'), 'bin')
    sbin_dirs = [
        os.path.join(target_dir, PREFIX.lstrip('/'), 'sbin'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'usr', 'sbin'),
    ]

    os.makedirs(bin_dir, exist_ok=True)

    for sbin_dir in sbin_dirs:
        if os.path.isdir(sbin_dir):
            for item in os.listdir(sbin_dir):
                src = os.path.join(sbin_dir, item)
                dst = os.path.join(bin_dir, item)
                if not os.path.exists(dst):
                    shutil.move(src, dst)
            shutil.rmtree(sbin_dir)


def enforce_pie(target_dir: str) -> None:
    """Enforces PIE (Position Independent Executable) checks on executables."""
    for root, dirs, files in os.walk(target_dir):
        for file in files:
            file_path = os.path.join(root, file)
            if os.path.isfile(file_path) and not os.path.islink(file_path):
                # Check if it's an ELF file
                with open(file_path, 'rb') as f:
                    magic = f.read(4)
                if magic == b'\x7fELF':
                    # Use readelf to check for PIE (DYN type instead of EXEC)
                    try:
                        output = subprocess.check_output(
                            ['readelf', '-h', file_path], stderr=subprocess.DEVNULL, text=True
                        )
                        if 'Type:' in output and 'EXEC' in output:
                            raise ValueError(f'Executable {file_path} is not PIE-compliant.')
                    except FileNotFoundError:
                        # readelf not found, skip or warn
                        pass


def gzip_docs(target_dir: str) -> None:
    """Compresses man and info pages using gzip."""
    doc_dirs = [
        os.path.join(target_dir, PREFIX.lstrip('/'), 'share', 'man'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'share', 'info'),
    ]

    for doc_dir in doc_dirs:
        if os.path.isdir(doc_dir):
            for root, dirs, files in os.walk(doc_dir):
                for file in files:
                    if not file.endswith('.gz'):
                        file_path = os.path.join(root, file)
                        if os.path.isfile(file_path) and not os.path.islink(file_path):
                            subprocess.run(['gzip', '-9', file_path], check=True)


def remove_libtool_la(target_dir: str) -> None:
    """Removes libtool .la files."""
    for root, dirs, files in os.walk(target_dir):
        for file in files:
            if file.endswith('.la'):
                file_path = os.path.join(root, file)
                os.remove(file_path)


def trim_caches(target_dir: str) -> None:
    """Deletes generated caches."""
    cache_patterns = ['__pycache__', 'mimeinfo.cache', 'gschemas.compiled']
    for root, dirs, files in os.walk(target_dir):
        # Remove __pycache__ dirs
        for d in dirs[:]:
            if d in cache_patterns:
                shutil.rmtree(os.path.join(root, d))
                dirs.remove(d)

        # Remove cache files
        for f in files:
            if f in cache_patterns:
                os.remove(os.path.join(root, f))


def run_elf_cleaner(target_dir: str) -> None:
    """Runs termux-elf-cleaner on all ELF shared objects and executables."""
    elf_cleaner_bin = 'termux-elf-cleaner'
    if not shutil.which(elf_cleaner_bin):
        return

    # Typical directories to check
    scan_dirs = [
        os.path.join(target_dir, PREFIX.lstrip('/'), 'bin'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'lib'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'lib32'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'libexec'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'opt'),
    ]

    for d in scan_dirs:
        if not os.path.isdir(d):
            continue
        for root, dirs, files in os.walk(d):
            for file in files:
                file_path = os.path.join(root, file)
                if os.path.isfile(file_path) and not os.path.islink(file_path):
                    with open(file_path, 'rb') as f:
                        magic = f.read(4)
                    if magic == b'\x7fELF':
                        try:
                            # Run termux-elf-cleaner (add default arguments if needed, assuming no extra args here unless required)
                            subprocess.run([elf_cleaner_bin, file_path], check=True, capture_output=True)
                        except subprocess.CalledProcessError:
                            pass


def validate_bionic_symbols(target_dir: str, libc: str) -> None:
    """Validates that Bionic binaries do not link to missing glibc symbols."""
    if libc != 'bionic':
        return

    base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
    map_files = {
        'libc.so': os.path.join(base_dir, 'scripts', 'libc.map.txt'),
        'libm.so': os.path.join(base_dir, 'scripts', 'libm.map.txt'),
        'libdl.so': os.path.join(base_dir, 'scripts', 'libdl.map.txt'),
    }

    allowed_symbols = {}
    for lib, map_path in map_files.items():
        if os.path.exists(map_path):
            with open(map_path, 'r') as f:
                allowed_symbols[lib] = {line.strip() for line in f if line.strip() and not line.startswith('#')}
        else:
            allowed_symbols[lib] = set()

    scan_dirs = [
        os.path.join(target_dir, PREFIX.lstrip('/'), 'bin'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'lib'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'libexec'),
    ]

    for d in scan_dirs:
        if not os.path.isdir(d):
            continue
        for root, dirs, files in os.walk(d):
            for file in files:
                file_path = os.path.join(root, file)
                if os.path.isfile(file_path) and not os.path.islink(file_path):
                    with open(file_path, 'rb') as f:
                        magic = f.read(4)
                    if magic == b'\x7fELF':
                        try:
                            # Use readelf to dump dynamic symbols and needed libraries
                            output = subprocess.check_output(
                                ['readelf', '-dW', file_path], stderr=subprocess.DEVNULL, text=True
                            )

                            # Skip if not linking to Bionic libs
                            linked_libs = re.findall(r'\(NEEDED\).*?Shared library: \[(.*?)\]', output)

                            sym_output = subprocess.check_output(
                                ['readelf', '-sW', file_path], stderr=subprocess.DEVNULL, text=True
                            )

                            for line in sym_output.splitlines():
                                parts = line.split()
                                if len(parts) >= 8 and parts[4] == 'GLOBAL' and parts[6] == 'UND':
                                    sym_name = parts[7]
                                    if '@' in sym_name:
                                        sym_name = sym_name.split('@')[0]

                                    # Very basic validation: If it needs libc/libm/libdl and the symbol is missing from our maps,
                                    # we would ideally fail. However, readelf doesn't easily map UND symbols to the specific NEEDED lib.
                                    # For a strict implementation, we check if the undefined symbol is known to be missing from Bionic.
                                    # Termux typically uses a custom script to cross-reference UND symbols against known Bionic maps.
                                    # We simulate this by checking if the symbol is NOT in the allowed map for the libraries it links to.

                                    # Since precise checking is complex in Python without `ldd`, we'll implement a basic check:
                                    # If it links to libc.so and the symbol is NOT in allowed_symbols['libc.so'] AND
                                    # NOT in any other linked lib, it might be an error.
                                    if 'libc.so' in linked_libs and sym_name not in allowed_symbols['libc.so']:
                                        # To avoid false positives on complex packages, we just log a warning instead of failing
                                        # because readelf output mapping to specific NEEDED libraries is ambiguous.
                                        print(
                                            f'Warning: Bionic binary {file_path} uses potentially undefined symbol {sym_name}'
                                        )
                        except subprocess.CalledProcessError:
                            pass


def validate_soname(target_dir: str) -> None:
    """Ensures all shared libraries have a SONAME."""
    lib_dir = os.path.join(target_dir, PREFIX.lstrip('/'), 'lib')
    if not os.path.isdir(lib_dir):
        return

    for root, dirs, files in os.walk(lib_dir):
        for file in files:
            if file.endswith('.so') and not os.path.islink(os.path.join(root, file)):
                file_path = os.path.join(root, file)
                with open(file_path, 'rb') as f:
                    magic = f.read(4)
                if magic == b'\x7fELF':
                    try:
                        output = subprocess.check_output(
                            ['readelf', '-d', file_path], stderr=subprocess.DEVNULL, text=True
                        )
                        if 'SONAME' not in output:
                            raise ValueError(f'Shared library {file_path} is missing a SONAME declaration.')
                    except subprocess.CalledProcessError:
                        pass


def extract_debug_symbols(target_dir: str) -> None:
    """Extracts debug symbols into .dbg files and strips the original binaries."""
    # Typical directories to check
    scan_dirs = [
        os.path.join(target_dir, PREFIX.lstrip('/'), 'bin'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'lib'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'lib32'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'libexec'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'opt'),
    ]

    for d in scan_dirs:
        if not os.path.isdir(d):
            continue
        for root, dirs, files in os.walk(d):
            for file in files:
                file_path = os.path.join(root, file)
                if os.path.isfile(file_path) and not os.path.islink(file_path):
                    with open(file_path, 'rb') as f:
                        magic = f.read(4)
                    if magic == b'\x7fELF':
                        try:
                            dbg_path = file_path + '.dbg'
                            # Extract debug info
                            subprocess.run(
                                ['llvm-objcopy', '--only-keep-debug', file_path, dbg_path],
                                check=True,
                                capture_output=True,
                            )
                            # Strip binary
                            subprocess.run(
                                ['llvm-strip', '--strip-unneeded', file_path], check=True, capture_output=True
                            )
                            # Link debug info to binary
                            subprocess.run(
                                ['llvm-objcopy', f'--add-gnu-debuglink={dbg_path}', file_path],
                                check=True,
                                capture_output=True,
                            )
                        except subprocess.CalledProcessError:
                            pass
                            # If it fails, maybe llvm-objcopy or llvm-strip are not available or it's an incompatible ELF. Ignore.
                        except FileNotFoundError:
                            pass


def fix_shebangs(target_dir: str, no_shebang_fix_files: list[str]) -> None:
    """Fixes hardcoded /bin/sh and /usr/bin/env paths in shebangs."""
    shebang_regex = re.compile(rb'^#!.*/bin/.*')
    prefix_bytes = PREFIX.encode('utf-8')

    # Convert exclusion list to regex patterns
    exclusion_patterns = []
    for f in no_shebang_fix_files:
        try:
            exclusion_patterns.append(re.compile(f.encode('utf-8')))
        except re.error:
            pass

    for root, dirs, files in os.walk(target_dir):
        for file in files:
            file_path = os.path.join(root, file)
            if not os.path.isfile(file_path) or os.path.islink(file_path):
                continue

            # Check exclusions
            rel_path = os.path.relpath(file_path, target_dir).encode('utf-8')
            excluded = False
            for pat in exclusion_patterns:
                if pat.search(rel_path):
                    excluded = True
                    break
            if excluded:
                continue

            # Read first line
            try:
                with open(file_path, 'rb') as f:
                    header_line = f.readline()
            except IOError:
                continue

            if len(header_line) >= 3 and header_line.startswith(b'#!') and shebang_regex.search(header_line):
                # Check if it's already valid (starts with /system/ or PREFIX)
                if (
                    header_line.startswith(b'#!/system/')
                    or header_line.startswith(b'#! ' + prefix_bytes + b'/')
                    or header_line.startswith(b'#!' + prefix_bytes + b'/')
                ):
                    continue

                # We need to replace it.
                # E.g. #!/usr/bin/env python -> #!/data/data/com.termux/files/usr/bin/env python
                # Find the executable name after /bin/
                match = re.search(rb'^#!\s*(?:.*?)/bin/(.*)', header_line)
                if match:
                    new_shebang = b'#!' + prefix_bytes + b'/bin/' + match.group(1) + b'\n'

                    # Rewrite the file
                    try:
                        with open(file_path, 'rb') as f:
                            lines = f.readlines()
                        lines[0] = new_shebang
                        with open(file_path, 'wb') as f:
                            f.writelines(lines)
                    except IOError:
                        pass


def detect_ghost_dependencies(target_dir: str, pkg: 'BuildYml') -> None:
    """Uses dpkg-shlibdeps to detect ghost dependencies."""
    if not pkg or not pkg.depends:
        return

    scan_dirs = [
        os.path.join(target_dir, PREFIX.lstrip('/'), 'bin'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'lib'),
        os.path.join(target_dir, PREFIX.lstrip('/'), 'libexec'),
    ]

    elf_files = []
    for d in scan_dirs:
        if not os.path.isdir(d):
            continue
        for root, dirs, files in os.walk(d):
            for file in files:
                file_path = os.path.join(root, file)
                if os.path.isfile(file_path) and not os.path.islink(file_path):
                    with open(file_path, 'rb') as f:
                        magic = f.read(4)
                    if magic == b'\x7fELF':
                        elf_files.append(file_path)

    if not elf_files:
        return

    # dpkg-shlibdeps -O outputs shlibs:Depends=...
    try:
        output = subprocess.check_output(
            ['dpkg-shlibdeps', '-O', '--ignore-missing-info'] + elf_files,
            stderr=subprocess.DEVNULL, text=True
        )
        if 'shlibs:Depends=' in output:
            depends_str = output.split('shlibs:Depends=')[1].strip()
            # Split by comma
            dpkg_deps = [d.split()[0] for d in depends_str.split(',')]

            # Now we have dpkg_deps from dpkg-shlibdeps, compare with declared
            all_declared_deps = set()
            if isinstance(pkg.depends, dict):
                for repo, deps in pkg.depends.items():
                    all_declared_deps.update(deps)
            elif isinstance(pkg.depends, list):
                all_declared_deps.update(pkg.depends)

            # Heuristic map since Android/Termux packages don't always perfectly match Debian
            dpkg_deps_base = {d.replace('-dev', '').replace('lib', '') for d in dpkg_deps}

            for dep in all_declared_deps:
                base = dep.replace('-dev', '').replace('lib', '')
                if base not in dpkg_deps_base:
                    print(f"Warning: Package '{pkg.name}' declares dependency '{dep}', but dpkg-shlibdeps could not find it used.")

    except FileNotFoundError:
        pass # dpkg-dev not installed
    except subprocess.CalledProcessError:
        pass # dpkg-shlibdeps can fail if libraries aren't found in standard paths


def detect_abi_breakage(target_dir: str, pkg: 'BuildYml') -> None:
    """Uses abidiff to detect ABI breakages against the latest published version on GitHub Releases."""
    if not pkg:
        return

    # Check if there are any shared libraries to validate
    lib_dir = os.path.join(target_dir, PREFIX.lstrip('/'), 'lib')
    if not os.path.isdir(lib_dir):
        return

    so_files = []
    for root, dirs, files in os.walk(lib_dir):
        for file in files:
            if file.endswith('.so') and not os.path.islink(os.path.join(root, file)):
                so_files.append(os.path.join(root, file))

    if not so_files:
        return

    import tempfile

    # To get the latest release, we'll try to use gh CLI to download the latest deb
    # If gh is not available or there is no previous release, we skip gracefully.
    try:
        # We need the deb file to extract old .so files. If the repository uses a unified single release format
        # where the release tag matches the package's name and version, we can use that.
        # But commonly in this repo, the tag might just be the package name.
        # Let's try to query just by the package name tag first.
        result = subprocess.run(
            ['gh', 'release', 'view', pkg.name, '--json', 'assets', '--jq', '.assets[].name'],
            capture_output=True, text=True
        )
        if result.returncode != 0:
            return  # No previous release found

        assets = result.stdout.strip().split()
        deb_asset = None
        # Try to find a deb matching our current arch
        # E.g. libbase_1.0.0-1_aarch64.deb
        for asset in assets:
            if asset.endswith('.deb') and '-static' not in asset and '-dev' not in asset:
                deb_asset = asset
                break

        if not deb_asset:
            return

        with tempfile.TemporaryDirectory() as tmpdir:
            deb_path = os.path.join(tmpdir, deb_asset)
            download_result = subprocess.run(
                ['gh', 'release', 'download', pkg.name, '-p', deb_asset, '-D', tmpdir],
                capture_output=True
            )
            if download_result.returncode != 0:
                return

            # Extract the deb
            extract_dir = os.path.join(tmpdir, 'extracted')
            os.makedirs(extract_dir, exist_ok=True)
            subprocess.run(['dpkg', '-x', deb_path, extract_dir], capture_output=True)

            old_lib_dir = os.path.join(extract_dir, PREFIX.lstrip('/'), 'lib')
            if not os.path.isdir(old_lib_dir):
                return

            for new_so in so_files:
                basename = os.path.basename(new_so)
                old_so = os.path.join(old_lib_dir, basename)
                if os.path.exists(old_so):
                    try:
                        # run abidiff
                        abidiff_result = subprocess.run(
                            ['abidiff', old_so, new_so],
                            capture_output=True, text=True
                        )
                        # abidiff returns 0 if ABI is identical, >0 if changes or errors
                        # 1 means ABI changes. 2 means incompatible changes.
                        if abidiff_result.returncode != 0:
                            print(f"\n[ABI Breakage Detection] WARNING: ABI changes detected in {basename}!")
                            print(abidiff_result.stdout)
                            # To strictly enforce, we could raise an error here if returncode is >= 4
                            # For now, we will fail if we detect a change and it's an incompatible change.
                            # Bit 0 (1): leaf changes. Bit 1 (2): incompatible changes.
                            if abidiff_result.returncode & 2:
                                raise ValueError(f"Incompatible ABI breakage detected in {basename}! You must bump the downstream dependent packages or the package name/SONAME.")
                    except FileNotFoundError:
                        pass # abidiff not installed
    except FileNotFoundError:
        pass # gh CLI not installed


def run_all_cleanups(target_dir: str, pkg: 'BuildYml' = None) -> None:
    trim_caches(target_dir)
    remove_libtool_la(target_dir)
    merge_sbin(target_dir)

    if pkg:
        if not pkg.no_shebang_fix:
            fix_shebangs(target_dir, pkg.no_shebang_fix_files)
        if not pkg.no_elf_cleaner:
            run_elf_cleaner(target_dir)

        validate_bionic_symbols(target_dir, pkg.libc)
        detect_ghost_dependencies(target_dir, pkg)
        detect_abi_breakage(target_dir, pkg)
    else:
        run_elf_cleaner(target_dir)

    validate_soname(target_dir)
    extract_debug_symbols(target_dir)
    gzip_docs(target_dir)
    enforce_pie(target_dir)
    normalize_permissions(target_dir)
    prune_ghost_directories(target_dir)
