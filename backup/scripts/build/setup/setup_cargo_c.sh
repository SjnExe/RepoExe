setup_cargo_c() {
	local CARGO_C_VERSION=0.10.15
	local CARGO_C_SHA256=066ff231fffa7c5f22ede897dd968110eddee6f16eff6eaf9415231efce57dbb
	local CARGO_C_TARNAME=cargo-c-x86_64-unknown-linux-musl.tar.gz
	local CARGO_C_TARFILE=$PKG_TMPDIR/$CARGO_C_TARNAME
	local CARGO_C_FOLDER

	if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
		CARGO_C_FOLDER=$SCRIPTDIR/build-tools/cargo-c-$CARGO_C_VERSION
	else
		CARGO_C_FOLDER=$COMMON_CACHEDIR/cargo-c-$CARGO_C_VERSION
	fi

	if [ "$ON_DEVICE_BUILD" = "true" ]; then
		if [[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' cargo-c 2>/dev/null)" != "installed" ]] ||
			[[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q cargo-c 2>/dev/null)" ]]; then
			echo "Package 'cargo-c' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install cargo-c"
			echo
			echo "  pacman -S cargo-c"
			echo
			exit 1
		fi
		return
	fi

	if [ ! -d "$CARGO_C_FOLDER" ]; then
		download https://github.com/lu-zero/cargo-c/releases/download/v$CARGO_C_VERSION/$CARGO_C_TARNAME \
			"$CARGO_C_TARFILE" \
			"$CARGO_C_SHA256"
		rm -Rf "$CARGO_C_FOLDER"
		mkdir -p "$CARGO_C_FOLDER"
		tar xf "$CARGO_C_TARFILE" -C "$CARGO_C_FOLDER"
	fi

	export PATH=$CARGO_C_FOLDER:$PATH
}
