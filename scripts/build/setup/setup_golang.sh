# Utility function for golang-using packages to setup a go toolchain.
setup_golang() {
	export GOPATH="${COMMON_CACHEDIR}/go-path" GOCACHE="${COMMON_CACHEDIR}/go-build"
	mkdir -p "$GOPATH" "$GOCACHE"
	if [ "$ON_DEVICE_BUILD" = "false" ]; then
		local GO_VERSION=go1.26.1
		local GO_SHA256=031f088e5d955bab8657ede27ad4e3bc5b7c1ba281f05f245bcc304f327c987a
		local GO_PLATFORM=linux-amd64

		local BUILDGO_FOLDER
		if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
			BUILDGO_FOLDER=${SCRIPTDIR}/build-tools/${GO_VERSION}
		else
			BUILDGO_FOLDER=${COMMON_CACHEDIR}/${GO_VERSION}
		fi

		BUILDGO_FOLDER+="-r1"

		export GOROOT=$BUILDGO_FOLDER
		export PATH=${GOROOT}/bin:${PATH}

		if [ -d "$BUILDGO_FOLDER" ]; then return; fi

		local BUILDGO_TAR=$COMMON_CACHEDIR/${GO_VERSION}.${GO_PLATFORM}.tar.gz
		rm -Rf "$COMMON_CACHEDIR/go" "$BUILDGO_FOLDER"
		download https://go.dev/dl/${GO_VERSION}.${GO_PLATFORM}.tar.gz \
			"$BUILDGO_TAR" \
			"$GO_SHA256"

		(
			cd "$COMMON_CACHEDIR"
			tar xf "$BUILDGO_TAR"
			mv go "$BUILDGO_FOLDER"
			rm "$BUILDGO_TAR"
		)

		(
			cd "$BUILDGO_FOLDER"
			. "${SCRIPTDIR}/packages/golang/patch-script/fix-hardcoded-etc-resolv-conf.sh"
			. "${SCRIPTDIR}/packages/golang/patch-script/remove-pidfd.sh"
			. "${SCRIPTDIR}/packages/golang/patch-script/remove-futex_time64.sh"
		)
	else
		if [[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' golang 2>/dev/null)" != "installed" ]] ||
		[[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q golang 2>/dev/null)" ]]; then
			echo "Package 'golang' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install golang"
			echo
			echo "  pacman -S golang"
			echo
			echo "or build it from source with"
			echo
			echo "  ./build-package.sh golang"
			echo
			exit 1
		fi

		export GOROOT="$_PREFIX__LIB_DIR/go"
	fi
}
