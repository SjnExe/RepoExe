import hashlib
import os
import shutil
import subprocess
import urllib.request
import logging

logger = logging.getLogger(__name__)


class Sysroot:
    """Manages the Sysroot Symlink Farm (Content-Addressable Store) and fetching logic."""

    def __init__(self, sysroot_dir: str = '/sysroot'):
        self.sysroot_dir = sysroot_dir
        os.makedirs(self.sysroot_dir, exist_ok=True)

    def _hash_string(self, s: str) -> str:
        """Returns the SHA256 of a string."""
        return hashlib.sha256(s.encode('utf-8')).hexdigest()

    def fetch_source(self, source_url: str, dest_dir: str, sha256: str = None) -> str:
        """Fetches the source code either via Git or downloading a tarball."""
        os.makedirs(dest_dir, exist_ok=True)

        if source_url.endswith('.git') or source_url.startswith('git://'):
            # Source is a Git repository
            logger.info(f'Cloning Git repository: {source_url}')
            clone_cmd = ['git', 'clone', '--recurse-submodules', source_url, dest_dir]
            subprocess.run(clone_cmd, check=True, capture_output=True)
            return dest_dir
        else:
            # Source is an archive
            filename = source_url.split('/')[-1]
            archive_path = os.path.join(dest_dir, filename)

            logger.info(f'Downloading archive: {source_url}')
            urllib.request.urlretrieve(source_url, archive_path)

            if sha256:
                with open(archive_path, 'rb') as f:
                    file_hash = hashlib.sha256(f.read()).hexdigest()
                if file_hash != sha256:
                    raise ValueError(f'SHA256 mismatch for {archive_path}. Expected {sha256}, got {file_hash}')

            # Extract archive
            logger.info(f'Extracting archive: {archive_path}')
            shutil.unpack_archive(archive_path, dest_dir)

            # Often tarballs extract into a single root directory.
            extracted_items = os.listdir(dest_dir)
            extracted_items.remove(filename)  # Ignore the archive we just downloaded

            if len(extracted_items) == 1:
                single_dir = os.path.join(dest_dir, extracted_items[0])
                if os.path.isdir(single_dir):
                    logger.info('Moving extracted root directory contents to dest_dir')
                    for item in os.listdir(single_dir):
                        shutil.move(os.path.join(single_dir, item), dest_dir)
                    os.rmdir(single_dir)

        self._patch_config_scripts(dest_dir)
        return dest_dir

    def _patch_config_scripts(self, src_dir: str) -> None:
        """Replaces config.guess and config.sub with our Android-compatible versions."""
        # Find scripts/config.guess relative to this file
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
        custom_guess = os.path.join(base_dir, 'scripts', 'config.guess')
        custom_sub = os.path.join(base_dir, 'scripts', 'config.sub')

        if not os.path.exists(custom_guess) or not os.path.exists(custom_sub):
            logger.warning("Custom config.guess or config.sub not found, skipping replacement.")
            return

        for root, _, files in os.walk(src_dir):
            if 'config.guess' in files:
                target = os.path.join(root, 'config.guess')
                try:
                    os.chmod(target, 0o755)
                    shutil.copy2(custom_guess, target)
                except OSError:
                    pass
            if 'config.sub' in files:
                target = os.path.join(root, 'config.sub')
                try:
                    os.chmod(target, 0o755)
                    shutil.copy2(custom_sub, target)
                except OSError:
                    pass

    def prepare_symlink_farm(self, package_hashes: dict[str, str], prefix: str):
        """
        Creates the Nix-style Symlink Farm in the active $PREFIX.
        package_hashes: A dictionary mapping package names to their state hash.
        """
        logger.info(f'Preparing symlink farm in {prefix}')
        os.makedirs(prefix, exist_ok=True)

        for pkg_name, pkg_hash in package_hashes.items():
            cache_path = os.path.join(self.sysroot_dir, pkg_hash)

            if not os.path.exists(cache_path):
                # In a full implementation, we would extract the prebuilt package into the cache path here.
                # For now, we assume the cache path is populated by the DAG/Dependency Resolver before calling this.
                logger.warning(f'Cache path {cache_path} for package {pkg_name} does not exist. Skipping symlinking.')
                continue

            # Iterate through all files in the cache path and symlink them to $PREFIX
            for root, _, files in os.walk(cache_path):
                for file in files:
                    src_file = os.path.join(root, file)
                    rel_path = os.path.relpath(src_file, cache_path)
                    dest_file = os.path.join(prefix, rel_path)

                    os.makedirs(os.path.dirname(dest_file), exist_ok=True)

                    if not os.path.exists(dest_file):
                        os.symlink(src_file, dest_file)
