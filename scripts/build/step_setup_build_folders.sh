step_setup_build_folders() {
	# Following directories may contain files with read-only
	# permissions which makes them undeletable. We need to fix
	# that.
	[ -d "$PKG_BUILDDIR" ] && chmod +w -R "$PKG_BUILDDIR" || true
	[ -d "$PKG_MULTILIB_BUILDDIR" ] && chmod +w -R "$PKG_MULTILIB_BUILDDIR" || true
	[ -d "$PKG_SRCDIR" ] && chmod +w -R "$PKG_SRCDIR" || true
	if [ "$SKIP_DEPCHECK" = false ] && \
		   [ "$INSTALL_DEPS" = true ] && \
		   [ "$PKG_METAPACKAGE" = false ] && \
		   [ "$PKGS__BUILD__RM_ALL_PKGS_BUILT_MARKER_AND_INSTALL_FILES" = true ] && \
		   [ "$ON_DEVICE_BUILD" = false ]; then
		# Remove all previously extracted/built files from
		# $PREFIX:
		rm -fr "$PREFIX_CLASSICAL"
		rm -f "$BUILT_PACKAGES_DIRECTORY"/*
	fi

	# Cleanup old build state:
	rm -Rf "$PKG_BUILDDIR" \
		"$PKG_MULTILIB_BUILDDIR" \
		"$PKG_SRCDIR"

	# Cleanup old packaging state:
	rm -Rf "$PKG_PACKAGEDIR" \
		"$PKG_TMPDIR" \
		"$PKG_MASSAGEDIR"

	# Cleanup cache directory containing package sources and hostbuild dir
	if [ "$FORCE_BUILD" = true ] && \
			[ "$PKGS__BUILD__RM_ALL_PKG_BUILD_DEPENDENT_DIRS" = true ]; then
		rm -Rf "$PKG_CACHEDIR" "$PKG_HOSTBUILD_DIR"
	fi

	# Create required directories, but not `PKG_SRCDIR` as it
	# will be created during build. If `PKG_SRCDIR` were
	# to be created, then `PKG_SRCURL` like for `zip` would get
	# extracted to sub directories in `extract_src_archive()`.
	# If `PKG_BUILD_IN_SRC` is `true`, then `PKG_BUILDDIR`
	# will be equal to `PKG_SRCDIR`, so do not create it in
	# that case.
	if [ "$PKG_BUILDDIR" != "$PKG_SRCDIR" ]; then
		mkdir -p "$PKG_BUILDDIR"
	fi
	mkdir -p "$COMMON_CACHEDIR" \
		 "$COMMON_CACHEDIR-$ARCH" \
		 "$COMMON_CACHEDIR-all" \
		 "$OUTPUT_DIR" \
		 "$PKG_PACKAGEDIR" \
		 "$PKG_TMPDIR" \
		 "$PKG_CACHEDIR" \
		 "$PKG_MASSAGEDIR"
	if [ "$PKG_BUILD_MULTILIB" = "true" ] && [ "$PKG_BUILD_ONLY_MULTILIB" = "false" ]; then
		mkdir -p "$PKG_MULTILIB_BUILDDIR"
	fi
	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		mkdir -p $PREFIX/{bin,etc,lib,libexec,share,share/LICENSES,tmp,include}
	elif [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		mkdir -p "$PREFIX"/{bin,etc,lib,share,share/LICENSES,include}
		mkdir -p "$PREFIX_CLASSICAL"/{bin,etc,tmp}
	fi

	# Required for creating `BUILDING_IN_SRC.txt` file in step_start_build
	if [ "$PKG_BUILDDIR_ORIG" != "$PKG_BUILDDIR" ]; then
		rm -Rf "$PKG_BUILDDIR_ORIG"
		mkdir -p "$PKG_BUILDDIR_ORIG"
	fi
}
