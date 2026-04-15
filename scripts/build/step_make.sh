step_make() {
	[ "$PKG_METAPACKAGE" = "true" ] && return

	local QUIET_BUILD=
	if [ "$QUIET_BUILD" = true ]; then
		QUIET_BUILD="-s"
	fi

	if test -f build.ninja; then
		ninja -j $MAKE_PROCESSES
	elif ls ./*.cabal &>/dev/null || ls ./cabal.project &>/dev/null; then
		cabal --config="$CABAL_CONFIG" build
	elif ls ./*akefile &>/dev/null || [ ! -z "$PKG_EXTRA_MAKE_ARGS" ]; then
		if [ -z "$PKG_EXTRA_MAKE_ARGS" ]; then
			make -j $MAKE_PROCESSES $QUIET_BUILD
		else
			make -j $MAKE_PROCESSES $QUIET_BUILD ${PKG_EXTRA_MAKE_ARGS}
		fi
	elif test -f dub.json; then
		setup_ldc
		dub build \
			-b release \
			--compiler=ldc2 \
			--arch "$LDC_TRIPLE"\
			${PKG_EXTRA_CONFIGURE_ARGS:+ $PKG_EXTRA_CONFIGURE_ARGS}
	fi
}

step_make_multilib() {
	step_make
}
