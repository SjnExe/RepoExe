setup_ninja() {
	local NINJA_VERSION=1.13.2
	local NINJA_FOLDER

	if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
		NINJA_FOLDER=${SCRIPTDIR}/build-tools/ninja-${NINJA_VERSION}
	else
		NINJA_FOLDER=${COMMON_CACHEDIR}/ninja-$NINJA_VERSION
	fi

	if [ "$ON_DEVICE_BUILD" = "false" ]; then
		if [ ! -x "$NINJA_FOLDER/ninja" ]; then
			mkdir -p "$NINJA_FOLDER"
			local NINJA_ZIP_FILE=$PKG_TMPDIR/ninja-$NINJA_VERSION.zip
			download https://github.com/ninja-build/ninja/releases/download/v$NINJA_VERSION/ninja-linux.zip \
				"$NINJA_ZIP_FILE" \
				5749cbc4e668273514150a80e387a957f933c6ed3f5f11e03fb30955e2bbead6
			unzip "$NINJA_ZIP_FILE" -d "$NINJA_FOLDER"
			chmod 755 $NINJA_FOLDER/ninja
		fi
		export PATH=$NINJA_FOLDER:$PATH
	else
		local NINJA_PKG_VERSION=$(bash -c ". $SCRIPTDIR/packages/ninja/build.sh; echo \$PKG_VERSION")
		if ([ ! -e "$BUILT_PACKAGES_DIRECTORY/ninja" ] ||
		    [ "$(cat "$BUILT_PACKAGES_DIRECTORY/ninja")" != "$NINJA_PKG_VERSION" ]) &&
		   ([[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' ninja 2>/dev/null)" != "installed" ]] ||
		    [[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q ninja 2>/dev/null)" ]]); then
			echo "Package 'ninja' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install ninja"
			echo
			echo "  pacman -S ninja"
			echo
			echo "or build it from source with"
			echo
			echo "  ./build-package.sh ninja"
			echo
			exit 1
		fi
	fi
}
