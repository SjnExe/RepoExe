git_clone_src() {
	local TMP_CHECKOUT=$PKG_CACHEDIR/tmp-checkout
	local TMP_CHECKOUT_VERSION=$PKG_CACHEDIR/tmp-checkout-version
	local pkg_srcurl="${PKG_SRCURL:4}"
	local pkg_local_srcpath=""
	local pkg_branch_flags=""

	if [[ "$pkg_srcurl" =~ ^file://(/[^/]+)+$ ]]; then
		pkg_local_srcpath="${pkg_srcurl:7}" # Remove `file://` prefix

		if [ ! -d "$pkg_local_srcpath" ]; then
			echo "No source directory found at path of PKG_SRCURL '$PKG_SRCURL' of package '$PKG_NAME'"
			return 1
		elif [ ! -d "$pkg_local_srcpath/.git" ]; then
			echo "The source directory at path of PKG_SRCURL '$PKG_SRCURL' of package '$PKG_NAME' does not a contain a '.git' sub directory"
			return 1
		fi
	fi

	if [ ! -f $TMP_CHECKOUT_VERSION ] || [ "$(cat $TMP_CHECKOUT_VERSION)" != "$PKG_VERSION" ]; then
		if [[ -n "$pkg_local_srcpath" ]]; then
			if [ "$PKG_GIT_BRANCH" != "" ]; then
				# The local git repository that needs to be cloned may
				# not have a branch created that is tracking its remote
				# branch, so we create it if it doesn't exist without
				# checking it out, otherwise when we clone below,
				# git will fail to find the branch in its own origin
				# i.e the local git repository, as it will not look
				# into the origin of the local git repository recursively.
				(cd "$pkg_local_srcpath" && git fetch origin $PKG_GIT_BRANCH:$PKG_GIT_BRANCH)
				pkg_branch_flags="--branch $PKG_GIT_BRANCH"
			fi
		else
			if [ "$PKG_GIT_BRANCH" == "" ]; then
				pkg_branch_flags="--branch v${PKG_VERSION#*:}"
			else
				pkg_branch_flags="--branch $PKG_GIT_BRANCH"
			fi
		fi

		echo "Downloading git source $([[ "$pkg_branch_flags" != "" ]] && echo "with branch '${pkg_branch_flags:9}' ")from '$pkg_srcurl'"

		rm -rf "$TMP_CHECKOUT"
		git clone \
			--depth 1 \
			$pkg_branch_flags \
			"$pkg_srcurl" \
			"$TMP_CHECKOUT"

		pushd "$TMP_CHECKOUT"

		# Workaround some bad server behaviour
		# error: Server does not allow request for unadvertised object commit_no
		# fatal: Fetched in submodule 'submodule_path', but it did not contain commit_no. Direct fetching of that commit failed.
		if ! git submodule update --init --recursive --depth=1; then
			local depth=10
			local maxdepth=100
			sleep 1
			while :; do
				echo "WARN: Retrying with max depth $depth"
				if git submodule update --init --recursive --depth=$depth; then
					break
				fi
				if [[ "$depth" -gt "$maxdepth" ]]; then
					error_exit "Failed to clone submodule"
				fi
				depth=$((depth+10))
				sleep 1
			done
		fi

		popd

		echo "$PKG_VERSION" > "$TMP_CHECKOUT_VERSION"
	else
		echo "Skipped downloading of git source from '$pkg_srcurl'"
	fi

	rm -rf "$PKG_SRCDIR"
	cp -Rf "$TMP_CHECKOUT" "$PKG_SRCDIR"
}
