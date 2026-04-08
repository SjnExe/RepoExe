# AGENTS.md

This file contains instructions for AI agents working on the **RepoExe** repository.

## Core Directives for Agents
- **NO LOG REPORTS:** Do not generate file-based log reports (e.g., `error_log.txt`) or paste massive logs into the chat. Users view logs directly in their terminal by re-running commands.
- **Deep Planning:** Always engage in "Deep Planning Mode" before starting a task. Verify requirements through questions until absolute certainty is reached.

## Project Context
- **Name:** RepoExe
- **Purpose:** A package repository for Termux providing custom tools and libraries (e.g., Android build tools like aapt2, zipalign, aidl).
- **Tech Stack:**
  - Termux Package Build System
  - Docker (Custom builder image based on Ubuntu)
  - GitHub Actions (CI/CD)

## Environment Setup

The build process for these packages requires a specialized Termux build environment. The repository provides a custom Docker image (`ghcr.io/sjnexe/repoexe-builder:latest`) to ensure reproducible builds.

To initialize the environment and run the builder container locally in the background, run the following setup script:

```bash
# Stop any existing docker instances that might be conflicting
sudo systemctl stop docker 2>/dev/null || true

# Reconfigure docker storage driver if overlay fails in this environment
sudo bash -c 'cat << "JSON" > /etc/docker/daemon.json
{
  "storage-driver": "vfs"
}
JSON'

# Clean previous state and start docker
sudo rm -rf /var/lib/docker
sudo systemctl start docker

# Pull the latest builder image
sudo docker pull ghcr.io/sjnexe/repoexe-builder:latest

# Start the builder container in the background
mkdir -p ~/.ccache output
sudo docker run -d --name builder \
  -u builder \
  --device /dev/fuse \
  --cap-add SYS_ADMIN \
  --security-opt apparmor:unconfined \
  -v $(pwd):/home/builder/RepoExe \
  -v ~/.ccache:/home/builder/.ccache \
  -w /home/builder/RepoExe \
  -e REPO_ROOT=/home/builder/RepoExe \
  ghcr.io/sjnexe/repoexe-builder:latest tail -f /dev/null

# Initialize termux-packages within the container
sudo docker exec builder bash -c "
sudo mkdir -p /data/data/com.termux/files/usr/etc/apt/sources.list.d/
echo 'deb [trusted=yes] https://SjnExe.github.io/RepoExe/ stable main' | sudo tee /data/data/com.termux/files/usr/etc/apt/sources.list.d/repoexe.list > /dev/null
git clone --depth 1 https://github.com/termux/termux-packages.git /home/builder/termux-packages
"
```

## Useful Commands

### Build a Package
To build a specific package (e.g., `libandroid-tools-shared`) for the `aarch64` architecture using the running Docker container:

```bash
sudo docker exec builder bash -c "
cd /home/builder/termux-packages
rm -rf /home/builder/termux-packages/packages/libandroid-tools-shared
cp -a /home/builder/RepoExe/packages/libandroid-tools-shared /home/builder/termux-packages/packages/
./build-package.sh -a aarch64 -I libandroid-tools-shared
"
```

### Clean Build Directory
To clean up previous build artifacts before starting a fresh build:
```bash
sudo docker exec builder bash -c "
rm -rf /home/builder/termux-packages/.termux-build/*
"
```

### Access Builder Shell
If you need to debug inside the builder container interactively:
```bash
sudo docker exec -it builder bash
```
