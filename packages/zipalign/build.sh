TERMUX_PKG_HOMEPAGE=https://developer.android.com/studio/command-line/zipalign
TERMUX_PKG_DESCRIPTION="Zip archive alignment tool"
TERMUX_PKG_LICENSE="Apache-2.0"
TERMUX_PKG_MAINTAINER="@SjnExe"
_TAG_VERSION=16.0.0
_TAG_REVISION=4
TERMUX_PKG_VERSION=${_TAG_VERSION}.${_TAG_REVISION}
TERMUX_PKG_SRCURL=(https://github.com/aosp-mirror/platform_build.git
                   https://github.com/aosp-mirror/platform_system_core.git
                   https://android.googlesource.com/platform/system/libbase
                   https://android.googlesource.com/platform/system/libziparchive)
TERMUX_PKG_GIT_BRANCH=android-${_TAG_VERSION}_r${_TAG_REVISION}
TERMUX_PKG_SHA256=(SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM)
TERMUX_PKG_SKIP_SRC_EXTRACT=true
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_DEPENDS="libc++, libzopfli, zlib, libandroid-tools-shared"

termux_step_post_get_source() {
	for i in $(seq 0 $(( ${#TERMUX_PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${TERMUX_PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_frameworks_//' -e 's/platform_//')

		git clone --depth 1 --single-branch \
			--branch $TERMUX_PKG_GIT_BRANCH \
			"$REPO_URL" "$CLONE_DIR"
	done

	# Get zopfli source (needed for headers)
	local ZOPFLI_VER=$(bash -c ". $TERMUX_SCRIPTDIR/packages/libzopfli/build.sh; echo \$TERMUX_PKG_VERSION")
	local ZOPFLI_SHA256=$(bash -c ". $TERMUX_SCRIPTDIR/packages/libzopfli/build.sh; echo \$TERMUX_PKG_SHA256")
	local ZOPFLI_TARFILE=$TERMUX_PKG_CACHEDIR/zopfli-${ZOPFLI_VER}.tar.gz
	termux_download \
		"https://github.com/google/zopfli/archive/zopfli-${ZOPFLI_VER}.tar.gz" \
		$ZOPFLI_TARFILE \
		$ZOPFLI_SHA256
	tar xf $ZOPFLI_TARFILE
	mv zopfli-zopfli-$ZOPFLI_VER zopfli
}

termux_step_pre_configure() {
	if $TERMUX_ON_DEVICE_BUILD; then
		termux_error_exit "Package '$TERMUX_PKG_NAME' is not safe for on-device builds."
	fi

	export PATH=$TERMUX_PKG_HOSTBUILD_DIR/_prefix/bin:$PATH

	CFLAGS+=" -fPIC"
	CXXFLAGS+=" -fPIC -std=c++17"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"

	_TMP_BINDIR=$TERMUX_PKG_SRCDIR/_bin
	rm -rf $_TMP_BINDIR
	mkdir -p $_TMP_BINDIR

	# The shared libraries are now in the sysroot via libandroid-tools-shared
	LDFLAGS+=" -llog -landroid-utils -landroid-ziparchive"
}

termux_step_make() {
	local LIBBASE_SRCDIR=$TERMUX_PKG_SRCDIR/libbase
	local CORE_INCDIR=$TERMUX_PKG_SRCDIR/core/include
	local LIBZIPARCHIVE_SRCDIR=$TERMUX_PKG_SRCDIR/libziparchive
	local ZIPALIGN_SRCDIR=$TERMUX_PKG_SRCDIR/build/tools/zipalign

	CPPFLAGS+=" -I. -I./include
		-I$LIBBASE_SRCDIR/include
		-I$CORE_INCDIR
		-I$LIBZIPARCHIVE_SRCDIR/include"

	# Build zipalign:
	cd $ZIPALIGN_SRCDIR
	for f in *.cpp; do
		$CXX $CXXFLAGS $CPPFLAGS -I$TERMUX_PKG_SRCDIR/zopfli/src $f -c
	done
	$CXX $CXXFLAGS *.o $LDFLAGS \
		-lzopfli \
		-lz \
		-o $_TMP_BINDIR/zipalign
}

termux_step_make_install() {
	install -Dm700 -t $TERMUX_PREFIX/bin \
		$_TMP_BINDIR/zipalign
}
