# shellcheck shell=bash
# Default algorithm to use for packages hosted on gitlab instances.
gitlab_auto_update() {
	local latest_tag
	latest_tag="$(gitlab_api_get_tag)"

	if [[ -z "${latest_tag}" ]]; then
		error_exit "Unable to get tag from ${PKG_SRCURL}"
	fi
	pkg_upgrade_version "${latest_tag}"
}
