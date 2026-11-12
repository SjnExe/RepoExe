# syntax=docker/dockerfile:1
FROM ubuntu:26.04

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
 && echo "deb https://apt.llvm.org/resolute/ llvm-toolchain-resolute-21 main" | tee /etc/apt/sources.list.d/llvm.list \
 && apt-get update && apt-get install -yq --no-install-recommends \
    zstd locales apt-utils eatmydata sudo git aria2 \
    unzip patch xvfb xauth libgtk-3-dev libcairo2-dev libx11-dev libxext-dev libxrender-dev build-essential cmake ninja-build meson pkg-config gettext intltool itstool shellcheck \
    proot dpkg-dev gcc g++ clang lld llvm clang-21 lld-21 llvm-21 nasm ruby ruby-dev bison flex gperf guile-3.0 guile-3.0-dev libicu-dev docker.io \
    librsvg2-dev libxml2-dev libxml2-utils desktop-file-utils shared-mime-info appstream-util yelp-tools libssl-dev patchelf \
 && locale-gen en_US.UTF-8 \
 && update-locale LANG=en_US.UTF-8 \
 && apt-get autoremove -y \
 && apt-get clean \
 && rm -rf /var/lib/apt/lists/*

# Install sccache for x86_64
RUN curl -L -sS "https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp \
 && mv /tmp/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache /usr/local/bin/ \
 && chmod +x /usr/local/bin/sccache \
 && rm -rf /tmp/sccache*

# Install Official Google Android NDK r29
RUN mkdir -p /opt \
 && curl -L -sS -o /tmp/ndk.zip "https://dl.google.com/android/repository/android-ndk-r29-linux.zip" \
 && unzip -q /tmp/ndk.zip -d /opt \
 && mv /opt/android-ndk-r29 ${NDK} \
 && rm -f /tmp/ndk.zip

# Install Official Go Toolchain
RUN GO_VERSION=$(curl -s https://go.dev/VERSION?m=text | head -n1) \
 && curl -fsSL "https://go.dev/dl/${GO_VERSION}.linux-amd64.tar.gz" | tar -C /usr/local -xz
ENV PATH="/usr/local/go/bin:${PATH}"

# Setup non-root builder user
RUN userdel -r ubuntu || true \
 && useradd -u 1000 -U -m -s /bin/bash builder \
 && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
 && chmod 0440 /etc/sudoers.d/builder \
 && mkdir -p /data/data/com.termux/files/usr /data/data/com.termux/files/home \
 && chown -R builder:builder /data/data/com.termux /home/builder

# Install Bun
USER root
RUN curl -fsSL https://bun.sh/install | bash \
 && mv /root/.bun/bin/bun /usr/local/bin/bun \
 && ln -sf /usr/local/bin/bun /usr/local/bin/bunx \
 && chmod +x /usr/local/bin/bun

USER builder:builder
WORKDIR /home/builder
ENV PATH="/home/builder/.local/bin:${PATH}"

WORKDIR /home/builder/RepoExe

# Install Rust Toolchain & cross targets
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable \
 && /home/builder/.cargo/bin/rustup target add \
      aarch64-linux-android \
      armv7-linux-androideabi \
      i686-linux-android \
      x86_64-linux-android
ENV PATH="/home/builder/.cargo/bin:${PATH}"

# Install cargo-binstall and use it to install prebuilt cargo-audit binary
RUN curl -L -sS "https://github.com/cargo-bins/cargo-binstall/releases/latest/download/cargo-binstall-x86_64-unknown-linux-musl.tgz" | tar xz -C /home/builder/.cargo/bin \
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
