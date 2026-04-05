FROM ghcr.io/termux/package-builder:latest

# Termux package-builder already contains python3, dpkg-dev, jq, and most standard tools.
# We only need to install the specific python packages required for our custom indexer,
# and gh CLI (which might not be in the base image, but we can install via apt).
# Note: we use pip with --break-system-packages for simplicity in the isolated builder container.
USER root
RUN apt-get update && apt-get install -y gh && rm -rf /var/lib/apt/lists/*
RUN pip3 install --no-cache-dir requests pyyaml --break-system-packages
USER builder

# Add any repository specific global configuration
ENV REPO_ROOT=/home/builder/RepoExe
