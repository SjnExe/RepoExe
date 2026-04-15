# shellcheck shell=bash
setup_cabal() {
	if [[ "${ON_DEVICE_BUILD}" == "false" ]]; then
		local CABAL_VERSION=3.14.1.1
		local CABAL_TAR="${COMMON_CACHEDIR}/cabal-${CABAL_VERSION}.tar.xz"

		local CABAL_RUNTIME_FOLDER

		if [[ "${PACKAGES_OFFLINE-false}" == "true" ]]; then
			CABAL_RUNTIME_FOLDER="${SCRIPTDIR}/build-tools/cabal-${CABAL_VERSION}-runtime"
		else
			CABAL_RUNTIME_FOLDER="${COMMON_CACHEDIR}/cabal-${CABAL_VERSION}-runtime"
		fi

		export PATH="${CABAL_RUNTIME_FOLDER}:${PATH}"
		export CABAL_CONFIG="$CABAL_RUNTIME_FOLDER/cabal.config"

		[[ -d "${CABAL_RUNTIME_FOLDER}" ]] && return

		download "https://downloads.haskell.org/~cabal/cabal-install-${CABAL_VERSION}/cabal-install-${CABAL_VERSION}-x86_64-linux-ubuntu22_04.tar.xz" \
			"${CABAL_TAR}" \
			773633b5fff7f26abd6d9388b4ab7ef35b0cd544612ec34ab91ef9bc24438619

		mkdir -p "${CABAL_RUNTIME_FOLDER}"
		tar xf "${CABAL_TAR}" -C "${CABAL_RUNTIME_FOLDER}"
		rm "${CABAL_TAR}"

		cabal update

		# Configuration:

		local repo="hackage.haskell.org"

		cat <<-EOF >"$CABAL_CONFIG"
			repository hackage.haskell.org
			 url: https://$repo/

			remote-repo-cache: $HOME/.cache/cabal/packages
			configure-option: --host=$HOST_PLATFORM
			tests: False
			build-summary: $HOME/.cache/cabal/logs/build.log
			remote-build-reporting: none
			jobs: $MAKE_PROCESSES

			program-locations
			 alex-location: $(command -v alex)
			 happy-location: $(command -v happy)

			program-default-options
			 $([[ "$ON_DEVICE_BUILD" == false ]] && printf "%s" "hsc2hs-options: --cross-compile")
		EOF
	else
		if [[ "${APP_PACKAGE_MANAGER}" == "apt" ]] && "$(dpkg-query -W -f '${db:Status-Status}\n' cabal-install 2>/dev/null)" != "installed" ||
			[[ "${APP_PACKAGE_MANAGER}" == "pacman" ]] && ! "$(pacman -Q cabal-install 2>/dev/null)"; then
			echo "Package 'cabal-install' is not installed."
			exit 1
		fi
	fi
}
