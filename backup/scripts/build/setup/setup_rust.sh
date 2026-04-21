# shellcheck shell=bash disable=SC1091 disable=SC2086 disable=SC2155
setup_rust() {
	if [[ "${ON_DEVICE_BUILD}" == "true" ]]; then
		if [[ -z "$(command -v rustc)" ]]; then
			cat <<- EOL
			Package 'rust' is not installed.
			You can install it with

			pkg install rust

			pacman -S rust
			EOL
			exit 1
		fi
		local RUSTC_VERSION=$(rustc --version | awk '{ print $2 }')
		if [[ -n "${RUST_VERSION-}" && "${RUST_VERSION-}" != "${RUSTC_VERSION}" ]]; then
			cat <<- EOL >&2
			WARN: On device build with old rust version is not possible!
			RUST_VERSION = ${RUST_VERSION}
			RUSTC_VERSION       = ${RUSTC_VERSION}
			EOL
		fi
		return
	fi

	if [[ -z "${RUST_VERSION-}" ]]; then
		RUST_VERSION=$(. "${SCRIPTDIR}"/packages/rust/build.sh; echo ${PKG_VERSION})
	fi
	if [[ "${RUST_VERSION}" == *"~beta"* ]]; then
		RUST_VERSION="beta"
	fi

	curl https://sh.rustup.rs -sSfo "${PKG_TMPDIR}"/rustup.sh
	sh "${PKG_TMPDIR}"/rustup.sh -y --default-toolchain "${RUST_VERSION}"

	export PATH="${HOME}/.cargo/bin:${PATH}"

	if [[ -n "${CARGO_TARGET_NAME-}" ]]; then
		# Specific version toolchain
		rustup target add "${CARGO_TARGET_NAME}" --toolchain "${RUST_VERSION}"
		# Default / Stable / rust-toolchain.toml toolchain
		rustup target add "${CARGO_TARGET_NAME}"
	fi
}
