#!/bin/bash
set -e

# Cleanup script to resolve conflicts between the official termux-packages repository and RepoExe.
# This script is executed by the GitHub Actions build workflow after cloning the official termux-packages repo.

if [ "$#" -ne 1 ]; then
    echo "Usage: $0 <path_to_termux_packages_repo>"
    exit 1
fi

TERMUX_PACKAGES_DIR="$1"
PACKAGES_DIR="$TERMUX_PACKAGES_DIR/packages"

echo "Running pre-build cleanup on $TERMUX_PACKAGES_DIR..."

if [ -d "$PACKAGES_DIR" ]; then
    # Remove the legacy 'aapt' package from termux-packages to prevent buildorder conflicts
    # with the standalone 'aapt2', 'aidl', and 'zipalign' packages provided by RepoExe.
    echo "Removing conflicting legacy package: aapt"
    rm -rf "$PACKAGES_DIR/aapt"
else
    echo "Error: Directory $PACKAGES_DIR not found."
    exit 1
fi

echo "Pre-build cleanup completed successfully."
