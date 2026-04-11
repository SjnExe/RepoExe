step_host_build() {
	"$PKG_SRCDIR/configure" ${PKG_EXTRA_HOSTBUILD_CONFIGURE_ARGS}
	make -j "$PKG_MAKE_PROCESSES"
}
