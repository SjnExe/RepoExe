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
For the agent environment, the repository is already cloned to `/app`. The following environmental setup script uses `fuse-overlayfs` for optimal performance, allocates swap space to prevent OOM errors, starts the builder container in the background, applies NDK patches, and mirrors the custom packages.

```bash
(test -f /swapfile || (sudo fallocate -l 16G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile) || true) &
(test -x /usr/local/bin/fuse-overlayfs || (sudo curl -sSL "https://github.com/containers/fuse-overlayfs/releases/download/v1.16/fuse-overlayfs-$(uname -m)" -o /usr/local/bin/fuse-overlayfs && sudo chmod +x /usr/local/bin/fuse-overlayfs)) &
wait
sudo bash -c 'echo "{\"storage-driver\": \"fuse-overlayfs\"}" > /etc/docker/daemon.json'
sudo systemctl restart docker
sudo docker pull -q ghcr.io/sjnexe/repoexe-builder:latest
mkdir -p ~/.ccache /app/output
sudo docker run -d --name builder -u builder --device /dev/fuse --cap-add SYS_ADMIN --security-opt apparmor:unconfined -v /app:/home/builder/RepoExe -v ~/.ccache:/home/builder/.ccache -w /home/builder/RepoExe -e REPO_ROOT=/home/builder/RepoExe ghcr.io/sjnexe/repoexe-builder:latest tail -f /dev/null
sudo docker exec builder bash -c "(sudo mkdir -p /data/data/com.termux/files/usr/etc/apt/sources.list.d/; echo 'deb [trusted=yes] https://SjnExe.github.io/RepoExe/ stable main' | sudo tee /data/data/com.termux/files/usr/etc/apt/sources.list.d/repoexe.list > /dev/null) & (git clone --depth 1 https://github.com/termux/termux-packages.git /home/builder/termux-packages; if [ -d \"ndk-patches/29\" ]; then for patch in ndk-patches/29/*.patch; do if [ -f \"\$patch\" ]; then sudo patch -p1 -d /home/builder/lib/android-ndk/sysroot < \"\$patch\" || true; fi; done; fi) & wait; for pkg_dir in packages/*; do if [ -d \"\$pkg_dir\" ]; then pkg=\$(basename \"\$pkg_dir\"); rm -rf \"/home/builder/termux-packages/packages/\$pkg\"; cp -a \"\$pkg_dir\" \"/home/builder/termux-packages/packages/\"; fi; done"
```

## Useful Commands

### Build a Package
To build a specific package (e.g., `aapt2`) for the `aarch64` architecture using the running Docker container:

```bash
sudo docker exec builder bash -c "
cd /home/builder/termux-packages
./build-package.sh -a aarch64 -I aapt2
mv output/*.deb /home/builder/RepoExe/output/ 2>/dev/null || true
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
