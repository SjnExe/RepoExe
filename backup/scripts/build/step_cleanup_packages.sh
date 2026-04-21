step_cleanup_packages() {
	[[ "${CLEANUP_BUILT_PACKAGES_ON_LOW_DISK_SPACE:=false}" == "true" ]] || return 0
	[[ -d "$TOPDIR" ]] || return 0

	local AVAILABLE PACKAGES_DIRECTORIES PKGS PKG_REGEX

	# Extract available disk space in bytes
	AVAILABLE="$(df "$TOPDIR" | awk 'NR==2 {print $4 * 1024}')"

	# No need to cleanup if there is enough disk space
	(( AVAILABLE <= CLEANUP_BUILT_PACKAGES_THRESHOLD )) || return 0

	PACKAGES_DIRECTORIES="$(jq --raw-output 'del(.pkg_format) | keys | .[]' "${SCRIPTDIR}"/scripts/repo.json | while read -r d; do [[ -d "${SCRIPTDIR}/$d" ]] && echo "$d" || true; done)"

	# Build package name regex to be used with `find`, avoiding loops.
	PKGS="$(find ${PACKAGES_DIRECTORIES} -mindepth 1 -maxdepth 1 -type d -printf '%f\n')"
	[[ -z "$PKGS" ]] && return 0

	# Exclude current package from the list.
	PKGS="$(printf "%s" "$PKGS" | grep -Fxv "$PKG_NAME")"
	[[ -z "$PKGS" ]] && return 0

	PKG_REGEX="$(printf "%s" "$PKGS" | sed -zE 's/[][\.|$(){}?+*^]/\\&/g' | sed -E 's/(.*)/(\1)/g' | sed -zE -e 's/[\n]+/|/g' -e 's/(.*)/(\1)/g')"

	echo "INFO: cleaning up some disk space for building \"${PKG_NAME}\"."

	(cd "$TOPDIR" && find . -mindepth 1 -maxdepth 1 -type d -regextype posix-extended -regex "^\./$PKG_REGEX$" -exec rm -rf "{}" +)
}
