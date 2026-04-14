#!/usr/bin/env bash
# check-versions.sh - script to open packages in a browser for checking their versions

OPEN=xdg-open
if [ $(uname) = Darwin ]; then OPEN=open; fi

check_package() { # path
	local path=$1
	local pkg=$(basename $path)
	. $path/build.sh
	echo -n "$pkg - $PKG_VERSION"
	read
	$OPEN $PKG_HOMEPAGE
}

# Run each package in separate process since we include their environment variables:
for path in packages/*; do
(
	check_package $path
)
done
