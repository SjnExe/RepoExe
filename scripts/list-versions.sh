#!/usr/bin/env bash

SCRIPT_DIR=$(dirname "$(realpath "$0")")
. "$SCRIPT_DIR"/properties.sh

check_package() { # path
	local path=$1
	local pkg=$(basename "$path")
	PKG_REVISION=0
	ARCH=aarch64
	. "$path"/build.sh
	if [ "$PKG_REVISION" != "0" ] || [ "$PKG_VERSION" != "${PKG_VERSION/-/}" ]; then
		PKG_VERSION+="-$PKG_REVISION"
	fi
	echo "$pkg=$PKG_VERSION"
}

for path in "${SCRIPT_DIR}"/../packages/*; do
(
	check_package "$path"
)
done
