PKG_HOMEPAGE=https://github.com/SjnExe/RepoExe
PKG_DESCRIPTION="Opt-in package for the RepoExe dev component"
PKG_LICENSE="MIT"
PKG_MAINTAINER="@SjnExe"
PKG_VERSION=1.0.0
PKG_SKIP_SRC_EXTRACT=true
PKG_PLATFORM_INDEPENDENT=true

step_make_install() {
	mkdir -p "$PREFIX/etc/apt/sources.list.d"
	echo "deb [trusted=yes] https://SjnExe.github.io/RepoExe stable dev" > repoexe-dev.list
	install -Dm644 repoexe-dev.list "$PREFIX/etc/apt/sources.list.d/repoexe-dev.list"
}
