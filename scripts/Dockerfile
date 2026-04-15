# Build with:
#	docker build -t ghcr.io/<owner>/repoexe-builder .
# Push to GitHub registry with:
#	docker push ghcr.io/<owner>/repoexe-builder
FROM ubuntu:24.04

# Fix locale to avoid warnings:
ENV LANG=en_US.UTF-8
ENV DEBIAN_FRONTEND=noninteractive

# Needed for setup:
RUN rm -rf /tmp/repoexe-packages && \
    mkdir -p /tmp/repoexe-packages/scripts
# Since we build from RepoExe root, the paths should reflect our structure
COPY ./scripts/llvm-snapshot.gpg.key ./scripts/properties.sh ./scripts/setup-android-sdk.sh ./scripts/setup-ubuntu.sh ./scripts/repo.json /tmp/repoexe-packages/scripts/
RUN mkdir -p /tmp/repoexe-packages/scripts/build
COPY ./scripts/build/termux_download.sh /tmp/repoexe-packages/scripts/build/

# Setup needed packages and the Android SDK and NDK
RUN apt-get update && \
	apt-get -yq upgrade && \
	apt-get install -yq --no-install-recommends sudo lsb-release software-properties-common && \
	userdel ubuntu && \
	useradd -u 1001 -U -m -s /bin/bash builder && \
	echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder && \
	chmod 0440 /etc/sudoers.d/builder && \
	chmod a+rx /tmp/repoexe-packages/scripts/*.sh /tmp/repoexe-packages/scripts/build/termux_download.sh && \
	su - builder -c "TERMUX_PKGS__BUILD__IS_DOCKER_BUILD='true' /tmp/repoexe-packages/scripts/setup-ubuntu.sh" && \
	su - builder -c "TERMUX_PKGS__BUILD__IS_DOCKER_BUILD='true' /tmp/repoexe-packages/scripts/setup-android-sdk.sh" && \
	apt-get remove -yq --autoremove lsb-release software-properties-common && \
	apt-get clean && \
	rm -rf /var/lib/apt/lists/* && \
	su - builder -c "rm -rf ~/lib/*.zip ~/.android/cache/" && \
	rm -rf /tmp/repoexe-packages

# Switch User
USER builder:builder

ENV REPO_ROOT=/home/builder/RepoExe

# We expect this to be mounted with '-v $PWD:/home/builder/RepoExe':
WORKDIR /home/builder/RepoExe
