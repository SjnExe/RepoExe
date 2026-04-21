step_copy_into_massagedir() {
	local DEST="$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
	mkdir -p "$DEST"
	# Copy files changed during the build into massagedir in order to massage them
	tar -C "$PREFIX_CLASSICAL" -N "$BUILD_TS_FILE" --exclude='tmp' --exclude='__pycache__' -cf - . | \
		tar -C "$DEST" -xf -
}
