TERMUX_PKG_HOMEPAGE=https://elinux.org/Android_aapt
TERMUX_PKG_DESCRIPTION="Android Asset Packaging Tool 2"
TERMUX_PKG_LICENSE="Apache-2.0"
TERMUX_PKG_MAINTAINER="@SjnExe"
_VERSION=2.20
_TAG_VERSION=16.0.0
_TAG_REVISION=4
TERMUX_PKG_VERSION=1:${_VERSION}-${_TAG_VERSION}.${_TAG_REVISION}
TERMUX_PKG_SRCURL=(https://android.googlesource.com/platform/frameworks/base
                   https://android.googlesource.com/platform/system/core
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
TERMUX_PKG_DEPENDS="fmt, libc++, libexpat, libpng, libprotobuf, libzopfli, zlib, libandroid-tools-shared"
TERMUX_PKG_BUILD_DEPENDS="googletest"

termux_step_post_get_source() {
	for i in $(seq 0 $(( ${#TERMUX_PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${TERMUX_PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_frameworks_//' -e 's/platform_//')

		git clone --depth 1 --single-branch \
			--branch $TERMUX_PKG_GIT_BRANCH \
			"$REPO_URL" "$CLONE_DIR"
	done

	for f in base/tools/aapt2/*.proto; do
		sed -i 's:frameworks/base/tools/aapt2/::' $f
	done
}

termux_step_pre_configure() {
	if $TERMUX_ON_DEVICE_BUILD; then
		termux_error_exit "Package '$TERMUX_PKG_NAME' is not safe for on-device builds."
	fi

	termux_setup_protobuf

	export PATH=$TERMUX_PKG_HOSTBUILD_DIR/_prefix/bin:$PATH

	CFLAGS+=" -fPIC"
	CXXFLAGS+=" -fPIC -std=c++17 -Wno-nontrivial-memcall -Wno-vla-cxx-extension -Wno-deprecated-anon-enum-enum-conversion -Wno-reorder-init-list"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"
	CPPFLAGS+=" -DPROTOBUF_USE_DLLS"
	CPPFLAGS+=" -I$TERMUX_PREFIX/include"

	_TMP_BINDIR=$TERMUX_PKG_SRCDIR/_bin
	rm -rf $_TMP_BINDIR
	mkdir -p $_TMP_BINDIR

	# The shared libraries are now in the sysroot via libandroid-tools-shared
	LDFLAGS+=" -llog -landroid-base -landroid-fw -landroid-utils -landroid-ziparchive -landroid-pathutils"
}

termux_step_make() {
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
	local LIBIDMAP2_POLICIES_INCDIR=$TERMUX_PKG_SRCDIR/base/cmds/idmap2/libidmap2_policies/include
	local AAPT2_SRCDIR=$TERMUX_PKG_SRCDIR/base/tools/aapt2

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
		$($TERMUX_SCRIPTDIR/packages/libprotobuf/interface_link_libraries.sh) \
		-o $_TMP_BINDIR/aapt2
}

termux_step_make_install() {
	install -Dm700 -t $TERMUX_PREFIX/bin \
		$_TMP_BINDIR/aapt2

	# Create an android.jar with AndroidManifest.xml and resources.arsc:
	cd $TERMUX_PKG_TMPDIR
	rm -rf android-jar
	mkdir android-jar
	cd android-jar
	cp $ANDROID_HOME/platforms/android-35/android.jar .
	unzip -q android.jar
	mkdir -p $TERMUX_PREFIX/share/aapt
	jar cfM $TERMUX_PREFIX/share/aapt/android.jar AndroidManifest.xml resources.arsc
}
