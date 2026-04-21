# Requires manual patch/revision alignment. Excluded from auto-updates.
PKG_HOMEPAGE=https://developer.android.com/guide/components/aidl
PKG_DESCRIPTION="Android Interface Definition Language (AIDL)"
PKG_LICENSE="Apache-2.0"
PKG_MAINTAINER="@SjnExe"
_TAG_VERSION=16.0.0
_TAG_REVISION=4
PKG_VERSION=${_TAG_VERSION}.${_TAG_REVISION}
PKG_SRCURL=(https://android.googlesource.com/platform/system/tools/aidl
                   https://android.googlesource.com/platform/system/core
                   https://android.googlesource.com/platform/system/libbase)
PKG_GIT_BRANCH=android-${_TAG_VERSION}_r${_TAG_REVISION}
PKG_SHA256=(SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM)
PKG_SKIP_SRC_EXTRACT=true
PKG_BUILD_IN_SRC=true
PKG_DEPENDS="fmt, libc++, libbase"
PKG_BUILD_DEPENDS="fmt"
PKG_BUILD_DEPENDS="fmt, googletest"

step_post_get_source() {
	for i in $(seq 0 $(( ${#PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_//')

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
	CXXFLAGS+=" -fPIC -std=c++17"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"

	_TMP_BINDIR=$PKG_SRCDIR/_bin
	rm -rf $_TMP_BINDIR
	mkdir -p $_TMP_BINDIR

	LDFLAGS+=" -L$PREFIX/lib -llog -landroid-base -lfmt"
}

step_make() {
	. $PKG_BUILDER_DIR/sources.sh

	local LIBBASE_SRCDIR=$PKG_SRCDIR/libbase
	local CORE_INCDIR=$PKG_SRCDIR/core/include
	local AIDL_SRCDIR=$PKG_SRCDIR/aidl

	CPPFLAGS+=" -I. -I./include
		-I$LIBBASE_SRCDIR/include
		-I$CORE_INCDIR"

	# Build aidl:
	cd $AIDL_SRCDIR
	flex aidl_language_l.ll
	bison --header=aidl_language_y.h aidl_language_y.yy
	cat >> aidl_language_y.h <<-EOF
		typedef union yy::parser::value_type YYSTYPE;
		typedef yy::parser::location_type YYLTYPE;
	EOF
	for f in $aidl_sources; do
		$CXX $CXXFLAGS $CPPFLAGS $f -c
	done
	$CXX $CXXFLAGS *.o $LDFLAGS \
		-lfmt \
		-lgtest \
		-o $_TMP_BINDIR/aidl
}

step_make_install() {
	install -Dm700 -t $PREFIX/bin \
		$_TMP_BINDIR/aidl
}
