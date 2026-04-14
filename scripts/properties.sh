# shellcheck shell=bash
# shellcheck disable=SC2034

# So avoid doing things like executing commands except of those available in
# coreutils and are clearly not a default part of most Linux installations,
# or sourcing any other script in our build directories.

if [ -z "${BASH_VERSION:-}" ]; then
    echo "The 'properties.sh' script must be run from a 'bash' shell."; return 64 2>/dev/null|| exit 64 # EX__USAGE
fi



###
# Variables for validation of build properties variables.
# Validation is done to ensure packages are not compiled for invalid
# values that are not supported, and values are as per repository file
# path limits.
#
# Additionally, the RepoExe build system is an unsafe mess of
# unquoted variables in shell scripts, and so validation is necessary
# for important variables, especially specific path variables against
# `REGEX__SAFE_*_PATH` regexes to reduce any potential damage.
#
###

##
# The map of variable names to their space separated list of validator
# actions to perform.
#
# Following are the supported validator actions.
# - `allow_unset_value`: Allow variable to be defined but unset, and
#    skip other validations.
# - `app_package_name`: Variable must match `REGEX__APP_PACKAGE_NAME`.
# - `invalid_termux_rootfs_paths`: Path variable must not match
#   `REGEX__INVALID_ROOTFS_PATHS`.
# - `invalid_termux_home_paths`: Path variable must not match
#   `REGEX__INVALID_HOME_PATHS`.
# - `invalid_termux_prefix_paths`: Path variable must not match
#   `REGEX__INVALID_PREFIX_PATHS`.
# - `path_equal_to_or_under_termux_rootfs`: Path variable must be equal
#   to or be under `ROOTFS`.
# - `path_under_termux_rootfs`:Path variable must be under `ROOTFS`.
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
#    length `<= APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN`
#    including the null `\0` terminator.
# - `unix_path_max`: Path variable must have max length `<= UNIX_PATH_MAX`
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
# Whether to validate max lengths of build paths. Set to `false` to skip validation.
##
__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN="true"

##
# Whether to validate `usr` merge format for `PREFIX`. Set to `false` to skip validation.
# Check `PREFIX` variable docs for more info.
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
# Variables for validating build variables.
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
# Regex that matches invalid RepoExe rootfs paths.
#
# The RepoExe rootfs or prefix paths must not be equal to or be under
# specific Filesystem Hierarchy Standard paths or paths used by RepoExe
# docker image/host OS for its own files, as RepoExe packages files
# must be kept separate from the build host. The RepoExe app data/prefix
# directories are also wiped by `clean.sh` when not running on-device,
# which wouldn't be possible if RepoExe and host directories are shared.
#
# The invalid paths list does not include the `/data` and `/mnt/expand`
# paths under which private app data directories are assigned to
# Android apps, or the `/data/local/tmp` directory assigned to `adb`
# `shell` user, or the `/system` directory for the Android system.
#
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs-3.0.html
# - https://en.wikipedia.org/wiki/Filesystem_Hierarchy_Standard
##
REGEX__INVALID_ROOTFS_PATHS='^((/bin(/.*)?)|(/boot(/.*)?)|(/dev(/.*)?)|(/etc(/.*)?)|(/home)|(/lib(/.*)?)|(/lib[^/]+(/.*)?)|(/media)|(/mnt)|(/opt)|(/proc(/.*)?)|(/root)|(/run(/.*)?)|(/sbin(/.*)?)|(/srv(/.*)?)|(/sys(/.*)?)|(/tmp(/.*)?)|(/usr)|(/usr/local)|(((/usr/)|(/usr/local/))((bin)|(games)|(include)|(lib)|(libexec)|(lib[^/]+)|(sbin)|(share)|(src)|(X11R6))(/.*)?)|(/var(/.*)?)|(/bin.usr-is-merged)|(/lib.usr-is-merged)|(/sbin.usr-is-merged)|(/.dockerinit)|(/.dockerenv))$'

##
# Regex that matches invalid RepoExe home paths.
#
# Same reasoning as `REGEX__INVALID_ROOTFS_PATHS`,
# and invalid paths are the same as well except that `/home` is
# allowed, and `/` and all paths under `/usr` are not allowed.
#
# `/home` is allowed as package data files are not packaged from there.
##
REGEX__INVALID_HOME_PATHS='^((/)|(/bin(/.*)?)|(/boot(/.*)?)|(/dev(/.*)?)|(/etc(/.*)?)|(/lib(/.*)?)|(/lib[^/]+(/.*)?)|(/media)|(/mnt)|(/opt)|(/proc(/.*)?)|(/root)|(/run(/.*)?)|(/sbin(/.*)?)|(/srv(/.*)?)|(/sys(/.*)?)|(/tmp(/.*)?)|(/usr(/.*)?)|(/var(/.*)?)|(/bin.usr-is-merged)|(/lib.usr-is-merged)|(/sbin.usr-is-merged)|(/.dockerinit)|(/.dockerenv))$'

##
# Regex that matches invalid RepoExe prefix paths.
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
# by this regex and it must be checked with `NAME_MAX`, as
# `bash` `=~` regex conditional does not support lookaround.
#
# Unlike Android, the RepoExe app package name max length is not `255`
# as its limited by `APPS_DIR___MAX_LEN` and `ROOTFS_DIR___MAX_LEN`.
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
##
REGEX__APP_DATA_DIR_PATH='^(((/data/data)|(/data/user/[0-9]+)|(/mnt/expand/[^/]+/user/[0-9]+))/[^/]+)$'





###
# Variables for the RepoExe build tools.
###

##
# The path to the `termux-packages` repo root directory.
##
PKGS__BUILD__REPO_ROOT_DIR="${PKGS__BUILD__REPO_ROOT_DIR:-}"

__termux_build_props__set_termux_builder__repo_root_dir() {

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
__termux_build_props__set_termux_builder__repo_root_dir "/.." || exit $?
unset __termux_build_props__set_termux_builder__repo_root_dir
SCRIPTDIR="${SCRIPTDIR:-$PKGS__BUILD__REPO_ROOT_DIR}" # Deprecated alternative variable for `PKGS__BUILD__REPO_ROOT_DIR`



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
# Variables for the RepoExe apps and packages for which to compile packages.
#
# Variables defined in this file need to be in sync with `termux-app`
# (`RepoExeConstants` and `RepoExeCoreConstants`), termux site and `termux-exec`.
#
# Following is a list of `TERMUX_` variables that are safe to modify when forking.
# **DO NOT MODIFY ANY OTHER VARIABLE UNLESS YOU KNOW WHAT YOU ARE DOING.**
#
# - `NAME`, `LNAME` and `UNAME`.
# - `REPOS_HOST_ORG_NAME` and `REPOS_HOST_ORG_URL`.
# - `TERMUX_*__REPO_NAME` and `TERMUX_*__REPO_URL`.
# - `APP__PACKAGE_NAME`.
# - `APP__DATA_DIR`.
# - `PROJECT_SUBDIR`.
# - `ROOTFS_SUBDIR`.
# - `ROOTFS` and alternates.
# - `PREFIX` and alternates.
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
# RepoExe project name.
#
# Default value: `RepoExe`
##
NAME="Termux"

##
# The lower case value for `NAME`.
#
# Default value: `termux`
##
LNAME="${NAME,,}"

##
# The upper case value for `NAME`.
#
# Default value: `TERMUX`
##
UNAME="${NAME^^}"



##
# RepoExe internal project name.
#
# This is used internally for paths, filenames, and other internal use
# cases and must match the `INTERNAL_NAME_REGEX` regex and
# have max length `INTERNAL_NAME___MAX_LEN`.
#
# **This must not be changed unless doing a full fork of RepoExe where
# all RepoExe references are changed instead of just changing the
# `NAME`, `APP__PACKAGE_NAME` and urls.**
#
# Default value: `termux`
##
INTERNAL_NAME="termux"

##
# The regex to validate `INTERNAL_NAME`.
#
# The internal name must start with characters in the range
# `[a-z0-9]`, followed by at least one character in the range
# `[a-z0-9_-]`, and end with characters in the range `[a-z0-9]`. The
# min length is `3`. The max length `7` as per
# `INTERNAL_NAME___MAX_LEN` is not checked by this regex and
# must be checked separately.
#
#
# Constant value: `^[a-z0-9][a-z0-9_-]+[a-z0-9]$`
##
INTERNAL_NAME_REGEX="^[a-z0-9][a-z0-9_-]+[a-z0-9]$"

##
# The max length for the `INTERNAL_NAME`.
#
# for why the value `7` is chosen.
#
# Constant value: `7`
##
INTERNAL_NAME___MAX_LEN=7



##
# RepoExe repositories host organization name.
#
# Default value: `termux`
##
REPOS_HOST_ORG_NAME="termux"

##
# RepoExe repositories host organization url.
#
# Default value: `https://github.com/termux`
##
REPOS_HOST_ORG_URL="https://github.com/$REPOS_HOST_ORG_NAME"



##
# RepoExe app package name used for `APP__DATA_DIR` and
# `APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# Ideally package name should be `<= 21` characters and max `33`
# characters. If package name has not yet been chosen, then it would
# be best to keep it to `<= 10` characters. Check
# for why.
#
# **See Also:**
# - `APP__NAMESPACE`.
# - https://developer.android.com/build/configure-app-module#set-application-id
#
# Default value: `com.termux`
##
APP__PACKAGE_NAME="com.termux"
APP_PACKAGE="$APP__PACKAGE_NAME" # Deprecated alternative variable for `APP__PACKAGE_NAME`

__build_props__add_variables_validator_actions "APP__PACKAGE_NAME" "app_package_name"

##
# RepoExe app data directory path that is expected to be assigned by
# Android to the RepoExe app with `APP__PACKAGE_NAME` for all
# its app data, that will contain the RepoExe project directory
# (`PROJECT_DIR`), and optionally the RepoExe rootfs directory
# (`ROOTFS`).
#
# The path must match `REGEX__APP_DATA_DIR_PATH`.
#
# The directory set will be deleted by `clean.sh` if `PREFIX`
# is under `APP__DATA_DIR` and not running on-device, so make
# sure a safe path is set if running `clean.sh` in RepoExe docker or
# host OS build environment.
#
# Default value: `/data/data/com.termux`
##
APP__DATA_DIR="/data/data/$APP__PACKAGE_NAME"
__build_props__add_variables_validator_actions "APP__DATA_DIR" "safe_absolute_path"

##
# The max length for the `APP__DATA_DIR` including the null '\0'
# terminator.
#
# for why the value `69` is chosen.
#
# Constant value: `69`
##
APP__DATA_DIR___MAX_LEN=69





##
# RepoExe subdirectory path for `PROJECT_DIR`.
#
# Default value: `termux`
##
PROJECT_SUBDIR="$INTERNAL_NAME"
__build_props__add_variables_validator_actions "PROJECT_SUBDIR" "safe_relative_path"

##
# RepoExe project directory path under `APP__DATA_DIR`.
#
# This is an exclusive directory for all repository files that includes
# RepoExe core directory (`CORE_DIR`), RepoExe apps directory
# (`APPS_DIR`), and optionally the RepoExe rootfs directory
# (`ROOTFS`).
#
# Currently, the default RepoExe rootfs directory is not under it and
# is at the `/files`  subdirectory but there are plans to move it to
# `termux/rootfs/II` in future where `II` refers to rootfs id starting
# at `0` for multi-rootfs support.
#
# An exclusive directory is required so that all repository files exist
# under a single directory, especially for when RepoExe is provided as
# a library, so that repository files do not interfere with other files
# of RepoExe app forks or apps that may use the RepoExe library.
#
#
# Default value: `/data/data/com.termux/termux`
##
PROJECT_DIR="$APP__DATA_DIR/$PROJECT_SUBDIR"
__build_props__add_variables_validator_actions "PROJECT_DIR" "safe_absolute_path"





##
# RepoExe subdirectory path for `CORE_DIR`.
#
# Constant value: `core`
##
CORE_SUBDIR="core"

##
# RepoExe core directory path under `PROJECT_DIR`.
#
# This contains RepoExe core files for the RepoExe app, like user settings and configs for the app,
# which and are independent of any specific rootfs.
#
#
# Default value: `/data/data/com.termux/termux/core`
##
CORE_DIR="$PROJECT_DIR/$CORE_SUBDIR"
__build_props__add_variables_validator_actions "CORE_DIR" "safe_absolute_path"






##
# RepoExe subdirectory path for `APPS_DIR`.
#
# Constant value: `app`
##
APPS_SUBDIR="app"

##
# RepoExe apps directory path under `PROJECT_DIR`.
#
# This contains app specific files for the RepoExe app, its plugin
# apps, and third party apps, like used for app APIs and
# filesystem/pathname socket files of servers created by the apps.
# - https://man7.org/linux/man-pages/man7/unix.7.html
#
#
# Default value: `/data/data/com.termux/termux/app`
##
APPS_DIR="$PROJECT_DIR/$APPS_SUBDIR"
__build_props__add_variables_validator_actions "APPS_DIR" "safe_absolute_path"

##
# The max length for the `APPS_DIR` including the null '\0'
# terminator.
#
# for why the value `84` is chosen.
#
# Constant value: `84`
##
APPS_DIR___MAX_LEN=84

##
# The max length for the RepoExe apps api socket server parent directory
# including the null '\0' terminator.
#
# for why the value `98` is chosen.
#
# Constant value: `98`
##
APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN=98



##
# RepoExe subdirectory path for `APPS_DIR_BY_IDENTIFIER`.
#
# Constant value: `i`
##
APPS_DIR_BY_IDENTIFIER_SUBDIR="i"

##
# RepoExe apps directory path by app identifier under `APPS_DIR`.
#
# Default value: `/data/data/com.termux/termux/app/i`
##
APPS_DIR_BY_IDENTIFIER="$APPS_DIR/$APPS_DIR_BY_IDENTIFIER_SUBDIR"

##
# The regex to validate a subdirectory name under the
# `APPS_DIR_BY_IDENTIFIER` excluding the null '\0' terminator
# that represents an app identifier.
#
# The app identifier must only contain characters in the range
# `[a-zA-Z0-9]` as segments, with `[._-]` as separators between
# segments, and with the first segment containing at least `3`
# characters. The max length `10` as per
# `APPS_APP_IDENTIFIER___MAX_LEN` is not checked by this regex
# and must be checked separately.
#
# Constant value: `^[a-zA-Z0-9]{3,}([._-][a-zA-Z0-9]+)*$`
##
APPS_APP_IDENTIFIER_REGEX="^[a-zA-Z0-9]{3,}([._-][a-zA-Z0-9]+)*$"

##
# The max length for a subdirectory name under the
# `APPS_DIR_BY_IDENTIFIER` excluding the null '\0' terminator
# that represents an app identifier.
#
# for why the value `10` is chosen.
#
# Constant value: `10`
##
APPS_APP_IDENTIFIER___MAX_LEN=10





##
# RepoExe subdirectory path for `APPS_DIR_BY_UID`.
#
# Constant value: `u`
##
APPS_DIR_BY_UID_SUBDIR="u"

##
# RepoExe apps directory path by app uid (user_id + app_id) under
# `APPS_DIR`.
#
# Default value: `/data/data/com.termux/termux/app/u`
##
APPS_DIR_BY_UID="$APPS_DIR/$APPS_DIR_BY_UID_SUBDIR"

##
# The regex to validate a  subdirectory name under the
# `APPS_DIR_BY_UID` excluding the null '\0' terminator that
# represents an app uid.
#
# The app uid must only contains `5` to `9` characters that are
# numbers and must not start with a `0`.
#
# Constant value: `^[1-9][0-9]{4,8}$`
##
APPS_APP_UID_REGEX="^[1-9][0-9]{4,8}$"

##
# The max length for a subdirectory name under the
# `APPS_DIR_BY_UID` excluding the null '\0' terminator that
# represents an app uid.
#
# for why the value `9` is chosen.
#
# Constant value: `9`
##
APPS_APP_UID___MAX_LEN=9





##
# RepoExe apps info environment subfile path under an app directory of
# `APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `termux-apps-info.env`
##
CORE__APPS_INFO_ENV_SUBFILE="$INTERNAL_NAME-apps-info.env"

##
# RepoExe apps info json subfile path under an app directory of
# `APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `termux-apps-info.json`
##
CORE__APPS_INFO_JSON_SUBFILE="$INTERNAL_NAME-apps-info.json"



##
# `termux-am-socket` server subfile path under an app directory of
# `APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `termux-am`
##
AM_SOCKET__SERVER_SOCKET_SUBFILE="$INTERNAL_NAME-am"





##
# RepoExe `ROOTFS` id.
#
# Default value: `0`
##
ROOTFS_ID="0"
__build_props__add_variables_validator_actions "ROOTFS_ID" "unsigned_int"

##
# RepoExe subdirectory path for `ROOTFS`.
#
# Default value: `files`
##
ROOTFS_SUBDIR="files"
__build_props__add_variables_validator_actions "ROOTFS_SUBDIR" "allow_unset_value safe_relative_path"

###########
# Uncomment if to place `ROOTFS`  under `PROJECT_DIR`
# instead of at `files`. This may be used for future multi-rootfs
# design. Make sure to update `CACHE_SUBDIR` above as well.

##
# RepoExe subdirectory path for parent directory of all RepoExe rootfses
# including `ROOTFS`.
#
# Default value: `termux/rootfs`
##
#ROOTFSES_SUBDIR="$PROJECT_SUBDIR/rootfs"
###########

##
# RepoExe subdirectory path for `ROOTFS`.
#
# Default value: `termux/rootfs/0`
##
#ROOTFS_SUBDIR="$ROOTFSES_SUBDIR/$ROOTFS_ID"
###########


##
# RepoExe rootfs directory path under `APP__DATA_DIR` that
# contains the Linux environment rootfs provided by RepoExe.
#
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch03.html
#
# The RepoExe rootfs must not be set to path in
# `REGEX__INVALID_ROOTFS_PATHS`. It can exist outside
# the `APP__DATA_DIR` if compiling packages for the Android
# system or `adb` `shell` user.
#
# Default value: `/data/data/com.termux/files`
##
ROOTFS="$APP__DATA_DIR/$ROOTFS_SUBDIR"
BASE_DIR="$ROOTFS" # Deprecated alternative variable for `ROOTFS`

__build_props__add_variables_validator_actions "ROOTFS" "safe_rootfs_or_absolute_path invalid_termux_rootfs_paths"

# FIXME: Remove after updating RepoExe app and `termux-am-socket`
# package sources and use `APPS_DIR`.
APPS_DIR="$ROOTFS/apps"

##
# The max length for the `ROOTFS` including the null '\0'
# terminator.
#
# for why the value `86` is chosen.
#
# Constant value: `86`
##
ROOTFS_DIR___MAX_LEN=86





####
# Variables for the RepoExe home.
####

##
# RepoExe subdirectory path for `HOME`.
#
# Default value: `home`
##
HOME_SUBDIR="home"
__build_props__add_variables_validator_actions "HOME_SUBDIR" "safe_relative_path"

##
# RepoExe home directory path under `ROOTFS` used for `$HOME`.
#
# It serves the same purpose as the `/home` directory on Linux distros.
#
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch03s08.html
#
# Check `PREFIX` variable docs for rules that apply depending
# on if `ROOTFS` is equal to Android/Linux rootfs `/` or not.
# The RepoExe home must not be set to Android/Linux rootfs `/` or any
# other path in `REGEX__INVALID_HOME_PATHS`.
#
# Default value: `/data/data/com.termux/files/home`
##
[[ "$ROOTFS" != "/" ]] && HOME="$ROOTFS/$HOME_SUBDIR" || \
    HOME="/$HOME_SUBDIR"
__build_props__add_variables_validator_actions "HOME" "safe_absolute_path invalid_termux_home_paths path_under_termux_rootfs"

ANDROID_HOME="$HOME" # Deprecated alternative variable for `HOME`

##
# RepoExe legacy project user config directory path under `HOME`.
#
# Default value: `/data/data/com.termux/files/home/.termux`
##
LEGACY_PROJECT_USER_CONFIG_DIR="$HOME/.termux"





####
# Variables for the RepoExe prefix.
####

##
# RepoExe subdirectory path for `PREFIX`.
#
# Default value: `usr`
##
PREFIX_SUBDIR="usr"
__build_props__add_variables_validator_actions "PREFIX_SUBDIR" "allow_unset_value safe_relative_path"

##
# RepoExe prefix directory path under or equal to `ROOTFS`
# where all RepoExe packages data is installed.
#
# It serves the same purpose as the `/usr` directory on Linux distros
# and contains the `bin`, `etc`, `include`, `lib`, `libexec`, `opt`,
# `share`, `tmp` and `var` sub directories.
#
# - https://refspecs.linuxfoundation.org/FHS_3.0/fhs/ch04.html
#
# If `ROOTFS` is not equal to `/`, then by default RepoExe
# uses `usr` merge format, like used by `debian`, as per
# `__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT`
# being enabled by default. In the `usr` merge format, all packages
# are installed under the `usr` subdirectory under rootfs, like under
# `$ROOTFS/usr/bin` and `$ROOTFS/usr/lib`,
# instead of under `$ROOTFS/bin` and `$ROOTFS/lib`.
# So if `usr` merge format is enabled, then DO NOT change the default
# value of `PREFIX_SUBDIR` from `usr`.
# The `$ROOTFS/usr-staging` directory is also used as a
# temporary directory for extracting bootstrap zip by the RepoExe app,
# before its renamed to `$ROOTFS/usr`.
# Additionally, `PREFIX` must not be equal to `HOME`
# and they must not be under each other, as RepoExe app requires that
# prefix and home are separate directories as prefix gets wiped during
# bootstrap installation or if `termux-reset` is run, and backup
# scripts require the same. Package data also needs to be kept
# separate from `home`, so it does not make sense for them to be
# equal to or be under each other.
# However, if a RepoExe app fork is using a modified bootstrap
# installation that does not use the `usr` merge format, then
# `__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT` can
# be set to `false` and `PREFIX_SUBDIR` could optionally be
# set to an empty string if `ROOTFS` should be equal to
# `PREFIX`, or a custom directory other than `usr`. In this
# case `HOME` can optionally be under `PREFIX`, but
# not be equal to it.
#
# - https://wiki.debian.org/UsrMerge
# - https://lists.debian.org/debian-devel-announce/2019/03/msg00001.html
# - https://dep-team.pages.debian.net/deps/dep17/
#
# If `ROOTFS` is equal to Android/Linux rootfs `/`, then
# `PREFIX_SUBDIR` must not be set to an empty string as
# `PREFIX` must be a subdirectory under rootfs `/`, and must
# not be set to `usr` either or or any other path in
# `REGEX__INVALID_PREFIX_PATHS`. Check the
# `REGEX__INVALID_ROOTFS_PATHS` variable docs for why
# some paths like `/usr`, etc are now allowed.
#
# Basically, the following rules apply for `PREFIX`.
# - If `ROOTFS` is not equal to `/`:
#     - If `usr` merge format is enabled:
#         - `PREFIX` must be equal to `$ROOTFS/usr`.
#         - `PREFIX` must not be equal to `HOME` and
#            they must not be under each other.
#     - If `usr` merge format is disabled:
#         - `PREFIX` must be equal to or be under `$ROOTFS`.
#         - `PREFIX` must not be equal to or be under `HOME`.
# - If `ROOTFS` is equal to `/`:
#     - If `usr` merge format is enabled or disabled:
#         - `PREFIX` must be under `$ROOTFS` and not
#           equal to `/usr` or other paths in `REGEX__INVALID_PREFIX_PATHS`.
#         - `PREFIX` must not be equal to or be under `HOME`.
#
# The directory set will be deleted by `clean.sh` if not running
# on-device, so make sure a safe path is set if running `clean.sh` in
# RepoExe docker or host OS build environment.
#
# At runtime, `PREFIX` may be overridden and set to
# `PREFIX_GLIBC` when compiling `glibc` packages by calling
# `build_props__set_prefix_dir_and_sub_variables` in
# `repoexe_step_setup_variables` if `PACKAGE_LIBRARY` equals `glibc`.
# However, `PREFIX_CLASSICAL` retains the original value
# set below for `PREFIX`.
# - https://github.com/termux/termux-packages/pull/16901
# - https://github.com/termux/termux-packages/pull/20864
#
# Default value: `/data/data/com.termux/files/usr`
##
[[ "$ROOTFS" != "/" ]] && PREFIX="$ROOTFS${PREFIX_SUBDIR:+"/$PREFIX_SUBDIR"}" || \
    PREFIX="/$PREFIX_SUBDIR"
__build_props__add_variables_validator_actions "PREFIX" "safe_absolute_path invalid_termux_prefix_paths"

if [[ "$ROOTFS" != "/" ]] && [[ "$__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT" != "true" ]]; then
    __build_props__add_variables_validator_actions "PREFIX" " path_equal_to_or_under_termux_rootfs"
else
    __build_props__add_variables_validator_actions "PREFIX" " path_under_termux_rootfs"
fi

PREFIX="$PREFIX" # Deprecated alternative variable for `PREFIX`



##
# The original value for `PREFIX` set above, as `PREFIX`
# can be overridden at runtime, like when compiling `glibc` packages.
# Checks variable docs of `PREFIX` for more info.
#
# Default value: `/data/data/com.termux/files/usr`
##
PREFIX_CLASSICAL="$PREFIX"
PREFIX_CLASSICAL="$PREFIX" # Deprecated alternative variable for `PREFIX_CLASSICAL`



##
# RepoExe subdirectory path for `PREFIX_GLIBC`.
#
# Default value: `glibc`
##
PREFIX_GLIBC_SUBDIR="glibc"

##
# RepoExe `glibc` prefix directory path under `PREFIX`
# where all RepoExe `glibc` packages data is installed.
#
# **See Also:**
# - https://github.com/termux-pacman/glibc-packages
# - https://github.com/termux/glibc-packages (mirror)
#
# Default value: `/data/data/com.termux/files/usr/glibc`
##
PREFIX_GLIBC="$PREFIX/$PREFIX_GLIBC_SUBDIR"
__build_props__add_variables_validator_actions "PREFIX_GLIBC" "safe_absolute_path invalid_termux_prefix_paths path_under_termux_rootfs"



##
# The max length for the `PREFIX` including the null '\0'
# terminator.
#
# for why the value `90` is chosen.
#
# Constant value: `90`
##
PREFIX_DIR___MAX_LEN="$((ROOTFS_DIR___MAX_LEN + 1 + 3))" # "/usr" (90)


##
# The max length for the `BIN_DIR` including the null '\0' terminator.
#
# Constant value: `94`
##
PREFIX__BIN_DIR___MAX_LEN="$((PREFIX_DIR___MAX_LEN + 1 + 3))" # "/bin" (94)

##
# The max safe length for a sub file path under the `BIN_DIR`
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
# - https://github.com/termux/termux-core-package/blob/master/lib/termux-core_nos_c/tre/include/termux/termux_core__nos__c/v1/termux/file/RepoExeFile.h
# - https://github.com/termux/termux-exec-package/blob/master/lib/termux-exec_nos_c/tre/include/termux/termux_exec__nos__c/v1/termux/api/termux_exec/service/ld_preload/direct/exec/ExecIntercept.h
#
# Constant value: `127`
##
PREFIX__BIN_FILE___SAFE_MAX_LEN="$((PREFIX__BIN_DIR___MAX_LEN + 1 + 33))" # "/<filename_with_len_33>" (127)

##
# The max length for entire shebang line for `termux-exec`.
#
# **See Also:**
# - https://github.com/termux/termux-exec-package/blob/master/lib/termux-exec_nos_c/tre/include/termux/termux_exec__nos__c/v1/termux/api/termux_exec/service/ld_preload/direct/exec/ExecIntercept.h
#
# Default value: `340`
##
FILE_HEADER__BUFFER_SIZE="340"




##
# `build_props__set_prefix_dir_and_sub_variables` `<termux__prefix>` [`<skip_validation>`]
##
build_props__set_prefix_dir_and_sub_variables() {

local termux__prefix="${1:-}"
local skip_validation="${2:-}"

if [[ "$skip_validation" != "true" ]]; then
    if [[ ! "$termux__prefix" =~ ${REGEX__SAFE_ABSOLUTE_PATH:?} ]] || \
            [[ "$termux__prefix" =~ ${REGEX__SINGLE_OR_DOUBLE_DOT_CONTAINING_PATH:?} ]]; then
        echo "The termux__prefix '$termux__prefix' passed to 'build_props__set_prefix_dir_and_sub_variables' with length ${#termux__prefix} is invalid." 1>&2
        echo "The termux__prefix must match a safe absolute path that starts with a \`/\` with at least one \
characters under rootfs \`/\`. Duplicate or trailing path separators \`/\` are not allowed. \
The path component characters must be in the range \`[a-zA-Z0-9+,.=_-]\`. The path must not contain single \`/./\` or \
double \`/../\` dot components." 1>&2
        return 1
    fi

    if [[ "$termux__prefix" =~ ${REGEX__INVALID_PREFIX_PATHS:?} ]]; then
        echo "The termux__prefix '$termux__prefix' passed to 'build_props__set_prefix_dir_and_sub_variables' with length ${#termux__prefix} is invalid." 1>&2
        echo "The termux__prefix must not match one of the invalid paths \
in REGEX__INVALID_PREFIX_PATHS \`$REGEX__INVALID_PREFIX_PATHS\`." 1>&2
        return 1
    fi
fi


# Override `PREFIX`, but keep original value in `PREFIX_CLASSICAL`.
PREFIX_CLASSICAL="$PREFIX"
PREFIX="$termux__prefix"



##
# RepoExe subdirectory path for `PREFIX__BIN_DIR`.
#
# Constant value: `bin`
##
PREFIX__BIN_SUBDIR="bin"

##
# RepoExe bin directory path under `PREFIX`.
#
#
# Default value: `/data/data/com.termux/files/usr/bin`
##
PREFIX__BIN_DIR="$PREFIX/$PREFIX__BIN_SUBDIR"



##
# RepoExe subdirectory path for `PREFIX__ETC_DIR`.
#
# Constant value: `etc`
##
PREFIX__ETC_SUBDIR="etc"

##
# RepoExe etc directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/etc`
##
PREFIX__ETC_DIR="$PREFIX/$PREFIX__ETC_SUBDIR"



##
# RepoExe subdirectory path for `PREFIX__BASE_INCLUDE_DIR`.
#
# Constant value: `include`
##
PREFIX__BASE_INCLUDE_SUBDIR="include"

##
# RepoExe base include directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/include`
##
PREFIX__BASE_INCLUDE_DIR="$PREFIX/$PREFIX__BASE_INCLUDE_SUBDIR"


##
# RepoExe subdirectory path for `PREFIX__MULTI_INCLUDE_DIR`.
#
# Constant value: `include32`
##
PREFIX__MULTI_INCLUDE_SUBDIR="include32"

##
# RepoExe multi include directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/include32`
##
PREFIX__MULTI_INCLUDE_DIR="$PREFIX/$PREFIX__MULTI_INCLUDE_SUBDIR"


##
# RepoExe include subdirectory path under `PREFIX`.
#
# Default value: `include`
##
PREFIX__INCLUDE_SUBDIR="$PREFIX__BASE_INCLUDE_SUBDIR"

##
# RepoExe include directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/include` (`$PREFIX__BASE_INCLUDE_DIR`)
##
PREFIX__INCLUDE_DIR="$PREFIX__BASE_INCLUDE_DIR"



##
# RepoExe subdirectory path for `PREFIX__BASE_LIB_DIR`.
#
# Constant value: `lib`
##
PREFIX__BASE_LIB_SUBDIR="lib"

##
# RepoExe base lib directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/lib`
##
PREFIX__BASE_LIB_DIR="$PREFIX/$PREFIX__BASE_LIB_SUBDIR"


##
# RepoExe subdirectory path for `PREFIX__MULTI_LIB_DIR`.
#
# Constant value: `lib32`
##
PREFIX__MULTI_LIB_SUBDIR="lib32"

##
# RepoExe multi lib directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/lib32`
##
PREFIX__MULTI_LIB_DIR="$PREFIX/$PREFIX__MULTI_LIB_SUBDIR"


##
# RepoExe lib subdirectory path under `PREFIX`.
#
# Default value: `lib`
##
PREFIX__LIB_SUBDIR="$PREFIX__BASE_LIB_SUBDIR"

##
# RepoExe lib directory path under `PREFIX`.
#
#
# Default value: `/data/data/com.termux/files/usr/lib` (`$PREFIX__BASE_LIB_DIR`)
##
PREFIX__LIB_DIR="$PREFIX__BASE_LIB_DIR"



##
# RepoExe subdirectory path for `PREFIX__LIBEXEC_DIR`.
#
# Constant value: `libexec`
##
PREFIX__LIBEXEC_SUBDIR="libexec"

##
# RepoExe libexec directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/libexec`
##
PREFIX__LIBEXEC_DIR="$PREFIX/$PREFIX__LIBEXEC_SUBDIR"



##
# RepoExe subdirectory path for `PREFIX__OPT_DIR`.
#
# Constant value: `opt`
##
PREFIX__OPT_SUBDIR="opt"

##
# RepoExe opt directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/opt`
##
PREFIX__OPT_DIR="$PREFIX/$PREFIX__OPT_SUBDIR"



##
# RepoExe subdirectory path for `PREFIX__SHARE_DIR`.
#
# Constant value: `share`
##
PREFIX__SHARE_SUBDIR="share"

##
# RepoExe share directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/share`
##
PREFIX__SHARE_DIR="$PREFIX/$PREFIX__SHARE_SUBDIR"



##
# RepoExe subdirectory path for `PREFIX__VAR_DIR`.
#
# Constant value: `var`
##
PREFIX__VAR_SUBDIR="var"

##
# RepoExe var directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/var`
##
PREFIX__VAR_DIR="$PREFIX/$PREFIX__VAR_SUBDIR"

}

# Set RepoExe prefix sub variables to be under the original value of
# `PREFIX` set in `PREFIX_CLASSICAL` by default,
# which is set earlier in this file.
# Skip validation as it will be done below by `__build_props__validate_variables`.
build_props__set_prefix_dir_and_sub_variables "$PREFIX" "true" || exit $?





# The following variables must always be under the original value of
# `PREFIX` set in `PREFIX_CLASSICAL` by default.

##
# RepoExe subdirectory path for `PREFIX__TMP_DIR`.
#
# Constant value: `tmp`
##
PREFIX__TMP_SUBDIR="tmp"

##
# RepoExe tmp directory path under `PREFIX`.
#
# Default value: `/data/data/com.termux/files/usr/tmp`
##
PREFIX__TMP_DIR="$PREFIX/$PREFIX__TMP_SUBDIR"

##
# The max length for the `PREFIX__TMP_DIR` including the null
# '\0' terminator.
#
# for why the value `94` is chosen.
#
# Constant value: `94`
##
PREFIX__TMP_DIR___MAX_LEN=94



##
# RepoExe `profile.d` directory path under `PREFIX__ETC_DIR`.
#
# Default value: `/data/data/com.termux/files/usr/etc/profile.d`
##
PREFIX__PROFILE_D_DIR="$PREFIX__ETC_DIR/profile.d"


##
# RepoExe project system config directory path under `PREFIX__ETC_DIR`.
#
# Default value: `/data/data/com.termux/files/usr/etc/termux`
##
PROJECT_SYSTEM_CONFIG_DIR="$PREFIX__ETC_DIR/$INTERNAL_NAME"





####
# Variables for the RepoExe cache.
####

##
# RepoExe subdirectory path for `CACHE_DIR`.
#
# Constant value: `cache`
##
CACHE_SUBDIR="cache"

###########
# Uncomment if to place `ROOTFS`  under `PROJECT_DIR`
# instead of at `files`. This may be used for future multi-rootfs
# design. This will also ensure `termux` files are not mixed with
# other cached files of an app, especially if RepoExe is forked or
# used as a library in other apps. Make sure to update
# `ROOTFS_SUBDIR` above as well.

##
# RepoExe subdirectory path for `CACHE_DIR`.
#
# Default value: `cache/termux/rootfs/0`
##
#CACHE_SUBDIR="cache/$INTERNAL_NAME/rootfs/$ROOTFS_ID"
###########

##
# RepoExe app cache directory path under `APP__DATA_DIR`
# contains cache files that are safe to be deleted by Android or
# RepoExe if required.
#
# The `cache` subdirectory is hardcoded in Android and must not be
# changed.
#
# Currently this is primarily used for packages cache files of package
# managers (`apt`/`pacman`).
#
#
# Default value: `/data/data/com.termux/cache`
##
CACHE_DIR="$APP__DATA_DIR/$CACHE_SUBDIR"
__build_props__add_variables_validator_actions "CACHE_DIR" "safe_absolute_path"

CACHE_DIR="$CACHE_DIR" # Deprecated alternative variable for `CACHE_DIR`





####
# Variables for the RepoExe bootstrap.
####

##
# RepoExe bootstrap system config directory path under `PROJECT_SYSTEM_CONFIG_DIR`.
#
# Default value: `/data/data/com.termux/files/usr/etc/termux/termux-bootstrap`
##
BOOTSTRAP__BOOTSTRAP_SYSTEM_CONFIG_DIR="$PROJECT_SYSTEM_CONFIG_DIR/termux-bootstrap"


##
# RepoExe subdirectory path for `BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_DIR`.
#
# Constant value: `second-stage`
##
BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_SUBDIR="second-stage"

##
# RepoExe bootstrap second stage directory path under `BOOTSTRAP__BOOTSTRAP_SYSTEM_CONFIG_DIR`.
#
# Default value: `/data/data/com.termux/files/usr/etc/termux/termux-bootstrap/second-stage`
##
BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_DIR="$BOOTSTRAP__BOOTSTRAP_SYSTEM_CONFIG_DIR/$BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_SUBDIR"


##
# RepoExe bootstrap second stage entry point subfile path path under `BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_DIR`.
#
# Default value: `termux-bootstrap-second-stage.sh`
##
BOOTSTRAP__BOOTSTRAP_SECOND_STAGE_ENTRY_POINT_SUBFILE="termux-bootstrap-second-stage.sh"





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
NAME_MAX=255

##
# The max length for a filesystem socket file path (pathanme UNIX domain socket)
# for the `sockaddr_un.sun_path` field including the null `\0`
# terminator as per `UNIX_PATH_MAX`.
#
# All filesystem socket path lengths created by RepoExe apps and packages must be `< 108`.
#
# - https://man7.org/linux/man-pages/man7/unix.7.html
# - https://cs.android.com/android/platform/superproject/+/android-13.0.0_r18:bionic/libc/kernel/uapi/linux/un.h;l=22
#
# Constant value: `108`
##
UNIX_PATH_MAX=108





##
# RepoExe environment variables root scope.
#
# The name of this variable `ENV__S_ROOT` is considered a
# constant for RepoExe execution environment that's exported by RepoExe
# app containing the root scope and **must not be changed even for
# forks**. It can be used to check if running under RepoExe or any of
# its forks, and should be used to generate all RepoExe variable names
# that may need to be read, since RepoExe app forks may not export
# variables under the `TERMUX_` root scope and may do it under a
# different root scope like `FOO_`, so the `PREFIX` variable
# would be `FOO__PREFIX` instead.
#
# The `ENV__S_APP` environment variable will be exported at
# runtime for the scope of the current RepoExe app running the shell.
#
# RepoExe packages and external programs can use the
# `termux-scoped-env-variable` util from the `termux-core`
# package to get variable names and values for RepoExe. It uses the
# root scope from the `$ENV__S_ROOT` environment variable
# exported by the RepoExe app to dynamically generate the RepoExe
# variable names and/or get their values, with support for fallback
# to the build values defined here if `$ENV__S_ROOT` variable
# is not exported.**
# - https://github.com/termux/termux-core-package/blob/master/site/pages/en/projects/docs/usage/utils/repoexe/shell/command/environment/termux-scoped-env-variable.md
#
# The value of this variable `ENV__S_ROOT` may be modified,
# although not advisable since external programs would be using
# hardcoded `TERMUX_` value for reading RepoExe environment variables,
# and so changing variable names to say `FOO_*` would result in
# `TERMUX_*` ones being unset during execution, which would change
# external programs behaviour and may break them.
# **If the value is changed here, it must also be set to the same
# value in RepoExe app that is exported.**
#
# Moreover, currently, only `termux-exec` supports modifying this, all
# other termux (internal) packages, like `termux-tools`, etc do not.
# So forks should not modify it at least until all termux packages
# support modifying it.
#
# Default value: `TERMUX_`
##
ENV__S_ROOT="TERMUX_"



##
# RepoExe environment variables RepoExe sub scope for primary variables
# or variables for currently running RepoExe config.
#
# **Do not modify this!** This is considered a constant RepoExe sub
# scope for RepoExe execution environment that's used by external
# programs that do not use the termux packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# RepoExe app containing the root scope to generate the value for
# `$ENV__S` and variable names under it.**
#
# Default value: `_`
##
ENV__SS="_"

##
# RepoExe environment variables RepoExe scope for primary variables or
# variables for currently running RepoExe config.
#
# **Do not modify this!**
#
# Default value: `TERMUX__`
##
ENV__S="${ENV__S_ROOT}${ENV__SS}"



##
# RepoExe environment variables RepoExe app sub scope.
#
# **Do not modify this!** This is considered a constant RepoExe app sub
# scope for RepoExe execution environment that's used by external
# programs that do not use the termux packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# RepoExe app containing the root scope to generate the value for
# `$ENV__S_APP` and variable names under it.**
#
# Default value: `APP__`
##
ENV__SS_APP="APP__"

##
# RepoExe environment variables RepoExe app scope.
#
# **Do not modify this!**
#
# Default value: `APP__`
##
ENV__S_APP="${ENV__S_ROOT}${ENV__SS_APP}"



##
# RepoExe environment variables RepoExe:API sub scope.
#
# **Do not modify this!** This is considered a constant RepoExe:API
# sub scope for RepoExe execution environment that's used by external
# programs that do not use the termux packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# RepoExe app containing the root scope to generate the value for
# `$ENV__S_API` and variable names under it.**
#
# Default value: `API__`
##
ENV__SS_API="API__"

##
# RepoExe environment variables RepoExe:API scope.
#
# **Do not modify this!**
#
# Default value: `API__`
##
ENV__S_API="${ENV__S_ROOT}${ENV__SS_API}"



##
# RepoExe environment variables RepoExe:API app sub scope.
#
# This may be allowed to be modified, in case APIs are provided under
# a different app name or under the main RepoExe app itself by a fork.
# Consequences for changing this haven't been fully looked at yet.
#
# Default value: `API_APP__`
##
ENV__SS_API_APP="API_APP__"

##
# RepoExe environment variables RepoExe:API app scope.
#
# **Do not modify this!**
#
# Default value: `API_APP__`
##
ENV__S_API_APP="${ENV__S_ROOT}${ENV__SS_API_APP}"



##
# RepoExe environment variables RepoExe rootfs sub scope.
#
# **Do not modify this!** This is considered a constant RepoExe rootfs
# sub scope for RepoExe execution environment that's used by external
# programs that do not use the termux packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# RepoExe app containing the root scope to generate the value for
# `$ENV__S_ROOTFS` and variable names under it.**
#
# Default value: `ROOTFS__`
##
ENV__SS_ROOTFS="ROOTFS__"

##
# RepoExe environment variables RepoExe rootfs scope.
#
# **Do not modify this!**
#
# Default value: `TERMUX_ROOTFS__`
##
ENV__S_ROOTFS="${ENV__S_ROOT}${ENV__SS_ROOTFS}"



##
# RepoExe environment variables `termux-core` sub scope.
#
# **Do not modify this!** This is considered a constant `termux-core`
# sub scope for RepoExe execution environment that's used by external
# programs that do not use the termux packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# RepoExe app containing the root scope to generate the value for
# `$ENV__S_CORE` and variable names under it.**
#
# Default value: `CORE__`
##
ENV__SS_CORE="CORE__"

##
# RepoExe environment variables `termux-core` scope.
#
# **Do not modify this!**
#
# Default value: `CORE__`
##
ENV__S_CORE="${ENV__S_ROOT}${ENV__SS_CORE}"


##
# RepoExe environment variables `termux-core-tests` sub scope.
#
# **Do not modify this!** This is considered a constant
# `termux-core-tests` sub scope for RepoExe execution environment
#  that's used by `termux-core` package to generate the value for
# `$ENV__S_CORE__TESTS` and variable names under it.**
#
# Default value: `CORE__TESTS__`
##
ENV__SS_CORE__TESTS="CORE__TESTS__"

##
# RepoExe environment variables `termux-core-tests` scope.
#
# **Do not modify this!**
#
# Default value: `CORE__TESTS__`
##
ENV__S_CORE__TESTS="${ENV__S_ROOT}${ENV__SS_CORE__TESTS}"



##
# RepoExe environment variables `termux-exec` sub scope.
#
# **Do not modify this!** This is considered a constant `termux-exec`
# sub scope for RepoExe execution environment that's used by external
# programs that do not use the termux packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# RepoExe app containing the root scope to generate the value for
# `$ENV__S_EXEC` and variable names under it.**
#
# Default value: `EXEC__`
##
ENV__SS_EXEC="EXEC__"

##
# RepoExe environment variables `termux-exec` scope.
#
# **Do not modify this!**
#
# Default value: `TERMUX_EXEC__`
##
ENV__S_EXEC="${ENV__S_ROOT}${ENV__SS_EXEC}"


##
# RepoExe environment variables `termux-exec-tests` sub scope.
#
# **Do not modify this!** This is considered a constant
# `termux-exec-tests` sub scope for RepoExe execution environment
#  that's used by `termux-exec` package to generate the value for
# `$ENV__S_EXEC__TESTS` and variable names under it.**
#
# Default value: `TERMUX_EXEC__TESTS__`
##
ENV__SS_EXEC__TESTS="EXEC__TESTS__"

##
# RepoExe environment variables `termux-exec-tests` scope.
#
# **Do not modify this!**
#
# Default value: `TERMUX_EXEC__TESTS__`
##
ENV__S_EXEC__TESTS="${ENV__S_ROOT}${ENV__SS_EXEC__TESTS}"



##
# RepoExe environment variables `termux-am-socket` sub scope.
#
# **Do not modify this!** This is considered a constant `termux-am-socket`
# sub scope for RepoExe execution environment that's used by external
# programs that do not use the termux packages building infrastructure
# and rely on `$ENV__S_ROOT` environment variable exported by
# RepoExe app containing the root scope to generate the value for
# `$ENV__S_AM_SOCKET` and variable names under it.**
#
# Default value: `AM_SOCKET__`
##
ENV__SS_AM_SOCKET="AM_SOCKET__"

##
# RepoExe environment variables `termux-am-socket` scope.
#
# **Do not modify this!**
#
# Default value: `AM_SOCKET__`
##
ENV__S_AM_SOCKET="${ENV__S_ROOT}${ENV__SS_AM_SOCKET}"





####
# Variables for the RepoExe packages.
#
# - https://github.com/termux/termux-packages
####

##
# RepoExe packages repo name.
#
# Default value: `termux-packages`
##
PKGS__REPO_NAME="termux-packages"

##
# RepoExe packages repo url.
#
# Default value: `https://github.com/termux/termux-packages`
##
PKGS__REPO_URL="$REPOS_HOST_ORG_URL/$PKGS__REPO_NAME"





####
# Variables for the RepoExe app that hosts the packages.
#
# - https://github.com/termux/termux-app
####

##
# RepoExe app name.
#
# Default value: `RepoExe`
##
APP__NAME="$NAME"


##
# The lower case value for `APP__NAME`.
#
# Default value: `termux`
##
APP__LNAME="${APP__NAME,,}"

##
# RepoExe app identifier for `APPS_DIR_BY_IDENTIFIER` subdirectory.
#
# Default value: `termux`
# Validation regex: `APPS_APP_IDENTIFIER_REGEX`
# Max length: `APPS_APP_IDENTIFIER___MAX_LEN`
##
APP__APP_IDENTIFIER="termux"



##
# RepoExe app repo name.
#
# Default value: `termux-app`
##
APP__REPO_NAME="termux-app"

##
# RepoExe app repo url.
#
# Default value: `https://github.com/termux/termux-app`
##
APP__REPO_URL="$REPOS_HOST_ORG_URL/$APP__REPO_NAME"



##
# RepoExe app namespace, i.e the Java package name under which RepoExe
# classes exists used for `APP__*_CLASS__*` and
# `APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# **See Also:**
# - `APP__PACKAGE_NAME`.
# - https://developer.android.com/build/configure-app-module#set-namespace
# - https://github.com/termux/termux-app/tree/master/app/src/main/java/com/termux
#
# Default value: `com.termux`
##
APP__NAMESPACE="com.termux"

__build_props__add_variables_validator_actions "APP__NAMESPACE" "app_package_name"



##
# RepoExe app apps directory path under `APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `/data/data/com.termux/termux/app/i/termux`
##
APP__APP_DIR="$APPS_DIR_BY_IDENTIFIER/$APP__APP_IDENTIFIER"
__build_props__add_variables_validator_actions "APP__APP_DIR" "safe_absolute_path"



##
# RepoExe app shell API `Activity` class name that hosts the
# shell/terminal views.
#
# **See Also:**
# - https://github.com/termux/termux-app/blob/master/app/src/main/java/com/termux/app/RepoExeActivity.java
#
# Default value: `com.termux.app.RepoExeActivity`
##
APP__SHELL_API__SHELL_API_ACTIVITY__CLASS_NAME="$APP__NAMESPACE.app.RepoExeActivity"



##
# RepoExe app shell API `Service` class name that hosts the
# shell/terminal sessions.
#
# **See Also:**
# - https://github.com/termux/termux-app/blob/master/app/src/main/java/com/termux/app/RepoExeService.java
#
# Default value: `com.termux.app.RepoExeService`
##
APP__SHELL_API__SHELL_API_SERVICE__CLASS_NAME="$APP__NAMESPACE.app.RepoExeService"



##
# RepoExe app `RUN_COMMAND` API `Service` class name that receives
# commands sent by 3rd party apps via intents.
#
# **See Also:**
# - https://github.com/termux/termux-app/blob/master/app/src/main/java/com/termux/app/RunCommandService.java
# - https://github.com/termux/termux-app/wiki/RUN_COMMAND-Intent
#
# Default value: `com.termux.app.RunCommandService`
##
APP__RUN_COMMAND_API__RUN_COMMAND_API_SERVICE__CLASS_NAME="$APP__NAMESPACE.app.RunCommandService"



##
# RepoExe app data sender API `BroadcastReceiver` class name that
# receives data view broadcasts and sends the data with `ACTION_SEND`
# and `ACTION_VIEW` intents to other apps, like by `termux-open`.
#
# **See Also:**
# - https://github.com/termux/termux-app/blob/master/app/src/main/java/com/termux/app/RepoExeOpenReceiver.java
# - https://github.com/termux/termux-tools/blob/master/scripts/termux-open.in
#
# Default value: `com.termux.app.RepoExeOpenReceiver`
##
APP__DATA_SENDER_API__DATA_SENDER_API_RECEIVER__CLASS_NAME="$APP__NAMESPACE.app.RepoExeOpenReceiver"





##
# RepoExe apps info environment file path for the RepoExe app under `APP__APP_DIR`.
#
# Default value: `/data/data/com.termux/termux/app/i/termux/termux-apps-info.env`
##
APP__CORE__APPS_INFO_ENV_FILE="$APP__APP_DIR/$CORE__APPS_INFO_ENV_SUBFILE"
__build_props__add_variables_validator_actions "APP__CORE__APPS_INFO_ENV_FILE" "safe_absolute_path"

##
# RepoExe apps info json file path for the RepoExe app under `APP__APP_DIR`.
#
# Default value: `/data/data/com.termux/termux/app/i/termux/termux-apps-info.json`
##
APP__CORE__APPS_INFO_JSON_FILE="$APP__APP_DIR/$CORE__APPS_INFO_JSON_SUBFILE"
__build_props__add_variables_validator_actions "APP__CORE__APPS_INFO_JSON_FILE" "safe_absolute_path"

##
# `termux-am-socket` server file path for the RepoExe app under `APP__APP_DIR`.
#
# Default value: `/data/data/com.termux/termux/app/i/termux/termux-am`
##
APP__AM_SOCKET__SERVER_SOCKET_FILE="$APP__APP_DIR/$AM_SOCKET__SERVER_SOCKET_SUBFILE"
__build_props__add_variables_validator_actions "APP__AM_SOCKET__SERVER_SOCKET_FILE" "safe_absolute_path unix_path_max"





####
# Variables for the RepoExe:API app that hosts the packages.
#
# - https://github.com/termux/termux-api
####

##
# RepoExe:API app package name used for
# `API_APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# **See Also:**
# - `API_APP__NAMESPACE`.
# - https://developer.android.com/build/configure-app-module#set-application-id
#
# Default value: `com.termux.api`
##
API_APP__PACKAGE_NAME="com.termux.api"

__build_props__add_variables_validator_actions "API_APP__PACKAGE_NAME" "app_package_name"



##
# RepoExe:API app name.
#
# Default value: `RepoExe:API`
##
API_APP__NAME="$NAME:API"

##
# RepoExe:API app identifier for `APPS_DIR_BY_IDENTIFIER` subdirectory.
#
# Default value: `termuxapi`
# Validation regex: `APPS_APP_IDENTIFIER_REGEX`
# Max length: `APPS_APP_IDENTIFIER___MAX_LEN`
##
API_APP__APP_IDENTIFIER="termuxapi"



##
# RepoExe:API app repo name.
#
# Default value: `termux-api`
##
API_APP__REPO_NAME="termux-api"

##
# RepoExe:API app repo url.
#
# Default value: `https://github.com/termux/termux-api`
##
API_APP__REPO_URL="$REPOS_HOST_ORG_URL/$API_APP__REPO_NAME"



##
# RepoExe:API app namespace, i.e the Java package name under which
# RepoExe:API classes exists used for `API_APP__*_CLASS__*` and
# `API_APP__*_(ACTIVITY|RECEIVER|SERVICE)__*` variables.
#
# **See Also:**
# - `API_APP__PACKAGE_NAME`.
# - https://developer.android.com/build/configure-app-module#set-namespace
# - https://github.com/termux/termux-api/tree/master/app/src/main/java/com/termux/api
#
# Default value: `com.termux.api`
##
API_APP__NAMESPACE="com.termux.api"

__build_props__add_variables_validator_actions "API_APP__NAMESPACE" "app_package_name"



##
# RepoExe:API app apps directory path under `APPS_DIR_BY_IDENTIFIER`.
#
# Default value: `/data/data/com.termux/termux/app/i/termuxapi`
##
API_APP__APP_DIR="$APPS_DIR_BY_IDENTIFIER/$API_APP__APP_IDENTIFIER"
__build_props__add_variables_validator_actions "API_APP__APP_DIR" "safe_absolute_path"



##
# RepoExe:API app Android API `BroadcastReceiver` class name that
# receives and processes API requests from command line via `termux-api`
# native exec entry point.
#
# **See Also:**
# - https://github.com/termux/termux-api/blob/master/app/src/main/java/com/termux/api/RepoExeApiReceiver.java
# - https://github.com/termux/termux-api-package/blob/master/termux-api.c
#
# Default value: `com.termux.api.RepoExeApiReceiver`
##
API_APP__ANDROID_API__ANDROID_API_RECEIVER__CLASS_NAME="$API_APP__NAMESPACE.RepoExeApiReceiver"





####
# Variables for the `termux-api` package.
#
# - https://github.com/termux/termux-api-package
####

##
# The `termux-api` package repo name.
#
# Default value: `termux-api-package`
##
API_PKG__REPO_NAME="termux-api-package"

##
# The `termux-api` package repo url.
#
# Default value: `https://github.com/termux/termux-api-package`
##
API_PKG__REPO_URL="$REPOS_HOST_ORG_URL/$API_PKG__REPO_NAME"










####
# Variables for the `termux-core` package.
#
# - https://github.com/termux/termux-core-package
####

##
# The `termux-core` package repo name.
#
# Default value: `termux-core-package`
##
CORE_PKG__REPO_NAME="termux-core-package"

##
# The `termux-core` package repo url.
#
# Default value: `https://github.com/termux/termux-core-package`
##
CORE_PKG__REPO_URL="$REPOS_HOST_ORG_URL/$CORE_PKG__REPO_NAME"





####
# Variables for the `termux-am` package.
#
# - https://github.com/termux/RepoExeAm
####

##
# The `termux-am` package repo name.
#
# Default value: `RepoExeAm`
##
AM_PKG__REPO_NAME="RepoExeAm"

##
# The `termux-am` package repo url.
#
# Default value: `https://github.com/termux/RepoExeAm`
##
AM_PKG__REPO_URL="$REPOS_HOST_ORG_URL/$AM_PKG__REPO_NAME"



##
# RepoExeAm namespace, i.e the Java package name under which RepoExe
# classes exists used for `AM__*_CLASS__*` variables.
#
# This must not be changed unless the classes in the `RepoExeAm` repo
# are moved to a different Java package name (in forks).
#
# **See Also:**
# - https://developer.android.com/build/configure-app-module#set-namespace
# - https://github.com/termux/RepoExeAm/tree/master/app/src/main/java/com/termux/termuxam
#
# Constant value: `com.termux.termuxam`
##
AM_APP__NAMESPACE="com.termux.termuxam"

__build_props__add_variables_validator_actions "AM_APP__NAMESPACE" "app_package_name"



##
# RepoExeAm main class that is passed as `start-class-name` to
# `/system/bin/app_process` when running `am.apk` set in `$CLASSPATH`.
#
# - https://github.com/termux/RepoExeAm/blob/master/app/src/main/java/com/termux/termuxam/Am.java
# - https://github.com/termux/RepoExeAm/blob/v0.8.0/am-libexec-packaged#L30
# - https://cs.android.com/android/platform/superproject/+/android-14.0.0_r1:frameworks/base/cmds/app_process/app_main.cpp;l=31
#
# Default value: `com.termux.termuxam.Am`
##
AM_APP__AM_CLASS__CLASS_NAME="$AM_APP__NAMESPACE.Am"





###
# Variables for the RepoExe package repositories.
###

# The core variable values for which the packages hosted on the
# package repos defined in `repo.json` are compiled for.
# If a custom repo is not being hosted, and official RepoExe repos are
# still defined in `repo.json`, then DO NOT change these values. If a
# custom repo is being hosted whose variable values equal
# `APP__PACKAGE_NAME`, `APP__DATA_DIR`,
# `CORE_DIR`, `APPS_DIR`, `ROOTFS`,
# `HOME`, and `PREFIX` values defined above, then
# update these values respectively to the same values.
# These values are used for the `-i/-I` flags to `build-package.sh`,
# and if respective values do not match, then those flags are ignored
# and dependency packages are not downloaded from the package repos
# and are compiled locally.
# FIXME: Checking for all variables will be added later in repo
# changes pull, currently only `REPO_APP__PACKAGE_NAME` is checked.
REPO_APP__PACKAGE_NAME="com.termux"
REPO_APP__DATA_DIR="/data/data/com.termux"
REPO__CORE_DIR="/data/data/com.termux/termux/core"
REPO__APPS_DIR="/data/data/com.termux/termux/app"
REPO__ROOTFS="/data/data/com.termux/files"
REPO__HOME="/data/data/com.termux/files/home"
REPO__PREFIX="/data/data/com.termux/files/usr"



####
# Variables loaded from `repo.json` file for RepoExe package repositories.
####

REPO_URL=()
REPO_DISTRIBUTION=()
REPO_COMPONENT=()

# FIXME: Move `repo.json` file to under `scripts/` directory and COPY it to `/tmp/termux-packages` in `Dockerfile`.
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
CGCT_DEFAULT_PREFIX="/data/data/com.termux/files/usr/glibc"
__build_props__add_variables_validator_actions "CGCT_DEFAULT_PREFIX" "safe_absolute_path invalid_termux_prefix_paths"

export CGCT_DIR="/data/data/com.termux/cgct"
__build_props__add_variables_validator_actions "CGCT_DIR" "safe_absolute_path invalid_termux_prefix_paths"

# Allow to override setup.
for f in "${HOME}/.config/termux/termuxrc.sh" "${HOME}/.termux/termuxrc.sh" "${HOME}/.termuxrc"; do
    if [ -f "$f" ]; then
        echo "Using builder configuration from '$f'..."
        # shellcheck source=/dev/null
        . "$f"
        break
    fi
done
unset f





###
# Run build properties variable values validation.
###

# Uncomment to print `TERMUX_` variables set
#compgen -v TERMUX_ | while read v; do echo "${v}=${!v}"; done

##
# `__build_props__validate_variables`
##
__build_props__validate_variables() {

    local is_value_defined
    local validator_action
    local validator_actions
    local variable_name
    local variable_value

    if [[ ! "$INTERNAL_NAME" =~ ${INTERNAL_NAME_REGEX:?} ]]; then
        echo "The INTERNAL_NAME '$INTERNAL_NAME' with length ${#INTERNAL_NAME} is invalid." 1>&2
        echo "Check 'INTERNAL_NAME_REGEX' variable docs for info on what is a valid internal name." 1>&2
        return 1
    fi

    if [ "${#INTERNAL_NAME}" -gt ${INTERNAL_NAME___MAX_LEN:?} ]; then
        echo "The INTERNAL_NAME '$INTERNAL_NAME' with length ${#INTERNAL_NAME} is invalid." 1>&2
        echo "The INTERNAL_NAME must have max length \`<= INTERNAL_NAME___MAX_LEN ($INTERNAL_NAME___MAX_LEN)\`." 1>&2
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
            echo "The variable_name '$variable_name' in build properties variables validator actions is not a valid shell variable name." 1>&2
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
                echo "The variable_name '$variable_name' in build properties variables validator actions is not defined." 1>&2
                return 1
            fi

            # If defined but unset.
            [[ " ${validator_actions[*]} " == *" allow_unset_value "* ]] && continue

            echo "The build properties variable value for variable name '$variable_name' is not set." 1>&2
            return 1
        fi

        for validator_action in $validator_actions; do
            case "$validator_action" in
                allow_unset_value)
                    :
                    ;;
                app_package_name)
                    if [[ ! "$variable_value" =~ ${REGEX__APP_PACKAGE_NAME:?} ]] || \
                            [ "${#variable_value}" -gt "${NAME_MAX:?}" ]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must be a valid android app package name with \
max length \`<= NAME_MAX ($NAME_MAX)\`." 1>&2
                        echo "- https://developer.android.com/build/configure-app-module#set-application-id" 1>&2
                        return 1
                    fi
                    ;;
                invalid_termux_rootfs_paths)
                    if [[ "$variable_value" =~ ${REGEX__INVALID_ROOTFS_PATHS:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must not match one of the invalid paths \
in REGEX__INVALID_ROOTFS_PATHS \`$REGEX__INVALID_ROOTFS_PATHS\`." 1>&2
                        return 1
                    fi
                    ;;
                invalid_termux_home_paths)
                    if [[ "$variable_value" =~ ${REGEX__INVALID_HOME_PATHS:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must not match one of the invalid paths \
in REGEX__INVALID_HOME_PATHS \`$REGEX__INVALID_HOME_PATHS\`." 1>&2
                        return 1
                    fi
                    ;;
                invalid_termux_prefix_paths)
                    if [[ "$variable_value" =~ ${REGEX__INVALID_PREFIX_PATHS:?} ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must not match one of the invalid paths \
in REGEX__INVALID_PREFIX_PATHS \`$REGEX__INVALID_PREFIX_PATHS\`." 1>&2
                        return 1
                    fi
                    ;;
                path_equal_to_or_under_termux_rootfs)
                    if [[ "$variable_value" != "${ROOTFS:?}" ]] && \
                            {
                                { [[ "${ROOTFS:?}" != "/" ]] && [[ "$variable_value" != "${ROOTFS}/"* ]]; } || \
                                { [[ "${ROOTFS:?}" == "/" ]] && [[ "$variable_value" != "/"* ]]; };
                            }; then
                        echo "The $variable_name '$variable_value' is invalid." 1>&2
                        echo "The $variable_name must be equal to or be under ROOTFS \`$ROOTFS\`." 1>&2
                        return 1
                    fi
                    ;;
                path_under_termux_rootfs)
                    if { [[ "${ROOTFS:?}" != "/" ]] && [[ "$variable_value" != "${ROOTFS}/"* ]]; } || \
                        { [[ "${ROOTFS:?}" == "/" ]] && [[ "$variable_value" != "/"* ]]; }; then
                        echo "The $variable_name '$variable_value' is invalid." 1>&2
                        echo "The $variable_name must be under ROOTFS \`$ROOTFS\`." 1>&2
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
                    if [[ "${#variable_value}" -ge "${APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN:?}" ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must have max length \`<= APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN \
($APPS_API_SOCKET__SERVER_PARENT_DIR___MAX_LEN)\` including the null \`\0\` terminator." 1>&2
                        return 1
                    fi
                    ;;
                unix_path_max)
                    if [[ "${#variable_value}" -ge "${UNIX_PATH_MAX:?}" ]]; then
                        echo "The $variable_name '$variable_value' with length ${#variable_value} is invalid." 1>&2
                        echo "The $variable_name must have max length \`<= UNIX_PATH_MAX ($UNIX_PATH_MAX)\` \
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
                    echo "The build properties variables validator action '$validator_action' for \
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
            [ "${#APPS_DIR}" -ge ${APPS_DIR___MAX_LEN:?} ]; then
        echo "The APPS_DIR '$APPS_DIR' with length ${#APPS_DIR} is invalid." 1>&2
        echo "The APPS_DIR must have max length \`<= APPS_DIR___MAX_LEN ($APPS_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi


    if [[ ! "$APP__APP_IDENTIFIER" =~ ${APPS_APP_IDENTIFIER_REGEX:?} ]]; then
        echo "The APP__APP_IDENTIFIER '$APP__APP_IDENTIFIER' with length ${#APP__APP_IDENTIFIER} is invalid." 1>&2
        echo "Check 'APPS_APP_IDENTIFIER_REGEX' variable docs for info on what is a valid app identifier." 1>&2
        return 1
    fi

    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#APP__APP_IDENTIFIER}" -gt ${APPS_APP_IDENTIFIER___MAX_LEN:?} ]; then
        echo "The APP__APP_IDENTIFIER '$APP__APP_IDENTIFIER' with length ${#APP__APP_IDENTIFIER} is invalid." 1>&2
        echo "The APP__APP_IDENTIFIER must have max length \
\`<= APPS_APP_IDENTIFIER___MAX_LEN ($APPS_APP_IDENTIFIER___MAX_LEN)\`." 1>&2
        return 1
    fi


    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#ROOTFS}" -ge ${ROOTFS_DIR___MAX_LEN:?} ]; then
        echo "The ROOTFS '$ROOTFS' with length ${#ROOTFS} is invalid." 1>&2
        echo "The ROOTFS must have max length \`<= ROOTFS_DIR___MAX_LEN ($ROOTFS_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi

    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#PREFIX}" -ge ${PREFIX_DIR___MAX_LEN:?} ]; then
        echo "The PREFIX '$PREFIX' with length ${#PREFIX} is invalid." 1>&2
        echo "The PREFIX must have max length \`<= PREFIX_DIR___MAX_LEN ($PREFIX_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi

    if [[ "$__BUILD_PROPS__VALIDATE_PATHS_MAX_LEN" == "true" ]] && \
            [ "${#PREFIX__TMP_DIR}" -ge ${PREFIX__TMP_DIR___MAX_LEN:?} ]; then
        echo "The PREFIX__TMP_DIR '$PREFIX__TMP_DIR' with length ${#PREFIX__TMP_DIR} is invalid." 1>&2
        echo "The PREFIX__TMP_DIR must have max length \`<= PREFIX__TMP_DIR___MAX_LEN ($PREFIX__TMP_DIR___MAX_LEN)\` \
including the null \`\0\` terminator." 1>&2
        return 1
    fi


    if [[ "$ROOTFS" != "/" ]] && \
            [[ "$__BUILD_PROPS__VALIDATE_PREFIX_USR_MERGE_FORMAT" == "true" ]]; then
        if [[ "$PREFIX" != "$ROOTFS/usr" ]]; then
            echo "The PREFIX '$PREFIX' is invalid." 1>&2
            echo "The PREFIX must be equal to '\$ROOTFS/usr' ($ROOTFS/usr) as per 'usr' merge format." 1>&2
            return 1
        fi

        if [[ "${PREFIX:?}" == "${HOME:?}" ]] || \
                [[ "$PREFIX" == "$HOME/"* ]] || \
                [[ "$HOME" == "$PREFIX/"* ]]; then
            echo "The PREFIX '$PREFIX' or HOME '$HOME' is invalid." 1>&2
            echo "The PREFIX must not be equal to HOME and they must not be under each other as per 'usr' merge format." 1>&2
            return 1
        fi
    else
        if [[ "${PREFIX:?}" == "${HOME:?}" ]] || \
                [[ "$PREFIX" == "$HOME/"* ]]; then
            echo "The PREFIX '$PREFIX' or HOME '$HOME' is invalid." 1>&2
            echo "The PREFIX must not be equal to or be under HOME." 1>&2
            return 1
        fi
    fi

    if [[ "${PREFIX:?}" == "${CGCT_DIR:?}" ]] || \
            [[ "$PREFIX" == "$CGCT_DIR/"* ]] || \
            [[ "$CGCT_DIR" == "$PREFIX/"* ]]; then
        echo "The PREFIX '$PREFIX' or CGCT_DIR '$CGCT_DIR' is invalid." 1>&2
        echo "The PREFIX must not be equal to CGCT_DIR and they must not be under each other." 1>&2
        return 1
    fi

    if [[ "$PREFIX" != "$PREFIX_CLASSICAL" ]]; then
        echo "The PREFIX '$PREFIX' or PREFIX_CLASSICAL '$PREFIX_CLASSICAL' is invalid." 1>&2
        echo "The PREFIX must be equal to PREFIX_CLASSICAL." 1>&2
        return 1
    fi

    if [[ "$PREFIX" == "$PREFIX_GLIBC" ]]; then
        echo "The PREFIX '$PREFIX' or PREFIX_GLIBC '$PREFIX_GLIBC' is invalid." 1>&2
        echo "The PREFIX must not be equal to PREFIX_GLIBC." 1>&2
        return 1
    fi

    if [[ "$PREFIX__BASE_LIB_DIR" == "$PREFIX__MULTI_LIB_DIR" ]]; then
        echo "The PREFIX__BASE_LIB_DIR '$PREFIX__BASE_LIB_DIR' or PREFIX__MULTI_LIB_DIR '$PREFIX__MULTI_LIB_DIR' is invalid." 1>&2
        echo "The PREFIX__BASE_LIB_DIR must not be equal to PREFIX__MULTI_LIB_DIR." 1>&2
        return 1
    fi

    if [[ "$PREFIX__BASE_INCLUDE_DIR" == "$PREFIX__MULTI_INCLUDE_DIR" ]]; then
        echo "The PREFIX__BASE_INCLUDE_DIR '$PREFIX__BASE_INCLUDE_DIR' or PREFIX__MULTI_INCLUDE_DIR '$PREFIX__MULTI_INCLUDE_DIR' is invalid." 1>&2
        echo "The PREFIX__BASE_INCLUDE_DIR must not be equal to PREFIX__MULTI_INCLUDE_DIR." 1>&2
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
