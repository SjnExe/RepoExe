step_configure() {
	[ "$PKG_METAPACKAGE" = "true" ] && return

	# This check should be above autotools check as haskell package too makes use of configure scripts which
	# should be executed by its own build system.
	if ls "${PKG_SRCDIR}"/*.cabal &>/dev/null || ls "${PKG_SRCDIR}"/cabal.project &>/dev/null; then
		[ "$CONTINUE_BUILD" == "true" ] && return
		step_configure_cabal
	elif [ "$PKG_FORCE_CMAKE" = "false" ] && [ -f "$PKG_SRCDIR/configure" ]; then
		if [ "$CONTINUE_BUILD" == "true" ]; then
			return
		fi
		step_configure_autotools
	elif [ "$PKG_FORCE_CMAKE" = "true" ] || [ -f "$PKG_SRCDIR/CMakeLists.txt" ]; then
		setup_cmake
		if [ "$PKG_CMAKE_BUILD" = Ninja ]; then
			setup_ninja
		fi

		# Some packages, for example swift, uses cmake
		# internally, but cannot be configured with our
		# step_configure_cmake function (CMakeLists.txt
		# is not in src dir)
		if [ -f "$PKG_SRCDIR/CMakeLists.txt" ] &&
			[ "$CONTINUE_BUILD" == "false" ]; then
			step_configure_cmake
		fi
	elif [ -f "$PKG_SRCDIR/meson.build" ]; then
		if [ "$CONTINUE_BUILD" == "true" ]; then
			return
		fi
		step_configure_meson
	fi
}

step_configure_multilib() {
	step_configure
}
