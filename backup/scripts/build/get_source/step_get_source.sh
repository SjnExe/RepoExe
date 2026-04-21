step_get_source() {
	: "${PKG_SRCURL:=""}"

	if [ "${PKG_SRCURL:0:4}" == "git+" ]; then
		[ ! "$QUIET_BUILD" = true ] && echo "Downloading $PKG_NAME@$PKG_VERSION git source from '$PKG_SRCURL' if necessary..."
		git_clone_src
	else
		if [ -z "${PKG_SRCURL}" ] || [ "${PKG_SKIP_SRC_EXTRACT-false}" = "true" ] || [ "$PKG_METAPACKAGE" = "true" ]; then
			mkdir -p "$PKG_SRCDIR"
			return
		fi
		[ ! "$QUIET_BUILD" = true ] && echo "Downloading $PKG_NAME@$PKG_VERSION source from '$PKG_SRCURL' if necessary..."
		download_src_archive
		cd $PKG_TMPDIR
		extract_src_archive
	fi
}
