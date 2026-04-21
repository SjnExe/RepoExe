# This script setups host python and crossenv for cross-compilation of python
# packages. Requires python package to be built before this script is called.
#
# It is highly recommended checking out documentation of
# setup_build_python before using this script
setup_python_pip() {
	setup_build_python
	if [ "$ON_DEVICE_BUILD" = "true" ]; then
		if [[ "$APP_PACKAGE_MANAGER" = "apt" && "$(dpkg-query -W -f '${db:Status-Status}\n' python-pip 2>/dev/null)" != "installed" ]] ||
		[[ "$APP_PACKAGE_MANAGER" = "pacman" && ! "$(pacman -Q python-pip 2>/dev/null)" ]]; then
			echo "Package 'python-pip' is not installed."
			echo "You can install it with"
			echo
			echo "  pkg install python-pip"
			echo
			echo "  pacman -S python-pip"
			echo
			echo "Note that package 'python-pip' is known to be problematic for building on device."
			exit 1
		fi

		# Setup a virtual environment and do not mess the system site-packages
		local _VENV_DIR="${PKG_TMPDIR}/venv-dir"

		mkdir -p "$_VENV_DIR"
		python${PYTHON_VERSION} -m venv --system-site-packages "$_VENV_DIR"
		. "$_VENV_DIR/bin/activate"

		pip install 'setuptools==80.9.0' 'wheel==0.46.1'
	else
		local _CROSSENV_VERSION=1.6.1
		local _CROSSENV_TAR=crossenv-$_CROSSENV_VERSION.tar.gz
		local _CROSSENV_FOLDER

		if [ "${PACKAGES_OFFLINE-false}" = "true" ]; then
			_CROSSENV_FOLDER=${SCRIPTDIR}/build-tools/crossenv-${_CROSSENV_VERSION}
		else
			_CROSSENV_FOLDER=${COMMON_CACHEDIR}/crossenv-${_CROSSENV_VERSION}
		fi
		export PYTHON_CROSSENV_SRCDIR=$_CROSSENV_FOLDER

		if [ ! -d "$_CROSSENV_FOLDER" ]; then
			download \
				https://github.com/benfogle/crossenv/archive/refs/tags/v$_CROSSENV_VERSION.tar.gz \
				$PKG_TMPDIR/$_CROSSENV_TAR \
				f85bfbfbfea3567427daa56693c28c75e69fb6ae78c508565f7ae54a26fe407d

			rm -Rf "$PKG_TMPDIR/crossenv-$_CROSSENV_VERSION"
			tar xf $PKG_TMPDIR/$_CROSSENV_TAR -C $PKG_TMPDIR
			mv "$PKG_TMPDIR/crossenv-$_CROSSENV_VERSION" \
				$_CROSSENV_FOLDER
			shopt -s nullglob
			local f
			for f in "$SCRIPTDIR"/scripts/build/setup/python-crossenv-*.patch; do
				echo "[${FUNCNAME[0]}]: Applying $(basename "$f")"
				cat "$f" | sed -e "s|@@PKG_API_LEVEL@@|${PKG_API_LEVEL}|g" | patch --silent -p1 -d "$_CROSSENV_FOLDER"
			done
			shopt -u nullglob
		fi

		if [ ! -d "$PYTHON_CROSSENV_PREFIX" ]; then
			cd "$PYTHON_CROSSENV_SRCDIR"
			"$BUILD_PYTHON_DIR/host-build-prefix/bin/python${PYTHON_VERSION}" -m crossenv \
				"$PREFIX/bin/python${PYTHON_VERSION}" \
				"${PYTHON_CROSSENV_PREFIX}"
		fi
		. "${PYTHON_CROSSENV_PREFIX}/bin/activate"

		# Since 3.12, distutils is removed from python, but setuptools>=60 provides it
		# Since wheel 0.46, setuptools>=70 is required to provide bdist_wheel
		build-pip install 'setuptools==80.9.0' 'wheel==0.46.1'
		cross-pip install 'setuptools==80.9.0' 'wheel==0.46.1'

		export PATH="${PYTHON_CROSSENV_PREFIX}/build/bin:${PATH}"
		local _CROSS_PATH="${PYTHON_CROSSENV_PREFIX}/cross/bin"
		export PATH="${_CROSS_PATH}:$(echo -n $(tr ':' '\n' <<< "${PATH}" | grep -v "^${_CROSS_PATH}$") | tr ' ' ':')"

		local sysconfig_module=$(${PYTHON_CROSSENV_PREFIX}/build/bin/python -c "import sysconfig; print(sysconfig.__file__)")
		if [[ ! -f "${PYTHON_CROSSENV_BUILDHOME}/${sysconfig_module##*/}" ]]; then
			cp -r "${sysconfig_module}" "${PYTHON_CROSSENV_BUILDHOME}"
			sed -i "s|os.path.normpath(sys.*prefix)|\"${PREFIX}\"|g" "${PYTHON_CROSSENV_BUILDHOME}/${sysconfig_module##*/}"
		fi
	fi
}
