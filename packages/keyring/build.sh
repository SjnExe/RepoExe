PKG_HOMEPAGE=https://repoexe.dev/
PKG_DESCRIPTION="repoexe keyring"
PKG_LICENSE="Apache-2.0"
PKG_MAINTAINER="@repoexe"
PKG_VERSION=3.9
PKG_SKIP_SRC_EXTRACT=true
PKG_PLATFORM_INDEPENDENT=true
PKG_ESSENTIAL=true

step_make_install() {
	install -Dm600 $PKG_BUILDER_DIR/grimler.gpg \
		$PREFIX/etc/apt/trusted.gpg.d/grimler.gpg
	install -Dm600 $PKG_BUILDER_DIR/repoexe.gpg \
		$PREFIX/etc/apt/trusted.gpg.d/repoexe.gpg
	install -Dm600 $PKG_BUILDER_DIR/repoexe-autobuilds.gpg \
		$PREFIX/etc/apt/trusted.gpg.d/repoexe-autobuilds.gpg
}
