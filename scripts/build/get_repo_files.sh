get_repo_files() {
	local PACKAGES_HASH RELEASE_FILE repo_base dl_prefix RELEASE_FILE_URL RELEASE_FILE_SIG_URL
	local -a pids=()
	# Not needed for on-device builds or when building
	# dependencies.
	if [[ "$ON_DEVICE_BUILD" = "true" || "$INSTALL_DEPS" = "false" ]]; then
		return
	fi

	[[ "${CI-false}" == "true" ]] && echo "::group::INFO: Fetching repo metadata" || :

	for idx in "${!REPO_URL[@]}"; do
		local REPO_NAME="${REPO_URL[$idx]#https://}"
		REPO_NAME="${REPO_NAME#http://}"
		REPO_NAME="${REPO_NAME//\//-}"
		case "$REPO_PKG_FORMAT" in
		"debian")
			RELEASE_FILE="${COMMON_CACHEDIR}/${REPO_NAME}-${REPO_DISTRIBUTION[$idx]}-Release"
			repo_base="${REPO_URL[$idx]}/dists/${REPO_DISTRIBUTION[$idx]}"
			dl_prefix="${REPO_NAME}-${REPO_DISTRIBUTION[$idx]}-${REPO_COMPONENT[$idx]}"
			RELEASE_FILE_URL="${repo_base}/Release"
			RELEASE_FILE_SIG_URL="${RELEASE_FILE_URL}.gpg"
			;;
		"pacman")
			RELEASE_FILE="${COMMON_CACHEDIR}-${ARCH}/${REPO_NAME}-json"
			repo_base="${REPO_URL[$idx]}/${ARCH}"
			RELEASE_FILE_URL="${repo_base}/${REPO_DISTRIBUTION[$idx]}.json"
			RELEASE_FILE_SIG_URL="${RELEASE_FILE_URL}.sig"
			;;
		*) error_exit "Invalid package format: $REPO_PKG_FORMAT"
			;;
		esac

		(
			local attempt delay=5
			if [[ "${CI-false}" == "true" ]]; then
				delay=30
			fi
			for attempt in {1..6}; do
				if download "${RELEASE_FILE_URL}" "${RELEASE_FILE}" SKIP_CHECKSUM \
						&& download "${RELEASE_FILE_SIG_URL}" "${RELEASE_FILE}.gpg" SKIP_CHECKSUM; then
					mkdir -p "$HOME/.gnupg"
					chmod 700 "$HOME/.gnupg"
					if ! gpg --verify "${RELEASE_FILE}.gpg" "${RELEASE_FILE}"; then
						echo "GPG verification failed, probably we downloaded corrupted metadata. Retrying in $delay seconds."
						sleep "$delay"
						continue
					fi

					if [[ "$REPO_PKG_FORMAT" == "debian" ]]; then
						for arch in all "${ARCH}"; do
							PACKAGES_HASH="$(./scripts/get_hash_from_file.py "${RELEASE_FILE}" "${arch}" "${REPO_COMPONENT[$idx]}")"

							# If packages_hash = "" then the repo probably doesn't contain debs for $arch
							[[ -n "$PACKAGES_HASH" ]] && \
								download "${repo_base}/${REPO_COMPONENT[$idx]}/binary-$arch/Packages" \
										"${COMMON_CACHEDIR}-$arch/${dl_prefix}-Packages" "$PACKAGES_HASH" && \
								exit 0
						done
					fi
					exit 0
				fi
			done
			error_exit "Failed to download package repository metadata. Try to build without -i/-I option."
		) 2>&1 | (
			set +e
			# curl progress meter uses carriage return instead of newlines, fixing it
			sed -u 's/\r/\n/g' | while :; do
				local buffer=()
				# Half second buffer to prevent mixing lines and make output consistent.
				sleep 0.5;
				while :; do
					# read with 0 timeout does not read any data so giving minimal timeout
					IFS='' read -t 0.001 -r line; rc=$?
					# append job name to the start for tracking multiple jobs
					[[ $rc == 0 ]] && buffer+=( "[$REPO_NAME]: $line" )
					# Probably EOF or timeout
					[[ $rc == 1 || $rc -ge 128 ]] && break
				done

				# prevent output garbling by using stdout as a lock file
				[[ "${#buffer[@]}" -ge 1 ]] && flock --no-fork . printf "%s\n" "${buffer[@]}"
				[[ $rc == 1 ]] && break # exit on EOF
			done
		) &
		pids+=( $! )
	done

	for _ in "${pids[@]}"; do
		if ! wait -n; then
			# One of jobs exited with non-zero status, we should return error too.
			kill "${pids[@]}" 2>/dev/null
			exit 1
		fi
	done
	[[ "${CI-false}" == "true" ]] && echo "::endgroup::" || :
}
