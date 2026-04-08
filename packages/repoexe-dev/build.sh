TERMUX_PKG_HOMEPAGE=https://github.com/SjnExe/RepoExe
TERMUX_PKG_DESCRIPTION="Opt-in package for the RepoExe dev component"
TERMUX_PKG_LICENSE="MIT"
TERMUX_PKG_MAINTAINER="@SjnExe"
TERMUX_PKG_VERSION=1.0.0
TERMUX_PKG_SKIP_SRC_EXTRACT=true
TERMUX_PKG_PLATFORM_INDEPENDENT=true

termux_step_make_install() {
	mkdir -p $TERMUX_PREFIX/etc/apt/sources.list.d
	echo "deb [trusted=yes] https://SjnExe.github.io/RepoExe stable dev" > repoexe-dev.list
	install -Dm600 repoexe-dev.list $TERMUX_PREFIX/etc/apt/sources.list.d/repoexe-dev.list
}
