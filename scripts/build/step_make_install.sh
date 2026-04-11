# shellcheck disable=SC2086
step_make_install() {
	[ "$PKG_METAPACKAGE" = "true" ] && return

	if test -f build.ninja; then
		ninja -j $PKG_MAKE_PROCESSES install
	elif test -f setup.py || test -f pyproject.toml || test -f setup.cfg; then
		pip install --no-deps . --prefix $PREFIX
	elif ls ./*.cabal &>/dev/null || ls ./cabal.project &>/dev/null; then
		# Workaround until `cabal install` is fixed.
		while read -r bin; do
			[[ -f "$bin" ]] || error_exit "'$bin', no such file. Has build completed?"
			echo "INFO: Installing '$bin' component..."
			cp "$bin" "$PREFIX/bin"
		done< <(cat ./dist-newstyle/cache/plan.json | jq -r '."install-plan"[]|select(."component-name"? and (."component-name"|test("exe:.*")) and (.style == "local") )|."bin-file"')
	elif ls ./*akefile &>/dev/null || [ -n "$PKG_EXTRA_MAKE_ARGS" ]; then
		: "${PKG_MAKE_INSTALL_TARGET:="install"}"
		# Some packages have problem with parallell install, and it does not buy much, so use -j 1.
		if [ -z "$PKG_EXTRA_MAKE_ARGS" ]; then
			make -j 1 ${PKG_MAKE_INSTALL_TARGET}
		else
			make -j 1 ${PKG_EXTRA_MAKE_ARGS} ${PKG_MAKE_INSTALL_TARGET}
		fi
	elif test -f Cargo.toml; then
		if [[ -z "$(command -v cargo)" ]]; then
			error_exit "cargo command is not found! Please add setup_rust in package's build.sh!"
		fi
		cargo install \
			--jobs $PKG_MAKE_PROCESSES \
			--path . \
			--force \
			--locked \
			--no-track \
			--target $CARGO_TARGET_NAME \
			--root $PREFIX \
			$PKG_EXTRA_CONFIGURE_ARGS
	fi
}

step_make_install_multilib() {
	step_make_install
}
