#!/usr/bin/env bash
set -euo pipefail

# This script generates a list of packages with their versions and other details to make it easier for parsing by check-repository-consistency.js
# Outputs scripts/apt-packages-list-<arch>.txt for each architecture
#
# Format of each line:
# <package_name> <repo-name> <version> <may_have_staticsplit>
#
# Usage:
# ./scripts/generate-apt-packages-list.sh "/path/to/output_dir"
#
# The script will generate "/path/to/output_dir/apt-packages-list-<arch>.txt"
# for aarch64, arm, i686 and x86_64

if [[ "$#" != 1 ]]; then
	echo 'Usage:'
	echo './scripts/generate-apt-packages-list.sh "/path/to/output_dir"'
	exit 1
fi


REPOEXE_PACKAGES_DIR="$(realpath "$(dirname "$(realpath "$0")")/..")"
OUTPUT_DIR="$1"

readarray -t repo_paths < <(jq --raw-output 'del(.pkg_format) | keys | .[]' "$REPOEXE_PACKAGES_DIR/scripts/repo.json" | while read -r d; do [[ -d "$REPOEXE_PACKAGES_DIR/$d" ]] && echo "$d"; done)

for arch in "aarch64" "arm" "i686" "x86_64"; do
	# Note that this is loop for generating the list of packages is being parallelized for each architecture
	for repo_path in "${repo_paths[@]}"; do
		repo_name="$(jq --raw-output ".[\"$repo_path\"].name" "$REPOEXE_PACKAGES_DIR/scripts/repo.json")"
		for pkg_path in "$REPOEXE_PACKAGES_DIR/$repo_path"/*; do
			(
				APT_VERSION=
				export PKG_REVISION=0
				export PKG_NO_STATICSPLIT=false
				set +euo pipefail
				. "$pkg_path/build.sh" &> /dev/null || :
				set -euo pipefail
				# We are erroneously adding a revision for packages with version containing a dash when generating the apt packages in our build scripts.
				# So reproduce the same bug here
				# Source: scripts/build/extract_dep_info.sh
				#	if [[ "$PKG_REVISION" != "0" || "$PKG_VERSION" != "${PKG_VERSION/-/}" ]]; then
				#		VER_DEBIAN+="-$PKG_REVISION"
				# fi
				if [[ "$PKG_REVISION" != 0 || "$PKG_VERSION" != "${PKG_VERSION/-/}" ]]; then
					APT_VERSION="$PKG_VERSION-$PKG_REVISION"
				else
					APT_VERSION="$PKG_VERSION"
				fi

				IFS="," read -r -a EXCLUDED_ARCHES <<< "${PKG_EXCLUDED_ARCHES:-}"
				excluded=false
				for excluded_arch in "${EXCLUDED_ARCHES[@]}"; do
					if [[ "$excluded_arch" == *"$arch"* ]]; then
						excluded=true
					fi
				done
				if [[ "$excluded" != true ]]; then
					if [[ -d "$pkg_path" ]]; then
						echo -n "$(basename "$pkg_path") $repo_name $APT_VERSION"
					fi
					if [[ "$PKG_NO_STATICSPLIT" == true ]]; then
						echo " false"
					else
						echo " true"
					fi
				fi
				for subpkg in "$pkg_path"/*.subpackage.sh; do
					if [[ -f "$subpkg" ]]; then
						(
							set +euo pipefail
							export SUBPKG_PLATFORM_INDEPENDENT=false
							. "$subpkg" &> /dev/null || :
							set -euo pipefail
							IFS="," read -r -a SUBPKG_EXCLUDED_ARCHES <<< "${SUBPKG_EXCLUDED_ARCHES:-}"
							subpkg_excluded=false
							if [[ "${SUBPKG_PLATFORM_INDEPENDENT}" == "false" ]]; then
								subpkg_excluded="$excluded"
							fi
							for excluded_subpkg_arch in "${SUBPKG_EXCLUDED_ARCHES[@]}"; do
								if [[ "$excluded_subpkg_arch" == *"$arch"* ]]; then
									subpkg_excluded=true
								fi
							done
							if [[ "$subpkg_excluded" != true ]]; then
								echo "$(basename "$subpkg" .subpackage.sh) $repo_name $APT_VERSION false"
							fi
						)
					fi
				done
			)
		done
	done > "$OUTPUT_DIR/apt-packages-list-$arch.txt" & # Parallelize each architecture
done

wait
