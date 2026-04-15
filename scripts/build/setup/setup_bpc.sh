setup_bpc() {
	local _BPC_BUILD_SH="$SCRIPTDIR/packages/blueprint-compiler/build.sh"
	local _BPC_VERSION=$(bash -c ". $_BPC_BUILD_SH; echo \${PKG_VERSION#*:}")
	local _BPC_SRCURL=$(bash -c ". $_BPC_BUILD_SH; echo \${PKG_SRCURL}")
	local _BPC_SHA256=$(bash -c ". $_BPC_BUILD_SH; echo \${PKG_SHA256}")
	local _BPC_SRCARCHIVE="${PKG_TMPDIR}/bpc-${_BPC_VERSION}.tar.gz"
	local _BPC_SRCDIR="${PKG_TMPDIR}/bpc-${_BPC_VERSION}"
	local _BPC_FOLDER

	if [[ "$ON_DEVICE_BUILD" == "true" ]]; then
		if ([ ! -e "$BUILT_PACKAGES_DIRECTORY/blueprint-compiler" ] ||
			[ "$(cat "$BUILT_PACKAGES_DIRECTORY/blueprint-compiler")" != "$_BPC_VERSION" ]) &&
			([[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' blueprint-compiler 2>/dev/null)" != "installed" ]] ||
			[[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q blueprint-compiler 2>/dev/null)" ]]); then
			echo "Package 'blueprint-compiler' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install blueprint-compiler"
			echo
			echo "  pacman -S blueprint-compiler"
			echo
			echo "or build it from source with"
			echo
			echo "  ./build-package.sh blueprint-compiler"
			echo
			exit 1
		fi
		return
	fi

	if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
		_BPC_FOLDER="${SCRIPTDIR}/build-tools/bpc-${_BPC_VERSION}"
	else
		_BPC_FOLDER="${COMMON_CACHEDIR}/bpc-${_BPC_VERSION}"
	fi

	if [ ! -d "$_BPC_FOLDER" ]; then
	(
		download "$_BPC_SRCURL" "$_BPC_SRCARCHIVE" "$_BPC_SHA256"

		rm -Rf "$_BPC_SRCDIR"
		mkdir -p "$_BPC_SRCDIR/build"
		tar -xf "$_BPC_SRCARCHIVE" --strip-components=1 -C "$_BPC_SRCDIR"
		# setup_meson for hostbuilds copied from glib package
		AR=;CC=;CFLAGS=;CPPFLAGS=;CXX=;CXXFLAGS=;LD=;LDFLAGS=;PKG_CONFIG=;STRIP=
		setup_meson
		unset AR CC CFLAGS CPPFLAGS CXX CXXFLAGS LD LDFLAGS PKG_CONFIG STRIP
		${MESON} setup "$_BPC_SRCDIR" "$_BPC_SRCDIR/build" --prefix "$_BPC_FOLDER"
		ninja -C "$_BPC_SRCDIR/build" -j "$MAKE_PROCESSES"
		ninja -C "$_BPC_SRCDIR/build" install
	)
	fi

	export PATH="$_BPC_FOLDER/bin:$PATH"
	export GI_TYPELIB_PATH="$PREFIX/lib/girepository-1.0"
}
