step_create_pacman_package() {
	if [ "$PKG_METAPACKAGE" = "true" ]; then
		# Metapackage doesn't have data inside.
		rm -rf data
	fi

	local PKG_INSTALLSIZE
	PKG_INSTALLSIZE=$(du -bs . | cut -f 1)

	# From here on ARCH is set to "all" if PKG_PLATFORM_INDEPENDENT is set by the package
	[ "$PKG_PLATFORM_INDEPENDENT" = "true" ] && ARCH=any

	# Configuring the selection of a copress for a batch.
	local COMPRESS
	local PKG_FORMAT
	case $PACMAN_PACKAGE_COMPRESSION in
		"gzip")
			COMPRESS=(gzip -c -f -n)
			PKG_FORMAT="gz";;
		"bzip2")
			COMPRESS=(bzip2 -c -f)
			PKG_FORMAT="bz2";;
		"zstd")
			COMPRESS=(zstd -c -z -q -)
			PKG_FORMAT="zst";;
		"lrzip")
			COMPRESS=(lrzip -q)
			PKG_FORMAT="lrz";;
		"lzop")
			COMPRESS=(lzop -q)
			PKG_FORMAT="lzop";;
		"lz4")
			COMPRESS=(lz4 -q)
			PKG_FORMAT="lz4";;
		"lzip")
			COMPRESS=(lzip -c -f)
			PKG_FORMAT="lz";;
		"xz" | *)
			COMPRESS=(xz -c -z -)
			PKG_FORMAT="xz";;
	esac

	local PACMAN_FILE=$OUTPUT_DIR/${PKG_NAME}${DEBUG}-${PKG_FULLVERSION_FOR_PACMAN}-${ARCH}.pkg.tar.${PKG_FORMAT}

	if [ "$GLOBAL_LIBRARY" = "true" ] && [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		test ! -z "$PKG_DEPENDS" && PKG_DEPENDS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_DEPENDS")
		test ! -z "$PKG_BREAKS" && PKG_BREAKS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_BREAKS")
		test ! -z "$PKG_CONFLICTS" && PKG_CONFLICTS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_CONFLICTS")
		test ! -z "$PKG_RECOMMENDS" && PKG_RECOMMENDS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_RECOMMENDS")
		test ! -z "$PKG_REPLACES" && PKG_REPLACES=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_REPLACES")
		test ! -z "$PKG_PROVIDES" && PKG_PROVIDES=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_PROVIDES")
		test ! -z "$PKG_SUGGESTS" && PKG_SUGGESTS=$(repoexe_package__add_prefix_glibc_to_package_list "$PKG_SUGGESTS")
	fi

	# Package metadata.
	{
		echo "pkgname = $PKG_NAME"
		echo "pkgbase = $PKG_NAME"
		echo "pkgver = $PKG_FULLVERSION_FOR_PACMAN"
		echo "pkgdesc = $(echo "$PKG_DESCRIPTION" | tr '\n' ' ')"
		echo "url = $PKG_HOMEPAGE"
		echo "builddate = $SOURCE_DATE_EPOCH"
		echo "packager = $PKG_MAINTAINER"
		echo "size = $PKG_INSTALLSIZE"
		echo "arch = $ARCH"

		if [ -n "$PKG_LICENSE" ]; then
			tr ',' '\n' <<< "$PKG_LICENSE" | awk '{ printf "license = %s\n", $0 }'
		fi

		if [ -n "$PKG_REPLACES" ]; then
			tr ',' '\n' <<< "$PKG_REPLACES" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "replaces = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
		fi

		if [ -n "$PKG_CONFLICTS" ]; then
			tr ',' '\n' <<< "$PKG_CONFLICTS" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "conflict = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
		fi

		if [ -n "$PKG_BREAKS" ]; then
			tr ',' '\n' <<< "$PKG_BREAKS" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "conflict = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
		fi

		if [ -n "$PKG_PROVIDES" ]; then
			tr ',' '\n' <<< "$PKG_PROVIDES" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "provides = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
		fi

		if [ -n "$PKG_DEPENDS" ]; then
			tr ',' '\n' <<< "$PKG_DEPENDS" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "depend = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }' | sed 's/|.*//'
		fi

		if [ -n "$PKG_RECOMMENDS" ]; then
			tr ',' '\n' <<< "$PKG_RECOMMENDS" | awk '{ printf "optdepend = %s\n", $1 }'
		fi

		if [ -n "$PKG_SUGGESTS" ]; then
			tr ',' '\n' <<< "$PKG_SUGGESTS" | awk '{ printf "optdepend = %s\n", $1 }'
		fi

		if [ -n "$PKG_BUILD_DEPENDS" ]; then
			tr ',' '\n' <<< "$PKG_BUILD_DEPENDS" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "makedepend = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
		fi

		if [ -n "$PKG_CONFFILES" ]; then
			tr ',' '\n' <<< "$PKG_CONFFILES" | awk '{ printf "backup = '"${PREFIX_CLASSICAL:1}"'/%s\n", $1 }'
		fi

		if [ -n "$PKG_GROUPS" ]; then
			tr ',' '\n' <<< "${PKG_GROUPS/#, /}" | awk '{ printf "group = %s\n", $1 }'
		fi
	} > .PKGINFO

	# Build metadata.
	{
		echo "format = 2"
		echo "pkgname = $PKG_NAME"
		echo "pkgbase = $PKG_NAME"
		echo "pkgver = $PKG_FULLVERSION_FOR_PACMAN"
		echo "pkgarch = $ARCH"
		echo "packager = $PKG_MAINTAINER"
		echo "builddate = $SOURCE_DATE_EPOCH"
	} > .BUILDINFO

	# Write installation hooks.
	step_create_debscripts
	# Process `update-alternatives` entries from `.alternatives` files
	# These need to be merged into the `.postinst` and `.prerm` files, so after those are created.
	step_update_alternatives
	step_create_python_debscripts
	step_create_pacman_install_hook

	# ensure all elements of the package have the same mtime
	find . -exec touch -h -d @$SOURCE_DATE_EPOCH {} +

	# Create package
	shopt -s dotglob globstar
	printf '%s\0' **/* | bsdtar -cnf - --format=mtree \
		--options='!all,use-set,type,uid,gid,mode,time,size,md5,sha256,link' \
		--null --files-from - --exclude .MTREE | \
		gzip -c -f -n > .MTREE
	touch -d @$SOURCE_DATE_EPOCH .MTREE
	printf '%s\0' **/* | bsdtar --no-fflags -cnf - --null --files-from - | \
		$COMPRESS > "$PACMAN_FILE"
	shopt -u dotglob globstar
}
