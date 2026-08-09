# syntax=docker/dockerfile:1
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=en_US.UTF-8

# Pre-create systemd groups and users to prevent tmpfiles warning logs during APT package setup
RUN groupadd -r systemd-journal -g 999 2>/dev/null || true \
 && groupadd -r systemd-network -g 998 2>/dev/null || true \
 && useradd -r -g systemd-network -u 998 -d /run/systemd -s /bin/false systemd-network 2>/dev/null || true

# Base dependencies with APT cache mounts
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt,sharing=locked \
    apt-get update && apt-get install -yq --no-install-recommends \
    zstd locales apt-utils eatmydata sudo curl git ca-certificates aria2 \
    unzip patch xvfb xauth libgtk-3-dev libcanberra-gtk3-dev libcairo2-dev libx11-dev libxext-dev libxrender-dev build-essential cmake ninja-build meson pkg-config gettext intltool itstool nodejs npm shellcheck \
    proot abigail-tools graphviz dpkg-dev gcc g++ clang lld llvm ruby ruby-dev bison flex gperf libicu-dev python3-pip python3-yaml python3-pydantic docker.io \
  && locale-gen en_US.UTF-8 \
  && update-locale LANG=en_US.UTF-8 \
  && npm install -g prettier@latest

# Install sccache for ARM64
ENV SCCACHE_VERSION=v0.17.0
RUN curl -L -sS "https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-aarch64-unknown-linux-musl.tar.gz" | tar xz -C /tmp \
  && mv /tmp/sccache-${SCCACHE_VERSION}-aarch64-unknown-linux-musl/sccache /usr/local/bin/ \
  && chmod +x /usr/local/bin/sccache \
  && rm -rf /tmp/sccache*

ENV SCCACHE_DIR=/home/builder/.cache/sccache

# Setup HomuHomu833 Android NDK r29 for ARM64
ENV TERMUX_NDK_VERSION=29
ENV NDK=/opt/android-ndk
RUN mkdir -p /opt \
  && curl -L -sS -o /tmp/ndk.tar.xz "https://github.com/HomuHomu833/android-ndk-custom/releases/download/r29/android-ndk-r29-aarch64-linux-gnu.tar.xz" \
  && tar -xf /tmp/ndk.tar.xz -C /opt \
  && mv /opt/android-ndk-r29 ${NDK} \
  && rm -f /tmp/ndk.tar.xz

# Setup builder user (UID 1000)
RUN userdel -r ubuntu || true \
  && useradd -u 1000 -U -m -s /bin/bash builder \
  && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
  && chmod 0440 /etc/sudoers.d/builder \
  && mkdir -p /data/data/com.termux/files/usr /data/data/com.termux/files/home \
  && chown -R builder:builder /data/data/com.termux /home/builder

# Install Official Go Toolchain for ARM64
RUN GO_VERSION=$(curl -s https://go.dev/VERSION?m=text | head -n1) \
  && curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-arm64.tar.gz" | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"

# Install uv & tools
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
USER builder:builder
WORKDIR /home/builder
ENV PATH="/home/builder/.local/bin:${PATH}"

RUN uv python install 3.13 \
 && uv tool install ruff \
 && uv tool install mypy

ENV REPO_ROOT=/home/builder/RepoExe
WORKDIR /home/builder/RepoExe

RUN --mount=type=cache,target=/home/builder/.cache/pip \
    python3 -m pip install --break-system-packages --no-cache-dir pyyaml "pydantic>=2.0.0" pytest ruff

# Install Rust Toolchain for ARM64
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable \
 && /home/builder/.cargo/bin/rustup target add aarch64-linux-android aarch64-unknown-linux-musl aarch64-unknown-linux-gnu
ENV PATH="/home/builder/.cargo/bin:${PATH}"

# Install Cargo tools with cache mounts
RUN --mount=type=cache,target=/home/builder/.cargo/registry \
    --mount=type=cache,target=/home/builder/.cargo/git \
    cargo install cargo-c cargo-audit || true

USER root
# Apply NDK Patches dynamically
COPY scripts/docker/ndk-patches /tmp/ndk-patches
RUN PREBUILT_DIR=$(ls ${NDK}/toolchains/llvm/prebuilt | head -n1) \
  && cd ${NDK}/toolchains/llvm/prebuilt/${PREBUILT_DIR}/sysroot \
  && for patch in /tmp/ndk-patches/${TERMUX_NDK_VERSION}/*.patch; do \
       [ -f "$patch" ] || continue; \
       sed -i "s|@TERMUX_PREFIX@|/data/data/com.termux/files/usr|g" "$patch"; \
       sed -i "s|@TERMUX_HOME@|/data/data/com.termux/files/home|g" "$patch"; \
       patch --no-backup-if-mismatch -p1 < "$patch"; \
     done \
  && cp /tmp/ndk-patches/langinfo.h ${NDK}/toolchains/llvm/prebuilt/${PREBUILT_DIR}/sysroot/usr/include/ 2>/dev/null || true \
  && cp /tmp/ndk-patches/libintl.h ${NDK}/toolchains/llvm/prebuilt/${PREBUILT_DIR}/sysroot/usr/include/ 2>/dev/null || true \
  && rm -rf /tmp/ndk-patches

USER builder:builder
ENV GOTOOLCHAIN=local
