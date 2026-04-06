#!/bin/bash
# Free up disk space on Ubuntu runner
set -euo pipefail

echo "Freeing disk space..."

# Remove large, unused directories directly to save time vs apt-get
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

# Removing packages via apt takes ~5 minutes on GitHub runners, doing the rm -rf above is usually enough.
# However, if we still need to clear apt packages, we can do it faster by avoiding the triggers and autoremove logic where possible,
# or simply relying entirely on the rm -rf.
# Given the user wants it optimized, we will skip the slow apt-get remove phase and just rely on cleaning the apt cache.
sudo apt-get clean || true

df -h /
