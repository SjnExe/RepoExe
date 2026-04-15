setup_cmake() {
	local CMAKE_VERSION=4.3.1
	local CMAKE_SHA256=208d76804009cbe8ec9aea0aa052c857c6e59bd289b43b9941c99324dc78b1d8
	local CMAKE_MAJORVERSION="${CMAKE_VERSION%.*}"
	local CMAKE_TARNAME="cmake-${CMAKE_VERSION}-linux-x86_64.tar.gz"
	local CMAKE_URL="https://github.com/Kitware/CMake/releases/download/v${CMAKE_VERSION}/${CMAKE_TARNAME}"
	local CMAKE_TARFILE="${PKG_TMPDIR}/${CMAKE_TARNAME}"
	local CMAKE_FOLDER="${COMMON_CACHEDIR}/cmake-${CMAKE_VERSION}"
	if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
		CMAKE_FOLDER="${SCRIPTDIR}/build-tools/cmake-${CMAKE_VERSION}"
	fi

	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		local CMAKE_NAME="cmake"
	elif [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		local CMAKE_NAME="cmake-glibc"
	fi

	export CMAKE_INSTALL_ALWAYS=1

	if [ "${ON_DEVICE_BUILD}" = "true" ]; then
		if [[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' $CMAKE_NAME 2>/dev/null)" != "installed" ]] ||
			[[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q $CMAKE_NAME 2>/dev/null)" ]]; then
			echo "Package '$CMAKE_NAME' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install $CMAKE_NAME"
			echo
			echo "  pacman -S $CMAKE_NAME"
			echo
			exit 1
		fi
		return
	fi

	if [ ! -d "${CMAKE_FOLDER}" ]; then
		download "${CMAKE_URL}" \
			"${CMAKE_TARFILE}" \
			"${CMAKE_SHA256}"
		rm -Rf "${PKG_TMPDIR}/cmake-${CMAKE_VERSION}-linux-x86_64"
		tar xf "${CMAKE_TARFILE}" -C "${PKG_TMPDIR}"
		mv "${PKG_TMPDIR}/cmake-${CMAKE_VERSION}-linux-x86_64" \
			"${CMAKE_FOLDER}"
	fi

	export PATH="${CMAKE_FOLDER}/bin:${PATH}"
}
