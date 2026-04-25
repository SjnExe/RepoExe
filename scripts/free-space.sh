#!/bin/bash
set -e
echo "Freeing up disk space on GitHub runner..."
sudo rm -rf /usr/local/lib/android
sudo rm -rf /usr/share/dotnet
sudo rm -rf /opt/ghc
sudo rm -rf /usr/local/.ghcup
sudo rm -rf /usr/local/share/powershell
sudo rm -rf /usr/local/share/chromium
sudo apt-get clean
echo "Disk space freed."
