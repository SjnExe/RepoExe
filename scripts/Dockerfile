# Build with:
#	docker build -t ghcr.io/<owner>/repoexe-builder .
# Push to GitHub registry with:
#	docker push ghcr.io/<owner>/repoexe-builder
FROM ubuntu:24.04

# Fix locale to avoid warnings:
ENV LANG=en_US.UTF-8
ENV DEBIAN_FRONTEND=noninteractive

# Needed for setup:
RUN rm -rf /tmp/packages \
  && mkdir -p /tmp/packages/scripts
# Since we build from RepoExe root, the paths should reflect our structure
COPY ./scripts/llvm-snapshot.gpg.key ./scripts/properties.sh ./scripts/setup-android-sdk.sh ./scripts/setup-ubuntu.sh ./scripts/repo.json /tmp/packages/scripts/
RUN mkdir -p /tmp/packages/scripts/build
COPY ./scripts/build/download.sh /tmp/packages/scripts/build/

# Setup needed packages and the Android SDK and NDK
# We use eatmydata to disable fsync and significantly speed up package installations
# We switch to Azure mirrors for Ubuntu since GitHub Actions run on Azure, drastically increasing download speeds.
RUN sed -i 's/archive.ubuntu.com/azure.archive.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources \
  && sed -i 's/security.ubuntu.com/azure.archive.ubuntu.com/g' /etc/apt/sources.list.d/ubuntu.sources \
  && apt-get update \
  && apt-get install -yq --no-install-recommends eatmydata aria2 \
  && eatmydata apt-get -yq upgrade \
  && eatmydata apt-get install -yq --no-install-recommends sudo lsb-release software-properties-common \
  && userdel ubuntu \
  && useradd -u 1001 -U -m -s /bin/bash builder \
  && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
  && chmod 0440 /etc/sudoers.d/builder \
  && chmod a+rx /tmp/packages/scripts/*.sh /tmp/packages/scripts/build/download.sh \
  && su - builder -c "PKGS__BUILD__IS_DOCKER_BUILD='true' /tmp/packages/scripts/setup-ubuntu.sh" \
  && su - builder -c "PKGS__BUILD__IS_DOCKER_BUILD='true' /tmp/packages/scripts/setup-android-sdk.sh" \
  && eatmydata apt-get remove -yq --autoremove lsb-release software-properties-common \
  && eatmydata apt-get clean \
  && rm -rf /var/lib/apt/lists/* \
  && su - builder -c "rm -rf ~/lib/*.zip ~/.android/cache/" \
  && rm -rf /tmp/packages

# Switch User
USER builder:builder

ENV REPO_ROOT=/home/builder/RepoExe

# We expect this to be mounted with '-v $PWD:/home/builder/RepoExe':
WORKDIR /home/builder/RepoExe
