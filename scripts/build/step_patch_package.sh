step_patch_package() {
	[ "$PKG_METAPACKAGE" = "true" ] && return

	cd "$PKG_SRCDIR"
	# Suffix patch with ".patch32" or ".patch64" to only apply for
	# these bitnesses
	local PATCHES=$(find $PKG_BUILDER_DIR -mindepth 1 -maxdepth 1 \
			     -name \*.patch -o -name \*.patch$ARCH_BITS | sort)
	local DEBUG_PATCHES=""
	if [ "$DEBUG_BUILD" = "true" ]; then
		DEBUG_PATCHES=$(find $PKG_BUILDER_DIR -mindepth 1 -maxdepth 1 -name \*.patch.debug | sort)
	fi
	local ON_DEVICE_PATCHES=""
	# .patch.ondevice patches should only be applied when building
	# on device
	if [ "$ON_DEVICE_BUILD" = "true" ]; then
		ON_DEVICE_PATCHES=$(find $PKG_BUILDER_DIR -mindepth 1 -maxdepth 1 -name \*.patch.ondevice | sort)
	fi
	shopt -s nullglob
	for patch in $PATCHES $DEBUG_PATCHES $ON_DEVICE_PATCHES; do
		echo "Applying patch: $(basename $patch)"
		test -f "$patch" && sed \
			-e "s%\@APP_PACKAGE\@%${APP_PACKAGE}%g" \
			-e "s%\@BASE_DIR\@%${BASE_DIR}%g" \
			-e "s%\@CACHE_DIR\@%${CACHE_DIR}%g" \
			-e "s%\@HOME\@%${ANDROID_HOME}%g" \
			-e "s%\@PREFIX\@%${PREFIX}%g" \
			-e "s%\@PREFIX_CLASSICAL\@%${PREFIX_CLASSICAL}%g" \
			-e "s%\@ENV__S_REPOEXE\@%${ENV__S_REPOEXE}%g" \
			-e "s%\@ENV__S_APP\@%${ENV__S_APP}%g" \
			-e "s%\@ENV__S_API_APP\@%${ENV__S_API_APP}%g" \
			-e "s%\@ENV__S_ROOTFS\@%${ENV__S_ROOTFS}%g" \
			-e "s%\@ENV__S_EXEC\@%${ENV__S_EXEC}%g" \
			"$patch" | patch --silent -p1
	done
	shopt -u nullglob
}
