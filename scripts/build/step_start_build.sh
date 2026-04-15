step_start_build() {
	# shellcheck source=/dev/null
	source "$PKG_BUILDER_SCRIPT"
	# Path to hostbuild marker, for use if package has hostbuild step
	HOSTBUILD_MARKER="$PKG_HOSTBUILD_DIR/BUILT_FOR_$PKG_VERSION"

	if [ "$PKG_METAPACKAGE" = "true" ]; then
		# Metapackage has no sources
		PKG_SKIP_SRC_EXTRACT=true
		# Usually metapackages are also platform dependent but it is not always the
		# right decision to mark them as such when they depend on packages which may
		# not be available for all architectures
		# PKG_PLATFORM_INDEPENDENT=true
	fi

	if [ -n "${PKG_EXCLUDED_ARCHES:=""}" ] && [ "$PKG_EXCLUDED_ARCHES" != "${PKG_EXCLUDED_ARCHES/$ARCH/}" ]; then
		echo "Skipping building $PKG_NAME for arch $ARCH"
		exit 0
	fi

	if [ -n "$PKG_PYTHON_COMMON_BUILD_DEPS" ] || [[ "$ON_DEVICE_BUILD" = "false" && -n "$PKG_PYTHON_CROSS_BUILD_DEPS" ]] || [[ "$ON_DEVICE_BUILD" = "true" && -n "$PKG_PYTHON_TARGET_DEPS" ]]; then
		# Enable python setting
		PKG_SETUP_PYTHON=true
	fi
	if [ -z "$PKG_PYTHON_RUNTIME_DEPS" ]; then
		PKG_PYTHON_RUNTIME_DEPS="$PKG_PYTHON_TARGET_DEPS"
	fi
	if [ "$PKG_PYTHON_RUNTIME_DEPS" = "false" ]; then
		PKG_PYTHON_RUNTIME_DEPS=""
	fi

	PKG_FULLVERSION=$PKG_VERSION
	if [ "$PKG_REVISION" != "0" ] || [ "$PKG_FULLVERSION" != "${PKG_FULLVERSION/-/}" ]; then
		# "0" is the default revision, so only include it if the upstream versions contains "-" itself
		PKG_FULLVERSION+="-$PKG_REVISION"
	fi
	# full format version for pacman
	local PKG_VERSION_EDITED=${PKG_VERSION//-/.}
	local INCORRECT_SYMBOLS=$(echo $PKG_VERSION_EDITED | grep -o '[0-9][a-z]')
	if [ -n "$INCORRECT_SYMBOLS" ]; then
		local PKG_VERSION_EDITED=${PKG_VERSION_EDITED//${INCORRECT_SYMBOLS:0:1}${INCORRECT_SYMBOLS:1:1}/${INCORRECT_SYMBOLS:0:1}.${INCORRECT_SYMBOLS:1:1}}
	fi
	PKG_FULLVERSION_FOR_PACMAN="${PKG_VERSION_EDITED}"
	if [ -n "$PKG_REVISION" ]; then
		PKG_FULLVERSION_FOR_PACMAN+="-${PKG_REVISION}"
	else
		PKG_FULLVERSION_FOR_PACMAN+="-0"
	fi

	if [ "$DEBUG_BUILD" = "true" ]; then
		if [ "$PKG_HAS_DEBUG" = "true" ]; then
			DEBUG="-dbg"
		else
			echo "Skipping building debug build for $PKG_NAME"
			exit 0
		fi
	else
		DEBUG=""
	fi

	if [ "$DEBUG_BUILD" = "false" ] && [ "$FORCE_BUILD" = "false" ]; then
		if [ -e "$BUILT_PACKAGES_DIRECTORY/$PKG_NAME" ] &&
			[ "$(cat "$BUILT_PACKAGES_DIRECTORY/$PKG_NAME")" = "$PKG_FULLVERSION" ]; then
			echo "$PKG_NAME@$PKG_FULLVERSION built - skipping (rm $BUILT_PACKAGES_DIRECTORY/$PKG_NAME to force rebuild)"
			exit 0
		elif [ "$ON_DEVICE_BUILD" = "true" ] &&
			([[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status} ${Version}\n' "$PKG_NAME" 2>/dev/null)" = "installed $PKG_FULLVERSION" ]] ||
			 [[ "$APP_PACKAGE_MANAGER" = "pacman" && "$(pacman -Q $PKG_NAME 2>/dev/null)" = "$PKG_NAME $PKG_FULLVERSION_FOR_PACMAN" ]]); then
			echo "$PKG_NAME@$PKG_FULLVERSION installed - skipping"
			exit 0
		fi
	fi

	if [ "$ON_DEVICE_BUILD" = "true" ] || [ "$ARCH_BITS" = "32" ]; then
		PKG_BUILD_MULTILIB=false
	fi
	if [ "$PKG_BUILD_MULTILIB" = "true" ] && [ $(tr ' ' '\n' <<< "${PKG_EXCLUDED_ARCHES//,/}" | grep -c -e '^arm$' -e '^i686$') = "2" ]; then
		PKG_BUILD_ONLY_MULTILIB=true
	fi

	echo "RepoExe - building $PKG_NAME for arch $ARCH..."
	test -t 1 && printf "\033]0;%s...\007" "$PKG_NAME"

	# Avoid exporting PKG_CONFIG_LIBDIR until after step_host_build.
	step_setup_pkg_config_libdir

	local PKG_BUILDDIR_ORIG="$PKG_BUILDDIR"
	if [ "$PKG_BUILD_IN_SRC" = "true" ]; then
		PKG_BUILDDIR=$PKG_SRCDIR
	fi
	if [ "$PKG_BUILD_MULTILIB" = "true" ] && [ "$PKG_BUILD_ONLY_MULTILIB" = "false" ] && ([ "$PKG_BUILD_IN_SRC" = "true" ] || [ "$PKG_MULTILIB_BUILDDIR" = "$PKG_BUILDDIR" ]); then
		error_exit "It is not possible to build 32-bit and 64-bit versions of a package in one place, the build location must be separate."
	fi

	if [ "$CONTINUE_BUILD" == "true" ]; then
		# If the package has a hostbuild step, verify that it has been built
		if [ "$PKG_HOSTBUILD" == "true" ] && [ ! -f "$HOSTBUILD_MARKER" ]; then
			error_exit "Cannot continue this build, hostbuilt tools are missing"
		fi

		# Set ELF_CLEANER for on-device continued build
		if [ "$PACKAGE_LIBRARY" = "bionic" ] && [ "$ON_DEVICE_BUILD" = "true" ]; then
			ELF_CLEANER="$(command -v repoexe-elf-cleaner)"
		fi
		# The rest in this function can be skipped when doing
		# a continued build
		return
	fi

	if [ "$ON_DEVICE_BUILD" = "true" ] && [ "$PKG_ON_DEVICE_BUILD_NOT_SUPPORTED" = "true" ]; then
		error_exit "Package '$PKG_NAME' is not available for on-device builds."
	fi

	# Delete and re-create the directories used for building the package
	step_setup_build_folders

	if [ "$PKG_BUILD_IN_SRC" = "true" ]; then
		# Create a file for users to know that the build directory not containing any built files is expected behaviour
		echo "Building in src due to PKG_BUILD_IN_SRC being set to true" > "$PKG_BUILDDIR_ORIG/BUILDING_IN_SRC.txt"
	fi

	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		if [ "$ON_DEVICE_BUILD" = "true" ]; then
			case "$APP_PACKAGE_MANAGER" in
				"apt") apt install -y repoexe-elf-cleaner;;
				"pacman") pacman -S repoexe-elf-cleaner --needed --noconfirm;;
			esac
			ELF_CLEANER="$(command -v repoexe-elf-cleaner)"
		else
			local ELF_CLEANER_VERSION
			ELF_CLEANER_VERSION=$(bash -c ". $SCRIPTDIR/packages/repoexe-elf-cleaner/build.sh; echo \$PKG_VERSION")
			download \
				"https://github.com/RepoExe/repoexe-elf-cleaner/releases/download/v${ELF_CLEANER_VERSION}/repoexe-elf-cleaner" \
				"$ELF_CLEANER" \
				59645fb25b84d11f108436e83d9df5e874ba4eb76ab62948869a23a3ee692fa7
			chmod u+x "$ELF_CLEANER"
		fi

		# Some packages search for libutil, libpthread and librt even
		# though this functionality is provided by libc.  Provide
		# library stubs so that such configure checks succeed.
		mkdir -p "$PREFIX/lib"
		for lib in libutil.so libpthread.so librt.so; do
			if [ ! -f $PREFIX/lib/$lib ]; then
				echo 'INPUT(-lc)' > $PREFIX/lib/$lib
			fi
		done
	fi
}

step_setup_pkg_config_libdir() {
	export PKG_CONFIG_LIBDIR=$_PREFIX__LIB_DIR/pkgconfig:$PREFIX/share/pkgconfig
}
