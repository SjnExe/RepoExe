create_pacman_subpackages() {
	# Sub packages:
	local _ADD_PREFIX=""
	if [[ "$PACKAGE_LIBRARY" == 'glibc' ]]; then
		_ADD_PREFIX="glibc/"
	fi
	if [[ "$PKG_NO_STATICSPLIT" == 'false' && -n "$(shopt -s globstar; shopt -s nullglob; echo ${_ADD_PREFIX}lib{,32}/**/*.a)" ]]; then
		# Add virtual -static sub package if there are include files:
		local _STATIC_SUBPACKAGE_FILE=$PKG_TMPDIR/${PKG_NAME}-static.subpackage.sh
		echo SUBPKG_INCLUDE=\"$(find ${_ADD_PREFIX}lib{,32} -name '*.a' -o -name '*.la' 2> /dev/null) $PKG_STATICSPLIT_EXTRA_PATTERNS\" > "$_STATIC_SUBPACKAGE_FILE"
		echo "SUBPKG_DESCRIPTION=\"Static libraries for ${PKG_NAME}\"" >> "$_STATIC_SUBPACKAGE_FILE"
	fi

	# Now build all sub packages
	rm -Rf "$TOPDIR/$PKG_NAME/subpackages"
	for subpackage in $PKG_BUILDER_DIR/*.subpackage.sh $PKG_TMPDIR/*subpackage.sh; do
		[[ -f "$subpackage" ]] || continue
		local SUB_PKG_NAME
		SUB_PKG_NAME=$(basename "$subpackage" .subpackage.sh)
		if [[ "$PACKAGE_LIBRARY" == 'glibc' ]] && ! repoexe_package__is_package_name_have_glibc_prefix "$SUB_PKG_NAME"; then
			SUB_PKG_NAME="$(repoexe_package__add_prefix_glibc_to_package_name ${SUB_PKG_NAME})"
		fi
		# Default value is same as main package, but sub package may override:
		local SUBPKG_PLATFORM_INDEPENDENT=$PKG_PLATFORM_INDEPENDENT
		local SUB_PKG_DIR=$TOPDIR/$PKG_NAME/subpackages/$SUB_PKG_NAME
		local SUBPKG_ESSENTIAL=false
		local SUBPKG_BREAKS=""
		local SUBPKG_DEPENDS=""
		local SUBPKG_RECOMMENDS=""
		local SUBPKG_SUGGESTS=""
		local SUBPKG_CONFLICTS=""
		local SUBPKG_REPLACES=""
		local SUBPKG_PROVIDES=""
		local SUBPKG_CONFFILES=""
		local SUBPKG_DEPEND_ON_PARENT=""
		local SUBPKG_EXCLUDED_ARCHES=""
		local SUBPKG_GROUPS=""
		local SUBPKG_PYTHON_RUNTIME_DEPS=""
		local SUB_PKG_MASSAGE_DIR=$SUB_PKG_DIR/massage/$PREFIX_CLASSICAL
		local SUB_PKG_PACKAGE_DIR=$SUB_PKG_DIR/package
		mkdir -p "$SUB_PKG_MASSAGE_DIR" "$SUB_PKG_PACKAGE_DIR"

		# Override step_create_subpkg_debscripts
		# shellcheck source=/dev/null
		source "$SCRIPTDIR/scripts/build/step_create_subpkg_debscripts.sh"

		# shellcheck source=/dev/null
		source "$subpackage"

		# Do not create subpackage for specific arches.
		# Using ARCH instead of SUB_PKG_ARCH (defined below) is intentional.
		if [[ " ${SUBPKG_EXCLUDED_ARCHES//,/ } " == *" ${ARCH} "* ]]; then
			echo "Skipping creating subpackage '$SUB_PKG_NAME' for arch $ARCH"
			continue
		fi

		# Allow globstar (i.e. './**/') patterns.
		shopt -s globstar
		for includeset in $SUBPKG_INCLUDE; do
			local _INCLUDE_DIRSET
			_INCLUDE_DIRSET=$(dirname "$includeset")
			[[ "$_INCLUDE_DIRSET" == "." ]] && _INCLUDE_DIRSET=""

			if [[ -e "$includeset" || -L "$includeset" ]]; then
				# Add the -L clause to handle relative symbolic links:
				mkdir -p "$SUB_PKG_MASSAGE_DIR/$_INCLUDE_DIRSET"
				mv "$includeset" "$SUB_PKG_MASSAGE_DIR/$_INCLUDE_DIRSET"
			fi
		done
		shopt -u globstar

		local SUB_PKG_ARCH=$ARCH
		[[ "$SUBPKG_PLATFORM_INDEPENDENT" == "true" ]] && SUB_PKG_ARCH=any

		cd "$SUB_PKG_DIR/massage"
		# Check that files were actually installed, else don't subpackage.
		if [[ "$SUB_PKG_ARCH" == "any" && "$(find . -type f -print | head -n1)" == "" ]]; then
			echo "No files in subpackage '$SUB_PKG_NAME' when built for $SUB_PKG_ARCH with package '$PKG_NAME', so"
			echo "the subpackage was not created. If unexpected, check to make sure the files are where you expect."
			cd "$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
			continue
		fi
		local SUB_PKG_INSTALLSIZE
		SUB_PKG_INSTALLSIZE=$(du -bs . | cut -f 1)

		# If the subpackage is not in the $PKG_DEPENDS for the parent package,
		# and SUBPKG_DEPEND_ON_PARENT doesn't have a value, the subpackage should depend on its parent
		[[ " ${PKG_DEPENDS//,/ } " != *" $SUB_PKG_NAME "* ]] && : "${SUBPKG_DEPEND_ON_PARENT:=true}"

		case "$SUBPKG_DEPEND_ON_PARENT" in
			'unversioned') SUBPKG_DEPENDS+=", $PKG_NAME";;
			'deps')        SUBPKG_DEPENDS+=", $PKG_DEPENDS";;
			# TODO: pacman does support versioned dependencies
			# but we are not currently translating the .DEB notation to pacman's
			'true')        SUBPKG_DEPENDS+=", $PKG_NAME";;
			*) ;;
		esac

		[[ "$GLOBAL_LIBRARY" == 'true' && "$PACKAGE_LIBRARY" == 'glibc' ]] && {
			[[ -n "$SUBPKG_DEPENDS"    ]] && SUBPKG_DEPENDS=$(repoexe_package__add_prefix_glibc_to_package_list "$SUBPKG_DEPENDS")
			[[ -n "$SUBPKG_BREAKS"     ]] && SUBPKG_BREAKS=$(repoexe_package__add_prefix_glibc_to_package_list "$SUBPKG_BREAKS")
			[[ -n "$SUBPKG_CONFLICTS"  ]] && SUBPKG_CONFLICTS=$(repoexe_package__add_prefix_glibc_to_package_list "$SUBPKG_CONFLICTS")
			[[ -n "$SUBPKG_RECOMMENDS" ]] && SUBPKG_RECOMMENDS=$(repoexe_package__add_prefix_glibc_to_package_list "$SUBPKG_RECOMMENDS")
			[[ -n "$SUBPKG_REPLACES"   ]] && SUBPKG_REPLACES=$(repoexe_package__add_prefix_glibc_to_package_list "$SUBPKG_REPLACES")
			[[ -n "$SUBPKG_PROVIDES"   ]] && SUBPKG_PROVIDES=$(repoexe_package__add_prefix_glibc_to_package_list "$SUBPKG_PROVIDES")
			[[ -n "$SUBPKG_SUGGESTS"   ]] && SUBPKG_SUGGESTS=$(repoexe_package__add_prefix_glibc_to_package_list "$SUBPKG_SUGGESTS")
		}

		# Package metadata.
		{
			echo "pkgname = $SUB_PKG_NAME"
			echo "pkgbase = $PKG_NAME"
			echo "pkgver = $PKG_FULLVERSION_FOR_PACMAN"
			echo "pkgdesc = $(echo "$SUBPKG_DESCRIPTION" | tr '\n' ' ')"
			echo "url = $PKG_HOMEPAGE"
			echo "builddate = $SOURCE_DATE_EPOCH"
			echo "packager = $PKG_MAINTAINER"
			echo "size = $SUB_PKG_INSTALLSIZE"
			echo "arch = $SUB_PKG_ARCH"

			if [[ -n "$SUBPKG_REPLACES" ]]; then
				tr ',' '\n' <<< "$SUBPKG_REPLACES" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "replaces = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
			fi

			if [[ -n "$SUBPKG_CONFLICTS" ]]; then
				tr ',' '\n' <<< "$SUBPKG_CONFLICTS" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "conflict = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
			fi

			if [[ -n "$SUBPKG_BREAKS" ]]; then
				tr ',' '\n' <<< "$SUBPKG_BREAKS" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "conflict = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
			fi

			if [[ -n "$SUBPKG_PROVIDES" ]]; then
				tr ',' '\n' <<< "$SUBPKG_PROVIDES" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "provides = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }'
			fi

			if [[ -n "$SUBPKG_DEPENDS" ]]; then
				tr ',' '\n' <<< "${SUBPKG_DEPENDS/#, /}" | sed 's|(||g; s|)||g; s| ||g; s|>>|>|g; s|<<|<|g' | awk '{ printf "depend = " $1; if ( ($1 ~ /</ || $1 ~ />/ || $1 ~ /=/) && $1 !~ /-/ ) printf "-0"; printf "\n" }' | sed 's/|.*//'
			fi

			if [[ -n "$SUBPKG_RECOMMENDS" ]]; then
				tr ',' '\n' <<< "$SUBPKG_RECOMMENDS" | awk '{ printf "optdepend = %s\n", $1 }'
			fi

			if [[ -n "$SUBPKG_SUGGESTS" ]]; then
				tr ',' '\n' <<< "$SUBPKG_SUGGESTS" | awk '{ printf "optdepend = %s\n", $1 }'
			fi

			if [[ -n "$SUBPKG_CONFFILES" ]]; then
				tr ',' '\n' <<< "$SUBPKG_CONFFILES" | awk '{ printf "backup = '"${PREFIX_CLASSICAL:1}"'/%s\n", $1 }'
			fi

			if [[ -n "$SUBPKG_GROUPS" ]]; then
				tr ',' '\n' <<< "${SUBPKG_GROUPS/#, /}" | awk '{ printf "group = %s\n", $1 }'
			fi
		} > .PKGINFO

		# Build metadata.
		{
			echo "format = 2"
			echo "pkgname = $SUB_PKG_NAME"
			echo "pkgbase = $PKG_NAME"
			echo "pkgver = $PKG_FULLVERSION_FOR_PACMAN"
			echo "pkgarch = $SUB_PKG_ARCH"
			echo "packager = $PKG_MAINTAINER"
			echo "builddate = $SOURCE_DATE_EPOCH"
		} > .BUILDINFO

		# Write package installation hooks.
		step_create_subpkg_debscripts
		step_create_python_debscripts
		step_create_pacman_install_hook

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

		# ensure all elements of the package have the same mtime
		find . -exec touch -h -d @$SOURCE_DATE_EPOCH {} +

		# Create the actual .pkg file:
		local SUBPKG_PACMAN_FILE=$OUTPUT_DIR/${SUB_PKG_NAME}${DEBUG}-${PKG_FULLVERSION_FOR_PACMAN}-${SUB_PKG_ARCH}.pkg.tar.${PKG_FORMAT}
		shopt -s dotglob globstar
		printf '%s\0' **/* | bsdtar -cnf - --format=mtree \
			--options='!all,use-set,type,uid,gid,mode,time,size,md5,sha256,link' \
			--null --files-from - --exclude .MTREE | \
			gzip -c -f -n > .MTREE
		touch -d @$SOURCE_DATE_EPOCH .MTREE
		printf '%s\0' **/* | bsdtar --no-fflags -cnf - --null --files-from - | \
			$COMPRESS > "$SUBPKG_PACMAN_FILE"
		shopt -u dotglob globstar

		# Go back to main package:
		cd "$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
	done
}
