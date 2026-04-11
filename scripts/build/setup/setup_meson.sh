setup_meson() {
	setup_ninja
	local MESON_VERSION=1.10.0
	local MESON_FOLDER

	if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
		MESON_FOLDER=${SCRIPTDIR}/build-tools/meson-${MESON_VERSION}
	else
		MESON_FOLDER=${COMMON_CACHEDIR}/meson-${MESON_VERSION}
	fi

	if [ ! -d "$MESON_FOLDER" ]; then
		local MESON_TAR_NAME=meson-$MESON_VERSION.tar.gz
		local MESON_TAR_FILE=$PKG_TMPDIR/$MESON_TAR_NAME
		local MESON_TMP_FOLDER=$PKG_TMPDIR/meson-$MESON_VERSION
		download \
			"https://github.com/mesonbuild/meson/releases/download/$MESON_VERSION/meson-$MESON_VERSION.tar.gz" \
			"$MESON_TAR_FILE" \
			8071860c1f46a75ea34801490fd1c445c9d75147a65508cd3a10366a7006cc1c
		tar xf "$MESON_TAR_FILE" -C "$PKG_TMPDIR"
		shopt -s nullglob
		local f
		for f in "$SCRIPTDIR"/scripts/build/setup/meson-*.patch; do
			echo "[${FUNCNAME[0]}]: Applying $(basename "$f")"
			patch --silent -p1 -d "$MESON_TMP_FOLDER" < "$f"
		done
		shopt -u nullglob
		mv "$MESON_TMP_FOLDER" "$MESON_FOLDER"
	fi
	MESON="${MESON_FOLDER}/meson.py"
	if [ "$ON_DEVICE_BUILD" = "false" ]; then
		MESON="/usr/bin/python3 ${MESON}"
	fi
	MESON_CROSSFILE=$PKG_TMPDIR/meson-crossfile-$ARCH.txt
	local MESON_CPU MESON_CPU_FAMILY
	if [ "$ARCH" = "arm" ]; then
		MESON_CPU_FAMILY="arm"
		MESON_CPU="armv7"
	elif [ "$ARCH" = "i686" ]; then
		MESON_CPU_FAMILY="x86"
		MESON_CPU="i686"
	elif [ "$ARCH" = "x86_64" ]; then
		MESON_CPU_FAMILY="x86_64"
		MESON_CPU="x86_64"
	elif [ "$ARCH" = "aarch64" ]; then
		MESON_CPU_FAMILY="aarch64"
		MESON_CPU="aarch64"
	else
		error_exit "Unsupported arch: $ARCH"
	fi

	echo "[binaries]" > $MESON_CROSSFILE
	echo "ar = '$AR'" >> $MESON_CROSSFILE
	echo "c = '$CC'" >> $MESON_CROSSFILE
	echo "cmake = 'cmake'" >> $MESON_CROSSFILE
	echo "cpp = '$CXX'" >> $MESON_CROSSFILE
	echo "ld = '$LD'" >> $MESON_CROSSFILE
	echo "pkg-config = '$PKG_CONFIG'" >> $MESON_CROSSFILE
	echo "strip = '$STRIP'" >> $MESON_CROSSFILE
	if [[ -n "$(command -v rustc)" && -n "${CARGO_TARGET_NAME-}" ]]; then
		echo "rust = ['rustc', '--target', '$CARGO_TARGET_NAME']" >> $MESON_CROSSFILE
	fi

	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		echo '' >> $MESON_CROSSFILE
		echo "[properties]" >> $MESON_CROSSFILE
		echo "needs_exe_wrapper = true" >> $MESON_CROSSFILE
	fi

	echo '' >> $MESON_CROSSFILE
	echo "[built-in options]" >> $MESON_CROSSFILE

	echo -n "c_args = [" >> $MESON_CROSSFILE
	local word first=true
	for word in $CFLAGS $CPPFLAGS; do
		if [ "$first" = "true" ]; then
			first=false
		else
			echo -n ", " >> $MESON_CROSSFILE
		fi
		echo -n "'$word'" >> $MESON_CROSSFILE
	done
	echo ']' >> $MESON_CROSSFILE

	echo -n "cpp_args = [" >> $MESON_CROSSFILE
	local word first=true
	for word in $CXXFLAGS $CPPFLAGS; do
		if [ "$first" = "true" ]; then
			first=false
		else
			echo -n ", " >> $MESON_CROSSFILE
		fi
		echo -n "'$word'" >> $MESON_CROSSFILE
	done
	echo ']' >> $MESON_CROSSFILE

	local property
	for property in c_link_args cpp_link_args fortran_link_args; do
		echo -n "$property = [" >> $MESON_CROSSFILE
		first=true
		for word in $LDFLAGS; do
			if [ "$first" = "true" ]; then
				first=false
			else
				echo -n ", " >> $MESON_CROSSFILE
			fi
			echo -n "'$word'" >> $MESON_CROSSFILE
		done
		echo ']' >> $MESON_CROSSFILE
	done

	echo '' >> $MESON_CROSSFILE
	echo "[host_machine]" >> $MESON_CROSSFILE
	echo "cpu_family = '$MESON_CPU_FAMILY'" >> $MESON_CROSSFILE
	echo "cpu = '$MESON_CPU'" >> $MESON_CROSSFILE
	echo "endian = 'little'" >> $MESON_CROSSFILE
	if [ "$PACKAGE_LIBRARY" = "bionic" ]; then
		echo "system = 'android'" >> $MESON_CROSSFILE
	elif [ "$PACKAGE_LIBRARY" = "glibc" ]; then
		echo "system = 'linux'" >> $MESON_CROSSFILE
	fi
}
