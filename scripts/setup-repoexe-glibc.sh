#!/bin/bash

. $(dirname "$(realpath "$0")")/properties.sh
source "$PREFIX/bin/repoexe-setup-package-manager" || true

if [ "$APP_PACKAGE_MANAGER" = "apt" ]; then
	echo "Error: apt does not have glibc packages"
	exit 1
elif [ "$APP_PACKAGE_MANAGER" = "pacman" ]; then
	if $(pacman-conf -r gpkg-dev &> /dev/null); then
		pacman -Syu gpkg-dev --needed --noconfirm
	else
		echo "Error: no glibc packages repo found (only gpkg-dev at the moment)"
		exit 1
	fi
else
	echo "Error: no package manager defined"
	exit 1
fi
