step_setup_variables() {
	: "${ARCH:="aarch64"}" # arm, aarch64, i686 or x86_64.
	: "${OUTPUT_DIR:="${SCRIPTDIR}/output"}"
	: "${DEBUG_BUILD:="false"}"
	: "${FORCE_BUILD:="false"}"
	: "${FORCE_BUILD_DEPENDENCIES:="false"}"
	: "${INSTALL_DEPS:="false"}"
	: "${PKG_MAKE_PROCESSES:="$(nproc)"}"
	: "${PKGS__BUILD__RM_ALL_PKGS_BUILT_MARKER_AND_INSTALL_FILES:="true"}"
	: "${PKGS__BUILD__RM_ALL_PKG_BUILD_DEPENDENT_DIRS:="false"}"
	: "${PKG_API_LEVEL:="24"}"
	: "${CONTINUE_BUILD:="false"}"
	: "${QUIET_BUILD:="false"}"
	: "${WITHOUT_DEPVERSION_BINDING:="false"}"
	: "${SKIP_DEPCHECK:="false"}"
	: "${GLOBAL_LIBRARY:="false"}"
	: "${TOPDIR:="$HOME/.repoexe-build"}"
	: "${PACMAN_PACKAGE_COMPRESSION:="xz"}"

	if [ -z "${PACKAGE_FORMAT-}" ]; then
		if [ "$ON_DEVICE_BUILD" = "true" ] && [ -n "${APP_PACKAGE_MANAGER-}" ]; then
			PACKAGE_FORMAT="$([ "${APP_PACKAGE_MANAGER-}" = "apt" ] && echo "debian" || echo "${APP_PACKAGE_MANAGER-}")"
		else
			PACKAGE_FORMAT="debian"
		fi
	fi

	case "${PACKAGE_FORMAT-}" in
		debian) export PACKAGE_MANAGER="apt";;
		pacman) export PACKAGE_MANAGER="pacman";;
		*) error_exit "Unsupported package format \"${PACKAGE_FORMAT-}\". Only 'debian' and 'pacman' formats are supported";;
	esac

	# Default package library base
	if [ -z "${PACKAGE_LIBRARY-}" ]; then
		export PACKAGE_LIBRARY="bionic"
	fi

	if [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		build_props__set_prefix_dir_and_sub_variables "$_PREFIX_GLIBC"
		if [ "$ON_DEVICE_BUILD" = "false" ] && [ "$PREFIX" != "$CGCT_DEFAULT_PREFIX" ]; then
			export CGCT_APP_PREFIX="$PREFIX"
		fi
		if ! package__is_package_name_have_glibc_prefix "$PKG_NAME"; then
			PKG_NAME="$(package__add_prefix_glibc_to_package_name "${PKG_NAME}")"
		fi
	fi

	if [ "$ON_DEVICE_BUILD" = "true" ]; then
		# For on-device builds cross-compiling is not supported so we can
		# store information about built packages under $TOPDIR.
		BUILT_PACKAGES_DIRECTORY="$TOPDIR/.built-packages"
		PKGS__BUILD__RM_ALL_PKGS_BUILT_MARKER_AND_INSTALL_FILES="false"

		if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
			# On-device builds without repoexe-exec are unsupported.
			if [[ ":${LD_PRELOAD:-}:" != ":${_PREFIX__LIB_DIR}/librepoexe-exec"*".so:" ]]; then
				error_exit "On-device builds without repoexe-exec are not supported."
			fi
		fi
	else
		BUILT_PACKAGES_DIRECTORY="/data/data/.built-packages"
	fi

	# PKG_MAINTAINER should be explicitly set in build.sh of the package.
	: "${PKG_MAINTAINER:="default"}"

	step_setup_arch_variables
	REAL_ARCH="$ARCH"
	REAL_HOST_PLATFORM="$HOST_PLATFORM"

	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		if [ "$ON_DEVICE_BUILD" = "false" ] && [ ! -d "$NDK" ]; then
			error_exit "NDK ($NDK) not pointing at a directory!"
		fi

		if [ "$ON_DEVICE_BUILD" = "false" ] && ! grep -s -q "Pkg.Revision = $NDK_VERSION_NUM" "$NDK/source.properties"; then
			error_exit "Wrong NDK version - we need $NDK_VERSION"
		fi
	elif [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		if [ "$ON_DEVICE_BUILD" = "true" ]; then
			if [ -n "${LD_PRELOAD-}" ]; then
				unset LD_PRELOAD
			fi
			if [ ! -d "${PREFIX}/bin" ]; then
				error_exit "Glibc components are not installed, run './scripts/setup-repoexe-glibc.sh'"
			fi
		else
			if [ ! -d "${CGCT_DIR}/${ARCH}/bin" ]; then
				error_exit "The cgct tools were not found, run './scripts/setup-cgct.sh'"
			fi
		fi
	fi

	# The build tuple that may be given to --build configure flag:
	BUILD_TUPLE=$(sh "$SCRIPTDIR/scripts/config.guess")

	# We do not put all of build-tools/$ANDROID_BUILD_TOOLS_VERSION/ into PATH
	# to avoid stuff like arm-linux-androideabi-ld there to conflict with ones from
	# the standalone toolchain.
	D8=$ANDROID_HOME/build-tools/$ANDROID_BUILD_TOOLS_VERSION/d8

	COMMON_CACHEDIR="$TOPDIR/_cache"
	ELF_CLEANER=$COMMON_CACHEDIR/repoexe-elf-cleaner

	export prefix=${PREFIX}
	export PREFIX=${PREFIX}

	# Explicitly export in case the default was set.
	export ARCH=${ARCH}

	if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
		# In "offline" mode store/pick cache from directory with
		# build.sh script.
		PKG_CACHEDIR=$PKG_BUILDER_DIR/cache
	else
		PKG_CACHEDIR=$TOPDIR/$PKG_NAME/cache
	fi
	PKG_CMAKE_BUILD=Ninja # Which cmake generator to use
	PKG_ANTI_BUILD_DEPENDS="" # This cannot be used to "resolve" circular dependencies
	PKG_BREAKS="" # https://www.debian.org/doc/debian-policy/ch-relationships.html#s-binarydeps
	PKG_BUILDDIR=$TOPDIR/$PKG_NAME/build
	PKG_BUILD_DEPENDS=""
	PKG_BUILD_IN_SRC=false
	PKG_BUILD_MULTILIB=false # multilib-compilation (compilation of 32-bit packages for 64-bit devices)
	PKG_BUILD_ONLY_MULTILIB=false # Specifies that the package is compiled only via multilib-compilation. Enabled automatically if multilib-compilation is enabled and the `PKG_EXCLUDED_ARCHES` variable contains `arm` and `i686` values.
	PKG_MULTILIB_BUILDDIR=$TOPDIR/$PKG_NAME/multilib-build # path to the assembled components of the 32-bit package if multilib-compilation is enabled
	PKG_CONFFILES=""
	PKG_CONFLICTS="" # https://www.debian.org/doc/debian-policy/ch-relationships.html#s-conflicts
	PKG_DEPENDS=""
	PKG_DESCRIPTION="FIXME:Add description"
	PKG_DISABLE_GIR=false # setup_gir
	PKG_ESSENTIAL=false
	PKG_EXTRA_CONFIGURE_ARGS=""
	PKG_EXTRA_HOSTBUILD_CONFIGURE_ARGS=""
	PKG_EXTRA_MAKE_ARGS=""
	PKG_EXTRA_UNDEF_SYMBOLS_TO_CHECK="" # space-separated undefined symbols to check in step_massaging
	PKG_FORCE_CMAKE=false # if the package has autotools as well as cmake, then set this to prefer cmake
	PKG_GIT_BRANCH="" # branch defaults to 'v$PKG_VERSION' unless this variable is defined
	PKG_HAS_DEBUG=true # set to false if debug build doesn't exist or doesn't work, for example for python based packages
	PKG_HOMEPAGE=""
	PKG_HOSTBUILD=false # Set if a host build should be done in PKG_HOSTBUILD_DIR:
	PKG_HOSTBUILD_DIR=$TOPDIR/$PKG_NAME/host-build
	PKG_LICENSE_FILE="" # Relative path from $PKG_SRCDIR to LICENSE file. It is installed to $PREFIX/share/$PKG_NAME.
	PKG_MASSAGEDIR=$TOPDIR/$PKG_NAME/massage
	PKG_METAPACKAGE=false
	PKG_NO_ELF_CLEANER=false # set this to true to disable running of repoexe-elf-cleaner on built binaries
	PKG_NO_REPLACE_GUESS_SCRIPTS=false # if true, do not find and replace config.guess and config.sub in source directory
	PKG_NO_SHEBANG_FIX=false # if true, skip fixing shebang accordingly to PREFIX
	PKG_NO_SHEBANG_FIX_FILES="" # files to be excluded from fixing shebang
	PKG_NO_STRIP=false # set this to true to disable stripping binaries
	PKG_NO_STATICSPLIT=false
	PKG_STATICSPLIT_EXTRA_PATTERNS=""
	PKG_PACKAGEDIR=$TOPDIR/$PKG_NAME/package
	PKG_PLATFORM_INDEPENDENT=false
	PKG_PRE_DEPENDS=""
	PKG_PROVIDES="" #https://www.debian.org/doc/debian-policy/#virtual-packages-provides
	PKG_RECOMMENDS="" # https://www.debian.org/doc/debian-policy/ch-relationships.html#s-binarydeps
	PKG_REPLACES=""
	PKG_REVISION="0" # http://www.debian.org/doc/debian-policy/ch-controlfields.html#s-f-Version
	PKG_RM_AFTER_INSTALL=""
	PKG_SHA256=""
	PKG_SRCDIR=$TOPDIR/$PKG_NAME/src
	PKG_SUGGESTS=""
	PKG_TMPDIR=$TOPDIR/$PKG_NAME/tmp
	PKG_UNDEF_SYMBOLS_FILES="" # maintainer acknowledges these files have undefined symbols will not result in broken packages, eg: all, *.elf, ./path/to/file. "error" to always print results as errors
	PKG_NO_OPENMP_CHECK=false # if true, skip the openmp check
	PKG_SERVICE_SCRIPT=() # Fill with entries like: ("daemon name" 'script to execute'). Script is echoed with -e so can contain \n for multiple lines
	PKG_GROUPS="" # https://wiki.archlinux.org/title/Pacman#Installing_package_groups
	PKG_ON_DEVICE_BUILD_NOT_SUPPORTED=false # if the package does not support compilation on a device, then this package should not be compiled on devices
	PKG_SETUP_PYTHON=false # setting python to compile a package
	PYTHON_VERSION="$( # get the latest version of python
		if [[ "${PACKAGE_LIBRARY}" == "bionic" ]]; then
			. "$SCRIPTDIR/packages/python/build.sh"
		else # glibc
			. "$SCRIPTDIR/gpkg/python/build.sh"
		fi
		echo "$_MAJOR_VERSION"
	)"
	PKG_PYTHON_TARGET_DEPS="" # python modules to be installed via pip3
	PKG_PYTHON_CROSS_BUILD_DEPS="" # python modules to be installed via build-pip
	PKG_PYTHON_COMMON_BUILD_DEPS="" # python modules to be installed via pip3 or build-pip
	PKG_PYTHON_RUNTIME_DEPS="" # python modules to be installed via pip3 in debscriptps
	PYTHON_CROSSENV_PREFIX="$TOPDIR/python${PYTHON_VERSION}-crossenv-prefix-$PACKAGE_LIBRARY-$ARCH" # python modules dependency location (only used in non-devices)
	PYTHON_CROSSENV_BUILDHOME="$PYTHON_CROSSENV_PREFIX/build/lib/python${PYTHON_VERSION}"
	PYTHON_HOME=$_PREFIX__LIB_DIR/python${PYTHON_VERSION} # location of python libraries
	LLVM_VERSION="$( # get the latest version of LLVM
		if [[ "${PACKAGE_LIBRARY}" == "bionic" ]]; then
			. "$SCRIPTDIR/packages/libllvm/build.sh"
		else # glibc
			. "$SCRIPTDIR/gpkg/llvm/build.sh"
		fi
		echo "$PKG_VERSION"
	)"
	LLVM_MAJOR_VERSION="${LLVM_VERSION%%.*}"
	LLVM_NEXT_MAJOR_VERSION="$((LLVM_MAJOR_VERSION + 1))"
	PKG_MESON_NATIVE=false
	PKG_CMAKE_CROSSCOMPILING=true
	PROOT_EXTRA_ENV_VARS="" # Extra environvent variables for proot command in setup_proot

	unset CFLAGS CPPFLAGS LDFLAGS CXXFLAGS
	unset MESON_ENABLE_SOVERSION # setenv to enable SOVERSION suffix for shared libs built with Meson
}

# Setting architectural information according to the `ARCH` variable
step_setup_arch_variables() {
	if [ "x86_64" = "$ARCH" ] || [ "aarch64" = "$ARCH" ]; then
		ARCH_BITS=64
	else
		ARCH_BITS=32
	fi

	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		HOST_PLATFORM="${ARCH}-linux-android"
	else
		HOST_PLATFORM="${ARCH}-linux-gnu"
	fi
	if [ "$ARCH" = "arm" ]; then
		HOST_PLATFORM="${HOST_PLATFORM}eabi"
		if [ "$PACKAGE_LIBRARY" = "glibc" ]; then
			HOST_PLATFORM="${HOST_PLATFORM}hf"
		fi
	fi
}
