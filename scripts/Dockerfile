# syntax=docker/dockerfile:1
# Build with:
#	docker build -t ghcr.io/<owner>/repoexe-builder .
# Push to GitHub registry with:
#	docker push ghcr.io/<owner>/repoexe-builder
FROM ubuntu:24.04

# Fix locale to avoid warnings:
ENV DEBIAN_FRONTEND=noninteractive

# Needed for setup:
RUN rm -rf /tmp/packages \
  && mkdir -p /tmp/packages/scripts/build

# Since we build from RepoExe root, the paths should reflect our structure
# Split COPY and RUN into logical steps for better caching

# 1. Base Setup & Properties
COPY ./scripts/llvm-snapshot.gpg.key ./scripts/properties.sh ./scripts/setup-ubuntu.sh /tmp/packages/scripts/
COPY ./scripts/repo.json /tmp/packages/scripts/

RUN rm -f /etc/apt/apt.conf.d/docker-clean \
  && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  groupadd -r systemd-journal \
  && useradd -r -s /bin/false systemd-network \
  && useradd -r -s /bin/false systemd-resolve \
  && apt-get update \
  && apt-get install -yq --no-install-recommends locales \
  && locale-gen en_US.UTF-8 \
  && update-locale LANG=en_US.UTF-8 \
  && sed -i 's/archive.ubuntu.com/azure.archive.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources \
  && sed -i 's/security.ubuntu.com/azure.archive.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources \
  && apt-get update \
  && apt-get install -yq --no-install-recommends eatmydata aria2 \
  && eatmydata apt-get -yq upgrade \
  && eatmydata apt-get install -yq --no-install-recommends sudo lsb-release software-properties-common \
  && userdel ubuntu \
  && useradd -u 1001 -U -m -s /bin/bash builder \
  && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
  && chmod 0440 /etc/sudoers.d/builder

ENV LANG=en_US.UTF-8

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  chmod a+rx /tmp/packages/scripts/*.sh \
  && su - builder -c "PKGS__BUILD__IS_DOCKER_BUILD='true' /tmp/packages/scripts/setup-ubuntu.sh"

# 2. Android SDK Setup
COPY ./scripts/build/download.sh /tmp/packages/scripts/build/
COPY ./scripts/setup-android-sdk.sh /tmp/packages/scripts/

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked \
  --mount=type=cache,target=/var/lib/apt,sharing=locked \
  chmod a+rx /tmp/packages/scripts/setup-android-sdk.sh /tmp/packages/scripts/build/download.sh \
  && su - builder -c "PKGS__BUILD__IS_DOCKER_BUILD='true' /tmp/packages/scripts/setup-android-sdk.sh" \
  && eatmydata apt-get remove -yq --autoremove lsb-release software-properties-common \
  && su - builder -c "rm -rf ~/.android/cache/" \
  && rm -rf /tmp/packages

# Switch User
USER builder:builder

ENV REPO_ROOT=/home/builder/RepoExe

# We expect this to be mounted with '-v $PWD:/home/builder/RepoExe':
WORKDIR /home/builder/RepoExe
