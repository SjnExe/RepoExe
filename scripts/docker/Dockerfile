# syntax=docker/dockerfile:1
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=en_US.UTF-8

# Base dependencies
RUN apt-get update && apt-get install -yq --no-install-recommends \
    zstd locales apt-utils eatmydata sudo curl git ca-certificates aria2 \
    unzip patch build-essential nodejs npm shellcheck \
    proot abigail-tools graphviz dpkg-dev gcc g++ python3-pip python3-yaml python3-pydantic \
  && locale-gen en_US.UTF-8 \
  && update-locale LANG=en_US.UTF-8 \
  && npm install -g prettier@latest \
  && rm -rf /var/lib/apt/lists/*

# Install sccache for ARM64
ENV SCCACHE_VERSION=v0.8.2
RUN curl -L -sS "https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-aarch64-unknown-linux-musl.tar.gz" | tar xz -C /tmp \
  && mv /tmp/sccache-${SCCACHE_VERSION}-aarch64-unknown-linux-musl/sccache /usr/local/bin/ \
  && chmod +x /usr/local/bin/sccache \
  && rm -rf /tmp/sccache*

ENV SCCACHE_GHA_ENABLED=true
ENV SCCACHE_DIR=/home/builder/.cache/sccache

# Setup HomuHomu833 Android NDK r29 for ARM64
ENV NDK=/opt/android-ndk
RUN mkdir -p /opt \
  && curl -L -sS -o /tmp/ndk.tar.xz "https://github.com/HomuHomu833/android-ndk-custom/releases/download/r29/android-ndk-r29-aarch64-linux-gnu.tar.xz" \
  && tar -xf /tmp/ndk.tar.xz -C /opt \
  && mv /opt/android-ndk-r29 ${NDK} \
  && rm -f /tmp/ndk.tar.xz

RUN mkdir -p /data/data/com.termux/files/usr /data/data/com.termux/files/home

# Setup builder user (UID 1000)
RUN userdel -r ubuntu || true \
  && useradd -u 1000 -U -m -s /bin/bash builder \
  && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
  && chmod 0440 /etc/sudoers.d/builder \
  && chown -R builder:builder /data/data/com.termux /home/builder

# Install Official Go Toolchain for ARM64
RUN GO_VERSION=$(curl -s https://go.dev/VERSION?m=text | head -n1) \
  && curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-arm64.tar.gz" | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"

USER builder:builder
WORKDIR /home/builder

COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
ENV PATH="/home/builder/.local/bin:${PATH}"

RUN uv python install 3.13 \
 && uv tool install ruff \
 && uv tool install mypy

ENV REPO_ROOT=/home/builder/RepoExe
WORKDIR /home/builder/RepoExe

RUN python3 -m pip install --break-system-packages --no-cache-dir pyyaml "pydantic>=2.0.0" pytest ruff

# Install Rust Toolchain for ARM64
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable && /home/builder/.cargo/bin/rustup target add aarch64-unknown-linux-musl aarch64-unknown-linux-gnu
ENV PATH="/home/builder/.cargo/bin:${PATH}"

ENV GOTOOLCHAIN=local
