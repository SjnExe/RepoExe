TERMUX_PKG_HOMEPAGE=https://android.googlesource.com/platform/system/core
TERMUX_PKG_DESCRIPTION="Shared libraries for Android tools (aapt2, zipalign, aidl)"
TERMUX_PKG_LICENSE="Apache-2.0"
TERMUX_PKG_MAINTAINER="@SjnExe"
_TAG_VERSION=16.0.0
_TAG_REVISION=4
TERMUX_PKG_VERSION=${_TAG_VERSION}.${_TAG_REVISION}
TERMUX_PKG_SRCURL=(https://github.com/aosp-mirror/platform_frameworks_base.git
                   https://github.com/aosp-mirror/platform_system_core.git
                   https://android.googlesource.com/platform/system/libbase
                   https://android.googlesource.com/platform/system/libziparchive
                   https://android.googlesource.com/platform/system/logging
                   https://android.googlesource.com/platform/system/incremental_delivery)
TERMUX_PKG_GIT_BRANCH=android-${_TAG_VERSION}_r${_TAG_REVISION}
TERMUX_PKG_SHA256=(SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM)
TERMUX_PKG_SKIP_SRC_EXTRACT=true
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_DEPENDS="fmt, libc++, libexpat, libpng, libzopfli, zlib"

termux_step_post_get_source() {
	rm -rf $TERMUX_PKG_BUILDER_DIR/../aapt

	for i in $(seq 0 $(( ${#TERMUX_PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${TERMUX_PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_frameworks_//' -e 's/platform_//')

		if ! git clone --depth 1 --single-branch \
			--branch $TERMUX_PKG_GIT_BRANCH \
			"$REPO_URL" "$CLONE_DIR"; then
			echo "Clone failed. Attempting fallback..."
			if [[ "$REPO_URL" == https://github.com/aosp-mirror/* ]]; then
				local REPO_NAME=$(basename "$REPO_URL" .git)
				local AOSP_PATH=$(echo "$REPO_NAME" | sed 's/_/\//g')
				local FALLBACK_URL="https://android.googlesource.com/$AOSP_PATH"
				echo "Trying fallback URL: $FALLBACK_URL"
				git clone --depth 1 --single-branch \
					--branch "$TERMUX_PKG_GIT_BRANCH" \
					"$FALLBACK_URL" "$CLONE_DIR"
			else
				exit 1
			fi
		fi
	done
}

termux_step_pre_configure() {
	if $TERMUX_ON_DEVICE_BUILD; then
		termux_error_exit "Package '$TERMUX_PKG_NAME' is not safe for on-device builds."
	fi

	export PATH=$TERMUX_PKG_HOSTBUILD_DIR/_prefix/bin:$PATH

	CFLAGS+=" -fPIC"
	CXXFLAGS+=" -fPIC -std=c++20"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"

	_TMP_LIBDIR=$TERMUX_PKG_SRCDIR/_lib
	rm -rf $_TMP_LIBDIR
	mkdir -p $_TMP_LIBDIR

	LDFLAGS+=" -llog -L$_TMP_LIBDIR"
}

termux_step_make() {
	# Note: Need sources.sh for list of files, I will fetch it or create it
	. $TERMUX_PKG_BUILDER_DIR/sources.sh

	local CORE_INCDIR=$TERMUX_PKG_SRCDIR/core/include
	local LIBLOG_INCDIR=$TERMUX_PKG_SRCDIR/logging/liblog/include
	local LIBBASE_SRCDIR=$TERMUX_PKG_SRCDIR/libbase
	local LIBCUTILS_SRCDIR=$TERMUX_PKG_SRCDIR/core/libcutils
	local LIBUTILS_SRCDIR=$TERMUX_PKG_SRCDIR/core/libutils
	local INCFS_SUPPORT_INCDIR=$TERMUX_PKG_SRCDIR/libziparchive/incfs_support/include
	local LIBZIPARCHIVE_SRCDIR=$TERMUX_PKG_SRCDIR/libziparchive
	local INCFS_UTIL_SRCDIR=$TERMUX_PKG_SRCDIR/incremental_delivery/incfs/util
	local ANDROIDFW_SRCDIR=$TERMUX_PKG_SRCDIR/base/libs/androidfw

	CPPFLAGS+=" -I. -I./include
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
}

termux_step_make_install() {
	install -Dm600 -t $TERMUX_PREFIX/lib \
		$_TMP_LIBDIR/libandroid-{cutils,utils,base,ziparchive,fw}.so
}
