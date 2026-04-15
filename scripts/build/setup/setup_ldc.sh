# shellcheck shell=bash disable=SC2115,SC2155
setup_ldc_cross_config() {
	local WIDER_TRIPLE="${LDC_TRIPLE/--/-.*-}"
	# arm target is armv7a-unknown-linux-android
	if [[ "$ARCH" = "arm" ]]; then
		WIDER_TRIPLE="${WIDER_TRIPLE/androideabi/android.*}"
	fi

	local LDFLAGS_LINES=""
	local NEWLINE=$'\n'
	local OLDIFS=$IFS
	for paramater in $LDFLAGS; do
		[[ $paramater != -Wl,* ]] && continue
		flags=${paramater#-Wl,} # Remove -Wl,
		local IFS=,
		for flag in $flags; do
			LDFLAGS_LINES="${LDFLAGS_LINES}${NEWLINE}        \"-L${flag}\","
		done
		IFS=$OLDIFS
	done

	cp "${1}.orig" "$1"
	cat <<- EOF >> "$1"
	"${WIDER_TRIPLE}":
	{
	    switches = [
	        "-defaultlib=phobos2-ldc,druntime-ldc",
	        "-gcc=${CC}",
	        "-Xcc=-B",
	        "-Xcc=%%ldcbinarypath%%",
	        "-L-rpath-link=${PREFIX}/lib",${LDFLAGS_LINES}
	    ];
	    lib-dirs = [
	        "${PREFIX}/lib",
	    ];
	    rpath = "${PREFIX}/lib";
	};
	EOF
	ln -sf "${PREFIX}/opt/binutils/cross/bin/${HOST_PLATFORM}-ld" \
		"${BUILDLDC_FOLDER}/bin/ld.bfd"
}

setup_ldc() {
	LDC_TRIPLE=${HOST_PLATFORM/-/--}
	if [[ "$ARCH" = "arm" ]]; then
		LDC_TRIPLE=${LDC_TRIPLE/arm-/armv7a-}
	fi
	if [[ "$ON_DEVICE_BUILD" = "false" ]]; then
		local LDC_VERSION=$(. "${SCRIPTDIR}/packages/ldc/build.sh"; \
			echo "${PKG_VERSION}")
		local LDC_PLATFORM=linux-x86_64

		test -f "${PREFIX}/lib/libdruntime-ldc.a" ||
			error_exit "Package 'ldc' is not installed. " \
				"It is required by LDC cross-compiler. " \
				"You should specify it in 'PKG_BUILD_DEPENDS'."
		test -f "${PREFIX}/opt/binutils/cross/bin/${HOST_PLATFORM}-ld" ||
			error_exit "Package 'binutils-cross' is not installed. " \
				"It is required by LDC cross-compiler." \
				"You should specify it in 'PKG_BUILD_DEPENDS'."

		local BUILDLDC_FOLDER
		if [[ "${PACKAGES_OFFLINE-false}" = "true" ]]; then
			BUILDLDC_FOLDER=${SCRIPTDIR}/build-tools/ldc2-${LDC_VERSION}
		else
			BUILDLDC_FOLDER=${COMMON_CACHEDIR}/ldc2-${LDC_VERSION}
		fi
		local BUILDLDC_NAME=ldc2-${LDC_VERSION}-${LDC_PLATFORM}
		local BUILDLDC_CONF=${BUILDLDC_FOLDER}/etc/ldc2.conf

		export PATH=${BUILDLDC_FOLDER}/bin:${PATH}

		if [[ -d "$BUILDLDC_FOLDER" ]]; then
			ln -sf "${PREFIX}/opt/binutils/cross/bin/${HOST_PLATFORM}-ld" \
				"${BUILDLDC_FOLDER}/bin/ld.bfd"
			setup_ldc_cross_config "$BUILDLDC_CONF"
			return
		fi

		local BUILDLDC_TAR=$COMMON_CACHEDIR/${BUILDLDC_NAME}.tar.xz
		rm -Rf "${COMMON_CACHEDIR}/$BUILDLDC_NAME" \
			"$BUILDLDC_FOLDER"
		download "https://github.com/ldc-developers/ldc/releases/download/v${LDC_VERSION}/ldc2-${LDC_VERSION}.sha256sums.txt" \
			"${BUILDLDC_TAR}.chksum" \
			SKIP_CHECKSUM
		local LDC_SHA256=$(grep ${LDC_PLATFORM} \
			"${BUILDLDC_TAR}.chksum" | awk -F " " '{print $1}')
		download "https://github.com/ldc-developers/ldc/releases/download/v${LDC_VERSION}/ldc2-${LDC_VERSION}-${LDC_PLATFORM}.tar.xz" \
			"$BUILDLDC_TAR" \
			"${LDC_SHA256}"

		( cd "$COMMON_CACHEDIR"; tar xJf "$BUILDLDC_TAR"; \
			mv "$BUILDLDC_NAME" "$BUILDLDC_FOLDER"; \
			rm "$BUILDLDC_TAR" "${BUILDLDC_TAR}.chksum") || exit 1

		cp "$BUILDLDC_CONF" "${BUILDLDC_CONF}.orig"
		setup_ldc_cross_config "$BUILDLDC_CONF"
	else
		if [[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' ldc 2>/dev/null)" != "installed" ]] ||
		   [[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q ldc 2>/dev/null)" ]]; then
			echo "Package 'ldc' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install ldc"
			echo
			echo "  pacman -S ldc"
			echo
			exit 1
		fi
	fi
}
