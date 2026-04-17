#!/bin/bash

# Setting the TMPDIR variable
: "${TMPDIR:=/tmp}"
export TMPDIR

# Set the build-package.sh call depth
# If its the root call, then create a file to store the list of packages and their dependencies
# that have been compiled at any instant by recursive calls to build-package.sh
if (( ${BUILD_PACKAGE_CALL_DEPTH-0} )); then
	export BUILD_PACKAGE_CALL_DEPTH=$((BUILD_PACKAGE_CALL_DEPTH+1))
else
	BUILD_PACKAGE_CALL_DEPTH=0
	BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH="${TMPDIR}/build-package-call-built-packages-list-$(date +"%Y-%m-%d-%H.%M.%S.")$((RANDOM%1000))"
	BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH="${TMPDIR}/build-package-call-building-packages-list-$(date +"%Y-%m-%d-%H.%M.%S.")$((RANDOM%1000))"
	export BUILD_PACKAGE_CALL_DEPTH BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH
	echo -n " " > "$BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH"
	touch "$BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH"
fi

set -euo pipefail

cd "$(realpath "$(dirname "$0")")"
SCRIPTDIR=$(pwd)
export SCRIPTDIR

# Store pid of current process in a file for docker__run_docker_exec_trap
# shellcheck source=scripts/utils/docker/docker.sh
source "$SCRIPTDIR/scripts/utils/docker/docker.sh"
docker__create_docker_exec_pid_file

# Source the `repoexe_package` library.
# shellcheck source=scripts/utils/repoexe/package/repoexe_package.sh
source "$SCRIPTDIR/scripts/utils/repoexe/package/repoexe_package.sh"

export SOURCE_DATE_EPOCH=${SOURCE_DATE_EPOCH:-$(git -c log.showSignature=false log -1 --pretty=%ct 2>/dev/null || date "+%s")}

if [[ "$(uname -o)" == "Android" || -e "/system/bin/app_process" ]]; then
	if [[ "$(id -u)" == "0" ]]; then
		echo "On-device execution of this script as root is disabled."
		exit 1
	fi

	# This variable tells all parts of build system that
	# the build is being performed on device.
	export ON_DEVICE_BUILD=true
else
	export ON_DEVICE_BUILD=false
fi

# Automatically enable offline set of sources and build tools.
# Offline RepoExe bundle can be created by executing
# script ./scripts/setup-offline-bundle.sh.
if [[ -f "${SCRIPTDIR}/build-tools/.installed" ]]; then
	export PACKAGES_OFFLINE=true
fi

# Lock file to prevent parallel running in the same environment.
BUILD_LOCK_FILE="${TMPDIR}/.build.lck"
if [[ ! -e "$BUILD_LOCK_FILE" ]]; then
	touch "$BUILD_LOCK_FILE"
fi

REPO_PKG_FORMAT="$(jq --raw-output '.pkg_format // "debian"' "${SCRIPTDIR}/scripts/repo.json")"
export REPO_PKG_FORMAT

# Special variable for internal use. It forces script to ignore
# lock file.
: "${BUILD_IGNORE_LOCK:=false}"

# Utility function to log an error message and exit with an error code.
# shellcheck source=scripts/build/error_exit.sh
source "$SCRIPTDIR/scripts/build/error_exit.sh"

# Utility function to download a resource with an expected checksum.
# shellcheck source=scripts/build/download.sh
source "$SCRIPTDIR/scripts/build/download.sh"

# Utility function to run binaries under RepoExe environment via proot.
# shellcheck source=scripts/build/setup/setup_proot.sh
source "$SCRIPTDIR/scripts/build/setup/setup_proot.sh"

# Utility function to setup blueprint-compiler (may be used by gnome-calculator and epiphany).
# shellcheck source=scripts/build/setup/setup_bpc.sh
source "$SCRIPTDIR/scripts/build/setup/setup_bpc.sh"

# Utility function to setup capnproto (may be used by bitcoin).
# shellcheck source=scripts/build/setup/setup_capnp.sh
source "$SCRIPTDIR/scripts/build/setup/setup_capnp.sh"

# Utility function for setting up Cargo C-ABI helpers.
# shellcheck source=scripts/build/setup/setup_cargo_c.sh
source "$SCRIPTDIR/scripts/build/setup/setup_cargo_c.sh"

# Utility function for setting up pkg-config wrapper.
# shellcheck source=scripts/build/setup/setup_pkg_config_wrapper.sh
source "$SCRIPTDIR/scripts/build/setup/setup_pkg_config_wrapper.sh"

# Utility function for setting up Crystal toolchain.
# shellcheck source=scripts/build/setup/setup_crystal.sh
source "$SCRIPTDIR/scripts/build/setup/setup_crystal.sh"

# Utility function for setting up DotNet toolchain.
# shellcheck source=scripts/build/setup/setup_dotnet.sh
source "$SCRIPTDIR/scripts/build/setup/setup_dotnet.sh"

# Utility function for setting up Flang toolchain.
# shellcheck source=scripts/build/setup/setup_flang.sh
source "$SCRIPTDIR/scripts/build/setup/setup_flang.sh"

# Utility function to setup a GHC cross-compiler toolchain targeting Android.
# shellcheck source=scripts/build/setup/setup_ghc.sh
source "$SCRIPTDIR/scripts/build/setup/setup_ghc.sh"

# Utility function to setup GHC iserv to cross-compile haskell-template.
# shellcheck source=scripts/build/setup/setup_ghc_iserv.sh
source "$SCRIPTDIR/scripts/build/setup/setup_ghc_iserv.sh"

# Utility function to setup cabal-install (may be used by ghc toolchain).
# shellcheck source=scripts/build/setup/setup_cabal.sh
source "$SCRIPTDIR/scripts/build/setup/setup_cabal.sh"

# Utility function to setup jailbreak-cabal. It is used to remove version constraints
# from Cabal packages.
# shellcheck source=scripts/build/setup/setup_jailbreak_cabal.sh
source "$SCRIPTDIR/scripts/build/setup/setup_jailbreak_cabal.sh"

# Utility function for setting up GObject Introspection cross environment.
# shellcheck source=scripts/build/setup/setup_gir.sh
source "$SCRIPTDIR/scripts/build/setup/setup_gir.sh"

# Utility function for setting up GN toolchain.
# shellcheck source=scripts/build/setup/setup_gn.sh
source "$SCRIPTDIR/scripts/build/setup/setup_gn.sh"

# Utility function for golang-using packages to setup a go toolchain.
# shellcheck source=scripts/build/setup/setup_golang.sh
source "$SCRIPTDIR/scripts/build/setup/setup_golang.sh"

# Utility function for setting up LDC cross environment.
# shellcheck source=scripts/build/setup/setup_ldc.sh
source "$SCRIPTDIR/scripts/build/setup/setup_ldc.sh"

# Utility function for setting up no-integrated (GNU Binutils) as.
# shellcheck source=scripts/build/setup/setup_no_integrated_as.sh
source "$SCRIPTDIR/scripts/build/setup/setup_no_integrated_as.sh"

# Utility function for setting up build-python for cross-compilation of Python and crossenv
# shellcheck source=scripts/build/setup/setup_build_python.sh
source "$SCRIPTDIR/scripts/build/setup/setup_build_python.sh"

# Utility function for python packages to setup a python.
# shellcheck source=scripts/build/setup/setup_python_pip.sh
source "$SCRIPTDIR/scripts/build/setup/setup_python_pip.sh"

# Utility function for rust-using packages to setup a rust toolchain.
# shellcheck source=scripts/build/setup/setup_rust.sh
source "$SCRIPTDIR/scripts/build/setup/setup_rust.sh"

# Utility function for swift-using packages to setup a swift toolchain
# shellcheck source=scripts/build/setup/setup_swift.sh
source "$SCRIPTDIR/scripts/build/setup/setup_swift.sh"

# Utility function to setup a current xmake build system.
# shellcheck source=scripts/build/setup/setup_xmake.sh
source "$SCRIPTDIR/scripts/build/setup/setup_xmake.sh"

# Utility function for zig-using packages to setup a zig toolchain.
# shellcheck source=scripts/build/setup/setup_zig.sh
source "$SCRIPTDIR/scripts/build/setup/setup_zig.sh"

# Utility function to setup a current ninja build system.
# shellcheck source=scripts/build/setup/setup_ninja.sh
source "$SCRIPTDIR/scripts/build/setup/setup_ninja.sh"

# Utility function to setup Node.js JavaScript Runtime
# shellcheck source=scripts/build/setup/setup_nodejs.sh
source "$SCRIPTDIR/scripts/build/setup/setup_nodejs.sh"

# Utility function to setup a current meson build system.
# shellcheck source=scripts/build/setup/setup_meson.sh
source "$SCRIPTDIR/scripts/build/setup/setup_meson.sh"

# Utility function to setup a current cmake build system
# shellcheck source=scripts/build/setup/setup_cmake.sh
source "$SCRIPTDIR/scripts/build/setup/setup_cmake.sh"

# Utility function to setup protobuf:
# shellcheck source=scripts/build/setup/setup_protobuf.sh
source "$SCRIPTDIR/scripts/build/setup/setup_protobuf.sh"

# Utility function to setup the current version of the tree-sitter CLI
# shellcheck source=scripts/build/setup/setup_treesitter.sh
source "$SCRIPTDIR/scripts/build/setup/setup_treesitter.sh"

# Setup variables used by the build. Not to be overridden by packages.
# shellcheck source=scripts/build/step_setup_variables.sh
source "$SCRIPTDIR/scripts/build/step_setup_variables.sh"

# Save away and restore build setups which may change between builds.
# shellcheck source=scripts/build/step_handle_buildarch.sh
source "$SCRIPTDIR/scripts/build/step_handle_buildarch.sh"

# Function to get PKG_VERSION from build.sh
# shellcheck source=scripts/build/extract_dep_info.sh
source "$SCRIPTDIR/scripts/build/extract_dep_info.sh"

# Function that downloads a .deb (using the download function)
# shellcheck source=scripts/build/download_deb_pac.sh
source "$SCRIPTDIR/scripts/build/download_deb_pac.sh"

# Function that downloads and extracts multiple Ubuntu packages (using the download function)
# shellcheck source=scripts/build/download_ubuntu_packages.sh
source "$SCRIPTDIR/scripts/build/download_ubuntu_packages.sh"

# Script to download InRelease, verify it's signature and then download Packages.xz by hash
# shellcheck source=scripts/build/get_repo_files.sh
source "$SCRIPTDIR/scripts/build/get_repo_files.sh"

# Download or build dependencies. Not to be overridden by packages.
# shellcheck source=scripts/build/step_get_dependencies.sh
source "$SCRIPTDIR/scripts/build/step_get_dependencies.sh"

# Download python dependency modules for compilation.
# shellcheck source=scripts/build/step_get_dependencies_python.sh
source "$SCRIPTDIR/scripts/build/step_get_dependencies_python.sh"

# Handle config scripts that needs to be run during build. Not to be overridden by packages.
# shellcheck source=scripts/build/step_override_config_scripts.sh
source "$SCRIPTDIR/scripts/build/step_override_config_scripts.sh"

# Remove old src and build folders and create new ones
# shellcheck source=scripts/build/step_setup_build_folders.sh
source "$SCRIPTDIR/scripts/build/step_setup_build_folders.sh"

# Source the package build script and start building. Not to be overridden by packages.
# shellcheck source=scripts/build/step_start_build.sh
source "$SCRIPTDIR/scripts/build/step_start_build.sh"

# Cleans up files from already built packages. Not to be overridden by packages.
# shellcheck source=scripts/build/step_start_build.sh
source "$SCRIPTDIR/scripts/build/step_cleanup_packages.sh"

# Download or build dependencies. Not to be overridden by packages.
# shellcheck source=scripts/build/step_create_timestamp_file.sh
source "$SCRIPTDIR/scripts/build/step_create_timestamp_file.sh"

# Run just after sourcing $PKG_BUILDER_SCRIPT. Can be overridden by packages.
# shellcheck source=scripts/build/get_source/step_get_source.sh
source "$SCRIPTDIR/scripts/build/get_source/step_get_source.sh"

# Run from step_get_source if PKG_SRCURL begins with "git+".
# shellcheck source=scripts/build/get_source/step_get_source.sh
source "$SCRIPTDIR/scripts/build/get_source/git_clone_src.sh"

# Run from step_get_source if PKG_SRCURL does not begin with "git+".
# shellcheck source=scripts/build/get_source/download_src_archive.sh
source "$SCRIPTDIR/scripts/build/get_source/download_src_archive.sh"

# Run from step_get_source after download_src_archive.
# shellcheck source=scripts/build/get_source/unpack_src_archive.sh
source "$SCRIPTDIR/scripts/build/get_source/unpack_src_archive.sh"

# Hook for packages to act just after the package sources have been obtained.
# Invoked from $PKG_SRCDIR.
step_post_get_source() {
	return
}

# Optional host build. Not to be overridden by packages.
# shellcheck source=scripts/build/step_handle_host_build.sh
source "$SCRIPTDIR/scripts/build/step_handle_host_build.sh"

# Perform a host build. Will be called in $PKG_HOSTBUILD_DIR.
# After step_post_get_source() and before step_patch_package()
# shellcheck source=scripts/build/step_host_build.sh
source "$SCRIPTDIR/scripts/build/step_host_build.sh"

# Setup a standalone Android NDK toolchain. Called from step_setup_toolchain.
# shellcheck source=scripts/build/toolchain/setup_toolchain_29.sh
source "$SCRIPTDIR/scripts/build/toolchain/setup_toolchain_29.sh"

# Setup a standalone Android NDK 23c toolchain. Called from step_setup_toolchain.
# shellcheck source=scripts/build/toolchain/setup_toolchain_23c.sh
source "$SCRIPTDIR/scripts/build/toolchain/setup_toolchain_23c.sh"

# Setup a standalone Glibc GNU toolchain. Called from step_setup_toolchain.
# shellcheck source=scripts/build/toolchain/setup_toolchain_gnu.sh
source "$SCRIPTDIR/scripts/build/toolchain/setup_toolchain_gnu.sh"

# Runs step_setup_toolchain_${NDK_VERSION}. Not to be overridden by packages.
# shellcheck source=scripts/build/step_setup_toolchain.sh
source "$SCRIPTDIR/scripts/build/step_setup_toolchain.sh"

# Apply all *.patch files for the package. Not to be overridden by packages.
# shellcheck source=scripts/build/step_patch_package.sh
source "$SCRIPTDIR/scripts/build/step_patch_package.sh"

# Replace autotools build-aux/config.{sub,guess} with ours to add android targets.
# shellcheck source=scripts/build/step_replace_guess_scripts.sh
source "$SCRIPTDIR/scripts/build/step_replace_guess_scripts.sh"

# For package scripts to override. Called in $PKG_BUILDDIR.
step_pre_configure() {
	return
}

# Setup configure args and run $PKG_SRCDIR/configure. This function is called from step_configure
# shellcheck source=scripts/build/configure/step_configure_autotools.sh
source "$SCRIPTDIR/scripts/build/configure/step_configure_autotools.sh"

# Setup configure args and run cmake. This function is called from step_configure
# shellcheck source=scripts/build/configure/step_configure_cmake.sh
source "$SCRIPTDIR/scripts/build/configure/step_configure_cmake.sh"

# Setup configure args and run meson. This function is called from step_configure
# shellcheck source=scripts/build/configure/step_configure_meson.sh
source "$SCRIPTDIR/scripts/build/configure/step_configure_meson.sh"

# Setup configure args and run cabal. This function is called from step_configure
# shellcheck source=scripts/build/configure/step_configure_cabal.sh
source "$SCRIPTDIR/scripts/build/configure/step_configure_cabal.sh"

# Configure the package
# shellcheck source=scripts/build/configure/step_configure.sh
source "$SCRIPTDIR/scripts/build/configure/step_configure.sh"

# Hook for packages after configure step
step_post_configure() {
	return
}

# Make package, either with ninja or make
# shellcheck source=scripts/build/step_make.sh
source "$SCRIPTDIR/scripts/build/step_make.sh"

# Make install, either with ninja, make of cargo
# shellcheck source=scripts/build/step_make_install.sh
source "$SCRIPTDIR/scripts/build/step_make_install.sh"

# Hook function for package scripts to override.
step_post_make_install() {
	return
}

# Install hooks (alpm-hooks) and hook-scripts into the pacman package
# shellcheck source=scripts/build/step_install_pacman_hooks.sh
source "$SCRIPTDIR/scripts/build/step_install_pacman_hooks.sh"

# Add service scripts from array PKG_SERVICE_SCRIPT, if it is set
# shellcheck source=scripts/build/step_install_service_scripts.sh
source "$SCRIPTDIR/scripts/build/step_install_service_scripts.sh"

# Link/copy the LICENSE for the package to $PREFIX/share/$PKG_NAME/
# shellcheck source=scripts/build/step_install_license.sh
source "$SCRIPTDIR/scripts/build/step_install_license.sh"

# Function to cp (through tar) installed files to massage dir
# shellcheck source=scripts/build/step_copy_into_massagedir.sh
source "$SCRIPTDIR/scripts/build/step_copy_into_massagedir.sh"

# Hook function to create {pre,post}install, {pre,post}rm-scripts for subpkgs
# shellcheck source=scripts/build/step_create_subpkg_debscripts.sh
source "$SCRIPTDIR/scripts/build/step_create_subpkg_debscripts.sh"

# Create all subpackages. Run from step_massage
# shellcheck source=scripts/build/create_debian_subpackages.sh
source "$SCRIPTDIR/scripts/build/create_debian_subpackages.sh"

# Create all subpackages. Run from step_massage
# shellcheck source=scripts/build/create_pacman_subpackages.sh
source "$SCRIPTDIR/scripts/build/create_pacman_subpackages.sh"

# Function to run various cleanup/fixes
# shellcheck source=scripts/build/step_massage.sh
source "$SCRIPTDIR/scripts/build/step_massage.sh"

# Function to run strip symbols during step_massage
# shellcheck source=scripts/build/step_strip_elf_symbols.sh
source "$SCRIPTDIR/scripts/build/step_strip_elf_symbols.sh"

# Function to run termux-elf-cleaner during step_massage
# shellcheck source=scripts/build/step_elf_cleaner.sh
source "$SCRIPTDIR/scripts/build/step_elf_cleaner.sh"

# Hook for packages before massage step
step_pre_massage() {
	return
}

# Hook for packages after massage step
step_post_massage() {
	return
}

# Function to create {pre,post}install, {pre,post}rm-scripts and similar
# shellcheck source=scripts/build/step_create_debscripts.sh
source "$SCRIPTDIR/scripts/build/step_create_debscripts.sh"

# Function to generate debscripts for python packages.
# shellcheck source=scripts/build/step_create_python_debscripts.sh
source "$SCRIPTDIR/scripts/build/step_create_python_debscripts.sh"

# Convert Debian maintainer scripts into pacman-compatible installation hooks.
# This is used only when creating pacman packages.
# shellcheck source=scripts/build/step_create_pacman_install_hook.sh
source "$SCRIPTDIR/scripts/build/step_create_pacman_install_hook.sh"

# Create the build deb file. Not to be overridden by package scripts.
# shellcheck source=scripts/build/step_create_debian_package.sh
source "$SCRIPTDIR/scripts/build/step_create_debian_package.sh"

# Create the build .pkg.tar.xz file. Not to be overridden by package scripts.
# shellcheck source=scripts/build/step_create_pacman_package.sh
source "$SCRIPTDIR/scripts/build/step_create_pacman_package.sh"

# Process 'update-alternatives' entries from `.alternatives` files.
# Not to be overridden by package scripts.
# shellcheck source=scripts/build/step_update_alternatives.sh
source "$SCRIPTDIR/scripts/build/step_update_alternatives.sh"

# Finish the build. Not to be overridden by package scripts.
# shellcheck source=scripts/build/step_finish_build.sh
source "$SCRIPTDIR/scripts/build/step_finish_build.sh"

################################################################################

# shellcheck source=scripts/properties.sh
source "$SCRIPTDIR/scripts/properties.sh"

if [[ "$ON_DEVICE_BUILD" == "true" ]]; then
	# Setup APP_PACKAGE_MANAGER
	# shellcheck source=/dev/null
	source "$PREFIX/bin/repoexe-setup-package-manager"

	# For on device builds cross compiling is not supported.
	# Target architecture must be same as for environment used currently.
	case "$APP_PACKAGE_MANAGER" in
		"apt") ARCH=$(dpkg --print-architecture);;
		"pacman") ARCH=$(pacman-conf Architecture);;
	esac
	export ARCH
fi

# Check if the package is in the compiled list
check_package_in_built_packages_list() {
	[[ ! -f "$BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH" ]] && \
		error_exit "file '$BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH' not found."
	# slightly faster than `grep -q $word $file`
	[[ " $(< "$BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH") " == *" $1 "* ]]
	return $?
}

# Adds a package to the list of built packages if it is not in the list
add_package_to_built_packages_list() {
	if ! check_package_in_built_packages_list "$1"; then
		echo -n "$1 " >> "$BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH"
	fi
}

# Check if the package is in the compiling list
check_package_in_building_packages_list() {
	[[ ! -f "$BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH" ]] && \
		error_exit "file '$BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH' not found."
	# slightly faster than `grep -q $word $file`
	[[ $'\n'"$(<"$BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH")"$'\n' == *$'\n'"$1"$'\n'* ]]
	return $?
}

# Configure variables (ARCH, _PREFIX__INCLUDE_DIR, _PREFIX__LIB_DIR) for multilib-compilation
conf_multilib_vars() {
	# Change the 64-bit architecture type to its 32-bit counterpart in the `ARCH` variable
	case "$ARCH" in
		"aarch64") ARCH="arm";;
		"x86_64") ARCH="i686";;
		*) error_exit "It is impossible to set multilib arch for ${ARCH} arch."
	esac
	_PREFIX__INCLUDE_SUBDIR="$_PREFIX__MULTI_INCLUDE_SUBDIR"
	_PREFIX__INCLUDE_DIR="$_PREFIX__MULTI_INCLUDE_DIR"
	_PREFIX__LIB_SUBDIR="$_PREFIX__MULTI_LIB_SUBDIR"
	_PREFIX__LIB_DIR="$_PREFIX__MULTI_LIB_DIR"
}

# Run functions for normal compilation and multilib-compilation
run_base_and_multilib_build_step() {
	case "${1}" in
		step_configure|step_make|step_make_install) local func="${1}";;
		*) error_exit "Unsupported function '${1}'."
	esac
	cd "$PKG_BUILDDIR"
	if [[ "$PKG_BUILD_ONLY_MULTILIB" == "false" ]]; then
		"${func}"
	fi
	if [[ "$PKG_BUILD_MULTILIB" == "true" ]]; then
		(
			step_setup_multilib_environment
			"${func}_multilib"
		)
	fi
}

# Special hook to prevent use of "sudo" inside package build scripts.
# build-package.sh shouldn't perform any privileged operations.
sudo() {
	error_exit "Do not use 'sudo' inside build scripts. Build environment should be configured through ./scripts/setup-ubuntu.sh."
}

_show_usage() {
	echo "Usage: ./build-package.sh [options] PACKAGE_1 PACKAGE_2 ..."
	echo
	echo "Build a package by creating a .deb file in the output/ folder."
	echo
	echo "Available options:"
	[[ "$ON_DEVICE_BUILD" = "false" ]] && echo "  -a The architecture to build for: aarch64(default), arm, i686, x86_64 or all."
	echo "  -c Continue previous build."
	echo "  -C Cleanup already built packages on low disk space."
	echo "  -d Build with debug symbols."
	echo "  -D Build a disabled package in disabled-packages/."
	echo "  -f Force build even if package has already been built."
	echo "  -F Force build even if package and its dependencies have already been built."
	[[ "$ON_DEVICE_BUILD" = "false" ]] && echo "  -i Download and extract dependencies instead of building them."
	echo "  -I Download and extract dependencies instead of building them, keep existing $BASE_DIR files."
	echo "  -L The package and its dependencies will be based on the same library."
	echo "  -q Quiet build."
	echo "  -Q Loud build -- set -x debug output and function tracing."
	echo "  -r Remove all package build dependent dirs that '-f/-F'"
	echo "     flags alone would not remove, like cache dir containing "
	echo "     package sources and host build dir. Ignored if '-f/-F'"
	echo "     flags are not passed."
	echo "  -w Install dependencies without version binding."
	echo "  -s Skip dependency check."
	echo "  -o Specify directory where to put built packages. Default: output/"
	echo "  --format Specify package output format (debian, pacman)."
	echo "  --library Specify library of package (bionic, glibc)."
	exit 1
}

declare -a PACKAGE_LIST=()

(( $# )) || _show_usage
while (( $# )); do
	case "$1" in
		--) shift 1; break;;
		-h|--help) _show_usage;;
		--format)
			if [[ -z "${2-}" ]]; then
				error_exit "./build-package.sh: option '--format' requires an argument"
			fi
			shift 1
			export PACKAGE_FORMAT="$1"
		;;
		--library)
			if [[ -z "${2-}" ]]; then
				error_exit "./build-package.sh: option '--library' requires an argument"
			fi
			shift 1
			export PACKAGE_LIBRARY="$1"
		;;
		-a)
			if [[ "$ON_DEVICE_BUILD" == "true" ]]; then
				error_exit "./build-package.sh: option '-a' is not available for on-device builds"
			fi
			if [[ -z "${2-}" ]]; then
				error_exit "./build-package.sh: option '-a' requires an argument"
			fi
			shift 1
			export ARCH="$1"
		;;
		-d) export DEBUG_BUILD=true;;
		-D) IS_DISABLED=true;;
		-f) FORCE_BUILD=true;;
		-F) FORCE_BUILD_DEPENDENCIES=true && FORCE_BUILD=true;;
		-i)
			if [[ "$ON_DEVICE_BUILD" == "true" ]]; then
				error_exit "./build-package.sh: option '-i' is not available for on-device builds"
			fi
			export INSTALL_DEPS=true
		;;
		-I)
			export INSTALL_DEPS=true
			export PKGS__BUILD__RM_ALL_PKGS_BUILT_MARKER_AND_INSTALL_FILES=false
		;;
		-L) export GLOBAL_LIBRARY=true;;
		-q) export QUIET_BUILD=true;;
		-Q) export PS4='+$0 \[\e[32m\]${FUNCNAME[0]:-<global scope>}${FUNCNAME[*]:+()}:$LINENO\[\e[0m\] '; set -x;;
		-r) export PKGS__BUILD__RM_ALL_PKG_BUILD_DEPENDENT_DIRS=true;;
		-w) export WITHOUT_DEPVERSION_BINDING=true;;
		-s) export SKIP_DEPCHECK=true;;
		-o)
			if [[ -z "${2-}" ]]; then
				error_exit "./build-package.sh: option '-o' requires an argument"
			fi
			shift 1
			OUTPUT_DIR="$(realpath -m "$1")"
		;;
		-c) CONTINUE_BUILD=true;;
		-C) CLEANUP_BUILT_PACKAGES_ON_LOW_DISK_SPACE=true;;
		-*) error_exit "./build-package.sh: illegal option '$1'";;
		*) PACKAGE_LIST+=("$1");;
	esac
	shift 1
done
unset -f _show_usage

# Dependencies should be used from repo only if they are built for
# same package name.
if [[ "$REPO_APP__PACKAGE_NAME" != "$APP_PACKAGE" ]]; then
	echo "Ignoring -i option to download dependencies since repo package name ($REPO_APP__PACKAGE_NAME) does not equal app package name ($APP_PACKAGE)"
	INSTALL_DEPS=false
fi

case "$REPO_PKG_FORMAT" in
	debian|pacman) :;;
	*) error_exit "'pkg_format' is incorrectly specified in repo.json file. Only 'debian' and 'pacman' formats are supported";;
esac

if [[ -n "${PACKAGE_FORMAT-}" ]]; then
	case "${PACKAGE_FORMAT-}" in
		debian|pacman) :;;
		*) error_exit "Unsupported package format \"${PACKAGE_FORMAT-}\". Only 'debian' and 'pacman' formats are supported";;
	esac
fi

if [[ -n "${PACKAGE_LIBRARY-}" ]]; then
	case "${PACKAGE_LIBRARY-}" in
		bionic|glibc) :;;
		*) error_exit "Unsupported library \"${PACKAGE_LIBRARY-}\". Only 'bionic' and 'glibc' library are supported";;
	esac
fi

if [[ "${INSTALL_DEPS-false}" = "true" || "${PACKAGE_LIBRARY-bionic}" = "glibc" ]]; then
	# Setup PGP keys for verifying integrity of dependencies.
	# Keys are obtained from our keyring package.
	mkdir -p "$HOME/.gnupg"
	chmod 700 "$HOME/.gnupg"
	gpg --list-keys 2C7F29AE97891F6419A9E2CDB0076E490B71616B > /dev/null 2>&1 || {
		gpg --import "$SCRIPTDIR/packages/repoexe-keyring/grimler.gpg"
		gpg --no-tty --command-file <(echo -e "trust\n5\ny") --edit-key 2C7F29AE97891F6419A9E2CDB0076E490B71616B
	}
	gpg --list-keys CC72CF8BA7DBFA0182877D045A897D96E57CF20C > /dev/null 2>&1 || {
		gpg --import "$SCRIPTDIR/packages/repoexe-keyring/repoexe-autobuilds.gpg"
		gpg --no-tty --command-file <(echo -e "trust\n5\ny") --edit-key CC72CF8BA7DBFA0182877D045A897D96E57CF20C
	}
	gpg --list-keys 998DE27318E867EA976BA877389CEED64573DFCA > /dev/null 2>&1 || {
		gpg --import "$SCRIPTDIR/packages/repoexe-keyring/repoexe-pacman.gpg"
		gpg --no-tty --command-file <(echo -e "trust\n5\ny") --edit-key 998DE27318E867EA976BA877389CEED64573DFCA
	}
fi

for (( i=0; i < ${#PACKAGE_LIST[@]}; i++ )); do
	# Following commands must be executed under lock to prevent running
	# multiple instances of "./build-package.sh".
	#
	# To provide a sane environment for each package,
	# builds are done in an explicit subshell for each.
	# shellcheck disable=SC2031
	(
		if [[ "$BUILD_IGNORE_LOCK" != "true" ]]; then
			flock -n 5 || error_exit "Another build is already running within same environment."
		fi
		(
		# Handle 'all' arch:
		if [[ "$ON_DEVICE_BUILD" == "false" && -n "${ARCH+x}" && "${ARCH}" == 'all' ]]; then
			_SELF_ARGS=()
			[[ "${CLEANUP_BUILT_PACKAGES_ON_LOW_DISK_SPACE:-}" == "true" ]] && _SELF_ARGS+=("-C")
			[[ "${DEBUG_BUILD:-}" == "true" ]] && _SELF_ARGS+=("-d")
			[[ "${IS_DISABLED:-}" == "true" ]] && _SELF_ARGS+=("-D")
			[[ "${FORCE_BUILD:-}" == "true" && "${FORCE_BUILD_DEPENDENCIES:-}" != "true" ]] && _SELF_ARGS+=("-f")
			[[ "${FORCE_BUILD:-}" == "true" && "${FORCE_BUILD_DEPENDENCIES:-}" == "true" ]] && _SELF_ARGS+=("-F")
			[[ "${INSTALL_DEPS:-}" == "true" && "${PKGS__BUILD__RM_ALL_PKGS_BUILT_MARKER_AND_INSTALL_FILES:-}" != "false" ]] && _SELF_ARGS+=("-i")
			[[ "${INSTALL_DEPS:-}" == "true" && "${PKGS__BUILD__RM_ALL_PKGS_BUILT_MARKER_AND_INSTALL_FILES:-}" == "false" ]] && _SELF_ARGS+=("-I")
			[[ "${GLOBAL_LIBRARY:-}" == "true" ]] && _SELF_ARGS+=("-L")
			[[ -n "${OUTPUT_DIR:-}" ]] && _SELF_ARGS+=("-o" "$OUTPUT_DIR")
			[[ "${PKGS__BUILD__RM_ALL_PKG_BUILD_DEPENDENT_DIRS:-}" == "true" ]] && _SELF_ARGS+=("-r")
			[[ "${WITHOUT_DEPVERSION_BINDING:-}" == "true" ]] && _SELF_ARGS+=("-w")
			[[ -n "${PACKAGE_FORMAT:-}" ]] && _SELF_ARGS+=("--format" "$PACKAGE_FORMAT")
			[[ -n "${PACKAGE_LIBRARY:-}" ]] && _SELF_ARGS+=("--library" "$PACKAGE_LIBRARY")

			for arch in 'aarch64' 'arm' 'i686' 'x86_64'; do
				env ARCH="$arch" BUILD_IGNORE_LOCK=true ./build-package.sh \
					"${_SELF_ARGS[@]}" "${PACKAGE_LIST[i]}"
			done
			exit
		fi

		# Check the package to build:
		PKG_NAME="$(basename "${PACKAGE_LIST[i]}")"
		PKG_BUILDER_DIR=""
		if [[ ${PACKAGE_LIST[i]} == *"/"* ]]; then
			# Path to directory which may be outside this repo:
			if [[ ! -d "${PACKAGE_LIST[i]}" ]]; then error_exit "'${PACKAGE_LIST[i]}' seems to be a path but is not a directory"; fi
			PKG_BUILDER_DIR="$(realpath "${PACKAGE_LIST[i]}")"
		else
			# Package name:
			# FIXME: PACKAGES_DIRECTORIES should be made into an array.
			for package_directory in $PACKAGES_DIRECTORIES; do
				if [[ -d "${SCRIPTDIR}/${package_directory}/${PKG_NAME}" ]]; then
					export PKG_BUILDER_DIR="${SCRIPTDIR}/$package_directory/$PKG_NAME"
					break
				elif [[ -n "${IS_DISABLED=""}" && -d "${SCRIPTDIR}/disabled-packages/${PKG_NAME}" ]]; then
					export PKG_BUILDER_DIR="$SCRIPTDIR/disabled-packages/$PKG_NAME"
					break
				fi
			done
			if [[ -z "${PKG_BUILDER_DIR}" ]]; then
				error_exit "No package $PKG_NAME found in any of the enabled repositories. Are you trying to set up a custom repository?"
			fi
		fi
		export PKG_BUILDER_DIR
		PKG_BUILDER_SCRIPT=$PKG_BUILDER_DIR/build.sh
		if [[ ! -f "$PKG_BUILDER_SCRIPT" ]]; then
			error_exit "No build.sh script at package dir $PKG_BUILDER_DIR!"
		fi

		step_setup_variables
		step_handle_buildarch

		step_cleanup_packages
		step_start_build

		if ! check_package_in_building_packages_list "${PKG_BUILDER_DIR#"${SCRIPTDIR}/"}"; then
			echo "${PKG_BUILDER_DIR#"${SCRIPTDIR}/"}" >> "$BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH"
		fi

		if [[ "$CONTINUE_BUILD" == "false" ]]; then
			step_get_dependencies
			step_override_config_scripts
		fi

		step_create_timestamp_file

		if [[ "$CONTINUE_BUILD" == "false" ]]; then
			cd "$PKG_CACHEDIR"
			step_get_source
			cd "$PKG_SRCDIR"
			step_post_get_source
			step_handle_host_build
		fi

		step_setup_toolchain

		if [[ "$CONTINUE_BUILD" == "false" ]]; then
			step_get_dependencies_python
			step_patch_package
			step_replace_guess_scripts
			cd "$PKG_SRCDIR"
			step_pre_configure
		fi

		# Even on continued build we might need to setup paths
		# to tools so need to run part of configure step
		run_base_and_multilib_build_step step_configure

		if [[ "$CONTINUE_BUILD" == "false" ]]; then
			cd "$PKG_BUILDDIR"
			step_post_configure
		fi
		run_base_and_multilib_build_step step_make
		run_base_and_multilib_build_step step_make_install
		cd "$PKG_BUILDDIR"
		step_post_make_install
		step_install_pacman_hooks
		step_install_service_scripts
		step_install_license
		cd "$PKG_MASSAGEDIR"
		step_copy_into_massagedir
		cd "$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
		step_pre_massage
		cd "$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
		step_massage
		cd "$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
		step_post_massage
		# At the final stage (when the package is archiving) it is better to use commands from the system
		if [[ "$ON_DEVICE_BUILD" = "false" ]]; then
			export PATH="/usr/bin:$PATH"
		fi
		cd "$PKG_MASSAGEDIR"
		case "$PACKAGE_FORMAT" in
			debian) step_create_debian_package;;
			pacman) step_create_pacman_package;;
			*) error_exit "Unknown package format '$PACKAGE_FORMAT'.";;
		esac
		# Save a list of compiled packages for further work with it
		if check_package_in_building_packages_list "${PKG_BUILDER_DIR#"${SCRIPTDIR}/"}"; then
			sed -i "\|^${PKG_BUILDER_DIR#"${SCRIPTDIR}/"}$|d" "$BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH"
		fi
		add_package_to_built_packages_list "$PKG_NAME"
		step_finish_build
		) 5>&-
	) 5< "$BUILD_LOCK_FILE"
done

# Removing a file to store a list of compiled packages
if (( ! BUILD_PACKAGE_CALL_DEPTH )); then
	rm "$BUILD_PACKAGE_CALL_BUILT_PACKAGES_LIST_FILE_PATH"
	rm "$BUILD_PACKAGE_CALL_BUILDING_PACKAGES_LIST_FILE_PATH"
fi
