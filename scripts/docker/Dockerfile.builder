# syntax=docker/dockerfile:1
FROM ubuntu:24.04

ARG TERMUX_NDK_VERSION=29
ARG SCCACHE_VERSION=v0.17.0

ENV DEBIAN_FRONTEND=noninteractive \
    LANG=en_US.UTF-8 \
    NDK=/opt/android-ndk \
    SCCACHE_DIR=/home/builder/.cache/sccache \
    REPO_ROOT=/home/builder/RepoExe

# Pre-create systemd groups and install all Ubuntu base build tools
RUN groupadd -r systemd-journal -g 999 2>/dev/null || true \
 && groupadd -r systemd-network -g 998 2>/dev/null || true \
 && useradd -r -g systemd-network -u 998 -d /run/systemd -s /bin/false systemd-network 2>/dev/null || true \
 && apt-get update && apt-get install -yq --no-install-recommends ca-certificates curl gnupg \
 && (curl -fsSL --retry 5 https://apt.llvm.org/llvm-snapshot.gpg.key | tee /etc/apt/trusted.gpg.d/apt.llvm.org.asc >/dev/null || true) \
 && echo "deb https://apt.llvm.org/noble/ llvm-toolchain-noble-21 main" | tee /etc/apt/sources.list.d/llvm.list \
 && apt-get update && apt-get install -yq --no-install-recommends \
    zstd locales apt-utils eatmydata sudo git aria2 \
    unzip patch xvfb xauth libgtk-3-dev libcairo2-dev libx11-dev libxext-dev libxrender-dev build-essential cmake ninja-build meson pkg-config gettext intltool itstool nodejs npm shellcheck \
    proot dpkg-dev gcc g++ clang lld llvm clang-21 lld-21 llvm-21 nasm ruby ruby-dev bison flex gperf guile-3.0 guile-3.0-dev libicu-dev python3-pip python3-yaml python3-pydantic docker.io \
    librsvg2-dev libxml2-dev libxml2-utils desktop-file-utils shared-mime-info appstream-util yelp-tools libssl-dev patchelf \
 && locale-gen en_US.UTF-8 \
 && update-locale LANG=en_US.UTF-8 \
 && npm install -g prettier@latest \
 && apt-get autoremove -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Install sccache for ARM64
RUN curl -L -sS "https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-aarch64-unknown-linux-musl.tar.gz" | tar xz -C /tmp \
 && mv /tmp/sccache-${SCCACHE_VERSION}-aarch64-unknown-linux-musl/sccache /usr/local/bin/ \
 && chmod +x /usr/local/bin/sccache \
 && rm -rf /tmp/sccache*

# Install HomuHomu833 Android NDK r29
RUN mkdir -p /opt \
 && curl -L -sS -o /tmp/ndk.tar.xz "https://github.com/HomuHomu833/android-ndk-custom/releases/download/r29/android-ndk-r29-aarch64-linux-gnu.tar.xz" \
 && tar -xf /tmp/ndk.tar.xz -C /opt \
 && mv /opt/android-ndk-r29 ${NDK} \
 && rm -f /tmp/ndk.tar.xz

# Install Official Go Toolchain
RUN GO_VERSION=$(curl -s https://go.dev/VERSION?m=text | head -n1) \
 && curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-arm64.tar.gz" | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"

# Setup non-root builder user
RUN userdel -r ubuntu || true \
 && useradd -u 1000 -U -m -s /bin/bash builder \
 && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
 && chmod 0440 /etc/sudoers.d/builder \
 && mkdir -p /data/data/com.termux/files/usr /data/data/com.termux/files/home \
 && chown -R builder:builder /data/data/com.termux /home/builder

# Install uv & tools (Python 3.14)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/
USER builder:builder
WORKDIR /home/builder
ENV PATH="/home/builder/.local/bin:${PATH}"

RUN uv python install 3.14 \
 && uv tool install ruff \
 && uv tool install mypy

WORKDIR /home/builder/RepoExe

RUN python3 -m pip install --break-system-packages --no-cache-dir pyyaml "pydantic>=2.0.0" pytest ruff maturin hatchling hatch-fancy-pypi-readme hatch-vcs

# Install Rust Toolchain & targets
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable \
 && /home/builder/.cargo/bin/rustup target add aarch64-linux-android aarch64-unknown-linux-musl aarch64-unknown-linux-gnu
ENV PATH="/home/builder/.cargo/bin:${PATH}"

# Install cargo-binstall and use it to install prebuilt cargo-audit binary
RUN curl -L -sS "https://github.com/cargo-bins/cargo-binstall/releases/latest/download/cargo-binstall-aarch64-unknown-linux-musl.tgz" | tar xz -C /home/builder/.cargo/bin \
 && chmod +x /home/builder/.cargo/bin/cargo-binstall \
 && /home/builder/.cargo/bin/cargo-binstall -y cargo-audit

USER root
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
