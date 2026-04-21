step_handle_buildarch() {
	[ "$ON_DEVICE_BUILD" = "true" ] && return

	# If $PREFIX already exists, it may have been built for a different arch
	local ARCH_FILE=/data/ARCH
	if [ -f "${ARCH_FILE}" ]; then
		local PREVIOUS_ARCH
		PREVIOUS_ARCH=$(cat $ARCH_FILE)
		if [ "$PREVIOUS_ARCH" != "$ARCH" ]; then
			local DATA_BACKUPDIRS=$TOPDIR/_databackups
			mkdir -p "$DATA_BACKUPDIRS"
			local DATA_PREVIOUS_BACKUPDIR=$DATA_BACKUPDIRS/$PREVIOUS_ARCH
			local DATA_CURRENT_BACKUPDIR=$DATA_BACKUPDIRS/$ARCH
			# Save current /data (removing old backup if any)
			if test -e "$DATA_PREVIOUS_BACKUPDIR"; then
				error_exit "Directory already exists"
			fi
			if [ -d /data/data ]; then
				mv /data/data "$DATA_PREVIOUS_BACKUPDIR"
			fi
			# Restore new one (if any)
			if [ -d "$DATA_CURRENT_BACKUPDIR" ]; then
				mv "$DATA_CURRENT_BACKUPDIR" /data/data
			fi
		fi
	fi

	# Keep track of current arch we are building for.
	echo "$ARCH" > $ARCH_FILE
}
