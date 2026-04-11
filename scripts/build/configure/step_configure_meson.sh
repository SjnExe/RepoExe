step_configure_meson() {
	setup_meson

	local _meson_buildtype="minsize"
	local _meson_stripflag="--strip"
	if [ "$DEBUG_BUILD" = "true" ]; then
		_meson_buildtype="debug"
		_meson_stripflag=
	fi

	CC=gcc CXX=g++ CFLAGS= CXXFLAGS= CPPFLAGS= LDFLAGS= $MESON \
		setup \
		$PKG_SRCDIR \
		$PKG_BUILDDIR \
		--$(test "${PKG_MESON_NATIVE}" = "true" && echo "native-file" || echo "cross-file") $MESON_CROSSFILE \
		--prefix $PREFIX \
		--libdir $_PREFIX__LIB_SUBDIR \
		--includedir $_PREFIX__INCLUDE_SUBDIR \
		--buildtype ${_meson_buildtype} \
		${_meson_stripflag} \
		$PKG_EXTRA_CONFIGURE_ARGS \
		|| (step_configure_meson_failure_hook && false)
}

step_configure_meson_failure_hook() {
	false
}
