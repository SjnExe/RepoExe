TERMUX_PKG_HOMEPAGE=https://termux.dev/
TERMUX_PKG_DESCRIPTION="Termux keyring"
TERMUX_PKG_LICENSE="Apache-2.0"
TERMUX_PKG_MAINTAINER="@termux"
TERMUX_PKG_VERSION=3.9
TERMUX_PKG_SKIP_SRC_EXTRACT=true
TERMUX_PKG_PLATFORM_INDEPENDENT=true
TERMUX_PKG_ESSENTIAL=true

termux_step_make_install() {
	install -Dm600 $TERMUX_PKG_BUILDER_DIR/grimler.gpg \
		$TERMUX_PREFIX/etc/apt/trusted.gpg.d/grimler.gpg
	install -Dm600 $TERMUX_PKG_BUILDER_DIR/termux.gpg \
		$TERMUX_PREFIX/etc/apt/trusted.gpg.d/termux.gpg
	install -Dm600 $TERMUX_PKG_BUILDER_DIR/termux-autobuilds.gpg \
		$TERMUX_PREFIX/etc/apt/trusted.gpg.d/termux-autobuilds.gpg
}
