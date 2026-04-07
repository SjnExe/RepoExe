TERMUX_PKG_HOMEPAGE=https://developer.android.com/guide/components/aidl
TERMUX_PKG_DESCRIPTION="Android Interface Definition Language (AIDL)"
TERMUX_PKG_LICENSE="Apache-2.0"
TERMUX_PKG_MAINTAINER="@SjnExe"
_TAG_VERSION=16.0.0
_TAG_REVISION=4
TERMUX_PKG_VERSION=${_TAG_VERSION}.${_TAG_REVISION}
TERMUX_PKG_SRCURL=(https://android.googlesource.com/platform/system/tools/aidl
                   https://github.com/aosp-mirror/platform_system_core.git
                   https://android.googlesource.com/platform/system/libbase)
TERMUX_PKG_GIT_BRANCH=android-${_TAG_VERSION}_r${_TAG_REVISION}
TERMUX_PKG_SHA256=(SKIP_CHECKSUM
                   SKIP_CHECKSUM
                   SKIP_CHECKSUM)
TERMUX_PKG_SKIP_SRC_EXTRACT=true
TERMUX_PKG_BUILD_IN_SRC=true
TERMUX_PKG_DEPENDS="fmt, libc++, libandroid-tools-shared"
TERMUX_PKG_BUILD_DEPENDS="googletest"

termux_step_post_get_source() {
	rm -rf $TERMUX_PKG_BUILDER_DIR/../aapt

	for i in $(seq 0 $(( ${#TERMUX_PKG_SRCURL[@]}-1 ))); do
		local REPO_URL=${TERMUX_PKG_SRCURL[$i]}
		local CLONE_DIR=$(basename "$REPO_URL" .git | sed -e 's/platform_system_tools_//' -e 's/platform_system_//' -e 's/platform_//')

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
	CXXFLAGS+=" -fPIC -std=c++17"
	CPPFLAGS+=" -DNDEBUG -D__ANDROID_SDK_VERSION__=__ANDROID_API__"

	_TMP_BINDIR=$TERMUX_PKG_SRCDIR/_bin
	rm -rf $_TMP_BINDIR
	mkdir -p $_TMP_BINDIR

	LDFLAGS+=" -llog -landroid-base"
}

termux_step_make() {
	. $TERMUX_PKG_BUILDER_DIR/sources.sh

	local LIBBASE_SRCDIR=$TERMUX_PKG_SRCDIR/libbase
	local CORE_INCDIR=$TERMUX_PKG_SRCDIR/core/include
	local AIDL_SRCDIR=$TERMUX_PKG_SRCDIR/aidl

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

termux_step_make_install() {
	install -Dm700 -t $TERMUX_PREFIX/bin \
		$_TMP_BINDIR/aidl
}
