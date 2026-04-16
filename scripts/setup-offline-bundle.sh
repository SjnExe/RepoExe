#!/usr/bin/env bash
##
## Download all package sources and install all build tools whether possible,
## so they will be available offline.
##

set -e -u

if [ "$(uname -o)" = "Android" ] || [ "$(uname -m)" != "x86_64" ]; then
	echo "This script supports only x86_64 GNU/Linux systems."
	exit 1
fi

export SCRIPTDIR="$(dirname "$(readlink -f "$0")")/../"
mkdir -p "$SCRIPTDIR"/build-tools

. "$SCRIPTDIR"/scripts/properties.sh
: "${PKG_MAKE_PROCESSES:="$(nproc)"}"
export PKG_MAKE_PROCESSES
export PACKAGES_OFFLINE=true
export ARCH=aarch64
export ON_DEVICE_BUILD=false
export PKG_TMPDIR="$SCRIPTDIR/build-tools/_tmp"
export COMMON_CACHEDIR="$PKG_TMPDIR"
export HOST_PLATFORM=aarch64-linux-android
export ARCH_BITS=64
export BUILD_TUPLE=x86_64-pc-linux-gnu
export PKG_API_LEVEL=24
export TOPDIR="$HOME/.repoexe-build"
export PYTHON_CROSSENV_PREFIX="$TOPDIR/python-crossenv-prefix"
export PYTHON_VERSION=$(. "$SCRIPTDIR/packages/python/build.sh"; echo "$_MAJOR_VERSION")
export PYTHON_HOME=$PREFIX/lib/python${PYTHON_VERSION}
export CC=gcc CXX=g++ LD=ld AR=ar STRIP=strip PKG_CONFIG=pkg-config
export CPPFLAGS="" CFLAGS="" CXXFLAGS="" LDFLAGS=""
export PACKAGE_LIBRARY=bionic
mkdir -p "$PKG_TMPDIR"

# Build tools.
. "$SCRIPTDIR"/scripts/build/download.sh
(. "$SCRIPTDIR"/scripts/build/setup/setup_cargo_c.sh
	termux_setup_cargo_c
)
(. "$SCRIPTDIR"/scripts/build/setup/setup_cmake.sh
	termux_setup_cmake
)
# GHC fails. Skipping for now.
#(. "$SCRIPTDIR"/scripts/build/setup/setup_ghc.sh
#	termux_setup_ghc
#)
(. "$SCRIPTDIR"/scripts/build/setup/setup_golang.sh
	termux_setup_golang
)
(
	. "$SCRIPTDIR"/scripts/build/setup/setup_ninja.sh
	. "$SCRIPTDIR"/scripts/build/setup/setup_meson.sh
	termux_setup_meson
)
(. "$SCRIPTDIR"/scripts/build/setup/setup_protobuf.sh
	termux_setup_protobuf
)
#(. "$SCRIPTDIR"/scripts/build/setup/setup_python_pip.sh
#	termux_setup_python_pip
#)
# Offline rust is not supported yet.
#(. "$SCRIPTDIR"/scripts/build/setup/setup_rust.sh
#	termux_setup_rust
#)
(. "$SCRIPTDIR"/scripts/build/setup/setup_swift.sh
	termux_setup_swift
)
(. "$SCRIPTDIR"/scripts/build/setup/setup_zig.sh
	termux_setup_zig
)
(test -d "$SCRIPTDIR"/build-tools/android-sdk && test -d "$SCRIPTDIR"/build-tools/android-ndk && exit 0
	"$SCRIPTDIR"/scripts/setup-android-sdk.sh
)
rm -rf "${PKG_TMPDIR}"

# Package sources.
for repo_path in $(jq --raw-output 'del(.pkg_format) | keys | .[]' $SCRIPTDIR/repo.json); do
	for p in "$SCRIPTDIR"/$repo_path/*; do
		(
			. "$SCRIPTDIR"/scripts/build/get_source/step_get_source.sh
			. "$SCRIPTDIR"/scripts/build/get_source/git_clone_src.sh
			. "$SCRIPTDIR"/scripts/build/get_source/download_src_archive.sh
			. "$SCRIPTDIR"/scripts/build/get_source/unpack_src_archive.sh

			# Disable archive extraction in step_get_source.sh.
			termux_extract_src_archive() {
				:
			}

			PKG_NAME=$(basename "$p")
			PKG_BUILDER_DIR="${p}"
			PKG_CACHEDIR="${p}/cache"
			PKG_METAPACKAGE=false

			# Set some variables to dummy values to avoid errors.
			PKG_TMPDIR="${PKG_CACHEDIR}/.tmp"
			PKG_SRCDIR="${PKG_CACHEDIR}/.src"
			PKG_BUILDDIR="$PKG_SRCDIR"
			PKG_HOSTBUILD_DIR="$PKG_TMPDIR"
			PKG_GIT_BRANCH=""
			DEBUG_BUILD=false


			mkdir -p "$PKG_CACHEDIR" "$PKG_TMPDIR" "$PKG_SRCDIR"
			cd "$PKG_CACHEDIR"

			. "${p}"/build.sh || true
			if ! ${PKG_METAPACKAGE}; then
				echo "Downloading sources for '$PKG_NAME'..."
				termux_step_get_source

				# Delete dummy src and tmp directories.
				rm -rf "$PKG_TMPDIR" "$PKG_SRCDIR"
			fi
		)
	done
done

# Mark to tell build-package.sh to enable offline mode.
touch "$SCRIPTDIR"/build-tools/.installed
