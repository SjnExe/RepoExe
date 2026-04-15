# shellcheck shell=bash
# Utility function to setup a GHC cross-compiler toolchain targeting Android.
setup_ghc() {
	local GHC_VERSION=9.12.2
	local GHC_PREFIX="ghc-cross-$GHC_VERSION-$ARCH"
	local GHC_TEMP_FOLDER="$COMMON_CACHEDIR/$GHC_PREFIX"
	local GHC_TAR="$GHC_TEMP_FOLDER.tar.xz"
	local GHC_RUNTIME_FOLDER

	if [[ "$ON_DEVICE_BUILD" == false ]]; then

		if [[ "${PACKAGES_OFFLINE-false}" == true ]]; then
			GHC_RUNTIME_FOLDER="$SCRIPTDIR/build-tools/$GHC_PREFIX-runtime"
		else
			GHC_RUNTIME_FOLDER="$COMMON_CACHEDIR/$GHC_PREFIX-runtime"
		fi

		export PATH="$GHC_RUNTIME_FOLDER/bin:$PATH"

		[[ -d "$GHC_RUNTIME_FOLDER" ]] && return

		declare -A checksums=(
			["aarch64"]="a9a70c178d3b7cd5733730d93c00975b9957e164f203d80ba04e53cd76c54183"
			["arm"]="173c3b9bbc37afb47edb5f1f2f287064c37c7b4ef19ce787e6d82970e7c5f9cf"
			["i686"]="77315c0eeae163d5a21077c86d1c2f6f0192fdc6cb6fe1e377fc1115cfb073d4"
			["x86_64"]="07a289d912be3a9ae75aa5e2ae5f22d577fabd3a13331de3e6f318d7545fd38a"
		)

		local target="$HOST_PLATFORM"
		[[ "$ARCH" == "arm" ]] && target="armv7a-linux-androideabi"

		download "https://github.com/RepoExe/ghc-cross-tools/releases/download/ghc-v$GHC_VERSION/ghc-$GHC_VERSION-$target.tar.xz" \
			"$GHC_TAR" \
			"${checksums[$ARCH]}"

		mkdir -p "$GHC_RUNTIME_FOLDER" "$GHC_TEMP_FOLDER"
		tar -xf "$GHC_TAR" -C "$GHC_TEMP_FOLDER" --strip-components=1

		(
			set -e
			cd "$GHC_TEMP_FOLDER"

			export CONF_CC_OPTS_STAGE2="$CFLAGS $CPPFLAGS"
			export CONF_GCC_LINKER_OPTS_STAGE2="$LDFLAGS"
			export CONF_CXX_OPTS_STAGE2="$CXXFLAGS"

			./configure \
				--prefix="$GHC_RUNTIME_FOLDER" \
				--host="$target"
			make install
		) &>/dev/null

		rm -rf "$GHC_TAR" "$GHC_TEMP_FOLDER"
	else
		if [[ "$APP_PACKAGE_MANAGER" == "apt" ]] && "$(dpkg-query -W -f '${db:Status-Status}\n' ghc 2>/dev/null)" != "installed" ||
			[[ "$APP_PACKAGE_MANAGER" == "pacman" ]] && ! "$(pacman -Q ghc 2>/dev/null)"; then
			echo "Package 'ghc' is not installed."
			exit 1
		fi
	fi
}
