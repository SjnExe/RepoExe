step_setup_toolchain() {
	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		STANDALONE_TOOLCHAIN="$COMMON_CACHEDIR/android-r${NDK_VERSION}-api-${PKG_API_LEVEL}"
		[ "$PKG_METAPACKAGE" = "true" ] && return

		# Bump STANDALONE_TOOLCHAIN if a change is made in
		# toolchain setup to ensure that everyone gets an updated
		# toolchain
		if [ "${NDK_VERSION}" = "29" ]; then
			STANDALONE_TOOLCHAIN+="-v4"
			setup_toolchain_29
		else
			error_exit "We do not have a setup_toolchain function for NDK version $NDK_VERSION"
		fi
	elif [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		if [ "$ON_DEVICE_BUILD" = "true" ]; then
			STANDALONE_TOOLCHAIN="$PREFIX"
		fi
		setup_toolchain_gnu
	fi
}

step_setup_multilib_environment() {
	conf_multilib_vars
	if [ "$PKG_BUILD_ONLY_MULTILIB" = "false" ]; then
		PKG_BUILDDIR="$PKG_MULTILIB_BUILDDIR"
	fi
	step_setup_arch_variables
	step_setup_pkg_config_libdir
	step_setup_toolchain
	cd $PKG_BUILDDIR
}
