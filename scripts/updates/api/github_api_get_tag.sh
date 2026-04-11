# shellcheck shell=bash
github_api_get_tag() {
	if [[ -z "${GITHUB_TOKEN:-}" ]]; then
		# Needed to use GraphQL API.
		error_exit "GITHUB_TOKEN environment variable not set."
	fi

	local user repo project tag_type
	tag_type="$PKG_UPDATE_TAG_TYPE"

	# Example:
	# https://github.com/vim/vim/archive/refs/tags/v${PKG_VERSION}.tar.gz
	#        _="https:"
	#        _=""
	#        _="github.com"
	#     user="vim"
	#     repo="vim"
	#        _="archive/refs/tags/v${PKG_VERSION}.tar.gz"
	IFS='/' read -r _ _ _ user repo _ <<< "${PKG_SRCURL}"
	project="${user}/${repo}"

	if [[ -z "${tag_type}" ]]; then # If not set, then decide on the basis of url.
		if [[ "${PKG_SRCURL:0:4}" == "git+" ]]; then
			tag_type="newest-tag" # Get newest tag.
		elif [[ -n "$PKG_UPDATE_VERSION_REGEXP" ]]; then
			tag_type="latest-regex" # Get the latest release tag.
		else
			tag_type="latest-release-tag" # Get the latest release tag.
		fi
	fi

	local -a curl_opts=(
		-H "X-GitHub-Api-Version: 2022-11-28"
		-H "Accept: application/vnd.github.v3+json"
		-H "Authorization: token ${GITHUB_TOKEN}"
		-A "repoexe update checker 1.1 (github.com/repoexe/repoexe-packages)"
		--silent
		--location
		--retry 10
		--retry-delay 1
		--write-out '|%{http_code}'
	)
	local -a graphql_request=(
		-X POST
		-d "$(
			cat <<-EOF | tr '\n' ' '
				{
					"query": "query {
						repository(owner: \"${project%/*}\", name: \"${project##*/}\") {
							refs(refPrefix: \"refs/tags/\", first: 1, orderBy: {
								field: TAG_COMMIT_DATE, direction: DESC
							})
							{
								edges {
									node {
										name
									}
								}
							}
						}
					}"
				}
			EOF
		)"
	)

	local jq_filter api_path
	case "${tag_type}" in
		newest-tag)
			# We use graphql intensively so we should slowdown our requests to avoid hitting github ratelimits.
			sleep 1
			curl_opts+=("${graphql_request[@]}")
			api_path="graphql"
			jq_filter='.data.repository.refs.edges[0].node.name'
		;;
		latest-release-tag)
			api_path="repos/${project}/releases/latest"
			jq_filter=".tag_name"
		;;
		latest-regex)
			# We use graphql intensively so we should slowdown our requests to avoid hitting github ratelimits.
			sleep 1
			curl_opts+=("${graphql_request[@]}")
			# Get the 20 latest tags by tag commit date
			curl_opts[-1]="${curl_opts[-1]/first: 1/first: 20}"
			api_path="graphql"
			jq_filter='.data.repository.refs.edges[].node.name'
		;;
		*)
			error_exit <<-EndOfError
				ERROR: Invalid PKG_UPDATE_TAG_TYPE: '${tag_type}'.
				Allowed values: 'newest-tag', 'latest-release-tag', 'latest-regex'.
			EndOfError
		;;
	esac

	# Assemble the complete URL for the API request
	local api_url="https://api.github.com/${api_path}"
	local http_code response
	response="$(curl "${curl_opts[@]}" "${api_url}")"

	http_code="${response##*|}"
	# echo interpolates control characters, which jq does not like.
	response="$(printf "%s\n" "${response%|*}")"

	local tag_name=""
	case "${http_code}" in
		200)
			tag_name="$(jq --exit-status --raw-output "${jq_filter}" <<< "${response}")"
		;;
		404)
			error_exit <<-EndOfError
				No '${tag_type}' found. (${api_url})
				HTTP code: ${http_code}
				Try using '$(
					if [[ "${tag_type}" == "newest-tag" ]]; then
						echo "latest-release-tag"
					else
						echo "newest-tag"
					fi
				)'.
			EndOfError
		;;
		*)
			if jq --exit-status "has(\"message\") and .message == \"Not Found\"" <<< "${response}"; then
				error_exit <<-EndOfError
					No '${tag_type}' found. (${api_url})
					HTTP code: ${http_code}
					Try using '$(
						if [[ "${tag_type}" == "newest-tag" ]]; then
							echo "latest-release-tag"
						else
							echo "newest-tag"
						fi
					)'.
				EndOfError
			fi
		;;
	esac
	echo "${tag_name}"
}
