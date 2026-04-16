#!/bin/bash

set -e -u

# This script is in '$SCRIPTDIR/scripts/bin/'.
SCRIPTDIR=$(cd "$(realpath "$(dirname "$0")")"; cd ../..; pwd)
DRY_RUN_SCRIPT_NAME=$(basename "$0")
BUILDSCRIPT_NAME="build-package.sh"
ARCH="aarch64"
DEBUG_BUILD="false"
PACKAGES_DIRECTORIES="
packages
root-packages
x11-packages
"

# Please keep synchronized with the logic of lines 468-547 of 'build-package.sh'.
declare -a PACKAGE_LIST=()
while (($# >= 1)); do
	case "$1" in
		*"/$BUILDSCRIPT_NAME") ;;
		-a)
			if [ $# -lt 2 ]; then
				echo "$DRY_RUN_SCRIPT_NAME: Option '-a' requires an argument"
				exit 1
			fi
			shift 1
			if [ -z "$1" ]; then
				echo "$DRY_RUN_SCRIPT_NAME: Argument to '-a' should not be empty."
				exit 1
			fi
			ARCH="$1"
			;;
		-d) DEBUG_BUILD="true" ;;
		-*) ;;
		*) PACKAGE_LIST+=("$1") ;;
	esac
	shift 1
done

# Please keep synchronized with the logic of lines 592-656 of 'build-package.sh'.
for ((i=0; i<${#PACKAGE_LIST[@]}; i++)); do
	PKG_NAME=$(basename "${PACKAGE_LIST[i]}")
	PKG_BUILDER_DIR=
	for package_directory in $PACKAGES_DIRECTORIES; do
		if [ -d "${SCRIPTDIR}/${package_directory}/${PKG_NAME}" ]; then
			PKG_BUILDER_DIR="${SCRIPTDIR}/$package_directory/$PKG_NAME"
			break
		fi
	done
	if [ -z "${PKG_BUILDER_DIR}" ]; then
		echo "$DRY_RUN_SCRIPT_NAME: No package $PKG_NAME found in any of the enabled repositories. Are you trying to set up a custom repository?"
		exit 1
	fi
	PKG_BUILDER_SCRIPT="$PKG_BUILDER_DIR/build.sh"

	# Please keep synchronized with the logic of lines 2-50 of 'scripts/build/step_start_build.sh'.
	if [ "${ARCH}" != "all" ] && \
		grep -qE "^PKG_EXCLUDED_ARCHES=.*${ARCH}" "$PKG_BUILDER_SCRIPT"; then
		echo "$DRY_RUN_SCRIPT_NAME: Skipping building $PKG_NAME for arch $ARCH"
		continue
	fi

	if [ "${DEBUG_BUILD}" = "true" ] && \
		grep -qE "^PKG_HAS_DEBUG=.*false" "$PKG_BUILDER_SCRIPT"; then
		echo "$DRY_RUN_SCRIPT_NAME: Skipping building debug build for $PKG_NAME"
		continue
	fi

	echo "$DRY_RUN_SCRIPT_NAME: Ending dry run simulation ($BUILDSCRIPT_NAME would have continued building $PKG_NAME)"
	exit 0
done

if [ ${#PACKAGE_LIST[@]} -gt 0 ]; then
	# At least one package name was parsed, but none of them reached "exit 0",
	# so exit with return value 85 (EX_C__NOOP) to indicate that no packages would have been built.
	echo "$DRY_RUN_SCRIPT_NAME: Ending dry run simulation ($BUILDSCRIPT_NAME would not have built any packages)"
	exit 85 # EX_C__NOOP
fi

# If this point is reached, assume that a combination of arguments
# that is either invalid or is not implemented in this script
# has been used, and that the real 'build-package.sh'
# needs to be run so that its own parser can interpret the arguments
# and display the appropriate message.
echo "$DRY_RUN_SCRIPT_NAME: Ending dry run simulation (unknown arguments, pass to the real $BUILDSCRIPT_NAME for more information)"
exit 0
