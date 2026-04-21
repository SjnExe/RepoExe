step_finish_build() {
	echo "RepoExe - build of '$PKG_NAME' done"
	test -t 1 && printf "\033]0;%s - DONE\007" "$PKG_NAME"

	mkdir -p "$BUILT_PACKAGES_DIRECTORY"
	echo "$PKG_FULLVERSION" > "$BUILT_PACKAGES_DIRECTORY/$PKG_NAME"

	for subpackage in "$PKG_BUILDER_DIR"/*.subpackage.sh; do
		local subpkg_name="$(basename $subpackage | sed 's@\.subpackage\.sh@@g')"
		echo "$PKG_FULLVERSION" > "$BUILT_PACKAGES_DIRECTORY/${subpkg_name}"
	done
	exit 0
}
