TERMUX_PKG_HOMEPAGE=https://example.com
TERMUX_PKG_DESCRIPTION="An example package demonstrating the RepoExe mixin structure"
TERMUX_PKG_LICENSE="MIT"
TERMUX_PKG_MAINTAINER="SjnExe"
TERMUX_PKG_VERSION="1.0.0"
TERMUX_PKG_SRCURL="https://example.com/source.tar.gz"
TERMUX_PKG_SHA256="dummy_hash_for_example"

# Source the Python mixin from the RepoExe root
source $REPO_ROOT/scripts/mixins/build-python.sh

# Utilize the mixin to setup dependencies
repoexe_setup_python_env

termux_step_make_install() {
    # Utilize the mixin for building
    repoexe_python_build
}
