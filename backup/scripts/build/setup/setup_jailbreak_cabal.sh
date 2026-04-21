# shellcheck shell=bash
# Utility script to setup jailbreak-cabal script. It is used by haskell build system to remove version
# constraints in cabal files.
setup_jailbreak_cabal() {
	if [[ "${ON_DEVICE_BUILD}" == "false" ]]; then
		local JAILBREAK_VERSION=1.3.5
		local JAILBREAK_TAR="${COMMON_CACHEDIR}/jailbreak-cabal-${JAILBREAK_VERSION}.tar.gz"
		local JAILBREAK_RUNTIME_FOLDER

		if [[ "${PACKAGES_OFFLINE-false}" == "true" ]]; then
			JAILBREAK_RUNTIME_FOLDER="${SCRIPTDIR}/build-tools/jailbreak-cabal-${JAILBREAK_VERSION}-runtime"
		else
			JAILBREAK_RUNTIME_FOLDER="${COMMON_CACHEDIR}/jailbreak-cabal-${JAILBREAK_VERSION}-runtime"
		fi

		export PATH="${JAILBREAK_RUNTIME_FOLDER}:${PATH}"

		[[ -d "${JAILBREAK_RUNTIME_FOLDER}" ]] && return

		download "https://github.com/MrAdityaAlok/ghc-cross-tools/releases/download/jailbreak-cabal-v${JAILBREAK_VERSION}/jailbreak-cabal-${JAILBREAK_VERSION}.tar.xz" \
			"${JAILBREAK_TAR}" \
			"8d1a8b8fadf48f4abf42da025d5cf843bd68e1b3c18ecacdc0cd0c9bd470c64e"

		mkdir -p "${JAILBREAK_RUNTIME_FOLDER}"
		tar xf "${JAILBREAK_TAR}" -C "${JAILBREAK_RUNTIME_FOLDER}"

		rm "${JAILBREAK_TAR}"
	else
		if [[ "${APP_PACKAGE_MANAGER}" == "apt" ]] && "$(dpkg-query -W -f '${db:Status-Status}\n' jailbreak-cabal 2>/dev/null)" != "installed" ||
			[[ "${APP_PACKAGE_MANAGER}" = "pacman" ]] && ! "$(pacman -Q jailbreak-cabal 2>/dev/null)"; then
			echo "Package 'jailbreak-cabal' is not installed."
			exit 1
		fi
	fi
}
