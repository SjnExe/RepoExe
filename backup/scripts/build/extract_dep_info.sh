#!/usr/bin/bash

extract_dep_info() {
	( # Do everything in a subshell to avoid variable hell outside the function
	PKG="$1"
	PKG_DIR="$2"

	# set SUBPKG_PLATFORM_INDEPENDENT to
	# parent package's value and override if
	# needed
	PKG_ON_DEVICE_BUILD_NOT_SUPPORTED="false"
	PKG_PLATFORM_INDEPENDENT="false"
	PKG_REVISION="0"
	source "${PKG_DIR}/build.sh"

	# debian version
	VER_DEBIAN="$PKG_VERSION"
	if [[ "$PKG_REVISION" != "0" || "$PKG_VERSION" != "${PKG_VERSION/-/}" ]]; then
		VER_DEBIAN+="-$PKG_REVISION"
	fi

	# pacman version
	VER_PACMAN="${PKG_VERSION//-/.}"
	if [[ "$VER_PACMAN" =~ [0-9][a-z] ]]; then
		p=${BASH_REMATCH[0]}
		VER_PACMAN=${VER_PACMAN//"$p"/"${p:0:1}.${p:1:1}"}
	fi

	if [[ "$PKG" != "${PKG_DIR##*/}" && "${PKG/-glibc/}" != "${PKG_DIR##*/}" ]]; then
		if [[ "$INSTALL_DEPS" == "false" || \
				"$PKG_NO_STATICSPLIT" = "true" || \
				"${PKG/-static/}-static" != "${PKG}" ]]; then
			# Allow commands like `cat ${PKG_TMPDIR}` to fail inside subpackages buildscripts
			# Usually it does not directly affect target packages
			set +e
			# shellcheck source=/dev/null
			if [[ -f "${PKG_DIR}/${PKG}.subpackage.sh" ]]; then
				source "${PKG_DIR}/${PKG}.subpackage.sh"
			else
				source "${PKG_DIR}/${PKG/-glibc/}.subpackage.sh"
			fi
		fi
	fi
	if [[ "${SUBPKG_PLATFORM_INDEPENDENT:-$PKG_PLATFORM_INDEPENDENT}" == "true" ]]; then
		ARCH=all
	fi

	echo "${ARCH} ${VER_DEBIAN} ${VER_PACMAN}-${PKG_REVISION} ${PKG_ON_DEVICE_BUILD_NOT_SUPPORTED}"
	)
}

# Make script standalone executable as well as sourceable
if [[ "${BASH_SOURCE[0]}" == "${0}" ]]; then
	extract_dep_info "$@"
fi
