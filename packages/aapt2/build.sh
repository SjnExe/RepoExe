PKG_HOMEPAGE=https://elinux.org/Android_aapt
PKG_DESCRIPTION="Android Asset Packaging Tool 2"
PKG_LICENSE="Apache-2.0"
PKG_MAINTAINER="@SjnExe"
_VERSION=2.20
_TAG_VERSION=16.0.0
_TAG_REVISION=4
PKG_VERSION=1:${_VERSION}-${_TAG_VERSION}.${_TAG_REVISION}
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
PKG_DEPENDS="fmt, libc++, libexpat, libpng, libprotobuf, libzopfli, zlib, libandroid-tools-shared"
PKG_BUILD_DEPENDS="googletest"

step_post_get_source() {
	for i in $(seq 0 $(( ${#PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_frameworks_//' -e 's/platform_//')

		git clone --depth 1 --single-branch \
			--branch $PKG_GIT_BRANCH \
			"$REPO_URL" "$CLONE_DIR"
	done

	for f in base/tools/aapt2/*.proto; do
		sed -i 's:frameworks/base/tools/aapt2/::' $f
	done
}

step_pre_configure() {
	if $ON_DEVICE_BUILD; then
		error_exit "Package '$PKG_NAME' is not safe for on-device builds."
	fi

	setup_protobuf

	export PATH=$PKG_HOSTBUILD_DIR/_prefix/bin:$PATH

	CFLAGS+=" -fPIC"
	CXXFLAGS+=" -fPIC -std=c++17 -Wno-nontrivial-memcall -Wno-vla-cxx-extension -Wno-deprecated-anon-enum-enum-conversion -Wno-reorder-init-list"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"
	CPPFLAGS+=" -DPROTOBUF_USE_DLLS"
	CPPFLAGS+=" -I$PREFIX/include"

	_TMP_BINDIR=$PKG_SRCDIR/_bin
	rm -rf $_TMP_BINDIR
	mkdir -p $_TMP_BINDIR

	# The shared libraries are now in the sysroot via libandroid-tools-shared
	LDFLAGS+=" -llog -landroid-base -landroid-fw -landroid-utils -landroid-ziparchive -landroid-pathutils"
}

step_make() {
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
	local LIBIDMAP2_POLICIES_INCDIR=$PKG_SRCDIR/base/cmds/idmap2/libidmap2_policies/include
	local AAPT2_SRCDIR=$PKG_SRCDIR/base/tools/aapt2

	CPPFLAGS+=" -I. -I./include
		-I$LIBBASE_SRCDIR/include
		-I$LIBLOG_INCDIR
		-I$CORE_INCDIR
		-I$LIBZIPARCHIVE_SRCDIR/include
		-I$INCFS_UTIL_SRCDIR/include
		-I$ANDROIDFW_SRCDIR/include
		-I$ANDROIDFW_SRCDIR/include_pathutils"

	# Build aapt2:
	cd $AAPT2_SRCDIR
	for f in $libaapt2_proto; do
		protoc --cpp_out=. $f
	done
	for f in $aapt2_sources; do
		$CXX $CXXFLAGS $CPPFLAGS -I$LIBIDMAP2_POLICIES_INCDIR \
			$f -c -o ${f%.*}.o
	done
	$CXX $CXXFLAGS $(find . -name '*.o') $LDFLAGS \
		-lexpat \
		-lpng \
		-lprotobuf \
		$($SCRIPTDIR/packages/libprotobuf/interface_link_libraries.sh) \
		-o $_TMP_BINDIR/aapt2
}

step_make_install() {
	install -Dm700 -t $PREFIX/bin \
		$_TMP_BINDIR/aapt2

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
