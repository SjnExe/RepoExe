setup_swift() {
	local SWIFT_TRIPLE=${HOST_PLATFORM/-/-unknown-}$PKG_API_LEVEL
	export SWIFT_TARGET_TRIPLE=${SWIFT_TRIPLE/arm-/armv7-}

	if [ "$ON_DEVICE_BUILD" = "false" ]; then
		local SWIFT_VERSION=$(. $SCRIPTDIR/packages/swift/build.sh; echo $PKG_VERSION)
		local SWIFT_RELEASE=$(. $SCRIPTDIR/packages/swift/build.sh; echo $SWIFT_RELEASE)
		local SWIFT_BIN="swift-$SWIFT_VERSION-$SWIFT_RELEASE-ubuntu24.04"
		local SWIFT_FOLDER

		if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
			SWIFT_FOLDER=${SCRIPTDIR}/build-tools/${SWIFT_BIN}
		else
			SWIFT_FOLDER=${COMMON_CACHEDIR}/${SWIFT_BIN}
		fi

		if [ ! -d "$SWIFT_FOLDER" ]; then
			local SWIFT_TAR=$PKG_TMPDIR/${SWIFT_BIN}.tar.gz
			download \
				https://download.swift.org/swift-$SWIFT_VERSION-release/ubuntu2404/swift-$SWIFT_VERSION-$SWIFT_RELEASE/$SWIFT_BIN.tar.gz \
				$SWIFT_TAR \
				4022cb64faf7e2681c19f9b62a22fb7d9055db6194d9e4a4bef9107b6ce10946

			(cd $PKG_TMPDIR ; tar xf $SWIFT_TAR ; mv $SWIFT_BIN $SWIFT_FOLDER; rm $SWIFT_TAR)
		fi
		export SWIFT_BINDIR="$SWIFT_FOLDER/usr/bin"
		export SWIFT_CROSSCOMPILE_CONFIG="$SWIFT_FOLDER/usr/android-$ARCH.json"
		if [ ! -z ${STANDALONE_TOOLCHAIN+x} ]; then
			local MULTILIB_DIR="$ARCH-linux-android"
			test $ARCH == 'arm' && MULTILIB_DIR+="eabi"
			cat <<- EOF > $SWIFT_CROSSCOMPILE_CONFIG
			{ "version": 1,
			"target": "${SWIFT_TARGET_TRIPLE}",
			"toolchain-bin-dir": "${SWIFT_BINDIR}",
			"sdk": "${STANDALONE_TOOLCHAIN}/sysroot",
			"extra-cc-flags": [ "-fPIC" ],
			"extra-swiftc-flags": [ "-resource-dir", "${PREFIX}/lib/swift",
			   "-Xcc", "-I${PREFIX}/include",
			   "-L${PREFIX}/opt/ndk-multilib/$MULTILIB_DIR/lib", "-L${PREFIX}/lib",
			   "-tools-directory", "${STANDALONE_TOOLCHAIN}/bin", ],
			"extra-cpp-flags": [ "-lstdc++" ] }
			EOF
		fi
	else
		if [[ "${APP_PACKAGE_MANAGER}" == "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' swift 2>/dev/null)" != "installed" ]] ||
		   [[ "${APP_PACKAGE_MANAGER}" == "pacman" && ! "$(pacman -Q swift 2>/dev/null)" ]]; then
			echo "Package 'swift' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install swift"
			echo
			echo "  pacman -S swift"
			echo
			echo "or build it from source with"
			echo
			echo "  ./build-package.sh swift"
			echo
			exit 1
		fi
		export SWIFT_BINDIR="$PREFIX/bin"
	fi
}
