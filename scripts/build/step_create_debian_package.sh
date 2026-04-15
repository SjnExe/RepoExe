step_create_debian_package() {
	if [ "$PKG_METAPACKAGE" = "true" ]; then
		# Metapackage doesn't have data inside.
		rm -rf data
	fi
	tar --sort=name \
		--mtime="@${SOURCE_DATE_EPOCH}" \
		--owner=0 --group=0 --numeric-owner \
		-cJf "$PKG_PACKAGEDIR/data.tar.xz" -H gnu .

	# Get install size. This will be written as the "Installed-Size" deb field so is measured in 1024-byte blocks:
	local PKG_INSTALLSIZE
	PKG_INSTALLSIZE=$(du -sk . | cut -f 1)

	# From here on ARCH is set to "all" if PKG_PLATFORM_INDEPENDENT is set by the package
	[ "$PKG_PLATFORM_INDEPENDENT" = "true" ] && ARCH=all

	mkdir -p DEBIAN
	cat > DEBIAN/control <<-HERE
		Package: $PKG_NAME
		Architecture: ${ARCH}
		Installed-Size: ${PKG_INSTALLSIZE}
		Maintainer: $PKG_MAINTAINER
		Version: $PKG_FULLVERSION
		Homepage: $PKG_HOMEPAGE
	HERE
	if [ "$GLOBAL_LIBRARY" = "true" ] && [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		test ! -z "$PKG_DEPENDS" && PKG_DEPENDS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_DEPENDS")
		test ! -z "$PKG_BREAKS" && PKG_BREAKS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_BREAKS")
		test ! -z "$PKG_CONFLICTS" && PKG_CONFLICTS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_CONFLICTS")
		test ! -z "$PKG_RECOMMENDS" && PKG_RECOMMENDS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_RECOMMENDS")
		test ! -z "$PKG_REPLACES" && PKG_REPLACES=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_REPLACES")
		test ! -z "$PKG_PROVIDES" && PKG_PROVIDES=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_PROVIDES")
		test ! -z "$PKG_SUGGESTS" && PKG_SUGGESTS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_SUGGESTS")
	fi
	test ! -z "$PKG_BREAKS" && echo "Breaks: $PKG_BREAKS" >> DEBIAN/control
	test ! -z "$PKG_PRE_DEPENDS" && echo "Pre-Depends: $PKG_PRE_DEPENDS" >> DEBIAN/control
	test ! -z "$PKG_DEPENDS" && echo "Depends: $PKG_DEPENDS" >> DEBIAN/control
	[ "$PKG_ESSENTIAL" = "true" ] && echo "Essential: yes" >> DEBIAN/control
	test ! -z "$PKG_CONFLICTS" && echo "Conflicts: $PKG_CONFLICTS" >> DEBIAN/control
	test ! -z "$PKG_RECOMMENDS" && echo "Recommends: $PKG_RECOMMENDS" >> DEBIAN/control
	test ! -z "$PKG_REPLACES" && echo "Replaces: $PKG_REPLACES" >> DEBIAN/control
	test ! -z "$PKG_PROVIDES" && echo "Provides: $PKG_PROVIDES" >> DEBIAN/control
	test ! -z "$PKG_SUGGESTS" && echo "Suggests: $PKG_SUGGESTS" >> DEBIAN/control
	echo "Description: $PKG_DESCRIPTION" >> DEBIAN/control

	# Create DEBIAN/conffiles (see https://www.debian.org/doc/debian-policy/ap-pkg-conffiles.html):
	for f in $PKG_CONFFILES; do echo "$PREFIX_CLASSICAL/$f" >> DEBIAN/conffiles; done

	# Allow packages to create arbitrary control files.
	# XXX: Should be done in a better way without a function?
	cd DEBIAN
	step_create_debscripts
	# Process `update-alternatives` entries from `.alternatives` files
	# These need to be merged into the `.postinst` and `.prerm` files, so after those are created.
	step_update_alternatives
	step_create_python_debscripts

	# Create control.tar.xz
	tar --sort=name \
		--mtime="@${SOURCE_DATE_EPOCH}" \
		--owner=0 --group=0 --numeric-owner \
		-cJf "$PKG_PACKAGEDIR/control.tar.xz" -H gnu .

	test ! -f "$COMMON_CACHEDIR/debian-binary" && echo "2.0" > "$COMMON_CACHEDIR/debian-binary"
	PKG_DEBFILE=$OUTPUT_DIR/${PKG_NAME}${DEBUG}_${PKG_FULLVERSION}_${ARCH}.deb
	# Create the actual .deb file:
	${AR-ar} cr "$PKG_DEBFILE" \
		"$COMMON_CACHEDIR/debian-binary" \
		"$PKG_PACKAGEDIR/control.tar.xz" \
		"$PKG_PACKAGEDIR/data.tar.xz"
}
