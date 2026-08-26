import hashlib
import logging
import os
import shutil
import subprocess
import urllib.request

logger = logging.getLogger(__name__)


class Sysroot:
    """Manages the Sysroot Symlink Farm (Content-Addressable Store) and fetching logic."""

    def __init__(self, sysroot_dir: str = "/sysroot"):
        self.sysroot_dir = sysroot_dir
        os.makedirs(self.sysroot_dir, exist_ok=True)

    def _hash_string(self, s: str) -> str:
        """Returns the SHA256 of a string."""
        return hashlib.sha256(s.encode("utf-8")).hexdigest()

    def fetch_source(
        self,
        source: str,
        dest_dir: str,
        sha256: str | None = None,
        mirror: bool = False,
        git_branch: str | None = None,
    ) -> str:
        """Fetches the source code either via Git or downloading a tarball, validates signatures and mirrors to GitHub Releases."""
        os.makedirs(dest_dir, exist_ok=True)

        if source == "local":
            logger.info("Using local source")
            return dest_dir
        elif (
            "#" in source
            or source.endswith(".git")
            or source.startswith("git://")
            or git_branch is not None
        ):
            # Source is a Git repository
            repo_url = source
            branch = git_branch
            if "#" in source:
                repo_url, branch = source.split("#", 1)
            logger.info(f"Cloning Git repository: {repo_url} (branch/ref: {branch})")
            clone_cmd = ["git", "clone", "--recurse-submodules"]
            if branch:
                clone_cmd.extend(["--branch", branch, "--single-branch"])
            clone_cmd.extend([repo_url, dest_dir])
            subprocess.run(clone_cmd, check=True, capture_output=True)
            return dest_dir
        else:
            # Source is an archive
            filename = source.split("/")[-1]
            archive_path = os.path.join(dest_dir, filename)

            # Try to fetch from our mirror first if enabled
            downloaded = False
            if mirror:
                # Assuming GH_TOKEN is set
                mirror_url = f"https://github.com/SjnExe/RepoExe/releases/download/mirrors/{filename}"
                logger.info(f"Attempting to download from mirror: {mirror_url}")
                try:
                    urllib.request.urlretrieve(mirror_url, archive_path)
                    downloaded = True
                except urllib.error.URLError:
                    logger.info("Mirror download failed, falling back to upstream")

            if not downloaded:
                logger.info(f"Downloading archive: {source}")
                req = urllib.request.Request(
                    source, headers={"User-Agent": "Mozilla/5.0"}
                )
                with (
                    urllib.request.urlopen(req) as response,
                    open(archive_path, "wb") as out_file,
                ):
                    shutil.copyfileobj(response, out_file)

                # Try to mirror it
                if mirror and shutil.which("gh"):
                    logger.info(f"Mirroring to GitHub Releases: {filename}")
                    # We create/update a 'mirrors' release tag
                    try:
                        subprocess.run(
                            ["gh", "release", "view", "mirrors"],
                            check=True,
                            capture_output=True,
                        )
                    except subprocess.CalledProcessError:
                        subprocess.run(
                            [
                                "gh",
                                "release",
                                "create",
                                "mirrors",
                                "--title",
                                "Source Mirrors",
                                "--notes",
                                "Mirrored source tarballs",
                            ],
                            check=True,
                        )

                    try:
                        subprocess.run(
                            [
                                "gh",
                                "release",
                                "upload",
                                "mirrors",
                                archive_path,
                                "--clobber",
                            ],
                            check=True,
                        )
                    except subprocess.CalledProcessError as e:
                        logger.warning(f"Failed to upload mirror: {e}")

            if sha256:
                with open(archive_path, "rb") as f:
                    file_hash = hashlib.sha256(f.read()).hexdigest()
                if file_hash != sha256:
                    raise ValueError(
                        f"SHA256 mismatch for {archive_path}. Expected {sha256}, got {file_hash}"
                    )

            # Try to verify GPG signature if a .sig or .asc file exists alongside
            sig_url = f"{source}.sig"
            sig_path = f"{archive_path}.sig"
            try:
                urllib.request.urlretrieve(sig_url, sig_path)
                logger.info("Found signature, verifying...")
                # Note: this requires gpg to be set up and the correct keys imported by the orchestrator beforehand.
                # E.g., `gpg --verify {sig_path} {archive_path}`
                subprocess.run(
                    ["gpg", "--verify", sig_path, archive_path],
                    check=True,
                    capture_output=True,
                )
                logger.info("Signature verified successfully.")
            except urllib.error.URLError:
                pass  # No signature found, that's fine
            except subprocess.CalledProcessError:
                logger.warning(
                    "Signature verification failed! Proceeding anyway, but please review."
                )

            # Extract archive
            logger.info(f"Extracting archive: {archive_path}")
            shutil.unpack_archive(archive_path, dest_dir)

            # Often tarballs extract into a single root directory.
            extracted_items = os.listdir(dest_dir)
            extracted_items.remove(filename)  # Ignore the archive we just downloaded
            if os.path.exists(sig_path):
                extracted_items.remove(filename + ".sig")

            if len(extracted_items) == 1:
                single_dir = os.path.join(dest_dir, extracted_items[0])
                if os.path.isdir(single_dir):
                    logger.info("Moving extracted root directory contents to dest_dir")
                    for item in os.listdir(single_dir):
                        shutil.move(os.path.join(single_dir, item), dest_dir)
                    os.rmdir(single_dir)

        self._patch_config_scripts(dest_dir)
        return dest_dir

    def _patch_config_scripts(self, src_dir: str) -> None:
        """Replaces config.guess and config.sub with our Android-compatible versions."""
        # Find scripts/configs/config.guess relative to this file
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
        custom_guess = os.path.join(base_dir, "scripts", "configs", "config.guess")
        custom_sub = os.path.join(base_dir, "scripts", "configs", "config.sub")

        if not os.path.exists(custom_guess) or not os.path.exists(custom_sub):
            logger.warning(
                "Custom config.guess or config.sub not found, skipping replacement."
            )
            return

        for root, _, files in os.walk(src_dir):
            if "config.guess" in files:
                target = os.path.join(root, "config.guess")
                try:
                    os.chmod(target, 0o755)
                    shutil.copy2(custom_guess, target)
                except OSError:
                    pass
            if "config.sub" in files:
                target = os.path.join(root, "config.sub")
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
        logger.info(f"Preparing symlink farm in {prefix}")
        os.makedirs(prefix, exist_ok=True)

        for pkg_name, pkg_hash in package_hashes.items():
            cache_path = os.path.join(self.sysroot_dir, pkg_hash)

            if not os.path.exists(cache_path):
                # In a full implementation, we would extract the prebuilt package into the cache path here.
                # For now, we assume the cache path is populated by the DAG/Dependency Resolver before calling this.
                logger.warning(
                    f"Cache path {cache_path} for package {pkg_name} does not exist. Skipping symlinking."
                )
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
