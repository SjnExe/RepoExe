# shellcheck shell=bash
# shellcheck disable=SC2034

# XXX: This file is sourced by repology-updater script
# So avoid doing things like executing commands except of those available in
# coreutils and are clearly not a default part of most Linux installations,
# or sourcing any other script in our build directories.

if [ -z "${BASH_VERSION:-}" ]; then
    echo "The 'properties.sh' script must be run from a 'bash' shell."; return 64 2>/dev/null|| exit 64 # EX__USAGE
fi



###
# Variables for validation of repoexe properties variables.
# Validation is done to ensure packages are not compiled for invalid
# values that are not supported, and values are as per repoexe file
# path limits.
#
# Additionally, the repoexe packages build system is an unsafe mess of
# unquoted variables in shell scripts, and so validation is necessary
# for important variables, especially specific path variables against
# `REGEX__SAFE_*_PATH` regexes to reduce any potential damage.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
###

##
# The map of variable names to their space separated list of validator
# actions to perform.
#
# Following are the supported validator actions.
# - `allow_unset_value`: Allow variable to be defined but unset, and
#    skip other validations.
# - `app_package_name`: Variable must match `REGEX__APP_PACKAGE_NAME`.
# - `invalid_rootfs_paths`: Path variable must not match
#   `REGEX__INVALID_ROOTFS_PATHS`.
# - `invalid_home_paths`: Path variable must not match
#   `REGEX__INVALID_HOME_PATHS`.
# - `invalid_prefix_paths`: Path variable must not match
#   `REGEX__INVALID_PREFIX_PATHS`.
# - `path_equal_to_or_under_rootfs`: Path variable must be equal
#   to or be under `_ROOTFS`.
# - `path_under_rootfs`:Path variable must be under `_ROOTFS`.
# - `safe_absolute_path`: Path variable must match
#   `REGEX__SAFE_ABSOLUTE_PATH` and must not match
#   `REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH`.
# - `safe_relative_path`: Path variable must match
#   `REGEX__SAFE_RELATIVE_PATH` and must not match
#   `REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH`.
# - `safe_rootfs_or_absolute_path`: Path variable must match
#   `REGEX__SAFE_ROOTFS_OR_ABSOLUTE_PATH` and must not match
#   `REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH`.
# - `apps_api_socket__server_parent_dir`: Path variable must have max
#    length `<= _APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN`
#    including the null `\0` terminator.
# - `unix_path_max`: Path variable must have max length `<= _UNIX_PATH_MAX`
#    including the null `\0` terminator.
# - `unsigned_int`: Variable must match `REGEX__UNSIGNED_INT`.
##
unset __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_MAP; declare -A __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_MAP=()

##
# The list of variable names added to `__BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_MAP`
# that maintains insertion order.
##
unset __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_VARIABLE_NAMES; declare -a __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_VARIABLE_NAMES=()

##
# Whether to validate max lengths of repoexe paths. Set to `false` to skip validation.
##
__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN="true"

##
# Whether to validate `usr` merge format for `_PREFIX`. Set to `false` to skip validation.
# Check `_PREFIX` variable docs for more info.
##
__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT="true"



##
# `__build_props__add_variables_validator_actions` `<variable_name>` `<validator_actions>`
##
__build_props__add_variables_validator_actions() {

    if [ $# -ne 2 ]; then
        echo "Invalid argument count '$#' to '__build_props__add_variables_validator_actions'." 1>&2
        return 1
    fi

    local variable_name="$1"
    local validator_actions="$2"

    if [[ ! "$variable_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
        echo "The variable_name '$variable_name' passed to '__build_props__add_variables_validator_actions' is not a valid shell variable name." 1>&2
        return 1
    fi

    if [[ " ${__BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_VARIABLE_NAMES[*]} " != *" $variable_name "* ]]; then
        __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_VARIABLE_NAMES+=("$variable_name")
    fi

    __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_MAP["$variable_name"]+="$validator_actions"

}





####
# Variables for validating repoexe variables.
####

##
# Regex that matches an absolute path that starts with a `/` with at
# least one characters under rootfs `/`. Duplicate or trailing path
# separators `/` are not allowed.
##
REGEX__ABSOLUTE_PATH='^(/[^/]+)+$'

##
# Regex that matches a relative path that does not start with a `/`.
# Duplicate or trailing path separators `/` are not allowed.
##
REGEX__RELATIVE_PATH='^[^/]+(/[^/]+)*$'

##
# Regex that matches (rootfs `/`) or (an absolute path that starts
# with a `/`). Duplicate or trailing path separators `/` are not
# allowed.
##
REGEX__ROOTFS_OR_ABSOLUTE_PATH='^((/)|((/[^/]+)+))$'


##
# Regex that matches a safe absolute path that starts with a `/` with
# at least one characters under rootfs `/`. Duplicate or trailing path
# separators `/` are not allowed. The path component characters must
# be in the range `[a-zA-Z0-9+,.=_-]`.
#
# The path must also be validated against
# `REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH`.
##
REGEX__SAFE_ABSOLUTE_PATH='^(/[a-zA-Z0-9+,.=_-]+)+$'

##
# Regex that matches a safe relative path that does not start with a
# `/`. Duplicate or trailing path separators `/` are not allowed. The
# path component characters must be in the range `[a-zA-Z0-9+,.=_-]`.
#
# The path must also be validated against
# `REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH`.
##
REGEX__SAFE_RELATIVE_PATH='^[a-zA-Z0-9+,.=_-]+(/[a-zA-Z0-9+,.=_-]+)*$'

##
# Regex that matches (rootfs `/`) or (a safe absolute path that starts
# with a `/`). Duplicate or trailing path separators `/` are not
# allowed. The path component characters must be in the range
# `[a-zA-Z0-9+,.=_-]`.
#
# The path must also be validated against
# `REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH`.
##
REGEX__SAFE_ROOTFS_OR_ABSOLUTE_PATH='^((/)|((/[a-zA-Z0-9+,.=_-]+)+))$'


##
# Regex that matches a path containing single `/./` or double `/../` dot components.
##
REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH='((^\./)|(^\.\./)|(/\.$)|(/\.\.$)|(/\./)|(/\.\./))'


##
# Regex that matches invalid repoexe rootfs paths.
#
# The repoexe rootfs or prefix paths must not be equal to or be under
# specific Filesystem Hierarchy Standard paths or paths used by repoexe
# docker image/host OS for its own files, as repoexe packages files
# must be kept separate from the build host. The repoexe app data/prefix
# directories are also wiped by `clean.sh` when not running on-device,
# which wouldn't be possible if repoexe and host directories are shared.
#
# The invalid paths list does not include the `/data` and `/mnt/expand`
# paths under which private app data directories are assigned to
# Android apps, or the `/data/local/tmp` directory assigned to `adb`
# `shell` user, or the `/system` directory for the Android system.
#
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs-3.0.html
# - https://en.wikipedia.org/wiki/Filesystem_Hierarchy_Standard
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-private-app-data-directory
##
REGEX__INVALID_ROOTFS_PATHS='^((/bin(/.*)?)|(/boot(/.*)?)|(/dev(/.*)?)|(/etc(/.*)?)|(/home)|(/lib(/.*)?)|(/lib[^/]+(/.*)?)|(/media)|(/mnt)|(/opt)|(/proc(/.*)?)|(/root)|(/run(/.*)?)|(/sbin(/.*)?)|(/srv(/.*)?)|(/sys(/.*)?)|(/tmp(/.*)?)|(/usr)|(/usr/local)|(((/usr/)|(/usr/local/))((bin)|(games)|(include)|(lib)|(libexec)|(lib[^/]+)|(sbin)|(share)|(src)|(X11R6))(/.*)?)|(/var(/.*)?)|(/bin.usr-is-merged)|(/lib.usr-is-merged)|(/sbin.usr-is-merged)|(/.dockerinit)|(/.dockerenv))$'

##
# Regex that matches invalid repoexe home paths.
#
# Same reasoning as `REGEX__INVALID_ROOTFS_PATHS`,
# and invalid paths are the same as well except that `/home` is
# allowed, and `/` and all paths under `/usr` are not allowed.
#
# `/home` is allowed as package data files are not packaged from there.
##
REGEX__INVALID_HOME_PATHS='^((/)|(/bin(/.*)?)|(/boot(/.*)?)|(/dev(/.*)?)|(/etc(/.*)?)|(/lib(/.*)?)|(/lib[^/]+(/.*)?)|(/media)|(/mnt)|(/opt)|(/proc(/.*)?)|(/root)|(/run(/.*)?)|(/sbin(/.*)?)|(/srv(/.*)?)|(/sys(/.*)?)|(/tmp(/.*)?)|(/usr(/.*)?)|(/var(/.*)?)|(/bin.usr-is-merged)|(/lib.usr-is-merged)|(/sbin.usr-is-merged)|(/.dockerinit)|(/.dockerenv))$'

##
# Regex that matches invalid repoexe prefix paths.
#
# Same reasoning as `REGEX__INVALID_ROOTFS_PATHS`,
# and invalid paths are the same as well except that `/` is not
# allowed.
##
REGEX__INVALID_PREFIX_PATHS='^((/)|(/bin(/.*)?)|(/boot(/.*)?)|(/dev(/.*)?)|(/etc(/.*)?)|(/home)|(/lib(/.*)?)|(/lib[^/]+(/.*)?)|(/media)|(/mnt)|(/opt)|(/proc(/.*)?)|(/root)|(/run(/.*)?)|(/sbin(/.*)?)|(/srv(/.*)?)|(/sys(/.*)?)|(/tmp(/.*)?)|(/usr)|(/usr/local)|(((/usr/)|(/usr/local/))((bin)|(games)|(include)|(lib)|(libexec)|(lib[^/]+)|(sbin)|(share)|(src)|(X11R6))(/.*)?)|(/var(/.*)?)|(/bin.usr-is-merged)|(/lib.usr-is-merged)|(/sbin.usr-is-merged)|(/.dockerinit)|(/.dockerenv))$'


##
# Regex that matches an unsigned integer `>= 0`.
##
REGEX__UNSIGNED_INT='^[0-9]+$'


##
# Regex to match an android app package name.
#
# The package name must have at least two segments separated by a dot
# `.`, where each segment must start with at least one character in
# the range `[a-zA-Z]`, followed by zero or more characters in the
# range `[a-zA-Z0-9_]`. The package name length must also be
# `<= 255` (`NAME_MAX` for ext4 partitions). The length is not checked
# by this regex and it must be checked with `_NAME_MAX`, as
# `bash` `=~` regex conditional does not support lookaround.
#
# Unlike Android, the repoexe app package name max length is not `255`
# as its limited by `_APPS_DIR___MAX_LEN` and `_ROOTFS_DIR___MAX_LEN`.
#
# - https://developer.android.com/build/configure-app-module#set-application-id
# - https://cs.android.com/android/platform/superproject/+/android-14.0.0_r1:frameworks/base/core/java/android/content/pm/parsing/ApkLiteParseUtils.java;l=669-677
# - https://cs.android.com/android/platform/superproject/+/android-14.0.0_r1:frameworks/base/core/java/android/content/pm/parsing/FrameworkParsingPackageUtils.java;l=63-103
# - https://cs.android.com/android/platform/superproject/+/android-14.0.0_r1:frameworks/base/core/java/android/os/FileUtils.java;l=954-994
# - https://cs.android.com/android/platform/superproject/+/android-14.0.0_r1:frameworks/base/core/java/android/content/pm/PackageManager.java;l=2147-2155
##
REGEX__APP_PACKAGE_NAME="^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$"

##
# Regex to match an android app data path.
#
# The supported formats are:
# - `/data/data/<package_name>` (for primary user `0`) if app is to be
#   installed on internal sd.
# - `/data/user/<user_id>/<package_name>` (for all users) if app is to
#   be installed on internal sd.
# `/mnt/expand/<volume_uuid>/user/<user_id>/<package_name>` if app is
#  to be installed on a removable/portable volume/sd card being used as
#  adoptable storage.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-private-app-data-directory
##
REGEX__APP_DATA_DIR_PATH='^(((/data/data)|(/data/user/[0-9]+)|(/mnt/expand/[^/]+/user/[0-9]+))/[^/]+)$'





###
# Variables for the repoexe build tools.
###

##
# The path to the `repoexe-packages` repo root directory.
##
PKGS__BUILD__REPO_ROOT_DIR="${PKGS__BUILD__REPO_ROOT_DIR:-}"

__build_props__set_builder__repo_root_dir() {

    local relative_path="${1:-}"
    local return_value=0
    if [[ -z "${PKGS__BUILD__REPO_ROOT_DIR:-}" ]]; then
        if [[ "$(readlink --help 2>&1 || true)" =~ [\ ]-f[,\ ] ]]; then
            PKGS__BUILD__REPO_ROOT_DIR="$(file="$(readlink -f -- "${BASH_SOURCE[0]}")" && \
                parent="$(dirname -- "$file")" && \
                readlink -f -- "${parent}${relative_path}")" || return_value=$?
        else
            PKGS__BUILD__REPO_ROOT_DIR="$(pwd)" || return_value=$? # macOS `< 12.3` compatibility.
        fi
    fi
    if [ $return_value -ne 0 ] || [[ ! "$PKGS__BUILD__REPO_ROOT_DIR" =~ ^(/[a-zA-Z0-9+,.=_-]+)+$ ]] || \
            [[ ! -f "$PKGS__BUILD__REPO_ROOT_DIR/scripts/properties.sh" ]]; then
        echo "The PKGS__BUILD__REPO_ROOT_DIR '$PKGS__BUILD__REPO_ROOT_DIR' not found or is not valid." 1>&2
        return 1;
    fi

}
__build_props__set_builder__repo_root_dir "/.." || exit $?
unset __build_props__set_builder__repo_root_dir
SCRIPTDIR="${SCRIPTDIR:-PKGS__BUILD__REPO_ROOT_DIR}" # Deprecated alternative variable for `PKGS__BUILD__REPO_ROOT_DIR`



SDK_REVISION=9123335
ANDROID_BUILD_TOOLS_VERSION=33.0.1
# when changing the above:
# change PKG_VERSION (and remove PKG_REVISION if necessary) in:
#   apksigner, d8
# and trigger rebuild of them
: "${NDK_VERSION_NUM:="29"}"
: "${NDK_REVISION:=""}"
NDK_VERSION="${NDK_VERSION_NUM}${NDK_REVISION}"
# when changing the above:
# update version and hashsum in packages
#   libandroid-stub, libc++, ndk-multilib, ndk-sysroot, vulkan-loader-android
# and update SHA256 sums in scripts/setup-android-sdk.sh
# check all packages build and run correctly and bump if needed

: "${HOST_LLVM_MAJOR_VERSION:="20"}"
: "${HOST_LLVM_BASE_DIR:="/usr/lib/llvm-${HOST_LLVM_MAJOR_VERSION}"}"

: "${JAVA_HOME:=/usr/lib/jvm/java-17-openjdk-amd64}"
export JAVA_HOME="${JAVA_HOME}"

if [[ "${PACKAGES_OFFLINE-false}" == "true" ]]; then
    export ANDROID_HOME="${PKGS__BUILD__REPO_ROOT_DIR}/build-tools/android-sdk-${SDK_REVISION}"
    export NDK="${PKGS__BUILD__REPO_ROOT_DIR}/build-tools/android-ndk-r${NDK_VERSION}"
else
    : "${ANDROID_HOME:="${HOME}/lib/android-sdk-$SDK_REVISION"}"
    : "${NDK:="${HOME}/lib/android-ndk-r${NDK_VERSION}"}"
fi



###
# Variables for the repoexe apps and packages for which to compile packages.
#
# Variables defined in this file need to be in sync with `repoexe-app`
# (`repoexeConstants` and `repoexeCoreConstants`), repoexe site and `repoexe-exec`.
# - https://github.com/repoexe/repoexe-app/blob/master/repoexe-shared/src/main/java/com/repoexe/shared/repoexe/repoexeConstants.java
# - https://github.com/repoexe/repoexe-app/blob/master/repoexe-shared/src/main/java/com/repoexe/shared/repoexe/core/repoexeCoreConstants.java
#
# Following is a list of `` variables that are safe to modify when forking.
# **DO NOT MODIFY ANY OTHER VARIABLE UNLESS YOU KNOW WHAT YOU ARE DOING.**
#
# - `_NAME`, `_LNAME` and `_UNAME`.
# - `_REPOS_HOST_ORG_NAME` and `_REPOS_HOST_ORG_URL`.
# - `*__REPO_NAME` and `*__REPO_URL`.
# - `APP__PACKAGE_NAME`.
# - `APP__DATA_DIR`.
# - `_PROJECT_SUBDIR`.
# - `_ROOTFS_SUBDIR`.
# - `_ROOTFS` and alternates.
# - `_PREFIX` and alternates.
# - `ANDROID_HOME` and alternates.
# - `APP__NAME` and `APP__LNAME`.
# - `APP__APP_IDENTIFIER`.
# - `APP__NAMESPACE`.
# - `APP__SHELL_API__SHELL_API_ACTIVITY__*`.
# - `APP__SHELL_API__SHELL_API_SERVICE__*`.
# - `APP__RUN_COMMAND_API__RUN_COMMAND_API_SERVICE__*`.
# - `APP__DATA_SENDER_API__DATA_SENDER_API_RECEIVER__*`.
# - `API_APP__PACKAGE_NAME`.
# - `API_APP__NAME`.
# - `API_APP__APP_IDENTIFIER`.
# - `API_APP__NAMESPACE`.
# - `API_APP__ANDROID_API__ANDROID_API_RECEIVER__*`.
# - `AM_APP__NAMESPACE`.
###

##
# repoexe project name.
#
# Default value: `repoexe`
##
_NAME="repoexe"

##
# The lower case value for `_NAME`.
#
# Default value: `repoexe`
##
_LNAME="${_NAME,,}"

##
# The upper case value for `_NAME`.
#
# Default value: `repoexe`
##
_UNAME="${_NAME^^}"



##
# repoexe internal project name.
#
# This is used internally for paths, filenames, and other internal use
# cases and must match the `_INTERNAL_NAME_REGEX` regex and
# have max length `_INTERNAL_NAME___MAX_LEN`.
#
# **This must not be changed unless doing a full fork of repoexe where
# all repoexe references are changed instead of just changing the
# `_NAME`, `APP__PACKAGE_NAME` and urls.**
#
# Default value: `repoexe`
##
_INTERNAL_NAME="repoexe"

##
# The regex to validate `_INTERNAL_NAME`.
#
# The internal name must start with characters in the range
# `[a-z0-9]`, followed by at least one character in the range
# `[a-z0-9_-]`, and end with characters in the range `[a-z0-9]`. The
# min length is `3`. The max length `7` as per
# `_INTERNAL_NAME___MAX_LEN` is not checked by this regex and
# must be checked separately.
#
#
# Constant value: `^[a-z0-9][a-z0-9_-]+[a-z0-9]$`
##
_INTERNAL_NAME_REGEX="^[a-z0-9][a-z0-9_-]+[a-z0-9]$"

##
# The max length for the `_INTERNAL_NAME`.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `7` is chosen.
#
# Constant value: `7`
##
_INTERNAL_NAME___MAX_LEN=7



##
# repoexe repositories host organization name.
#
# Default value: `repoexe`
##
_REPOS_HOST_ORG_NAME="repoexe"

##
# repoexe repositories host organization url.
#
# Default value: `https://github.com/repoexe`
##
_REPOS_HOST_ORG_URL="https://github.com/$_REPOS_HOST_ORG_NAME"



##
# repoexe app package name used for `APP__DATA_DIR` and
# `APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# Ideally package name should be `<= 21` characters and max `33`
# characters. If package name has not yet been chosen, then it would
# be best to keep it to `<= 10` characters. Check
# https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why.
#
# **See Also:**
# - `APP__NAMESPACE`.
# - https://developer.android.com/build/configure-app-module#set-application-id
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-private-app-data-directory
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__`
##
APP__PACKAGE_NAME="__COM_REPOEXE_PLACEHOLDER__"
APP_PACKAGE="$APP__PACKAGE_NAME" # Deprecated alternative variable for `APP__PACKAGE_NAME`

__build_props__add_variables_validator_actions "APP__PACKAGE_NAME" "app_package_name"

##
# repoexe app data directory path that is expected to be assigned by
# Android to the repoexe app with `APP__PACKAGE_NAME` for all
# its app data, that will contain the repoexe project directory
# (`_PROJECT_DIR`), and optionally the repoexe rootfs directory
# (`_ROOTFS`).
#
# The path must match `REGEX__APP_DATA_DIR_PATH`.
#
# The directory set will be deleted by `clean.sh` if `_PREFIX`
# is under `APP__DATA_DIR` and not running on-device, so make
# sure a safe path is set if running `clean.sh` in repoexe docker or
# host OS build environment.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__`
##
APP__DATA_DIR="/data/data/$APP__PACKAGE_NAME"
__build_props__add_variables_validator_actions "APP__DATA_DIR" "safe_absolute_path"

##
# The max length for the `APP__DATA_DIR` including the null '\0'
# terminator.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `69` is chosen.
#
# Constant value: `69`
##
APP__DATA_DIR___MAX_LEN=69





##
# repoexe subdirectory path for `_PROJECT_DIR`.
#
# Default value: `repoexe`
##
_PROJECT_SUBDIR="$_INTERNAL_NAME"
__build_props__add_variables_validator_actions "_PROJECT_SUBDIR" "safe_relative_path"

##
# repoexe project directory path under `APP__DATA_DIR`.
#
# This is an exclusive directory for all repoexe files that includes
# repoexe core directory (`_CORE_DIR`), repoexe apps directory
# (`_APPS_DIR`), and optionally the repoexe rootfs directory
# (`_ROOTFS`).
#
# Currently, the default repoexe rootfs directory is not under it and
# is at the `/files`  subdirectory but there are plans to move it to
# `repoexe/rootfs/II` in future where `II` refers to rootfs id starting
# at `0` for multi-rootfs support.
#
# An exclusive directory is required so that all repoexe files exist
# under a single directory, especially for when repoexe is provided as
# a library, so that repoexe files do not interfere with other files
# of repoexe app forks or apps that may use the repoexe library.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-project-directory
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe`
##
_PROJECT_DIR="$APP__DATA_DIR/$_PROJECT_SUBDIR"
__build_props__add_variables_validator_actions "_PROJECT_DIR" "safe_absolute_path"





##
# repoexe subdirectory path for `_CORE_DIR`.
#
# Constant value: `core`
##
_CORE_SUBDIR="core"

##
# repoexe core directory path under `_PROJECT_DIR`.
#
# This contains repoexe core files for the repoexe app, like user settings and configs for the app,
# which and are independent of any specific rootfs.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-core-directory
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/core`
##
_CORE_DIR="$_PROJECT_DIR/$_CORE_SUBDIR"
__build_props__add_variables_validator_actions "_CORE_DIR" "safe_absolute_path"






##
# repoexe subdirectory path for `_APPS_DIR`.
#
# Constant value: `app`
##
_APPS_SUBDIR="app"

##
# repoexe apps directory path under `_PROJECT_DIR`.
#
# This contains app specific files for the repoexe app, its plugin
# apps, and third party apps, like used for app APIs and
# filesystem/pathname socket files of servers created by the apps.
# - https://man7.org/linux/man-pages/man7/unix.7.html
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-apps-directory
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app`
##
_APPS_DIR="$_PROJECT_DIR/$_APPS_SUBDIR"
__build_props__add_variables_validator_actions "_APPS_DIR" "safe_absolute_path"

##
# The max length for the `_APPS_DIR` including the null '\0'
# terminator.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `84` is chosen.
#
# Constant value: `84`
##
_APPS_DIR___MAX_LEN=84

##
# The max length for the repoexe apps api socket server parent directory
# including the null '\0' terminator.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `98` is chosen.
#
# Constant value: `98`
##
_APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN=98



##
# repoexe subdirectory path for `_APPS_DIR_BY_IDENTIFIER`.
#
# Constant value: `i`
##
_APPS_DIR_BY_IDENTIFIER_SUBDIR="i"

##
# repoexe apps directory path by app identifier under `_APPS_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app/i`
##
_APPS_DIR_BY_IDENTIFIER="$_APPS_DIR/$_APPS_DIR_BY_IDENTIFIER_SUBDIR"

##
# The regex to validate a subdirectory name under the
# `_APPS_DIR_BY_IDENTIFIER` excluding the null '\0' terminator
# that represents an app identifier.
#
# The app identifier must only contain characters in the range
# `[a-zA-Z0-9]` as segments, with `[._-]` as separators between
# segments, and with the first segment containing at least `3`
# characters. The max length `10` as per
# `_APPS_APP_IDENTIFIER___MAX_LEN` is not checked by this regex
# and must be checked separately.
#
# Constant value: `^[a-zA-Z0-9]{3,}([._-][a-zA-Z0-9]+)*$`
##
_APPS_APP_IDENTIFIER_REGEX="^[a-zA-Z0-9]{3,}([._-][a-zA-Z0-9]+)*$"

##
# The max length for a subdirectory name under the
# `_APPS_DIR_BY_IDENTIFIER` excluding the null '\0' terminator
# that represents an app identifier.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `10` is chosen.
#
# Constant value: `10`
##
_APPS_APP_IDENTIFIER___MAX_LEN=10





##
# repoexe subdirectory path for `_APPS_DIR_BY_UID`.
#
# Constant value: `u`
##
_APPS_DIR_BY_UID_SUBDIR="u"

##
# repoexe apps directory path by app uid (user_id + app_id) under
# `_APPS_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app/u`
##
_APPS_DIR_BY_UID="$_APPS_DIR/$_APPS_DIR_BY_UID_SUBDIR"

##
# The regex to validate a  subdirectory name under the
# `_APPS_DIR_BY_UID` excluding the null '\0' terminator that
# represents an app uid.
#
# The app uid must only contains `5` to `9` characters that are
# numbers and must not start with a `0`.
#
# Constant value: `^[1-9][0-9]{4,8}$`
##
_APPS_APP_UID_REGEX="^[1-9][0-9]{4,8}$"

##
# The max length for a subdirectory name under the
# `_APPS_DIR_BY_UID` excluding the null '\0' terminator that
# represents an app uid.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `9` is chosen.
#
# Constant value: `9`
##
_APPS_APP_UID___MAX_LEN=9





##
# repoexe apps info environment subfile path under an app directory of
# `_APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `repoexe-apps-info.env`
##
CORE__APPS_INFO_ENV_SUBFILE="$_INTERNAL_NAME-apps-info.env"

##
# repoexe apps info json subfile path under an app directory of
# `_APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `repoexe-apps-info.json`
##
CORE__APPS_INFO_JSON_SUBFILE="$_INTERNAL_NAME-apps-info.json"



##
# `repoexe-am-socket` server subfile path under an app directory of
# `_APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `repoexe-am`
##
AM_SOCKET__SERVER_SOCKET_SUBFILE="$_INTERNAL_NAME-am"





##
# repoexe `_ROOTFS` id.
#
# Default value: `0`
##
_ROOTFS_ID="0"
__build_props__add_variables_validator_actions "_ROOTFS_ID" "unsigned_int"

##
# repoexe subdirectory path for `_ROOTFS`.
#
# Default value: `files`
##
_ROOTFS_SUBDIR="files"
__build_props__add_variables_validator_actions "_ROOTFS_SUBDIR" "allow_unset_value safe_relative_path"

###########
# Uncomment if to place `_ROOTFS`  under `_PROJECT_DIR`
# instead of at `files`. This may be used for future multi-rootfs
# design. Make sure to update `_CACHE_SUBDIR` above as well.

##
# repoexe subdirectory path for parent directory of all repoexe rootfses
# including `_ROOTFS`.
#
# Default value: `repoexe/rootfs`
##
#_ROOTFSES_SUBDIR="$_PROJECT_SUBDIR/rootfs"
###########

##
# repoexe subdirectory path for `_ROOTFS`.
#
# Default value: `repoexe/rootfs/0`
##
#_ROOTFS_SUBDIR="$_ROOTFSES_SUBDIR/$_ROOTFS_ID"
###########


##
# repoexe rootfs directory path under `APP__DATA_DIR` that
# contains the Linux environment rootfs provided by repoexe.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-rootfs-directory
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch03.html
#
# The repoexe rootfs must not be set to path in
# `REGEX__INVALID_ROOTFS_PATHS`. It can exist outside
# the `APP__DATA_DIR` if compiling packages for the Android
# system or `adb` `shell` user.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files`
##
_ROOTFS="$APP__DATA_DIR/$_ROOTFS_SUBDIR"
BASE_DIR="$_ROOTFS" # Deprecated alternative variable for `_ROOTFS`

__build_props__add_variables_validator_actions "_ROOTFS" "safe_rootfs_or_absolute_path invalid_rootfs_paths"

# FIXME: Remove after updating repoexe app and `repoexe-am-socket`
# package sources and use `_APPS_DIR`.
APPS_DIR="$_ROOTFS/apps"

##
# The max length for the `_ROOTFS` including the null '\0'
# terminator.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `86` is chosen.
#
# Constant value: `86`
##
_ROOTFS_DIR___MAX_LEN=86





####
# Variables for the repoexe home.
####

##
# repoexe subdirectory path for `_HOME`.
#
# Default value: `home`
##
_HOME_SUBDIR="home"
__build_props__add_variables_validator_actions "_HOME_SUBDIR" "safe_relative_path"

##
# repoexe home directory path under `_ROOTFS` used for `$HOME`.
#
# It serves the same purpose as the `/home` directory on Linux distros.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-home-directory
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch03s08.html
#
# Check `_PREFIX` variable docs for rules that apply depending
# on if `_ROOTFS` is equal to Android/Linux rootfs `/` or not.
# The repoexe home must not be set to Android/Linux rootfs `/` or any
# other path in `REGEX__INVALID_HOME_PATHS`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/home`
##
[[ "$_ROOTFS" != "/" ]] && _HOME="$_ROOTFS/$_HOME_SUBDIR" || \
    _HOME="/$_HOME_SUBDIR"
__build_props__add_variables_validator_actions "_HOME" "safe_absolute_path invalid_home_paths path_under_rootfs"

ANDROID_HOME="$_HOME" # Deprecated alternative variable for `_HOME`

##
# repoexe legacy project user config directory path under `_HOME`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/home/.repoexe`
##
_LEGACY_PROJECT_USER_CONFIG_DIR="$_HOME/.repoexe"





####
# Variables for the repoexe prefix.
####

##
# repoexe subdirectory path for `_PREFIX`.
#
# Default value: `usr`
##
_PREFIX_SUBDIR="usr"
__build_props__add_variables_validator_actions "_PREFIX_SUBDIR" "allow_unset_value safe_relative_path"

##
# repoexe prefix directory path under or equal to `_ROOTFS`
# where all repoexe packages data is installed.
#
# It serves the same purpose as the `/usr` directory on Linux distros
# and contains the `bin`, `etc`, `include`, `lib`, `libexec`, `opt`,
# `share`, `tmp` and `var` sub directories.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-prefix-directory
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch04.html
#
# If `_ROOTFS` is not equal to `/`, then by default repoexe
# uses `usr` merge format, like used by `debian`, as per
# `__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT`
# being enabled by default. In the `usr` merge format, all packages
# are installed under the `usr` subdirectory under rootfs, like under
# `$_ROOTFS/usr/bin` and `$_ROOTFS/usr/lib`,
# instead of under `$_ROOTFS/bin` and `$_ROOTFS/lib`.
# So if `usr` merge format is enabled, then DO NOT change the default
# value of `_PREFIX_SUBDIR` from `usr`.
# The `$_ROOTFS/usr-staging` directory is also used as a
# temporary directory for extracting bootstrap zip by the repoexe app,
# before its renamed to `$_ROOTFS/usr`.
# Additionally, `_PREFIX` must not be equal to `_HOME`
# and they must not be under each other, as repoexe app requires that
# prefix and home are separate directories as prefix gets wiped during
# bootstrap installation or if `repoexe-reset` is run, and backup
# scripts require the same. Package data also needs to be kept
# separate from `home`, so it does not make sense for them to be
# equal to or be under each other.
# However, if a repoexe app fork is using a modified bootstrap
# installation that does not use the `usr` merge format, then
# `__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT` can
# be set to `false` and `_PREFIX_SUBDIR` could optionally be
# set to an empty string if `_ROOTFS` should be equal to
# `_PREFIX`, or a custom directory other than `usr`. In this
# case `_HOME` can optionally be under `_PREFIX`, but
# not be equal to it.
#
# - https://wiki.debian.org/UsrMerge
# - https://lists.debian.org/debian-devel-announce/2019/03/msg00001.html
# - https://dep-team.pages.debian.net/deps/dep17/
#
# If `_ROOTFS` is equal to Android/Linux rootfs `/`, then
# `_PREFIX_SUBDIR` must not be set to an empty string as
# `_PREFIX` must be a subdirectory under rootfs `/`, and must
# not be set to `usr` either or or any other path in
# `REGEX__INVALID_PREFIX_PATHS`. Check the
# `REGEX__INVALID_ROOTFS_PATHS` variable docs for why
# some paths like `/usr`, etc are now allowed.
#
# Basically, the following rules apply for `_PREFIX`.
# - If `_ROOTFS` is not equal to `/`:
#     - If `usr` merge format is enabled:
#         - `_PREFIX` must be equal to `$_ROOTFS/usr`.
#         - `_PREFIX` must not be equal to `_HOME` and
#            they must not be under each other.
#     - If `usr` merge format is disabled:
#         - `_PREFIX` must be equal to or be under `$_ROOTFS`.
#         - `_PREFIX` must not be equal to or be under `_HOME`.
# - If `_ROOTFS` is equal to `/`:
#     - If `usr` merge format is enabled or disabled:
#         - `_PREFIX` must be under `$_ROOTFS` and not
#           equal to `/usr` or other paths in `REGEX__INVALID_PREFIX_PATHS`.
#         - `_PREFIX` must not be equal to or be under `_HOME`.
#
# The directory set will be deleted by `clean.sh` if not running
# on-device, so make sure a safe path is set if running `clean.sh` in
# repoexe docker or host OS build environment.
#
# At runtime, `_PREFIX` may be overridden and set to
# `_PREFIX_GLIBC` when compiling `glibc` packages by calling
# `build_props__set_prefix_dir_and_sub_variables` in
# `step_setup_variables` if `PACKAGE_LIBRARY` equals `glibc`.
# However, `_PREFIX_CLASSICAL` retains the original value
# set below for `_PREFIX`.
# - https://github.com/repoexe/repoexe-packages/pull/16901
# - https://github.com/repoexe/repoexe-packages/pull/20864
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr`
##
[[ "$_ROOTFS" != "/" ]] && _PREFIX="$_ROOTFS${_PREFIX_SUBDIR:+"/$_PREFIX_SUBDIR"}" || \
    _PREFIX="/$_PREFIX_SUBDIR"
__build_props__add_variables_validator_actions "_PREFIX" "safe_absolute_path invalid_prefix_paths"

if [[ "$_ROOTFS" != "/" ]] && [[ "$__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT" != "true" ]]; then
    __build_props__add_variables_validator_actions "_PREFIX" " path_equal_to_or_under_rootfs"
else
    __build_props__add_variables_validator_actions "_PREFIX" " path_under_rootfs"
fi

PREFIX="$_PREFIX" # Deprecated alternative variable for `_PREFIX`



##
# The original value for `_PREFIX` set above, as `_PREFIX`
# can be overridden at runtime, like when compiling `glibc` packages.
# Checks variable docs of `_PREFIX` for more info.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr`
##
_PREFIX_CLASSICAL="$_PREFIX"
PREFIX_CLASSICAL="$_PREFIX" # Deprecated alternative variable for `_PREFIX_CLASSICAL`



##
# repoexe subdirectory path for `_PREFIX_GLIBC`.
#
# Default value: `glibc`
##
_PREFIX_GLIBC_SUBDIR="glibc"

##
# repoexe `glibc` prefix directory path under `_PREFIX`
# where all repoexe `glibc` packages data is installed.
#
# **See Also:**
# - https://github.com/repoexe-pacman/glibc-packages
# - https://github.com/repoexe/glibc-packages (mirror)
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/glibc`
##
_PREFIX_GLIBC="$_PREFIX/$_PREFIX_GLIBC_SUBDIR"
__build_props__add_variables_validator_actions "_PREFIX_GLIBC" "safe_absolute_path invalid_prefix_paths path_under_rootfs"



##
# The max length for the `_PREFIX` including the null '\0'
# terminator.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `90` is chosen.
#
# Constant value: `90`
##
_PREFIX_DIR___MAX_LEN="$((_ROOTFS_DIR___MAX_LEN + 1 + 3))" # "/usr" (90)


##
# The max length for the `_BIN_DIR` including the null '\0' terminator.
#
# Constant value: `94`
##
_PREFIX__BIN_DIR___MAX_LEN="$((_PREFIX_DIR___MAX_LEN + 1 + 3))" # "/bin" (94)

##
# The max safe length for a sub file path under the `_BIN_DIR`
# including the null '\0' terminator.
#
# This allows for a filename with max length `33` so that the path
# length is under `128` (`BINPRM_BUF_SIZE`) for Linux kernel `< 5.1`,
# and ensures `argv[0]` length is `< 128` on Android `< 6`, otherwise
# commands will fail with exit code 1 without any error on `stderr`,
# but with the `library name "<library_name>" too long` error in
# `logcat` if linker debugging is enabled.
#
# **See Also:**
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# - https://github.com/repoexe/repoexe-core-package/blob/master/lib/repoexe-core_nos_c/tre/include/repoexe/core__nos__c/v1/repoexe/file/repoexeFile.h
# - https://github.com/repoexe/repoexe-exec-package/blob/master/lib/repoexe-exec_nos_c/tre/include/repoexe/exec__nos__c/v1/repoexe/api/exec/service/ld_preload/direct/exec/ExecIntercept.h
#
# Constant value: `127`
##
_PREFIX__BIN_FILE___SAFE_MAX_LEN="$((_PREFIX__BIN_DIR___MAX_LEN + 1 + 33))" # "/<filename_with_len_33>" (127)

##
# The max length for entire shebang line for `repoexe-exec`.
#
# **See Also:**
# - https://github.com/repoexe/repoexe-exec-package/blob/master/lib/repoexe-exec_nos_c/tre/include/repoexe/exec__nos__c/v1/repoexe/api/exec/service/ld_preload/direct/exec/ExecIntercept.h
#
# Default value: `340`
##
_FILE_HEADER__BUFFER_SIZE="340"




##
# `build_props__set_prefix_dir_and_sub_variables` `<_prefix>` [`<skip_validation>`]
##
build_props__set_prefix_dir_and_sub_variables() {

local _prefix="${1:-}"
local skip_validation="${2:-}"

if [[ "$skip_validation" != "true" ]]; then
    if [[ ! "$_prefix" =~ ${REGEX__SAFE_ABSOLUTE_PATH:?} ]] || \
            [[ "$_prefix" =~ ${REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH:?} ]]; then
        echo "The _prefix '$_prefix' passed to 'build_props__set_prefix_dir_and_sub_variables' with length ${#_prefix} is invalid." 1>&2
        echo "The _prefix must match a safe absolute path that starts with a \`/\` with at least one \
characters under rootfs \`/\`. Duplicate or trailing path separators \`/\` are not allowed. \
The path component characters must be in the range \`[a-zA-Z0-9+,.=_-]\`. The path must not contain single \`/./\` or \
double \`/../\` dot components." 1>&2
        return 1
    fi

    if [[ "$_prefix" =~ ${REGEX__INVALID_PREFIX_PATHS:?} ]]; then
        echo "The _prefix '$_prefix' passed to 'build_props__set_prefix_dir_and_sub_variables' with length ${#_prefix} is invalid." 1>&2
        echo "The _prefix must not match one of the invalid paths \
in REGEX__INVALID_PREFIX_PATHS \`$REGEX__INVALID_PREFIX_PATHS\`." 1>&2
        return 1
    fi
fi


# Override `_PREFIX`, but keep original value in `_PREFIX_CLASSICAL`.
_PREFIX="$_prefix"
PREFIX="$_prefix"



##
# repoexe subdirectory path for `_PREFIX__BIN_DIR`.
#
# Constant value: `bin`
##
_PREFIX__BIN_SUBDIR="bin"

##
# repoexe bin directory path under `_PREFIX`.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-bin-directory
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/bin`
##
_PREFIX__BIN_DIR="$_PREFIX/$_PREFIX__BIN_SUBDIR"



##
# repoexe subdirectory path for `_PREFIX__ETC_DIR`.
#
# Constant value: `etc`
##
_PREFIX__ETC_SUBDIR="etc"

##
# repoexe etc directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/etc`
##
_PREFIX__ETC_DIR="$_PREFIX/$_PREFIX__ETC_SUBDIR"



##
# repoexe subdirectory path for `_PREFIX__BASE_INCLUDE_DIR`.
#
# Constant value: `include`
##
_PREFIX__BASE_INCLUDE_SUBDIR="include"

##
# repoexe base include directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/include`
##
_PREFIX__BASE_INCLUDE_DIR="$_PREFIX/$_PREFIX__BASE_INCLUDE_SUBDIR"


##
# repoexe subdirectory path for `_PREFIX__MULTI_INCLUDE_DIR`.
#
# Constant value: `include32`
##
_PREFIX__MULTI_INCLUDE_SUBDIR="include32"

##
# repoexe multi include directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/include32`
##
_PREFIX__MULTI_INCLUDE_DIR="$_PREFIX/$_PREFIX__MULTI_INCLUDE_SUBDIR"


##
# repoexe include subdirectory path under `_PREFIX`.
#
# Default value: `include`
##
_PREFIX__INCLUDE_SUBDIR="$_PREFIX__BASE_INCLUDE_SUBDIR"

##
# repoexe include directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/include` (`$_PREFIX__BASE_INCLUDE_DIR`)
##
_PREFIX__INCLUDE_DIR="$_PREFIX__BASE_INCLUDE_DIR"



##
# repoexe subdirectory path for `_PREFIX__BASE_LIB_DIR`.
#
# Constant value: `lib`
##
_PREFIX__BASE_LIB_SUBDIR="lib"

##
# repoexe base lib directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/lib`
##
_PREFIX__BASE_LIB_DIR="$_PREFIX/$_PREFIX__BASE_LIB_SUBDIR"


##
# repoexe subdirectory path for `_PREFIX__MULTI_LIB_DIR`.
#
# Constant value: `lib32`
##
_PREFIX__MULTI_LIB_SUBDIR="lib32"

##
# repoexe multi lib directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/lib32`
##
_PREFIX__MULTI_LIB_DIR="$_PREFIX/$_PREFIX__MULTI_LIB_SUBDIR"


##
# repoexe lib subdirectory path under `_PREFIX`.
#
# Default value: `lib`
##
_PREFIX__LIB_SUBDIR="$_PREFIX__BASE_LIB_SUBDIR"

##
# repoexe lib directory path under `_PREFIX`.
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-lib-directory
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/lib` (`$_PREFIX__BASE_LIB_DIR`)
##
_PREFIX__LIB_DIR="$_PREFIX__BASE_LIB_DIR"



##
# repoexe subdirectory path for `_PREFIX__LIBEXEC_DIR`.
#
# Constant value: `libexec`
##
_PREFIX__LIBEXEC_SUBDIR="libexec"

##
# repoexe libexec directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/libexec`
##
_PREFIX__LIBEXEC_DIR="$_PREFIX/$_PREFIX__LIBEXEC_SUBDIR"



##
# repoexe subdirectory path for `_PREFIX__OPT_DIR`.
#
# Constant value: `opt`
##
_PREFIX__OPT_SUBDIR="opt"

##
# repoexe opt directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/opt`
##
_PREFIX__OPT_DIR="$_PREFIX/$_PREFIX__OPT_SUBDIR"



##
# repoexe subdirectory path for `_PREFIX__SHARE_DIR`.
#
# Constant value: `share`
##
_PREFIX__SHARE_SUBDIR="share"

##
# repoexe share directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/share`
##
_PREFIX__SHARE_DIR="$_PREFIX/$_PREFIX__SHARE_SUBDIR"



##
# repoexe subdirectory path for `_PREFIX__VAR_DIR`.
#
# Constant value: `var`
##
_PREFIX__VAR_SUBDIR="var"

##
# repoexe var directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/var`
##
_PREFIX__VAR_DIR="$_PREFIX/$_PREFIX__VAR_SUBDIR"

}

# Set repoexe prefix sub variables to be under the original value of
# `_PREFIX` set in `_PREFIX_CLASSICAL` by default,
# which is set earlier in this file.
# Skip validation as it will be done below by `__build_props__validate_variables`.
build_props__set_prefix_dir_and_sub_variables "$_PREFIX" "true" || exit $?





# The following variables must always be under the original value of
# `_PREFIX` set in `_PREFIX_CLASSICAL` by default.

##
# repoexe subdirectory path for `_PREFIX__TMP_DIR`.
#
# Constant value: `tmp`
##
_PREFIX__TMP_SUBDIR="tmp"

##
# repoexe tmp directory path under `_PREFIX`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/tmp`
##
_PREFIX__TMP_DIR="$_PREFIX/$_PREFIX__TMP_SUBDIR"

##
# The max length for the `_PREFIX__TMP_DIR` including the null
# '\0' terminator.
#
# Check https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#file-path-limits
# for why the value `94` is chosen.
#
# Constant value: `94`
##
_PREFIX__TMP_DIR___MAX_LEN=94



##
# repoexe `profile.d` directory path under `_PREFIX__ETC_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/etc/profile.d`
##
_PREFIX__PROFILE_D_DIR="$_PREFIX__ETC_DIR/profile.d"


##
# repoexe project system config directory path under `_PREFIX__ETC_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/etc/repoexe`
##
_PROJECT_SYSTEM_CONFIG_DIR="$_PREFIX__ETC_DIR/$_INTERNAL_NAME"





####
# Variables for the repoexe cache.
####

##
# repoexe subdirectory path for `_CACHE_DIR`.
#
# Constant value: `cache`
##
_CACHE_SUBDIR="cache"

###########
# Uncomment if to place `_ROOTFS`  under `_PROJECT_DIR`
# instead of at `files`. This may be used for future multi-rootfs
# design. This will also ensure `repoexe` files are not mixed with
# other cached files of an app, especially if repoexe is forked or
# used as a library in other apps. Make sure to update
# `_ROOTFS_SUBDIR` above as well.

##
# repoexe subdirectory path for `_CACHE_DIR`.
#
# Default value: `cache/repoexe/rootfs/0`
##
#_CACHE_SUBDIR="cache/$_INTERNAL_NAME/rootfs/$_ROOTFS_ID"
###########

##
# repoexe app cache directory path under `APP__DATA_DIR`
# contains cache files that are safe to be deleted by Android or
# repoexe if required.
#
# The `cache` subdirectory is hardcoded in Android and must not be
# changed.
#
# Currently this is primarily used for packages cache files of package
# managers (`apt`/`pacman`).
#
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-app-cache-directory
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/cache`
##
_CACHE_DIR="$APP__DATA_DIR/$_CACHE_SUBDIR"
__build_props__add_variables_validator_actions "_CACHE_DIR" "safe_absolute_path"

CACHE_DIR="$_CACHE_DIR" # Deprecated alternative variable for `_CACHE_DIR`





####
# Variables for the repoexe bootstrap.
####

##
# repoexe bootstrap system config directory path under `_PROJECT_SYSTEM_CONFIG_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/etc/repoexe/repoexe-bootstrap`
##
BOOTSTRAP__BOOTSTRAP_SYSTEM_CONFIG_DIR="$_PROJECT_SYSTEM_CONFIG_DIR/repoexe-bootstrap"


##
# repoexe subdirectory path for `BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_DIR`.
#
# Constant value: `second-stage`
##
BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_SUBDIR="second-stage"

##
# repoexe bootstrap second stage directory path under `BOOTSTRAP__BOOTSTRAP_SYSTEM_CONFIG_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/etc/repoexe/repoexe-bootstrap/second-stage`
##
BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_DIR="$BOOTSTRAP__BOOTSTRAP_SYSTEM_CONFIG_DIR/$BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_SUBDIR"


##
# repoexe bootstrap second stage entry point subfile path path under `BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_DIR`.
#
# Default value: `repoexe-bootstrap-second-stage.sh`
##
BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_ENTRY_POINT_SUBFILE="repoexe-bootstrap-second-stage.sh"





##
# Max size in bytes for a path component or file name without the
# terminating `null` byte `\0`.
#
# On unix systems, any path component length of a path cannot be
# greater than what is supported by the filesystem under which the
# path is mounted.
#
# The common filesystems like `ext4`/`f2fs`/`btrfs`/`erofs`/`fat32`/`exfat`/`ntfs`
# all support max path component length of `255`. Check
# [filesystems limits wiki page] for more info on limits.
#
# The [POSIX standard requires `NAME_MAX` to be defined in `limits.h`] (not `c` standard).
#
# [`NAME_MAX`]: https://cs.android.com/android/platform/superproject/+/android-13.0.0_r18:bionic/libc/kernel/uapi/linux/limits.h;l=27
# [`readdir`]: https://www.man7.org/linux/man-pages/man3/readdir.3.html
# [`readdir_r`]: https://www.man7.org/linux/man-pages/man3/readdir_r.3.html
# [filesystems limits wiki page]: https://en.wikipedia.org/wiki/Comparison_of_file_systems#Limits
# [POSIX standard requires `NAME_MAX` to be defined in `limits.h`]: https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/limits.h.html
# [path component length greater than `NAME_MAX` should be considered an error]: https://pubs.opengroup.org/onlinepubs/9699919799/basedefs/V1_chap04.html#4.13
# [`NAME_MAX` value should normally be set to `255`]: https://cs.android.com/android/platform/superproject/+/android-13.0.0_r18:bionic/libc/kernel/uapi/linux/limits.h;l=27
# [the `NAME_MAX` value may not always be enforced, like by the GNU C library]: https://www.gnu.org/software/libc/manual/html_node/Limits-for-Files.html
# [`_PC_NAME_MAX` defined by POSIX]: https://pubs.opengroup.org/onlinepubs/9699919799/functions/pathconf.html
# [`glibc` `_PC_NAME_MAX` source]: https://github.com/bminor/glibc/blob/569cfcc6/sysdeps/posix/fpathconf.c#L65
# [`bionic` `_PC_NAME_MAX` source]: https://cs.android.com/android/platform/superproject/+/android-13.0.0_r18:bionic/libc/bionic/pathconf.cpp;l=91
# [`pathconf`]: https://man7.org/linux/man-pages/man3/pathconf.3.html
# [`statvfs.f_namemax`]: https://man7.org/linux/man-pages/man3/statvfs.3.html
# [`realpath(1)`]: https://man7.org/linux/man-pages/man1/realpath.1.html
# [`realpath(3)`]: https://man7.org/linux/man-pages/man3/realpath.3.html
# [To what extent does Linux support file names longer than 255 bytes?]: https://unix.stackexchange.com/questions/619625/to-what-extent-does-linux-support-file-names-longer-than-255-bytes
# [Extending ext4 File system's filename size limit to 1012 characters]: https://stackoverflow.com/questions/34980895/extending-ext4-file-systems-filename-size-limit-to-1012-characters
# [Limit on file name length in bash]: https://stackoverflow.com/questions/6571435/limit-on-file-name-length-in-bash
#
# Constant value: `255`
##
_NAME_MAX=255

##
# The max length for a filesystem socket file path (pathanme UNIX domain socket)
# for the `sockaddr_un.sun_path` field including the null `\0`
# terminator as per `UNIX_PATH_MAX`.
#
# All filesystem socket path lengths created by repoexe apps and packages must be `< 108`.
#
# - https://man7.org/linux/man-pages/man7/unix.7.html
# - https://cs.android.com/android/platform/superproject/+/android-13.0.0_r18:bionic/libc/kernel/uapi/linux/un.h;l=22
#
# Constant value: `108`
##
_UNIX_PATH_MAX=108





##
# repoexe environment variables root scope.
#
# The name of this variable `ENV__S_ROOT` is considered a
# constant for repoexe execution environment that's exported by repoexe
# app containing the root scope and **must not be changed even for
# forks**. It can be used to check if running under repoexe or any of
# its forks, and should be used to generate all repoexe variable names
# that may need to be read, since repoexe app forks may not export
# variables under the `` root scope and may do it under a
# different root scope like `FOO_`, so the `_PREFIX` variable
# would be `FOO__PREFIX` instead.
#
# The `ENV__S_APP` environment variable will be exported at
# runtime for the scope of the current repoexe app running the shell.
#
# repoexe packages and external programs can use the
# `repoexe-scoped-env-variable` util from the `repoexe-core`
# package to get variable names and values for repoexe. It uses the
# root scope from the `$ENV__S_ROOT` environment variable
# exported by the repoexe app to dynamically generate the repoexe
# variable names and/or get their values, with support for fallback
# to the build values defined here if `$ENV__S_ROOT` variable
# is not exported.**
# - https://github.com/repoexe/repoexe-core-package/blob/master/site/pages/en/projects/docs/usage/utils/repoexe/shell/command/environment/repoexe-scoped-env-variable.md
#
# The value of this variable `ENV__S_ROOT` may be modified,
# although not advisable since external programs would be using
# hardcoded `` value for reading repoexe environment variables,
# and so changing variable names to say `FOO_*` would result in
# `*` ones being unset during execution, which would change
# external programs behaviour and may break them.
# **If the value is changed here, it must also be set to the same
# value in repoexe app that is exported.**
#
# Moreover, currently, only `repoexe-exec` supports modifying this, all
# other repoexe (internal) packages, like `repoexe-tools`, etc do not.
# So forks should not modify it at least until all repoexe packages
# support modifying it.
#
# Default value: ``
##
ENV__S_ROOT=""



##
# repoexe environment variables repoexe sub scope for primary variables
# or variables for currently running repoexe config.
#
# **Do not modify this!** This is considered a constant repoexe sub
# scope for repoexe execution environment that's used by external
# programs that do not use the repoexe packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# repoexe app containing the root scope to generate the value for
# `$ENV__S_repoexe` and variable names under it.**
#
# Default value: `_`
##
ENV__SS_repoexe="_"

##
# repoexe environment variables repoexe scope for primary variables or
# variables for currently running repoexe config.
#
# **Do not modify this!**
#
# Default value: `_`
##
ENV__S_repoexe="${ENV__S_ROOT}${ENV__SS_repoexe}"



##
# repoexe environment variables repoexe app sub scope.
#
# **Do not modify this!** This is considered a constant repoexe app sub
# scope for repoexe execution environment that's used by external
# programs that do not use the repoexe packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# repoexe app containing the root scope to generate the value for
# `$ENV__S_APP` and variable names under it.**
#
# Default value: `APP__`
##
ENV__SS_APP="APP__"

##
# repoexe environment variables repoexe app scope.
#
# **Do not modify this!**
#
# Default value: `APP__`
##
ENV__S_APP="${ENV__S_ROOT}${ENV__SS_APP}"



##
# repoexe environment variables repoexe:API sub scope.
#
# **Do not modify this!** This is considered a constant repoexe:API
# sub scope for repoexe execution environment that's used by external
# programs that do not use the repoexe packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# repoexe app containing the root scope to generate the value for
# `$ENV__S_API` and variable names under it.**
#
# Default value: `API__`
##
ENV__SS_API="API__"

##
# repoexe environment variables repoexe:API scope.
#
# **Do not modify this!**
#
# Default value: `API__`
##
ENV__S_API="${ENV__S_ROOT}${ENV__SS_API}"



##
# repoexe environment variables repoexe:API app sub scope.
#
# This may be allowed to be modified, in case APIs are provided under
# a different app name or under the main repoexe app itself by a fork.
# Consequences for changing this haven't been fully looked at yet.
#
# Default value: `API_APP__`
##
ENV__SS_API_APP="API_APP__"

##
# repoexe environment variables repoexe:API app scope.
#
# **Do not modify this!**
#
# Default value: `API_APP__`
##
ENV__S_API_APP="${ENV__S_ROOT}${ENV__SS_API_APP}"



##
# repoexe environment variables repoexe rootfs sub scope.
#
# **Do not modify this!** This is considered a constant repoexe rootfs
# sub scope for repoexe execution environment that's used by external
# programs that do not use the repoexe packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# repoexe app containing the root scope to generate the value for
# `$ENV__S_ROOTFS` and variable names under it.**
#
# Default value: `ROOTFS__`
##
ENV__SS_ROOTFS="ROOTFS__"

##
# repoexe environment variables repoexe rootfs scope.
#
# **Do not modify this!**
#
# Default value: `ROOTFS__`
##
ENV__S_ROOTFS="${ENV__S_ROOT}${ENV__SS_ROOTFS}"



##
# repoexe environment variables `repoexe-core` sub scope.
#
# **Do not modify this!** This is considered a constant `repoexe-core`
# sub scope for repoexe execution environment that's used by external
# programs that do not use the repoexe packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# repoexe app containing the root scope to generate the value for
# `$ENV__S_CORE` and variable names under it.**
#
# Default value: `CORE__`
##
ENV__SS_CORE="CORE__"

##
# repoexe environment variables `repoexe-core` scope.
#
# **Do not modify this!**
#
# Default value: `CORE__`
##
ENV__S_CORE="${ENV__S_ROOT}${ENV__SS_CORE}"


##
# repoexe environment variables `repoexe-core-tests` sub scope.
#
# **Do not modify this!** This is considered a constant
# `repoexe-core-tests` sub scope for repoexe execution environment
#  that's used by `repoexe-core` package to generate the value for
# `$ENV__S_CORE__TESTS` and variable names under it.**
#
# Default value: `CORE__TESTS__`
##
ENV__SS_CORE__TESTS="CORE__TESTS__"

##
# repoexe environment variables `repoexe-core-tests` scope.
#
# **Do not modify this!**
#
# Default value: `CORE__TESTS__`
##
ENV__S_CORE__TESTS="${ENV__S_ROOT}${ENV__SS_CORE__TESTS}"



##
# repoexe environment variables `repoexe-exec` sub scope.
#
# **Do not modify this!** This is considered a constant `repoexe-exec`
# sub scope for repoexe execution environment that's used by external
# programs that do not use the repoexe packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# repoexe app containing the root scope to generate the value for
# `$ENV__S_EXEC` and variable names under it.**
#
# Default value: `EXEC__`
##
ENV__SS_EXEC="EXEC__"

##
# repoexe environment variables `repoexe-exec` scope.
#
# **Do not modify this!**
#
# Default value: `EXEC__`
##
ENV__S_EXEC="${ENV__S_ROOT}${ENV__SS_EXEC}"


##
# repoexe environment variables `repoexe-exec-tests` sub scope.
#
# **Do not modify this!** This is considered a constant
# `repoexe-exec-tests` sub scope for repoexe execution environment
#  that's used by `repoexe-exec` package to generate the value for
# `$ENV__S_EXEC__TESTS` and variable names under it.**
#
# Default value: `EXEC__TESTS__`
##
ENV__SS_EXEC__TESTS="EXEC__TESTS__"

##
# repoexe environment variables `repoexe-exec-tests` scope.
#
# **Do not modify this!**
#
# Default value: `EXEC__TESTS__`
##
ENV__S_EXEC__TESTS="${ENV__S_ROOT}${ENV__SS_EXEC__TESTS}"



##
# repoexe environment variables `repoexe-am-socket` sub scope.
#
# **Do not modify this!** This is considered a constant `repoexe-am-socket`
# sub scope for repoexe execution environment that's used by external
# programs that do not use the repoexe packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# repoexe app containing the root scope to generate the value for
# `$ENV__S_AM_SOCKET` and variable names under it.**
#
# Default value: `AM_SOCKET__`
##
ENV__SS_AM_SOCKET="AM_SOCKET__"

##
# repoexe environment variables `repoexe-am-socket` scope.
#
# **Do not modify this!**
#
# Default value: `AM_SOCKET__`
##
ENV__S_AM_SOCKET="${ENV__S_ROOT}${ENV__SS_AM_SOCKET}"





####
# Variables for the repoexe packages.
#
# - https://github.com/repoexe/repoexe-packages
####

##
# repoexe packages repo name.
#
# Default value: `repoexe-packages`
##
PKGS__REPO_NAME="repoexe-packages"

##
# repoexe packages repo url.
#
# Default value: `https://github.com/repoexe/repoexe-packages`
##
PKGS__REPO_URL="$_REPOS_HOST_ORG_URL/$PKGS__REPO_NAME"





####
# Variables for the repoexe app that hosts the packages.
#
# - https://github.com/repoexe/repoexe-app
####

##
# repoexe app name.
#
# Default value: `repoexe`
##
APP__NAME="$_NAME"


##
# The lower case value for `APP__NAME`.
#
# Default value: `repoexe`
##
APP__LNAME="${APP__NAME,,}"

##
# repoexe app identifier for `_APPS_DIR_BY_IDENTIFIER` subdirectory.
#
# Default value: `repoexe`
# Validation regex: `_APPS_APP_IDENTIFIER_REGEX`
# Max length: `_APPS_APP_IDENTIFIER___MAX_LEN`
##
APP__APP_IDENTIFIER="repoexe"



##
# repoexe app repo name.
#
# Default value: `repoexe-app`
##
APP__REPO_NAME="repoexe-app"

##
# repoexe app repo url.
#
# Default value: `https://github.com/repoexe/repoexe-app`
##
APP__REPO_URL="$_REPOS_HOST_ORG_URL/$APP__REPO_NAME"



##
# repoexe app namespace, i.e the Java package name under which repoexe
# classes exists used for `APP__*_CLASS__*` and
# `APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# **See Also:**
# - `APP__PACKAGE_NAME`.
# - https://developer.android.com/build/configure-app-module#set-namespace
# - https://github.com/repoexe/repoexe-app/tree/master/app/src/main/java/com/repoexe
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__`
##
APP__NAMESPACE="__COM_REPOEXE_PLACEHOLDER__"

__build_props__add_variables_validator_actions "APP__NAMESPACE" "app_package_name"



##
# repoexe app apps directory path under `_APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app/i/repoexe`
##
APP__APP_DIR="$_APPS_DIR_BY_IDENTIFIER/$APP__APP_IDENTIFIER"
__build_props__add_variables_validator_actions "APP__APP_DIR" "safe_absolute_path"



##
# repoexe app shell API `Activity` class name that hosts the
# shell/terminal views.
#
# **See Also:**
# - https://github.com/repoexe/repoexe-app/blob/master/app/src/main/java/com/repoexe/app/repoexeActivity.java
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.app.repoexeActivity`
##
APP__SHELL_API__SHELL_API_ACTIVITY__CLASS_NAME="$APP__NAMESPACE.app.repoexeActivity"



##
# repoexe app shell API `Service` class name that hosts the
# shell/terminal sessions.
#
# **See Also:**
# - https://github.com/repoexe/repoexe-app/blob/master/app/src/main/java/com/repoexe/app/repoexeService.java
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.app.repoexeService`
##
APP__SHELL_API__SHELL_API_SERVICE__CLASS_NAME="$APP__NAMESPACE.app.repoexeService"



##
# repoexe app `RUN_COMMAND` API `Service` class name that receives
# commands sent by 3rd party apps via intents.
#
# **See Also:**
# - https://github.com/repoexe/repoexe-app/blob/master/app/src/main/java/com/repoexe/app/RunCommandService.java
# - https://github.com/repoexe/repoexe-app/wiki/RUN_COMMAND-Intent
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.app.RunCommandService`
##
APP__RUN_COMMAND_API__RUN_COMMAND_API_SERVICE__CLASS_NAME="$APP__NAMESPACE.app.RunCommandService"



##
# repoexe app data sender API `BroadcastReceiver` class name that
# receives data view broadcasts and sends the data with `ACTION_SEND`
# and `ACTION_VIEW` intents to other apps, like by `repoexe-open`.
#
# **See Also:**
# - https://github.com/repoexe/repoexe-app/blob/master/app/src/main/java/com/repoexe/app/repoexeOpenReceiver.java
# - https://github.com/repoexe/repoexe-tools/blob/master/scripts/repoexe-open.in
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.app.repoexeOpenReceiver`
##
APP__DATA_SENDER_API__DATA_SENDER_API_RECEIVER__CLASS_NAME="$APP__NAMESPACE.app.repoexeOpenReceiver"





##
# repoexe apps info environment file path for the repoexe app under `APP__APP_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app/i/repoexe/repoexe-apps-info.env`
##
APP__CORE__APPS_INFO_ENV_FILE="$APP__APP_DIR/$CORE__APPS_INFO_ENV_SUBFILE"
__build_props__add_variables_validator_actions "APP__CORE__APPS_INFO_ENV_FILE" "safe_absolute_path"

##
# repoexe apps info json file path for the repoexe app under `APP__APP_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app/i/repoexe/repoexe-apps-info.json`
##
APP__CORE__APPS_INFO_JSON_FILE="$APP__APP_DIR/$CORE__APPS_INFO_JSON_SUBFILE"
__build_props__add_variables_validator_actions "APP__CORE__APPS_INFO_JSON_FILE" "safe_absolute_path"

##
# `repoexe-am-socket` server file path for the repoexe app under `APP__APP_DIR`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app/i/repoexe/repoexe-am`
##
APP__AM_SOCKET__SERVER_SOCKET_FILE="$APP__APP_DIR/$AM_SOCKET__SERVER_SOCKET_SUBFILE"
__build_props__add_variables_validator_actions "APP__AM_SOCKET__SERVER_SOCKET_FILE" "safe_absolute_path unix_path_max"





####
# Variables for the repoexe:API app that hosts the packages.
#
# - https://github.com/repoexe/repoexe-api
####

##
# repoexe:API app package name used for
# `API_APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# **See Also:**
# - `API_APP__NAMESPACE`.
# - https://developer.android.com/build/configure-app-module#set-application-id
# - https://github.com/repoexe/repoexe-packages/wiki/repoexe-file-system-layout#repoexe-private-app-data-directory
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.api`
##
API_APP__PACKAGE_NAME="__COM_REPOEXE_PLACEHOLDER__.api"

__build_props__add_variables_validator_actions "API_APP__PACKAGE_NAME" "app_package_name"



##
# repoexe:API app name.
#
# Default value: `repoexe:API`
##
API_APP__NAME="$_NAME:API"

##
# repoexe:API app identifier for `_APPS_DIR_BY_IDENTIFIER` subdirectory.
#
# Default value: `repoexeapi`
# Validation regex: `_APPS_APP_IDENTIFIER_REGEX`
# Max length: `_APPS_APP_IDENTIFIER___MAX_LEN`
##
API_APP__APP_IDENTIFIER="repoexeapi"



##
# repoexe:API app repo name.
#
# Default value: `repoexe-api`
##
API_APP__REPO_NAME="repoexe-api"

##
# repoexe:API app repo url.
#
# Default value: `https://github.com/repoexe/repoexe-api`
##
API_APP__REPO_URL="$_REPOS_HOST_ORG_URL/$API_APP__REPO_NAME"



##
# repoexe:API app namespace, i.e the Java package name under which
# repoexe:API classes exists used for `API_APP__*_CLASS__*` and
# `API_APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# **See Also:**
# - `API_APP__PACKAGE_NAME`.
# - https://developer.android.com/build/configure-app-module#set-namespace
# - https://github.com/repoexe/repoexe-api/tree/master/app/src/main/java/com/repoexe/api
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.api`
##
API_APP__NAMESPACE="__COM_REPOEXE_PLACEHOLDER__.api"

__build_props__add_variables_validator_actions "API_APP__NAMESPACE" "app_package_name"



##
# repoexe:API app apps directory path under `_APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app/i/repoexeapi`
##
API_APP__APP_DIR="$_APPS_DIR_BY_IDENTIFIER/$API_APP__APP_IDENTIFIER"
__build_props__add_variables_validator_actions "API_APP__APP_DIR" "safe_absolute_path"



##
# repoexe:API app Android API `BroadcastReceiver` class name that
# receives and processes API requests from command line via `repoexe-api`
# native exec entry point.
#
# **See Also:**
# - https://github.com/repoexe/repoexe-api/blob/master/app/src/main/java/com/repoexe/api/repoexeApiReceiver.java
# - https://github.com/repoexe/repoexe-api-package/blob/master/repoexe-api.c
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.api.repoexeApiReceiver`
##
API_APP__ANDROID_API__ANDROID_API_RECEIVER__CLASS_NAME="$API_APP__NAMESPACE.repoexeApiReceiver"





####
# Variables for the `repoexe-api` package.
#
# - https://github.com/repoexe/repoexe-api-package
####

##
# The `repoexe-api` package repo name.
#
# Default value: `repoexe-api-package`
##
API_PKG__REPO_NAME="repoexe-api-package"

##
# The `repoexe-api` package repo url.
#
# Default value: `https://github.com/repoexe/repoexe-api-package`
##
API_PKG__REPO_URL="$_REPOS_HOST_ORG_URL/$API_PKG__REPO_NAME"










####
# Variables for the `repoexe-core` package.
#
# - https://github.com/repoexe/repoexe-core-package
####

##
# The `repoexe-core` package repo name.
#
# Default value: `repoexe-core-package`
##
CORE_PKG__REPO_NAME="repoexe-core-package"

##
# The `repoexe-core` package repo url.
#
# Default value: `https://github.com/repoexe/repoexe-core-package`
##
CORE_PKG__REPO_URL="$_REPOS_HOST_ORG_URL/$CORE_PKG__REPO_NAME"





####
# Variables for the `repoexe-am` package.
#
# - https://github.com/repoexe/repoexeAm
####

##
# The `repoexe-am` package repo name.
#
# Default value: `repoexeAm`
##
AM_PKG__REPO_NAME="repoexeAm"

##
# The `repoexe-am` package repo url.
#
# Default value: `https://github.com/repoexe/repoexeAm`
##
AM_PKG__REPO_URL="$_REPOS_HOST_ORG_URL/$AM_PKG__REPO_NAME"



##
# repoexeAm namespace, i.e the Java package name under which repoexe
# classes exists used for `AM__*_CLASS__*` variables.
#
# This must not be changed unless the classes in the `repoexeAm` repo
# are moved to a different Java package name (in forks).
#
# **See Also:**
# - https://developer.android.com/build/configure-app-module#set-namespace
# - https://github.com/repoexe/repoexeAm/tree/master/app/src/main/java/com/repoexe/repoexeam
#
# Constant value: `__COM_REPOEXE_PLACEHOLDER__.repoexeam`
##
AM_APP__NAMESPACE="__COM_REPOEXE_PLACEHOLDER__.repoexeam"

__build_props__add_variables_validator_actions "AM_APP__NAMESPACE" "app_package_name"



##
# repoexeAm main class that is passed as `start-class-name` to
# `/system/bin/app_process` when running `am.apk` set in `$CLASSPATH`.
#
# - https://github.com/repoexe/repoexeAm/blob/master/app/src/main/java/com/repoexe/repoexeam/Am.java
# - https://github.com/repoexe/repoexeAm/blob/v0.8.0/am-libexec-packaged#L30
# - https://cs.android.com/android/platform/superproject/+/android-14.0.0_r1:frameworks/base/cmds/app_process/app_main.cpp;l=31
#
# Default value: `__COM_REPOEXE_PLACEHOLDER__.repoexeam.Am`
##
AM_APP__AM_CLASS__CLASS_NAME="$AM_APP__NAMESPACE.Am"





###
# Variables for the repoexe package repositories.
###

# The core variable values for which the packages hosted on the
# package repos defined in `repo.json` are compiled for.
# If a custom repo is not being hosted, and official repoexe repos are
# still defined in `repo.json`, then DO NOT change these values. If a
# custom repo is being hosted whose variable values equal
# `APP__PACKAGE_NAME`, `APP__DATA_DIR`,
# `_CORE_DIR`, `_APPS_DIR`, `_ROOTFS`,
# `_HOME`, and `_PREFIX` values defined above, then
# update these values respectively to the same values.
# These values are used for the `-i/-I` flags to `build-package.sh`,
# and if respective values do not match, then those flags are ignored
# and dependency packages are not downloaded from the package repos
# and are compiled locally.
# FIXME: Checking for all variables will be added later in repo
# changes pull, currently only `REPO_APP__PACKAGE_NAME` is checked.
REPO_APP__PACKAGE_NAME="__COM_REPOEXE_PLACEHOLDER__"
REPO_APP__DATA_DIR="/data/data/__COM_REPOEXE_PLACEHOLDER__"
REPO__CORE_DIR="/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/core"
REPO__APPS_DIR="/data/data/__COM_REPOEXE_PLACEHOLDER__/repoexe/app"
REPO__ROOTFS="/data/data/__COM_REPOEXE_PLACEHOLDER__/files"
REPO__HOME="/data/data/__COM_REPOEXE_PLACEHOLDER__/files/home"
REPO__PREFIX="/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr"



####
# Variables loaded from `repo.json` file for repoexe package repositories.
####

REPO_URL=()
REPO_DISTRIBUTION=()
REPO_COMPONENT=()

# FIXME: Move `repo.json` file to under `scripts/` directory and COPY it to `/tmp/repoexe-packages` in `Dockerfile`.
if [[ ! -f "$PKGS__BUILD__REPO_ROOT_DIR/repo.json" ]]; then
    if [[ "${PKGS__BUILD__IS_DOCKER_BUILD:-}" != "true" ]]; then
        echo "The 'repo.json' file not found at the '$PKGS__BUILD__REPO_ROOT_DIR/repo.json' path." 1>&2
        exit 1
    fi
else
    export PACKAGES_DIRECTORIES
    PACKAGES_DIRECTORIES=$(jq --raw-output '"packages"' "$PKGS__BUILD__REPO_ROOT_DIR/repo.json")

    for url in $(jq -r '.repo.url' "$PKGS__BUILD__REPO_ROOT_DIR/repo.json"); do
        REPO_URL+=("$url")
    done
    for distribution in $(jq -r '.repo.distribution' "$PKGS__BUILD__REPO_ROOT_DIR/repo.json"); do
        REPO_DISTRIBUTION+=("$distribution")
    done
    for component in $(jq -r '.repo.component' "$PKGS__BUILD__REPO_ROOT_DIR/repo.json"); do
        REPO_COMPONENT+=("$component")
    done
fi





###
# Misc
###

CLEANUP_BUILT_PACKAGES_THRESHOLD="$(( 5 * 1024 ** 3 ))" # 5 GiB
__build_props__add_variables_validator_actions "CLEANUP_BUILT_PACKAGES_THRESHOLD" "unsigned_int"

# Path to CGCT tools
CGCT_DEFAULT_PREFIX="/data/data/__COM_REPOEXE_PLACEHOLDER__/files/usr/glibc"
__build_props__add_variables_validator_actions "CGCT_DEFAULT_PREFIX" "safe_absolute_path invalid_prefix_paths"

export CGCT_DIR="/data/data/__COM_REPOEXE_PLACEHOLDER__/cgct"
__build_props__add_variables_validator_actions "CGCT_DIR" "safe_absolute_path invalid_prefix_paths"

# Allow to override setup.
for f in "${HOME}/.config/repoexe/repoexerc.sh" "${HOME}/.repoexe/repoexerc.sh" "${HOME}/.repoexerc"; do
    if [ -f "$f" ]; then
        echo "Using builder configuration from '$f'..."
        # shellcheck source=/dev/null
        . "$f"
        break
    fi
done
unset f





###
# Run repoexe properties variable values validation.
###

# Uncomment to print `` variables set
#compgen -v  | while read v; do echo "${v}=${!v}"; done

##
# `__build_props__validate_variables`
##
__build_props__validate_variables() {

    local is_value_defined
    local validator_action
    local validator_actions
    local variable_name
    local variable_value

    if [[ ! "$_INTERNAL_NAME" =~ ${_INTERNAL_NAME_REGEX:?} ]]; then
        echo "The _INTERNAL_NAME '$_INTERNAL_NAME' with length ${#_INTERNAL_NAME} is invalid." 1>&2
        echo "Check '_INTERNAL_NAME_REGEX' variable docs for info on what is a valid internal name." 1>&2
        return 1
    fi

    if [ "${#_INTERNAL_NAME}" -gt ${_INTERNAL_NAME___MAX_LEN:?} ]; then
        echo "The _INTERNAL_NAME '$_INTERNAL_NAME' with length ${#_INTERNAL_NAME} is invalid." 1>&2
        echo "The _INTERNAL_NAME must have max length \`<= _INTERNAL_NAME___MAX_LEN ($_INTERNAL_NAME___MAX_LEN)\`." 1>&2
        return 1
    fi

    if [[ ! "$APP__DATA_DIR" =~ ${REGEX__APP_DATA_DIR_PATH:?} ]]; then
        echo "The APP__DATA_DIR '$APP__DATA_DIR' with length ${#APP__DATA_DIR} is invalid." 1>&2
        echo "The APP__DATA_DIR must match \`/data/data/<package_name>\`, \`/data/user/<user_id>/<package_name>\` \
or \`/mnt/expand/<volume_uuid>/user/<user_id>/<package_name>\` formats." 1>&2
        return 1
    fi


    for variable_name in "${__BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_VARIABLE_NAMES[@]}"; do
        if [[ ! "$variable_name" =~ ^[a-zA-Z_][a-zA-Z0-9_]*$ ]]; then
            echo "The variable_name '$variable_name' in repoexe properties variables validator actions is not a valid shell variable name." 1>&2
            return 1
        fi

        variable_value="${!variable_name:-}"
        validator_actions="${__BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_MAP["$variable_name"]}"
        [[ -z "$validator_actions" ]] && continue

        if [[ -n "$variable_value" ]]; then
            :
        else
            is_value_defined=0
            eval '[ -n "${'"$variable_name"'+x}" ] && is_value_defined=1'

            # If not defined.
            if [[ "$is_value_defined" = "0" ]]; then
                echo "The variable_name '$variable_name' in repoexe properties variables validator actions is not defined." 1>&2
                return 1
            fi

            # If defined but unset.
            [[ " ${validator_actions[*]} " == *" allow_unset_value "* ]] && continue

            echo "The repoexe properties variable value for variable name '$variable_name' is not set." 1>&2
            return 1
        fi

        for validator_action in $validator_actions; do
            case "$validator_action" in
                allow_unset_value)
                    :
                    ;;
                app_package_name)
                    if [[ ! "$variable_value" =~ ${REGEX__APP_PACKAGE_NAME:?} ]] || \
                            [ "${#variable_value}" -gt "${_NAME_MAX:?}" ]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must be a valid android app package name with \
max length \`<= _NAME_MAX ($_NAME_MAX)\`." 1>&2
                        echo "- https://developer.android.com/build/configure-app-module#set-application-id" 1>&2
                        return 1
                    fi
                    ;;
                invalid_rootfs_paths)
                    if [[ "$variable_value" =~ ${REGEX__INVALID_ROOTFS_PATHS:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must not match one of the invalid paths \
in REGEX__INVALID_ROOTFS_PATHS \`$REGEX__INVALID_ROOTFS_PATHS\`." 1>&2
                        return 1
                    fi
                    ;;
                invalid_home_paths)
                    if [[ "$variable_value" =~ ${REGEX__INVALID_HOME_PATHS:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must not match one of the invalid paths \
in REGEX__INVALID_HOME_PATHS \`$REGEX__INVALID_HOME_PATHS\`." 1>&2
                        return 1
                    fi
                    ;;
                invalid_prefix_paths)
                    if [[ "$variable_value" =~ ${REGEX__INVALID_PREFIX_PATHS:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must not match one of the invalid paths \
in REGEX__INVALID_PREFIX_PATHS \`$REGEX__INVALID_PREFIX_PATHS\`." 1>&2
                        return 1
                    fi
                    ;;
                path_equal_to_or_under_rootfs)
                    if [[ "$variable_value" != "${_ROOTFS:?}" ]] && \
                            {
                                { [[ "${_ROOTFS:?}" != "/" ]] && [[ "$variable_value" != "${_ROOTFS}/"* ]]; } || \
                                { [[ "${_ROOTFS:?}" == "/" ]] && [[ "$variable_value" != "/"* ]]; };
                            }; then
                        echo "The $variable_name '$variable_value' is invalid." 1>&2
                        echo "The $variable_name must be equal to or be under _ROOTFS \`$_ROOTFS\`." 1>&2
                        return 1
                    fi
                    ;;
                path_under_rootfs)
                    if { [[ "${_ROOTFS:?}" != "/" ]] && [[ "$variable_value" != "${_ROOTFS}/"* ]]; } || \
                        { [[ "${_ROOTFS:?}" == "/" ]] && [[ "$variable_value" != "/"* ]]; }; then
                        echo "The $variable_name '$variable_value' is invalid." 1>&2
                        echo "The $variable_name must be under _ROOTFS \`$_ROOTFS\`." 1>&2
                        return 1
                    fi
                    ;;
                safe_absolute_path)
                    if [[ ! "$variable_value" =~ ${REGEX__SAFE_ABSOLUTE_PATH:?} ]] || \
                            [[ "$variable_value" =~ ${REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must match a safe absolute path that starts with a \`/\` with at least one \
characters under rootfs \`/\`. Duplicate or trailing path separators \`/\` are not allowed. \
The path component characters must be in the range \`[a-zA-Z0-9+,.=_-]\`. The path must not contain single \`/./\` or \
double \`/../\` dot components." 1>&2
                        return 1
                    fi
                    ;;
                safe_relative_path)
                    if [[ ! "$variable_value" =~ ${REGEX__SAFE_RELATIVE_PATH:?} ]] || \
                            [[ "$variable_value" =~ ${REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must match a safe relative path that does not start with a \`/\`. \
Duplicate or trailing path separators \`/\` are not allowed. The path component characters must be in the \
range \`[a-zA-Z0-9+,.=_-]\`. The path must not contain single \`/./\` or double \`/../\` dot components." 1>&2
                        return 1
                    fi
                    ;;
                safe_rootfs_or_absolute_path)
                    if [[ ! "$variable_value" =~ ${REGEX__SAFE_ROOTFS_OR_ABSOLUTE_PATH:?} ]] || \
                            [[ "$variable_value" =~ ${REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must match (rootfs \`/\`) or (a safe absolute path that starts with a \`/\`). \
Duplicate or trailing path separators \`/\` are not allowed. The path component characters must be in the \
range \`[a-zA-Z0-9+,.=_-]\`. The path must not contain single \`/./\` or double \`/../\` dot components." 1>&2
                        return 1
                    fi
                    ;;
                apps_api_socket__server_parent_dir)
                    if [[ "${#variable_value}" -ge "${_APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN:?}" ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must have max length \`<= _APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN \
($_APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN)\` including the null \`\0\` terminator." 1>&2
                        return 1
                    fi
                    ;;
                unix_path_max)
                    if [[ "${#variable_value}" -ge "${_UNIX_PATH_MAX:?}" ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must have max length \`<= _UNIX_PATH_MAX ($_UNIX_PATH_MAX)\` \
including the null \`\0\` terminator." 1>&2
                        return 1
                    fi
                    ;;
                unsigned_int)
                    if [[ ! "$variable_value" =~ ${REGEX__UNSIGNED_INT:?} ]]; then
                        echo "The $variable_name '$variable_value' is invalid." 1>&2
                        echo "The $variable_name must be an unsigned integer \`>= 0\`." 1>&2
                        return 1
                    fi
                    ;;
                *)
                    echo "The repoexe properties variables validator action '$validator_action' for \
variable name '$variable_name' is invalid." 1>&2
                    return 1
                    ;;
            esac
        done
    done


    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#APP__DATA_DIR}" -ge ${APP__DATA_DIR___MAX_LEN:?} ]; then
        echo "The APP__DATA_DIR '$APP__DATA_DIR' with length ${#APP__DATA_DIR} is invalid." 1>&2
        echo "The APP__DATA_DIR must have max length \`<= APP__DATA_DIR___MAX_LEN ($APP__DATA_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi

    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#_APPS_DIR}" -ge ${_APPS_DIR___MAX_LEN:?} ]; then
        echo "The _APPS_DIR '$_APPS_DIR' with length ${#_APPS_DIR} is invalid." 1>&2
        echo "The _APPS_DIR must have max length \`<= _APPS_DIR___MAX_LEN ($_APPS_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi


    if [[ ! "$APP__APP_IDENTIFIER" =~ ${_APPS_APP_IDENTIFIER_REGEX:?} ]]; then
        echo "The APP__APP_IDENTIFIER '$APP__APP_IDENTIFIER' with length ${#APP__APP_IDENTIFIER} is invalid." 1>&2
        echo "Check '_APPS_APP_IDENTIFIER_REGEX' variable docs for info on what is a valid app identifier." 1>&2
        return 1
    fi

    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#APP__APP_IDENTIFIER}" -gt ${_APPS_APP_IDENTIFIER___MAX_LEN:?} ]; then
        echo "The APP__APP_IDENTIFIER '$APP__APP_IDENTIFIER' with length ${#APP__APP_IDENTIFIER} is invalid." 1>&2
        echo "The APP__APP_IDENTIFIER must have max length \
\`<= _APPS_APP_IDENTIFIER___MAX_LEN ($_APPS_APP_IDENTIFIER___MAX_LEN)\`." 1>&2
        return 1
    fi


    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#_ROOTFS}" -ge ${_ROOTFS_DIR___MAX_LEN:?} ]; then
        echo "The _ROOTFS '$_ROOTFS' with length ${#_ROOTFS} is invalid." 1>&2
        echo "The _ROOTFS must have max length \`<= _ROOTFS_DIR___MAX_LEN ($_ROOTFS_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi

    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#_PREFIX}" -ge ${_PREFIX_DIR___MAX_LEN:?} ]; then
        echo "The _PREFIX '$_PREFIX' with length ${#_PREFIX} is invalid." 1>&2
        echo "The _PREFIX must have max length \`<= _PREFIX_DIR___MAX_LEN ($_PREFIX_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi

    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#_PREFIX__TMP_DIR}" -ge ${_PREFIX__TMP_DIR___MAX_LEN:?} ]; then
        echo "The _PREFIX__TMP_DIR '$_PREFIX__TMP_DIR' with length ${#_PREFIX__TMP_DIR} is invalid." 1>&2
        echo "The _PREFIX__TMP_DIR must have max length \`<= _PREFIX__TMP_DIR___MAX_LEN ($_PREFIX__TMP_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi


    if [[ "$_ROOTFS" != "/" ]] && \
            [[ "$__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT" == "true" ]]; then
        if [[ "$_PREFIX" != "$_ROOTFS/usr" ]]; then
            echo "The _PREFIX '$_PREFIX' is invalid." 1>&2
            echo "The _PREFIX must be equal to '\$_ROOTFS/usr' ($_ROOTFS/usr) as per 'usr' merge format." 1>&2
            return 1
        fi

        if [[ "${_PREFIX:?}" == "${_HOME:?}" ]] || \
                [[ "$_PREFIX" == "$_HOME/"* ]] || \
                [[ "$_HOME" == "$_PREFIX/"* ]]; then
            echo "The _PREFIX '$_PREFIX' or _HOME '$_HOME' is invalid." 1>&2
            echo "The _PREFIX must not be equal to _HOME and they must not be under each other as per 'usr' merge format." 1>&2
            return 1
        fi
    else
        if [[ "${_PREFIX:?}" == "${_HOME:?}" ]] || \
                [[ "$_PREFIX" == "$_HOME/"* ]]; then
            echo "The _PREFIX '$_PREFIX' or _HOME '$_HOME' is invalid." 1>&2
            echo "The _PREFIX must not be equal to or be under _HOME." 1>&2
            return 1
        fi
    fi

    if [[ "${_PREFIX:?}" == "${CGCT_DIR:?}" ]] || \
            [[ "$_PREFIX" == "$CGCT_DIR/"* ]] || \
            [[ "$CGCT_DIR" == "$_PREFIX/"* ]]; then
        echo "The _PREFIX '$_PREFIX' or CGCT_DIR '$CGCT_DIR' is invalid." 1>&2
        echo "The _PREFIX must not be equal to CGCT_DIR and they must not be under each other." 1>&2
        return 1
    fi

    if [[ "$_PREFIX" != "$PREFIX_CLASSICAL" ]]; then
        echo "The _PREFIX '$_PREFIX' or PREFIX_CLASSICAL '$PREFIX_CLASSICAL' is invalid." 1>&2
        echo "The _PREFIX must be equal to PREFIX_CLASSICAL." 1>&2
        return 1
    fi

    if [[ "$_PREFIX" == "$_PREFIX_GLIBC" ]]; then
        echo "The _PREFIX '$_PREFIX' or _PREFIX_GLIBC '$_PREFIX_GLIBC' is invalid." 1>&2
        echo "The _PREFIX must not be equal to _PREFIX_GLIBC." 1>&2
        return 1
    fi

    if [[ "$_PREFIX__BASE_LIB_DIR" == "$_PREFIX__MULTI_LIB_DIR" ]]; then
        echo "The _PREFIX__BASE_LIB_DIR '$_PREFIX__BASE_LIB_DIR' or _PREFIX__MULTI_LIB_DIR '$_PREFIX__MULTI_LIB_DIR' is invalid." 1>&2
        echo "The _PREFIX__BASE_LIB_DIR must not be equal to _PREFIX__MULTI_LIB_DIR." 1>&2
        return 1
    fi

    if [[ "$_PREFIX__BASE_INCLUDE_DIR" == "$_PREFIX__MULTI_INCLUDE_DIR" ]]; then
        echo "The _PREFIX__BASE_INCLUDE_DIR '$_PREFIX__BASE_INCLUDE_DIR' or _PREFIX__MULTI_INCLUDE_DIR '$_PREFIX__MULTI_INCLUDE_DIR' is invalid." 1>&2
        echo "The _PREFIX__BASE_INCLUDE_DIR must not be equal to _PREFIX__MULTI_INCLUDE_DIR." 1>&2
        return 1
    fi

}

__build_props__validate_variables || exit $?

unset __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_MAP
unset __BUILD_PROPS__VARIABLES_VALIDATOR_ACTIONS_VARIABLE_NAMES
unset __BUILD_PROPS__VALIDATE_PATHS_MAX_LEN
unset __BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT
unset __build_props__add_variables_validator_actions
unset __build_props__validate_variables
