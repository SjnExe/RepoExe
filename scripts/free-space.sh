#!/bin/bash
# Free up disk space on Ubuntu runner
set -euo pipefail

echo "Freeing disk space..."
sudo apt-get remove -y '^dotnet-.*' '^llvm-.*' 'php.*' '^mongodb-.*' '^mysql-.*' azure-cli google-cloud-cli powershell mono-devel libgl1-mesa-dri google-chrome-stable firefox ant ant-optional || true
sudo apt-get autoremove -y || true
sudo apt-get clean || true
sudo rm -rf /usr/share/dotnet /usr/local/lib/android /opt/ghc /opt/hostedtoolcache/CodeQL /usr/local/share/powershell /usr/share/swift /usr/local/.ghcup
df -h /
