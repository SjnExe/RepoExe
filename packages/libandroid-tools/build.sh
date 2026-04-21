PKG_HOMEPAGE=https://android.googlesource.com/platform/system/core
PKG_DESCRIPTION="Shared libraries for Android tools (aapt2, zipalign, aidl)"
PKG_LICENSE="Apache-2.0"
PKG_MAINTAINER="@SjnExe"
_TAG_VERSION=16.0.0
_TAG_REVISION=4
PKG_VERSION=${_TAG_VERSION}.${_TAG_REVISION}
PKG_SRCURL=(https://android.googlesource.com/platform/frameworks/base
                   https://android.googlesource.com/platform/system/core
                   https://android.googlesource.com/platform/system/libbase
                   https://android.googlesource.com/platform/system/libziparchive
                   https://android.googlesource.com/platform/system/logging
                   https://android.googlesource.com/platform/system/incremental_delivery)
PKG_GIT_BRANCH=android-${_TAG_VERSION}_r${_TAG_REVISION}
PKG_SHA256=(SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM)
PKG_SKIP_SRC_EXTRACT=true
PKG_BUILD_IN_SRC=true
PKG_DEPENDS="fmt, libc++, libexpat, libpng, libzopfli, zlib"
PKG_BUILD_DEPENDS="fmt"

step_post_get_source() {
	for i in $(seq 0 $(( ${#PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_frameworks_//' -e 's/platform_//')

		git clone --depth 1 --single-branch \
			--branch $PKG_GIT_BRANCH \
			"$REPO_URL" "$CLONE_DIR"
	done
}

step_pre_configure() {
	if $ON_DEVICE_BUILD; then
		error_exit "Package '$PKG_NAME' is not safe for on-device builds."
	fi

	export PATH=$PKG_HOSTBUILD_DIR/_prefix/bin:$PATH

	CFLAGS+=" -fPIC"
	CXXFLAGS+=" -Wno-c99-designator  -fPIC -std=c++20"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"

	_TMP_LIBDIR=$PKG_SRCDIR/_lib
	rm -rf $_TMP_LIBDIR
	mkdir -p $_TMP_LIBDIR

	LDFLAGS+=" -L$PREFIX/lib -llog -L$_TMP_LIBDIR"
}

step_make() {
	# Note: Need sources.sh for list of files, I will fetch it or create it
	. $PKG_BUILDER_DIR/sources.sh

	local CORE_INCDIR=$PKG_SRCDIR/core/include
	local LIBLOG_INCDIR=$PKG_SRCDIR/logging/liblog/include
	local LIBBASE_SRCDIR=$PKG_SRCDIR/libbase
	local LIBCUTILS_SRCDIR=$PKG_SRCDIR/core/libcutils
	local LIBUTILS_SRCDIR=$PKG_SRCDIR/core/libutils
	local INCFS_SUPPORT_INCDIR=$PKG_SRCDIR/libziparchive/incfs_support/include
	local LIBZIPARCHIVE_SRCDIR=$PKG_SRCDIR/libziparchive
	local INCFS_UTIL_SRCDIR=$PKG_SRCDIR/incremental_delivery/incfs/util
	local ANDROIDFW_SRCDIR=$PKG_SRCDIR/base/libs/androidfw

	CPPFLAGS+=" -I. -I./include
		-I$PKG_BUILDER_DIR/include
		-I$LIBBASE_SRCDIR/include
		-I$LIBLOG_INCDIR
		-I$CORE_INCDIR"

	# Build libbase:
	cd $LIBBASE_SRCDIR
	for f in $libbase_sources; do
		$CXX $CXXFLAGS $CPPFLAGS $f -c
	done
	$CXX $CXXFLAGS *.o -shared $LDFLAGS \
		-lfmt \
		-o $_TMP_LIBDIR/libandroid-base.so

	# Build libcutils:
	cd $LIBCUTILS_SRCDIR
	for f in $libcutils_sources; do
		$CXX $CXXFLAGS $CPPFLAGS $f -c
	done
	$CXX $CXXFLAGS *.o -shared $LDFLAGS \
		-landroid-base \
		-o $_TMP_LIBDIR/libandroid-cutils.so

	# Build libutils:
	cd $LIBUTILS_SRCDIR
	for f in $libutils_sources; do
		$CXX $CXXFLAGS $CPPFLAGS $f -c
	done
	$CXX $CXXFLAGS *.o -shared $LDFLAGS \
		-landroid-base \
		-landroid-cutils \
		-o $_TMP_LIBDIR/libandroid-utils.so

	# Build libziparchive:
	cd $LIBZIPARCHIVE_SRCDIR
	for f in $libziparchive_sources; do
		$CXX $CXXFLAGS $CPPFLAGS -I$INCFS_SUPPORT_INCDIR $f -c
	done
	$CXX $CXXFLAGS *.o -shared $LDFLAGS \
		-landroid-base \
		-lz \
		-o $_TMP_LIBDIR/libandroid-ziparchive.so

	CPPFLAGS+=" -I$LIBZIPARCHIVE_SRCDIR/include"
	CPPFLAGS+=" -I$INCFS_UTIL_SRCDIR/include"
	CPPFLAGS+=" -I$ANDROIDFW_SRCDIR/include_pathutils"

	# Build libandroidfw:
	cd $ANDROIDFW_SRCDIR
	for f in $androidfw_sources $INCFS_UTIL_SRCDIR/map_ptr.cpp; do
		$CXX $CXXFLAGS $CPPFLAGS $f -c
	done
	$CXX $CXXFLAGS *.o -shared $LDFLAGS \
		-landroid-base \
		-landroid-cutils \
		-landroid-utils \
		-landroid-ziparchive \
		-lz \
		-o $_TMP_LIBDIR/libandroid-fw.so

	# Build libandroid-pathutils:
	cd $ANDROIDFW_SRCDIR
	for f in PathUtils.cpp; do
		$CXX $CXXFLAGS $CPPFLAGS $f -c
	done
	$CXX $CXXFLAGS PathUtils.o -shared $LDFLAGS \
		-landroid-base \
		-landroid-cutils \
		-landroid-utils \
		-landroid-ziparchive \
		-landroid-fw \
		-lz \
		-o $_TMP_LIBDIR/libandroid-pathutils.so
}

step_make_install() {
	install -Dm644 -t $PREFIX/lib \
		$_TMP_LIBDIR/libandroid-{cutils,utils,base,ziparchive,fw,pathutils}.so

	# Install headers to the prefix so other tools like aapt2 can find them
	mkdir -p $PREFIX/include/android-tools
	cp -r $PKG_SRCDIR/core/include/* $PREFIX/include/android-tools/
	cp -r $PKG_SRCDIR/logging/liblog/include/* $PREFIX/include/android-tools/
	cp -r $PKG_SRCDIR/libbase/include/* $PREFIX/include/android-tools/
	cp -r $PKG_SRCDIR/libziparchive/incfs_support/include/* $PREFIX/include/android-tools/
	cp -r $PKG_SRCDIR/libziparchive/include/* $PREFIX/include/android-tools/
	cp -r $PKG_SRCDIR/incremental_delivery/incfs/util/include/* $PREFIX/include/android-tools/
	cp -r $PKG_SRCDIR/base/libs/androidfw/include/* $PREFIX/include/android-tools/
	cp -r $PKG_SRCDIR/base/libs/androidfw/include_pathutils/* $PREFIX/include/android-tools/
}
