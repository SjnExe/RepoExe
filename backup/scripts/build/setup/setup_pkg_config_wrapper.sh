setup_pkg_config_wrapper() {
	local _PKG_CONFIG_LIBDIR=$1
	local _WRAPPER_BIN="${PKG_BUILDDIR}/_wrapper/bin"
	mkdir -p "${_WRAPPER_BIN}"
	if [[ "${ON_DEVICE_BUILD}" == "false" ]]; then
		sed "s|^export PKG_CONFIG_LIBDIR=|export PKG_CONFIG_LIBDIR=${_PKG_CONFIG_LIBDIR}:|" \
			"${STANDALONE_TOOLCHAIN}/bin/pkg-config" \
			> "${_WRAPPER_BIN}/pkg-config"
		chmod +x "${_WRAPPER_BIN}/pkg-config"
		export PKG_CONFIG="${_WRAPPER_BIN}/pkg-config"
	fi
	export PATH="${_WRAPPER_BIN}:${PATH}"
}

setup_glib_cross_pkg_config_wrapper() {
	setup_pkg_config_wrapper "${PREFIX}/opt/glib/cross/lib/x86_64-linux-gnu/pkgconfig"
}

setup_wayland_cross_pkg_config_wrapper() {
	setup_pkg_config_wrapper "${PREFIX}/opt/libwayland/cross/lib/x86_64-linux-gnu/pkgconfig"
}
