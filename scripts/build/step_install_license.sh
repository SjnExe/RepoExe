# shellcheck shell=bash
step_install_license() {
	[[ "$PKG_METAPACKAGE" == 'true' ]] && return

	mkdir -p "$PREFIX/share/doc/$PKG_NAME"
	local LICENSE COUNTER=0

	# Was a license file specified?
	if [[ -n "${PKG_LICENSE_FILE}" ]]; then
		COUNTER=1
		local LICENSE_FILEPATH
		local -A INSTALLED_LICENSES=()
		while read -r LICENSE; do
			# Skip empty lines
			[[ -z "${LICENSE}" ]] && continue

			# Check that the license file exists in the source files
			[[ -f "$PKG_SRCDIR/$LICENSE" ]] || {
				error_exit "$PKG_SRCDIR/$LICENSE does not exist"
			}

			LICENSE_FILEPATH="$(basename "$LICENSE")"
			if [[ -n ${INSTALLED_LICENSES[${LICENSE_FILEPATH}]:-} ]]; then
				# We have already installed a license file named $(basename $LICENSE) so add a suffix to it
				TARGET="$PREFIX/share/doc/${PKG_NAME}/${LICENSE_FILEPATH}.$((COUNTER++))"
			else
				TARGET="$PREFIX/share/doc/${PKG_NAME}/${LICENSE_FILEPATH}"
				# shellcheck disable=SC2190 # this is a valid way to assign key value pairs
				INSTALLED_LICENSES+=("${LICENSE_FILEPATH}" 'already installed')
			fi
			cp -f "${PKG_SRCDIR}/${LICENSE}" "$TARGET"
		done <<< "${PKG_LICENSE_FILE//,/$'\n'}"
	else # If a license file wasn't specified, find the one we need
		local TO_LICENSE             # link target for generic licenses
		local FROM_SOURCES=0         # flag to check if we've included licenses from the source files yet
		local COMMON_LICENSE_FILES=( # search list for licenses with copyright information
		'COPYING' 'Copyright.txt'
		'copyright' 'Copyright' 'COPYRIGHT'
		'licence' 'Licence' 'LICENCE' # spelled with 'C'
		'license' 'License' 'LICENSE' # spelled with 'S'
		'license.txt' 'License.txt'
		'LICENSE.txt' 'LICENSE.TXT'
		'license.md' 'LICENSE.md'
		)
		# Parse the license(s)
		while read -r LICENSE; do
			# Skip empty lines
			[[ -z "${LICENSE}" ]] && continue

			case "$LICENSE" in
				# These licenses contain copyright information,
				# so we cannot use a generic license file
				'BSD'|'BSD 2-Clause'|'BSD 3-Clause'|'BSD Simplified'\
				|'curl'|'HPND'|'ISC'|'Libpng'|'MIT'|'OFL-1.1'\
				|'PythonPL'|'X11'|'ZLIB')
					# We only want to include the license files from the source files once
					if (( ! FROM_SOURCES )); then
						local FILE
						local EXTRA_LICENSE_FILES=("LICENCE-${LICENSE// /-}" "LICENSE-${LICENSE// /-}")
						# Find the license file(s) in the source files
						for FILE in "${COMMON_LICENSE_FILES[@]}" "${EXTRA_LICENSE_FILES[@]}"; do
							[[ -f "$PKG_SRCDIR/$FILE" ]] && {
								if (( COUNTER )); then
									cp -f "${PKG_SRCDIR}/$FILE" "${PREFIX}/share/doc/${PKG_NAME}/copyright.${COUNTER}"
								else
									cp -f "${PKG_SRCDIR}/$FILE" "${PREFIX}/share/doc/${PKG_NAME}/copyright"
								fi
								(( ++COUNTER, ++FROM_SOURCES ))
							}
						done
						# If we have not found any licenses after searching, that's an error.
						if (( ! FROM_SOURCES )); then
							error_exit "${PKG_NAME}: Could not find a license file for $LICENSE in the package sources"
						fi
					fi
				;;
				*) # For the rest we can use a link to the generic license file
					[[ -f "$SCRIPTDIR/packages/repoexe-licenses/LICENSES/${LICENSE}.txt" ]] || {
						# If we get here, no license file could be found
						error_exit "${PKG_NAME}: Could not find a license file for $LICENSE in packages/repoexe-licenses"
					}
					# the link target depends on the libc being used
					case "$PACKAGE_LIBRARY" in
						'bionic') TO_LICENSE="../../LICENSES/${LICENSE}.txt";;
						'glibc')  TO_LICENSE="../../../../share/LICENSES/${LICENSE}.txt";;
						*)        error_exit "'$PACKAGE_LIBRARY' is not a supported libc";;
					esac
					if (( COUNTER )); then
						ln -sf "$TO_LICENSE" "$PREFIX/share/doc/$PKG_NAME/copyright.${COUNTER}"
					else
						ln -sf "$TO_LICENSE" "$PREFIX/share/doc/$PKG_NAME/copyright"
					fi
					(( ++COUNTER ))
				;;
			esac
		done <<< "${PKG_LICENSE//,/$'\n'}"
		local license_files
		license_files="$(find -L "$PREFIX/share/doc/$PKG_NAME" -maxdepth 1 \( -type f -o -type l \) -name "copyright*")"
		[[ -n "$license_files" ]] || {
			error_exit "No LICENSE file was installed for $PKG_NAME"
		}
	fi
return 0
}
