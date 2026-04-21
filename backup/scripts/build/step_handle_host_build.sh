step_handle_host_build() {
	[ "$PKG_METAPACKAGE" = "true" ] && return
	[ "$PKG_HOSTBUILD" = "false" ] && return

	cd "$PKG_SRCDIR"
	local HOST_BUILD_PATCHES=$(find $PKG_BUILDER_DIR -mindepth 1 -maxdepth 1 -name \*.patch.beforehostbuild | sort)
	for patch in $HOST_BUILD_PATCHES; do
		echo "Applying patch: $(basename $patch)"
		test -f "$patch" && sed "s%\@PREFIX\@%${PREFIX}%g" "$patch" | patch --silent -p1
	done

	if [ ! -f "$HOSTBUILD_MARKER" ]; then
		rm -Rf "$PKG_HOSTBUILD_DIR"
		mkdir -p "$PKG_HOSTBUILD_DIR"
		cd "$PKG_HOSTBUILD_DIR"
		step_host_build
		touch "$HOSTBUILD_MARKER"
	fi
}
