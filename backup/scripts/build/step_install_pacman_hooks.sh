step_install_pacman_hooks() {
	[[ "$PACKAGE_FORMAT" != "pacman" ]] && return

	local sed="sed -e s|@PREFIX@|${PREFIX}|g -e s|@PREFIX_TARGET@|${PREFIX:1}|g -e s|@ARCH@|${ARCH}|g"

	# Installing hooks
	local hooks
	hooks=$(find $PKG_BUILDER_DIR -mindepth 1 -maxdepth 1 -name "*.alpm.hook")
	if [[ -n "${hooks}" ]]; then
		mkdir -p ${PREFIX}/share/libalpm/hooks
		local hook
		for hook in ${hooks}; do
			${sed} "${hook}" > "${PREFIX}/share/libalpm/hooks/$(sed 's|.alpm.hook$|.hook|' <<< "${hook##*/}")"
		done
	fi

	# Installing scripts
	local scripts
	scripts=$(find $PKG_BUILDER_DIR -mindepth 1 -maxdepth 1 -name "*.alpm.script")
	if [[ -n "${scripts}" ]]; then
		mkdir -p ${PREFIX}/share/libalpm/scripts
		local script script_alpm
		for script in ${scripts}; do
			script_alpm="${PREFIX}/share/libalpm/scripts/$(sed 's|.alpm.script$||' <<< "${script##*/}")"
			${sed} "${script}" > "${script_alpm}"
			chmod +x "${script_alpm}"
		done
	fi
}
