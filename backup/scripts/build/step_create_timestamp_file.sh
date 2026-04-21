step_create_timestamp_file() {
	# Keep track of when build started so we can see what files
	# have been created.  We start by sleeping/touching so that any
	# generated files ($PREFIX/bin/llvm-config from
	# step_override_config_scripts()) get an older timestamp
	# than the BUILD_TS_FILE.
	sleep 0.1
	BUILD_TS_FILE=$PKG_TMPDIR/timestamp_$PKG_NAME
	touch "$BUILD_TS_FILE"
}
