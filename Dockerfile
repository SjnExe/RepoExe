# syntax=docker/dockerfile:1
FROM ubuntu:24.04

# Fix locale to avoid warnings:
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=en_US.UTF-8

# Configure apt and install core dependencies
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
  && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

# Optimize apt sources, create dummy groups to avoid warnings, and install dependencies
RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked,id=apt-cache \
  --mount=type=cache,target=/var/lib/apt,sharing=locked,id=apt-lib \
  groupadd -r systemd-journal \
  && useradd -r -s /bin/false systemd-network \
  && useradd -r -s /bin/false systemd-resolve \
  && apt-get update \
  && apt-get install -yq --no-install-recommends locales apt-utils \
  && locale-gen en_US.UTF-8 \
  && update-locale LANG=en_US.UTF-8 \
  && sed -i 's@http://archive.ubuntu.com/ubuntu/@mirror://mirrors.ubuntu.com/mirrors.txt@g' /etc/apt/sources.list.d/ubuntu.sources \
  && sed -i 's@http://security.ubuntu.com/ubuntu/@mirror://mirrors.ubuntu.com/mirrors.txt@g' /etc/apt/sources.list.d/ubuntu.sources \
  && apt-get update \
  && apt-get install -yq --no-install-recommends \
    eatmydata sudo curl git ca-certificates aria2 fuse-overlayfs unzip patch \
  && eatmydata apt-get -yq upgrade

# Install sccache for distributed compiler caching
ENV SCCACHE_VERSION=v0.8.2
RUN curl -L -sS "https://github.com/mozilla/sccache/releases/download/${SCCACHE_VERSION}/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl.tar.gz" | tar xz -C /tmp \
  && mv /tmp/sccache-${SCCACHE_VERSION}-x86_64-unknown-linux-musl/sccache /usr/local/bin/ \
  && chmod +x /usr/local/bin/sccache \
  && rm -rf /tmp/sccache*

# Configure sccache to natively utilize the GitHub Actions Cache API
ENV SCCACHE_GHA_ENABLED=true
ENV SCCACHE_DIR=/home/builder/.cache/sccache

# Download and Setup Android NDK 29
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
COPY scripts/ndk-patches/29 /tmp/ndk-patches/29
COPY scripts/ndk-patches/langinfo.h /tmp/ndk-patches/langinfo.h
COPY scripts/ndk-patches/libintl.h /tmp/ndk-patches/libintl.h
RUN cd ${NDK}/toolchains/llvm/prebuilt/linux-x86_64/sysroot \
  && for patch in /tmp/ndk-patches/29/*.patch; do \
       sed -i "s|@TERMUX_PREFIX@|/data/data/com.termux/files/usr|g" "$patch"; \
       sed -i "s|@TERMUX_HOME@|/data/data/com.termux/files/home|g" "$patch"; \
       patch --no-backup-if-mismatch -p1 < "$patch"; \
     done \
  && cp /tmp/ndk-patches/langinfo.h ${NDK}/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include/ \
  && cp /tmp/ndk-patches/libintl.h ${NDK}/toolchains/llvm/prebuilt/linux-x86_64/sysroot/usr/include/ \
  && rm -rf /tmp/ndk-patches

# Install proot and set up Termux prefix simulation directories natively in Docker
RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked,id=apt-cache \
  --mount=type=cache,target=/var/lib/apt,sharing=locked,id=apt-lib \
  eatmydata apt-get install -yq --no-install-recommends \
    proot

RUN mkdir -p /data/data/com.termux/files/usr \
  && mkdir -p /data/data/com.termux/files/home

# Remove the default ubuntu user and create 'builder' with UID 1000
RUN userdel -r ubuntu || true \
  && useradd -u 1000 -U -m -s /bin/bash builder \
  && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
  && chmod 0440 /etc/sudoers.d/builder \
  && chown -R builder:builder /data/data/com.termux

# Install modern tools for Python and formatting
# We install nodejs and npm to get prettier, shellcheck for bash scripts
RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked,id=apt-cache \
  --mount=type=cache,target=/var/lib/apt,sharing=locked,id=apt-lib \
  eatmydata apt-get install -yq --no-install-recommends \
    nodejs npm shellcheck

# Install prettier globally
RUN npm install -g prettier@latest

# Switch to builder user
USER builder:builder
WORKDIR /home/builder

# Install uv (astral-sh/uv) directly without piping to shell during runtime
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

# Add uv to PATH (if necessary)
ENV PATH="/home/builder/.local/bin:${PATH}"

# Install Python 3.13, ruff, and mypy via uv
RUN uv python install 3.13 \
 && uv tool install ruff \
 && uv tool install mypy

ENV REPO_ROOT=/home/builder/RepoExe

# We expect this to be mounted with '-v $PWD:/home/builder/RepoExe'
WORKDIR /home/builder/RepoExe
