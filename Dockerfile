# syntax=docker/dockerfile:1
FROM ubuntu:24.04

# Fix locale to avoid warnings:
ENV DEBIAN_FRONTEND=noninteractive
ENV LANG=en_US.UTF-8

# Configure apt and install core dependencies
RUN rm -f /etc/apt/apt.conf.d/docker-clean \
  && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache

RUN \
  --mount=type=cache,target=/var/cache/apt,sharing=locked,id=apt-cache \
  --mount=type=cache,target=/var/lib/apt,sharing=locked,id=apt-lib \
  apt-get update \
  && apt-get install -yq --no-install-recommends \
    locales apt-utils eatmydata sudo curl git ca-certificates \
  && locale-gen en_US.UTF-8 \
  && update-locale LANG=en_US.UTF-8 \
  && eatmydata apt-get -yq upgrade

# Remove the default ubuntu user and create 'builder' with UID 1000
RUN userdel -r ubuntu || true \
  && useradd -u 1000 -U -m -s /bin/bash builder \
  && echo "builder ALL=(root) NOPASSWD:ALL" > /etc/sudoers.d/builder \
  && chmod 0440 /etc/sudoers.d/builder

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
