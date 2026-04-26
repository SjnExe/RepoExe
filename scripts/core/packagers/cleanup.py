import os
import shutil
import stat
import subprocess

from ..properties import PREFIX


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


def run_all_cleanups(target_dir: str) -> None:
    trim_caches(target_dir)
    remove_libtool_la(target_dir)
    merge_sbin(target_dir)
    gzip_docs(target_dir)
    enforce_pie(target_dir)
    normalize_permissions(target_dir)
    prune_ghost_directories(target_dir)
