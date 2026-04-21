# shellcheck shell=bash
# This provides an utility function to setup iserv (external interpreter of ghc) to cross-compile haskell-template.
setup_ghc_iserv() {
	local ISERV_BIN="$COMMON_CACHEDIR/iserv-bin-$ARCH"
	local ISERV_BIN_NAME="RepoExe-ghc-iserv"

	setup_proot

	export PATH="$ISERV_BIN:$PATH"

	[[ -d "$ISERV_BIN" ]] && return

	mkdir -p "$ISERV_BIN"

	local ghc_bin_dir
	ghc_bin_dir="$(ghc --print-libdir)/../bin"

	cat <<-EOF >"$ISERV_BIN/$ISERV_BIN_NAME"
		#!/bin/bash
		RepoExe-proot-run $ghc_bin_dir/ghc-iserv "\$@"
	EOF

	cat <<-EOF >"$ISERV_BIN/${ISERV_BIN_NAME/iserv/iserv-dyn}"
		#!/bin/bash
		RepoExe-proot-run $ghc_bin_dir/ghc-iserv-dyn "\$@"
	EOF

	chmod +x "$ISERV_BIN/$ISERV_BIN_NAME"
	chmod +x "$ISERV_BIN/${ISERV_BIN_NAME/iserv/iserv-dyn}"
}
