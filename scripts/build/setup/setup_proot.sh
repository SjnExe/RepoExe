# shellcheck shell=bash
# This provides an utility to run binaries under repoexe environment via proot.
setup_proot() {
	local PROOT_VERSION=5.3.0
	local QEMU_VERSION=7.2.0-1
	local PROOT_BIN="$COMMON_CACHEDIR/proot-bin-$ARCH"
	local PROOT_QEMU=""
	local PROOT_BIN_NAME="repoexe-proot-run"

	export PATH="$PROOT_BIN:$PATH"

	[[ -d "$PROOT_BIN" ]] && return

	if ! [[ -d "$PREFIX/opt/aosp" ]]; then
		echo "ERROR: Add 'aosp-libs' to PKG_BUILD_DEPENDS. 'proot' cannot run without it."
		exit 1
	fi

	mkdir -p "$PROOT_BIN"

	download https://github.com/proot-me/proot/releases/download/v"$PROOT_VERSION"/proot-v"$PROOT_VERSION"-x86_64-static \
		"$PROOT_BIN/proot" \
		d1eb20cb201e6df08d707023efb000623ff7c10d6574839d7bb42d0adba6b4da
	chmod +x "$PROOT_BIN"/proot

	declare -A checksums=(
		["aarch64"]="dce64b2dc6b005485c7aa735a7ea39cb0006bf7e5badc28b324b2cd0c73d883f"
		["arm"]="9f07762a3cd0f8a199cb5471a92402a4765f8e2fcb7fe91a87ee75da9616a806"
	)
	if [[ "$ARCH" == "aarch64" ]] || [[ "$ARCH" == "arm" ]]; then
		download https://github.com/multiarch/qemu-user-static/releases/download/v"$QEMU_VERSION"/qemu-"${ARCH/i686/i386}"-static \
			"$PROOT_BIN"/qemu-"$ARCH" \
			"${checksums[$ARCH]}"
		chmod +x "$PROOT_BIN"/qemu-"$ARCH"
		PROOT_QEMU="-q $PROOT_BIN/qemu-$ARCH"
	fi

	# NOTE: We include current PATH too so that host binaries also become available under proot.
	cat <<-EOF >"$PROOT_BIN/$PROOT_BIN_NAME"
		#!/bin/bash
		env -i \
			PATH="$PREFIX/bin:$PATH" \
			ANDROID_DATA=/data \
			ANDROID_ROOT=/system \
			HOME=$ANDROID_HOME \
			LANG=en_US.UTF-8 \
			PREFIX=$PREFIX \
			TERM=$TERM \
			TZ=UTC \
			$PROOT_EXTRA_ENV_VARS \
			$PROOT_BIN/proot $PROOT_QEMU -R / "\$@"
	EOF
	chmod +x "$PROOT_BIN/$PROOT_BIN_NAME"
}
