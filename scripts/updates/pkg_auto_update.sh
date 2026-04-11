# shellcheck shell=bash
pkg_auto_update() {
	if [[ -n "${__CACHED_TAG:-}" ]]; then
		pkg_upgrade_version "${__CACHED_TAG}"
		return $?
	fi

	# Example:
	# https://github.com/vim/vim/archive/refs/tags/v${PKG_VERSION}.tar.gz
	#            _="https:"
	#            _=""
	# project_host="github.com"
	#            _="vim/vim/archive/refs/tags/v${PKG_VERSION}.tar.gz"
	local project_host
	IFS='/' read -r _ _ project_host _ <<< "${PKG_SRCURL}"

	# gitlab.gnome.org started responding to API requests originating from
	# GitHub Actions with HTTP 403 errors in January 2026.
	# Example command failing in GitHub Actions:
	# curl https://gitlab.gnome.org/api/v4/projects/GNOME%2Fvte/releases/permalink/latest
	# See: https://github.com/repoexe/repoexe-packages/issues/28242
	if [[ -z "${PKG_UPDATE_METHOD}" ]]; then
		if [[ "${project_host}" == "github.com" ]]; then
			PKG_UPDATE_METHOD="github"
		elif [[ "$PKG_SRCURL" == *"/-/archive/"* && "$PKG_SRCURL" != *"gitlab.gnome.org"* ]]; then
			PKG_UPDATE_METHOD="gitlab"
		else
			PKG_UPDATE_METHOD="repology"
		fi
	fi

	case "${PKG_UPDATE_METHOD}" in
		github)
			if [[ "${project_host}" != "${PKG_UPDATE_METHOD}.com" ]]; then
				error_exit <<-EndOfError
					source url's hostname is not ${PKG_UPDATE_METHOD}.com, but has been
					configured to use ${PKG_UPDATE_METHOD}'s method.
				EndOfError
			fi
			github_auto_update
		;;
		gitlab)
			gitlab_auto_update
		;;
		repology)
			repology_auto_update
		;;
		*)
			error_exit <<-EndOfError
				wrong value '${PKG_UPDATE_METHOD}' for PKG_UPDATE_METHOD.
				Can be 'github', 'gitlab' or 'repology'
			EndOfError
		;;
	esac
}
