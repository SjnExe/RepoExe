# Build once, deprecate upstream tracking
PKG_HOMEPAGE=https://elinux.org/Android_aapt
PKG_DESCRIPTION="Android Asset Packaging Tool"
PKG_LICENSE="Apache-2.0"
PKG_MAINTAINER="@SjnExe"
PKG_VERSION=1:0.2
PKG_SRCURL=(https://android.googlesource.com/platform/frameworks/base
                   https://android.googlesource.com/platform/system/core
                   https://android.googlesource.com/platform/system/libbase
                   https://android.googlesource.com/platform/system/libziparchive
                   https://android.googlesource.com/platform/system/logging
                   https://android.googlesource.com/platform/system/incremental_delivery)
PKG_GIT_BRANCH=main
PKG_SHA256=(SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM)
PKG_SKIP_SRC_EXTRACT=true
PKG_BUILD_IN_SRC=true
PKG_DEPENDS="libc++, libexpat, libpng, zlib, libbase, libandroidfw, libutils, libziparchive, libandroid-pathutils"
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
	CXXFLAGS+=" -fPIC -std=c++17 -Wno-nontrivial-memcall -Wno-vla-cxx-extension -Wno-deprecated-anon-enum-enum-conversion -Wno-reorder-init-list"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"
	CPPFLAGS+=" -I$PREFIX/include/android-tools"
	_TMP_BINDIR=$PKG_SRCDIR/_bin
	rm -rf $_TMP_BINDIR
	mkdir -p $_TMP_BINDIR
	LDFLAGS+=" -llog -landroid-base -landroid-fw -landroid-utils -landroid-ziparchive -landroid-pathutils"
}
step_make() {
	local LIBBASE_SRCDIR=$PKG_SRCDIR/libbase
	local CORE_INCDIR=$PKG_SRCDIR/core/include
	local LIBLOG_INCDIR=$PKG_SRCDIR/logging/liblog/include
	local LIBZIPARCHIVE_SRCDIR=$PKG_SRCDIR/libziparchive
	local INCFS_UTIL_SRCDIR=$PKG_SRCDIR/incremental_delivery/incfs/util
	local ANDROIDFW_SRCDIR=$PKG_SRCDIR/base/libs/androidfw
	local AAPT_SRCDIR=$PKG_SRCDIR/base/tools/aapt
	CPPFLAGS+=" -I. -I./include
		-I$LIBBASE_SRCDIR/include
		-I$LIBLOG_INCDIR
		-I$CORE_INCDIR
		-I$LIBZIPARCHIVE_SRCDIR/include
		-I$INCFS_UTIL_SRCDIR/include
		-I$ANDROIDFW_SRCDIR/include
		-I$ANDROIDFW_SRCDIR/include_pathutils"
	# Build aapt:
	cd $AAPT_SRCDIR
	for f in *.cpp; do
		$CXX $CXXFLAGS $CPPFLAGS $f -c
	done
	$CXX $CXXFLAGS *.o $LDFLAGS \
		-lexpat \
		-lpng \
		-lz \
		-o $_TMP_BINDIR/aapt
}
step_make_install() {
	install -Dm700 -t $PREFIX/bin \
		$_TMP_BINDIR/aapt
	# Create an android.jar with AndroidManifest.xml and resources.arsc:
	cd $PKG_TMPDIR
	rm -rf android-jar
	mkdir android-jar
	cd android-jar
	cp $ANDROID_HOME/platforms/android-35/android.jar .
	unzip -q android.jar
	mkdir -p $PREFIX/share/aapt
	jar cfM $PREFIX/share/aapt/android.jar AndroidManifest.xml resources.arsc
}
