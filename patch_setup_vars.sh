#!/bin/bash
cat << 'DIFF' > setup_vars.patch
--- scripts/build/termux_step_setup_variables.sh
+++ scripts/build/termux_step_setup_variables.sh
@@ -171,7 +171,11 @@
	TERMUX_PYTHON_VERSION="$( # get the python version
		if [[ "${TERMUX_PACKAGE_LIBRARY}" == "bionic" ]]; then
-			. "$TERMUX_SCRIPTDIR/packages/python/build.sh"
+			if [ -f "$TERMUX_SCRIPTDIR/packages/python/build.sh" ]; then
+				. "$TERMUX_SCRIPTDIR/packages/python/build.sh"
+			fi
		else # glibc
-			. "$TERMUX_SCRIPTDIR/gpkg/python/build.sh"
+			if [ -f "$TERMUX_SCRIPTDIR/gpkg/python/build.sh" ]; then
+				. "$TERMUX_SCRIPTDIR/gpkg/python/build.sh"
+			fi
		fi
-		echo "$_MAJOR_VERSION"
+		echo "${_MAJOR_VERSION:-3.11}"
	)"
	TERMUX_PKG_PYTHON_TARGET_DEPS="" # python modules to be installed via pip3
@@ -186,7 +190,11 @@
	TERMUX_LLVM_VERSION="$( # get the latest version of LLVM
		if [[ "${TERMUX_PACKAGE_LIBRARY}" == "bionic" ]]; then
-			. "$TERMUX_SCRIPTDIR/packages/libllvm/build.sh"
+			if [ -f "$TERMUX_SCRIPTDIR/packages/libllvm/build.sh" ]; then
+				. "$TERMUX_SCRIPTDIR/packages/libllvm/build.sh"
+			fi
		else # glibc
-			. "$TERMUX_SCRIPTDIR/gpkg/llvm/build.sh"
+			if [ -f "$TERMUX_SCRIPTDIR/gpkg/llvm/build.sh" ]; then
+				. "$TERMUX_SCRIPTDIR/gpkg/llvm/build.sh"
+			fi
		fi
-		echo "$TERMUX_PKG_VERSION"
+		echo "${TERMUX_PKG_VERSION:-19.0.0}"
	)"
DIFF
patch -p0 < setup_vars.patch
