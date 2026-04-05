FROM ghcr.io/termux/package-builder:latest

# We extend the official Termux package-builder as it already contains everything
# necessary to compile Termux packages (clang, ndk, rust, python, etc.).
# No redundant tooling (like 'gh' or 'requests') is installed here because
# repository indexing and GitHub Releases upload occur directly on the GitHub Runner host.

# Add any repository specific global configuration
ENV REPO_ROOT=/home/builder/RepoExe
