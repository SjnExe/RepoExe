create_debian_subpackages() {
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
		if [[ "$PACKAGE_LIBRARY" == 'glibc' ]] && ! package__is_package_name_have_glibc_prefix "$SUB_PKG_NAME"; then
			SUB_PKG_NAME="$(package__add_prefix_glibc_to_package_name ${SUB_PKG_NAME})"
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
		# Allow negation patterns.
		shopt -s extglob
		for includeset in $SUBPKG_INCLUDE; do
			local _INCLUDE_DIRSET
			_INCLUDE_DIRSET=$(dirname "$includeset")
			[[ "$_INCLUDE_DIRSET" == "." ]] && _INCLUDE_DIRSET=""

			if [[ -e "$includeset" || -L "$includeset" ]]; then
				# Add the -L clause to handle relative symbolic links:
				mkdir -p "$SUB_PKG_MASSAGE_DIR/$_INCLUDE_DIRSET"
				mv "$includeset" "$SUB_PKG_MASSAGE_DIR/$_INCLUDE_DIRSET"
			else
				echo "WARNING: tried to add $includeset to subpackage '$SUB_PKG_NAME', but could not find it"
			fi
		done
		shopt -u globstar extglob

		local SUB_PKG_ARCH=$ARCH
		[[ "$SUBPKG_PLATFORM_INDEPENDENT" == "true" ]] && SUB_PKG_ARCH=all

		cd "$SUB_PKG_DIR/massage"
		# Check that files were actually installed, else don't subpackage.
		if [[ "$SUB_PKG_ARCH" == "all" && "$(find . -type f -print | head -n1)" == "" ]]; then
			echo "No files in subpackage '$SUB_PKG_NAME' when built for $SUB_PKG_ARCH with package '$PKG_NAME', so"
			echo "the subpackage was not created. If unexpected, check to make sure the files are where you expect."
			cd "$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
			continue
		fi
		local SUB_PKG_INSTALLSIZE
		SUB_PKG_INSTALLSIZE=$(du -sk . | cut -f 1)
		tar --sort=name \
			--mtime="@${SOURCE_DATE_EPOCH}" \
			--owner=0 --group=0 --numeric-owner \
			-cJf "$SUB_PKG_PACKAGE_DIR/data.tar.xz" .

		mkdir -p DEBIAN
		cd DEBIAN

		cat > control <<-HERE
			Package: $SUB_PKG_NAME
			Architecture: ${SUB_PKG_ARCH}
			Installed-Size: ${SUB_PKG_INSTALLSIZE}
			Maintainer: $PKG_MAINTAINER
			Version: $PKG_FULLVERSION
			Homepage: $PKG_HOMEPAGE
		HERE

		# If the subpackage is not in the $PKG_DEPENDS for the parent package,
		# and SUBPKG_DEPEND_ON_PARENT doesn't have a value, the subpackage should depend on its parent
		[[ " ${PKG_DEPENDS//,/ } " != *" $SUB_PKG_NAME "* ]] && : "${SUBPKG_DEPEND_ON_PARENT:=true}"

		case "$SUBPKG_DEPEND_ON_PARENT" in
			'unversioned') SUBPKG_DEPENDS+=", $PKG_NAME";;
			'deps')        SUBPKG_DEPENDS+=", $PKG_DEPENDS";;
			'true')        SUBPKG_DEPENDS+=", $PKG_NAME (= $PKG_FULLVERSION)";;
			*) ;;
		esac

		[[ "$GLOBAL_LIBRARY" == 'true' && "$PACKAGE_LIBRARY" == 'glibc' ]] && {
			[[ -n "$SUBPKG_DEPENDS"    ]] && SUBPKG_DEPENDS=$(package__add_prefix_glibc_to_package_list "$SUBPKG_DEPENDS")
			[[ -n "$SUBPKG_BREAKS"     ]] && SUBPKG_BREAKS=$(package__add_prefix_glibc_to_package_list "$SUBPKG_BREAKS")
			[[ -n "$SUBPKG_CONFLICTS"  ]] && SUBPKG_CONFLICTS=$(package__add_prefix_glibc_to_package_list "$SUBPKG_CONFLICTS")
			[[ -n "$SUBPKG_RECOMMENDS" ]] && SUBPKG_RECOMMENDS=$(package__add_prefix_glibc_to_package_list "$SUBPKG_RECOMMENDS")
			[[ -n "$SUBPKG_REPLACES"   ]] && SUBPKG_REPLACES=$(package__add_prefix_glibc_to_package_list "$SUBPKG_REPLACES")
			[[ -n "$SUBPKG_PROVIDES"   ]] && SUBPKG_PROVIDES=$(package__add_prefix_glibc_to_package_list "$SUBPKG_PROVIDES")
			[[ -n "$SUBPKG_SUGGESTS"   ]] && SUBPKG_SUGGESTS=$(package__add_prefix_glibc_to_package_list "$SUBPKG_SUGGESTS")
		}

		{ # add control fields to subpackage
		[[ "$SUBPKG_ESSENTIAL" == "true" ]] && echo "Essential: yes"
		[[ -n "$SUBPKG_DEPENDS"          ]] && echo "Depends: ${SUBPKG_DEPENDS/#, /}"
		[[ -n "$SUBPKG_BREAKS"           ]] && echo "Breaks: $SUBPKG_BREAKS"
		[[ -n "$SUBPKG_CONFLICTS"        ]] && echo "Conflicts: $SUBPKG_CONFLICTS"
		[[ -n "$SUBPKG_RECOMMENDS"       ]] && echo "Recommends: $SUBPKG_RECOMMENDS"
		[[ -n "$SUBPKG_REPLACES"         ]] && echo "Replaces: $SUBPKG_REPLACES"
		[[ -n "$SUBPKG_PROVIDES"         ]] && echo "Provides: $SUBPKG_PROVIDES"
		[[ -n "$SUBPKG_SUGGESTS"         ]] && echo "Suggests: $SUBPKG_SUGGESTS"
		echo "Description: $SUBPKG_DESCRIPTION"
		} >> control

		for f in $SUBPKG_CONFFILES; do echo "$PREFIX_CLASSICAL/$f" >> conffiles; done

		# Allow packages to create arbitrary control files.
		step_create_subpkg_debscripts
		step_create_python_debscripts

		# Create control.tar.xz
		tar --sort=name \
			--mtime="@${SOURCE_DATE_EPOCH}" \
			--owner=0 --group=0 --numeric-owner \
			-cJf "$SUB_PKG_PACKAGE_DIR/control.tar.xz" -H gnu .

		# Create the actual .deb file:
		SUBPKG_DEBFILE=$OUTPUT_DIR/${SUB_PKG_NAME}${DEBUG}_${PKG_FULLVERSION}_${SUB_PKG_ARCH}.deb
		[[ -f "$COMMON_CACHEDIR/debian-binary" ]] || echo "2.0" > "$COMMON_CACHEDIR/debian-binary"
		${AR-ar} cr "$SUBPKG_DEBFILE" \
				   "$COMMON_CACHEDIR/debian-binary" \
				   "$SUB_PKG_PACKAGE_DIR/control.tar.xz" \
				   "$SUB_PKG_PACKAGE_DIR/data.tar.xz"

		# Go back to main package:
		cd "$PKG_MASSAGEDIR/$PREFIX_CLASSICAL"
	done
}
