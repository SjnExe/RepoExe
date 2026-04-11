# shellcheck shell=bash
repology_auto_update() {
	local latest_version
	latest_version="$(repology_api_get_latest_version "${PKG_NAME}")"
	# Repology api returns null if package is not tracked by repology or is already upto date.
	if [[ "${latest_version}" == "null" ]]; then
		echo "INFO: Already up to date." # Since we exclude unique to repoexe packages from auto-update,
		# this package should be tracked by repology and be already up to date.
		return 0
	fi
	pkg_upgrade_version "${latest_version}"
}
