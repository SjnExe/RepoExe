import os
import urllib.request
import hashlib
import zipfile
import shutil

class ProtobufToolchain:
    def __init__(self, version: str = "34.1"):
        self.version = version.replace("2:", "") if version.startswith("2:") else version
        self._setup_target()

    def _setup_target(self):
        # We download the Linux x86_64 prebuilt
        self.zip_name = f"protoc-{self.version}-linux-x86_64.zip"
        self.url = f"https://github.com/protocolbuffers/protobuf/releases/download/v{self.version}/{self.zip_name}"

        # Hardcode sha256 for 34.1
        self.sha256 = "af27ea66cd26938fe48587804ca7d4817457a08350021a1c6e23a27ccc8c6904"

        # Cache dir
        cache_base = os.environ.get("REPOEXE_CACHE_DIR", "/tmp/repoexe-cache")
        self.dest_dir = os.path.join(cache_base, f"protobuf-{self.version}")
        self.bin_dir = os.path.join(self.dest_dir, "bin")

    def get_env(self) -> dict:
        """Downloads the protoc compiler if missing and returns the updated PATH."""
        if not os.path.exists(self.bin_dir):
            self._download_and_extract()

        current_path = os.environ.get("PATH", "")
        return {
            "PATH": f"{self.bin_dir}:{current_path}"
        }

    def _download_and_extract(self):
        os.makedirs(self.dest_dir, exist_ok=True)
        zip_path = os.path.join(self.dest_dir, self.zip_name)

        if not os.path.exists(zip_path):
            print(f"Downloading {self.url}...")
            urllib.request.urlretrieve(self.url, zip_path)

        # Verify SHA256
        with open(zip_path, "rb") as f:
            file_hash = hashlib.sha256(f.read()).hexdigest()
            if file_hash != self.sha256:
                raise ValueError(f"SHA256 mismatch for {zip_path}. Expected {self.sha256}, got {file_hash}")

        # Extract
        print(f"Extracting {zip_path}...")
        with zipfile.ZipFile(zip_path, 'r') as zip_ref:
            zip_ref.extractall(self.dest_dir)

        # Ensure bin/protoc is executable
        protoc_bin = os.path.join(self.bin_dir, "protoc")
        if os.path.exists(protoc_bin):
            os.chmod(protoc_bin, 0o755)
