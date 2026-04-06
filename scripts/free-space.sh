#!/bin/bash
# Free up disk space on Ubuntu runner
set -euo pipefail

echo "Freeing disk space..."

# Remove large, unused directories directly to save maximum space.
# We execute this in parallel to dramatically reduce execution time.
# Bypassing apt-get entirely prevents hanging triggers and saves ~5 minutes.

DIRS_TO_DELETE=(
  "/usr/share/dotnet"
  "/usr/local/lib/android"
  "/opt/ghc"
  "/opt/hostedtoolcache/CodeQL"
  "/usr/local/share/powershell"
  "/usr/share/swift"
  "/usr/local/.ghcup"
  "/usr/local/lib/node_modules"
  "/usr/local/share/chromium"
  "/usr/local/share/vcpkg"
  "/usr/share/rust"
  "/opt/az"
  "/opt/pipx"
  "/var/lib/docker/images"
)

# Run rm -rf in parallel
for dir in "${DIRS_TO_DELETE[@]}"; do
  sudo rm -rf "$dir" &
done

wait

# Clean apt cache instantly without invoking slow triggers
sudo rm -rf /var/cache/apt/archives/*

df -h /
