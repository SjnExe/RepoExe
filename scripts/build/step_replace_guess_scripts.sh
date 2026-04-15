step_replace_guess_scripts() {
	[ "$PKG_METAPACKAGE" = "true" ] && return
	[ "$PKG_NO_REPLACE_GUESS_SCRIPTS" = "true" ] && return

	cd "$PKG_SRCDIR"
	find . -name config.sub -exec chmod u+w '{}' \; -exec cp "$SCRIPTDIR/scripts/config.sub" '{}' \;
	find . -name config.guess -exec chmod u+w '{}' \; -exec cp "$SCRIPTDIR/scripts/config.guess" '{}' \;

	if [ "$ON_DEVICE_BUILD" = "true" ] && [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		local list_files=$(grep -s -r -l '^#!.*/bin/' $PKG_SRCDIR)
		if [ -n "$list_files" ]; then
			sed -i "s|#\!.*/bin/|#\!$PREFIX_CLASSICAL/bin/|" $list_files
		fi
	fi
}
