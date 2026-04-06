#!/bin/bash
# Free up disk space on Ubuntu runner
set -euo pipefail

echo "Freeing disk space..."

# Optimize apt operations by running non-interactive and combining purge and auto-remove
export DEBIAN_FRONTEND=noninteractive
sudo -E apt-get purge -y --auto-remove '^dotnet-.*' '^llvm-.*' 'php.*' '^mongodb-.*' '^mysql-.*' azure-cli google-cloud-cli powershell mono-devel libgl1-mesa-dri google-chrome-stable firefox ant ant-optional || true
sudo -E apt-get clean || true

# Remove large, unused directories directly to save maximum space
sudo rm -rf /usr/share/dotnet \
            /usr/local/lib/android \
            /opt/ghc \
            /opt/hostedtoolcache/CodeQL \
            /usr/local/share/powershell \
            /usr/share/swift \
            /usr/local/.ghcup \
            /usr/local/lib/node_modules \
            /usr/local/share/chromium \
            /usr/local/share/vcpkg

df -h /
