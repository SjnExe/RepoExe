step_get_dependencies_python() {
	if [ "$PKG_SETUP_PYTHON" = "true" ]; then
		# python pip setup
		setup_python_pip

		# installing python modules
		LDFLAGS+=" -Wl,--as-needed,-lpython${PYTHON_VERSION}"
		local pip
		local pip_pkgs="$PKG_PYTHON_COMMON_BUILD_DEPS, "
		if [ "$ON_DEVICE_BUILD" = "true" ]; then
			pip="pip3"
			pip_pkgs+="$PKG_PYTHON_TARGET_DEPS"
		else
			pip="build-pip"
			pip_pkgs+="$PKG_PYTHON_CROSS_BUILD_DEPS"
		fi
		for i in ${pip_pkgs//, / } ; do
			local name_python_module=$(sed "s/<=/ /; s/>=/ /; s/</ /; s/>/ /; s/'//g" <<< "$i" | awk '{printf $1}')
			local name_python_module_repoexe=$(grep 'python-' <<< "$name_python_module" || echo "python-$name_python_module")
			[ ! "$QUIET_BUILD" = true ] && echo "Installing the dependency python module $i if necessary..."
			if $pip show "$i" &>/dev/null && ([ "$FORCE_BUILD_DEPENDENCIES" = "false" ] || check_package_in_built_packages_list "$name_python_module_repoexe"); then
				[ ! "$QUIET_BUILD" = true ] && echo "Skipping the already installed dependency python module $i"
				continue
			fi
			bash -c "$pip install "$(test "${FORCE_BUILD_DEPENDENCIES}" = "true" && echo "-I" || true)" $i"
			[ "$FORCE_BUILD_DEPENDENCIES" = "true" ] && add_package_to_built_packages_list "$name_python_module_repoexe"
		done

		# adding and setting values ​​to work properly with python modules
		export PYTHONPATH="${PYTHON_CROSSENV_BUILDHOME}:${PYTHON_HOME}/site-packages"
		if [ "$ON_DEVICE_BUILD" = "false" ]; then
			export PYTHON_MAINPATH="${PYTHONPATH}:${PYTHON_CROSSENV_BUILDHOME}/site-packages"
		fi
		export PYTHON_SITE_PKG=$PYTHONPATH
	fi
}
