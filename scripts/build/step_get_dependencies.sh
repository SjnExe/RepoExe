step_get_dependencies() {
	[[ "$SKIP_DEPCHECK" == "true" || "$PKG_METAPACKAGE" == "true" ]] && return 0
	[[ "$INSTALL_DEPS" == "true" ]] && download_repo_file # Download repo files

	while read -r PKG PKG_DIR; do
		# Checking for duplicate dependencies
		local cyclic_dependence="false"
		if check_package_in_building_packages_list "$PKG_DIR"; then
			echo "A circular dependency was found on '$PKG', the old version of the package will be installed to resolve the conflict"
			cyclic_dependence="true"
			[[ "$INSTALL_DEPS" == "false" ]] && download_repo_file
		fi

		[[ -z "$PKG" ]] && continue
		[[ "$PKG" == "ERROR" ]] && error_exit "Obtaining buildorder failed"

		if [[ "$INSTALL_DEPS" == "true" || "$cyclic_dependence" = "true" ]]; then
			[[ "$PKG" == "ndk-sysroot" ]] && continue # llvm doesn't build if ndk-sysroot is installed:
			read -r DEP_ARCH DEP_VERSION DEP_VERSION_PAC DEP_ON_DEVICE_NOT_SUPPORTED < <(extract_dep_info "${PKG}" "${PKG_DIR}")
			local pkg_versioned="$PKG" build_dependency="false" force_build_dependency="$FORCE_BUILD_DEPENDENCIES"
			[[ "${WITHOUT_DEPVERSION_BINDING}" == "false" ]] && pkg_versioned+="@$DEP_VERSION"
			if [[ "$cyclic_dependence" == "false" ]]; then
				[[ "$QUIET_BUILD" != "true" ]] && echo "Downloading dependency $pkg_versioned if necessary..."
				if [[ "$FORCE_BUILD_DEPENDENCIES" == "true" && "$ON_DEVICE_BUILD" == "true" && "$DEP_ON_DEVICE_NOT_SUPPORTED" == "true" ]]; then
					echo "Building dependency $PKG on device is not supported. It will be downloaded..."
					force_build_dependency="false"
				fi
			else
				force_build_dependency="false"
			fi
			if [[ "$force_build_dependency" = "true" ]]; then
				force_check_package_dependency && continue || :
				[[ "$QUIET_BUILD" != "true" ]] && echo "Force building dependency $PKG instead of downloading due to -I flag..."
				build_dependency="true"
			else
				if repoexe_package__is_package_version_built "$PKG" "$DEP_VERSION"; then
					[[ "$QUIET_BUILD" != "true" ]] && echo "Skipping already built dependency $pkg_versioned"
					continue
				fi
				if ! WITHOUT_DEPVERSION_BINDING="$([[ "${cyclic_dependence}" == "true" ]] && echo "true" || echo "${WITHOUT_DEPVERSION_BINDING}")" download_deb_pac $PKG $DEP_ARCH $DEP_VERSION $DEP_VERSION_PAC; then
					[[ "$cyclic_dependence" == "true" || ( "$FORCE_BUILD_DEPENDENCIES" == "true" && "$ON_DEVICE_BUILD" == "true" ) ]] \
						&& error_exit "Download of $PKG$([[ "${WITHOUT_DEPVERSION_BINDING}" == "false" && "${cyclic_dependence}" == "false" ]] && echo "@$DEP_VERSION") from $REPO_URL failed"
					echo "Download of $pkg_versioned from $REPO_URL failed, building instead"
					build_dependency="true"
				fi
			fi
			if [[ "$cyclic_dependence" == "false" ]]; then
				if [[ "$build_dependency" == "true" ]]; then
					run_build-package
					continue
				fi
				add_package_to_built_packages_list "$PKG"
			fi
			if [[ "$ON_DEVICE_BUILD" == "false" ]]; then
				[[ "$QUIET_BUILD" != "true" ]] && echo "extracting $PKG to $COMMON_CACHEDIR-$DEP_ARCH..."
				(
					cd "$COMMON_CACHEDIR-$DEP_ARCH"
					if [[ "$REPO_PKG_FORMAT" == "debian" ]]; then
						# Ignore topdir `.`, to avoid possible  permission errors from tar
						ar p "${PKG}_${DEP_VERSION}_${DEP_ARCH}.deb" "data.tar.xz" | \
							tar xJ --no-overwrite-dir --transform='s#^.$#data#' -C /
					elif [[ "$REPO_PKG_FORMAT" == "pacman" ]]; then
						tar -xJf "${PKG}-${DEP_VERSION_PAC}-${DEP_ARCH}.pkg.tar.xz" \
							--anchored --exclude=.{BUILDINFO,PKGINFO,MTREE,INSTALL} \
							--force-local --no-overwrite-dir -C /
					fi
				)
			fi
			mkdir -p "$BUILT_PACKAGES_DIRECTORY"
			if [[ "$cyclic_dependence" == "false" && ( "$WITHOUT_DEPVERSION_BINDING" == "false" || "$ON_DEVICE_BUILD" == "false" ) ]]; then
				echo "$DEP_VERSION" > "$BUILT_PACKAGES_DIRECTORY/$PKG"
			fi
		else # Build dependencies
			# Built dependencies are put in the default OUTPUT_DIR instead of the specified one
			if [[ "$FORCE_BUILD_DEPENDENCIES" == "true" ]]; then
				[[ "$QUIET_BUILD" != "true" ]] && echo "Force building dependency $PKG..."
				read -r DEP_ARCH DEP_VERSION DEP_VERSION_PAC DEP_ON_DEVICE_NOT_SUPPORTED < <(extract_dep_info $PKG "${PKG_DIR}")
				[[ "$ON_DEVICE_BUILD" == "true" && "$DEP_ON_DEVICE_NOT_SUPPORTED" == "true" ]] \
					&& error_exit "Building $PKG on device is not supported. Consider passing -I flag to download it instead"
				force_check_package_dependency && continue
			else
				[[ "$QUIET_BUILD" != "true" ]] && echo "Building dependency $PKG if necessary..."
			fi
			run_build-package
		fi
	done < <(./scripts/bin/buildorder.py $([[ "${INSTALL_DEPS}" == "true" ]] && echo "-i") "$PKG_BUILDER_DIR" $PACKAGES_DIRECTORIES || echo "ERROR")
}

force_check_package_dependency() {
	if check_package_in_built_packages_list "$PKG" && repoexe_package__is_package_version_built "$PKG" "$DEP_VERSION"; then
		[[ "$QUIET_BUILD" != "true" ]] && echo "Skipping already built dependency $PKG$([[ "${WITHOUT_DEPVERSION_BINDING}" == "false" ]] && echo "@$DEP_VERSION")"
		return 0
	fi
	return 1
}

run_build-package() {
	local set_library
	if [[ "$GLOBAL_LIBRARY" = "true" ]]; then
		set_library="$PACKAGE_LIBRARY -L"
	else
		set_library="bionic"
		if repoexe_package__is_package_name_have_glibc_prefix "$PKG"; then
			set_library="glibc"
		fi
	fi
	BUILD_IGNORE_LOCK=true ./build-package.sh \
		$([[ "${INSTALL_DEPS}" == "true" ]] && echo "-I" || echo "-s") \
		$([[ "${FORCE_BUILD}" == "true" && "${FORCE_BUILD_DEPENDENCIES}" == "true" ]] && echo "-F") \
		$([[ "${PKGS__BUILD__RM_ALL_PKG_BUILD_DEPENDENT_DIRS}" == "true" ]] && echo "-r") \
		$([[ "${WITHOUT_DEPVERSION_BINDING}" = "true" ]] && echo "-w") \
			--format $PACKAGE_FORMAT --library $set_library "${PKG_DIR}"
}

download_repo_file() {
	get_repo_files

	# When doing build on device, ensure that apt lists are up-to-date.
	if [[ "$ON_DEVICE_BUILD" = "true" ]]; then
		case "$APP_PACKAGE_MANAGER" in
			"apt") apt update;;
			"pacman") pacman -Sy;;
		esac
	fi
}
