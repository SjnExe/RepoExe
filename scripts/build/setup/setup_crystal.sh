setup_crystal() {
	local CRYSTAL_VERSION=1.12.0
	local CRYSTAL_SHA256=d0c9237e8f0bb8c176545019b2296b65451fb29e2b4c7585986a3f9a4bcc1cb3
	local CRYSTAL_TARNAME=crystal-${CRYSTAL_VERSION}-1-linux-x86_64-bundled.tar.gz
	local CRYSTAL_TARFILE=$PKG_TMPDIR/crystal-$CRYSTAL_VERSION.tar.gz
	local CRYSTAL_FOLDER

	if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
		CRYSTAL_FOLDER=${SCRIPTDIR}/build-tools/crystal-${CRYSTAL_VERSION}
	else
		CRYSTAL_FOLDER=${COMMON_CACHEDIR}/crystal-${CRYSTAL_VERSION}
	fi

	if [ "$ON_DEVICE_BUILD" = "false" ]; then
		if [ ! -x "$CRYSTAL_FOLDER" ]; then
			mkdir -p "$CRYSTAL_FOLDER"
			download "https://github.com/crystal-lang/crystal/releases/download/$CRYSTAL_VERSION/$CRYSTAL_TARNAME" \
				"$CRYSTAL_TARFILE" \
				"$CRYSTAL_SHA256"
			tar xf "$CRYSTAL_TARFILE" --strip-components=2 -C "$CRYSTAL_FOLDER"
		fi
		export PATH=$CRYSTAL_FOLDER/bin:$PATH
	else
		if [[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' crystal 2>/dev/null)" != "installed" ]] ||
                   [[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q crystal 2>/dev/null)" ]]; then
			echo "Package 'crystal' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install crystal"
			echo
			echo "  pacman -S crystal"
			echo
			exit 1
		fi
	fi
}
