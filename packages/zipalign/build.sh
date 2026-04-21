# Requires manual patch/revision alignment. Excluded from auto-updates.
PKG_HOMEPAGE=https://developer.android.com/studio/command-line/zipalign
PKG_DESCRIPTION="Zip archive alignment tool"
PKG_LICENSE="Apache-2.0"
PKG_MAINTAINER="@SjnExe"
_TAG_VERSION=16.0.0
_TAG_REVISION=4
PKG_VERSION=${_TAG_VERSION}.${_TAG_REVISION}
PKG_SRCURL=(https://android.googlesource.com/platform/build
                   https://android.googlesource.com/platform/system/core
                   https://android.googlesource.com/platform/system/libbase
                   https://android.googlesource.com/platform/system/libziparchive)
PKG_GIT_BRANCH=android-${_TAG_VERSION}_r${_TAG_REVISION}
PKG_SHA256=(SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM)
PKG_SKIP_SRC_EXTRACT=true
PKG_BUILD_IN_SRC=true
PKG_DEPENDS="fmt, libc++, libzopfli, zlib, libbase, libutils, libziparchive"
PKG_BUILD_DEPENDS="fmt"

step_post_get_source() {
	for i in $(seq 0 $(( ${#PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_frameworks_//' -e 's/platform_//')

		git clone --depth 1 --single-branch \
			--branch $PKG_GIT_BRANCH \
			"$REPO_URL" "$CLONE_DIR"
	done

	# Get zopfli source (needed for headers)
	local ZOPFLI_VER=$(bash -c ". $REPOEXE_SCRIPTDIR/packages/libzopfli/build.sh; echo \$PKG_VERSION")
	local ZOPFLI_SHA256=$(bash -c ". $REPOEXE_SCRIPTDIR/packages/libzopfli/build.sh; echo \$PKG_SHA256")
	local ZOPFLI_TARFILE=$PKG_CACHEDIR/zopfli-${ZOPFLI_VER}.tar.gz
	termux_download \
		"https://github.com/google/zopfli/archive/zopfli-${ZOPFLI_VER}.tar.gz" \
		$ZOPFLI_TARFILE \
		$ZOPFLI_SHA256
	tar xf $ZOPFLI_TARFILE
	mv zopfli-zopfli-$ZOPFLI_VER zopfli
}

step_pre_configure() {
	if $ON_DEVICE_BUILD; then
		error_exit "Package '$PKG_NAME' is not safe for on-device builds."
	fi

	export PATH=$PKG_HOSTBUILD_DIR/_prefix/bin:$PATH

	CFLAGS+=" -fPIC"
	CXXFLAGS+=" -fPIC -std=c++17"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"

	_TMP_BINDIR=$PKG_SRCDIR/_bin
	rm -rf $_TMP_BINDIR
	mkdir -p $_TMP_BINDIR

	# The shared libraries are now in the sysroot via libbase, libutils, libziparchive
	LDFLAGS+=" -llog -landroid-utils -landroid-ziparchive -landroid-base -L$PREFIX__LIB_DIR -lfmt"
}

step_make() {
	local LIBBASE_SRCDIR=$PKG_SRCDIR/libbase
	local CORE_INCDIR=$PKG_SRCDIR/core/include
	local LIBZIPARCHIVE_SRCDIR=$PKG_SRCDIR/libziparchive
	local ZIPALIGN_SRCDIR=$PKG_SRCDIR/build/tools/zipalign

	CPPFLAGS+=" -I. -I./include
		-I$LIBBASE_SRCDIR/include
		-I$CORE_INCDIR
		-I$LIBZIPARCHIVE_SRCDIR/include"

	# Build zipalign:
	cd $ZIPALIGN_SRCDIR
	for f in *.cpp; do
		$CXX $CXXFLAGS $CPPFLAGS -I$PKG_SRCDIR/zopfli/src $f -c
	done
	$CXX $CXXFLAGS *.o $LDFLAGS \
		-lzopfli \
		-lz \
		-o $_TMP_BINDIR/zipalign
}

step_make_install() {
	install -Dm700 -t $PREFIX/bin \
		$_TMP_BINDIR/zipalign
}
