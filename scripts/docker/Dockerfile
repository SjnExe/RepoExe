# syntax=docker/dockerfile:1
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=en_US.UTF-8

# Base dependencies
RUN apt-get update && apt-get install -yq --no-install-recommends \
    zstd locales apt-utils eatmydata sudo curl git ca-certificates aria2 \
    unzip patch golang rustc cargo build-essential nodejs npm shellcheck \
    proot abigail-tools graphviz dpkg-dev python3-pip python3-yaml python3-pydantic \
  && locale-gen en_US.UTF-8 \
  && update-locale LANG=en_US.UTF-8 \
  && npm install -g prettier@latest \
  && rm -rf /var/lib/apt/lists/*

# Install sccache
ENV SCCACHE_VERSION=v0.8.2
RUN curl -L -sS "https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp \
  && mv /tmp/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache /usr/local/bin/ \
  && chmod +x /usr/local/bin/sccache \
  && rm -rf /tmp/sccache*

ENV SCCACHE_GHA_ENABLED=true
ENV SCCACHE_DIR=/home/builder/.cache/sccache

# Download & Setup Android NDK 29
ENV TERMUX_NDK_VERSION=29
ENV ANDROID_NDK_FILE=android-ndk-r${TERMUX_NDK_VERSION}-linux.zip
ENV ANDROID_NDK_SHA256=4abbbcdc842f3d4879206e9695d52709603e52dd68d3c1fff04b3b5e7a308ecf
ENV NDK=/opt/android-ndk

RUN mkdir -p /opt \
  && curl -L -sS -o /tmp/ndk.zip "https://dl.google.com/android/repository/${ANDROID_NDK_FILE}" \
  && echo "${ANDROID_NDK_SHA256}  /tmp/ndk.zip" | sha256sum -c - \
  && unzip -q /tmp/ndk.zip -d /opt \
  && mv /opt/android-ndk-r${TERMUX_NDK_VERSION} ${NDK} \
  && rm -f /tmp/ndk.zip \
  && rm -Rf ${NDK}/sources/cxx-stl/system

# Apply NDK Patches
COPY scripts/docker/ndk-patches /tmp/ndk-patches
RUN cd ${NDK}/toolchains/llvm/prebuilt/linux-x86_64/sysroot \
  && for patch in /tmp/ndk-patches/${TERMUX_NDK_VERSION}/*.patch; do \
       [ -f "$patch" ] || continue; \
       sed -i "s|@TERMUX_PREFIX@|/data/data/com.termux/files/usr|g" "$patch"; \
       sed -i "s|@TERMUX_HOME@|/data/data/com.termux/files/home|g" "$patch"; \
       patch --no-backup-if-mismatch -p1 < "$patch"; \
     done \
  && cp /tmp/ndk-patches/langinfo.h ${NDK}/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include/ 2>/dev/null || true \
  && cp /tmp/ndk-patches/libintl.h ${NDK}/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include/ 2>/dev/null || true \
  && rm -rf /tmp/ndk-patches

RUN mkdir -p /data/data/com.termux/files/usr /data/data/com.termux/files/home

# Setup builder user (UID 1000)
RUN userdel -r ubuntu || true \
  && useradd -u 1000 -U -m -s /bin/bash builder \
  && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
  && chmod 0440 /etc/sudoers.d/builder \
  && chown -R builder:builder /data/data/com.termux /home/builder

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

# Install latest stable Rust toolchain via rustup (supports Edition 2024)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable
ENV PATH="/home/builder/.cargo/bin:${PATH}"

ENV GOTOOLCHAIN=local
