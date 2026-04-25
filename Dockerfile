FROM ubuntu:24.04

# Use non-interactive for apt
ENV DEBIAN_FRONTEND=noninteractive

# Update and install base build tools, sccache, and uv
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    curl \
    wget \
    git \
    python3 \
    python3-pip \
    python3-venv \
    sudo \
    patch \
    jq \
    pkg-config \
    unzip \
    ca-certificates \
    shellcheck \
    && rm -rf /var/lib/apt/lists/*

# Install sccache for caching
RUN curl -sSL https://github.com/mozilla/sccache/releases/download/v0.7.7/sccache-v0.7.7-x86_64-unknown-linux-musl.tar.gz | tar xz -C /usr/local/bin --strip-components=1 sccache-v0.7.7-x86_64-unknown-linux-musl/sccache

# Install uv for Python dependency management
RUN curl -LsSf https://astral.sh/uv/install.sh | env UV_INSTALL_DIR="/usr/local/bin" sh

# Set up non-root 'builder' user with UID 1000
RUN useradd -m -s /bin/bash -u 1000 builder && \
    echo "builder ALL=(ALL) NOPASSWD:ALL" >> /etc/sudoers

# Create workspace
RUN mkdir -p /home/builder/RepoExe && chown builder:builder /home/builder/RepoExe

# Fetch and setup NDK 29
WORKDIR /opt
RUN curl -LO https://dl.google.com/android/repository/android-ndk-r29-linux.zip && \
    unzip -q android-ndk-r29-linux.zip && \
    rm android-ndk-r29-linux.zip
ENV NDK=/opt/android-ndk-r29

# Switch to builder user
USER builder
WORKDIR /home/builder/RepoExe

# Setup toolchains path and other envs
ENV PATH="/usr/local/bin:${PATH}"
ENV NDK_ROOT="/opt/android-ndk-r29"

# Copy NDK patches and apply them
COPY --chown=builder:builder ndk-patches/ /home/builder/ndk-patches/
RUN for p in /home/builder/ndk-patches/29/*.patch; do \
        patch -p1 -d ${NDK_ROOT}/sysroot <"$p" || true; \
    done

# We will mount our workspace here, and execute python scripts using uv
CMD ["bash"]
