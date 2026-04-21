# Source this script in order to make the content of bin
# directory available in $PATH. Use only under Bash!

if [ -z "${BASH}" ]; then
	echo "Cannot source because your shell is not Bash!"
else
	BINPATH=$(realpath "$(dirname "${BASH_SOURCE}")")
	PATH="${BINPATH}:${PATH}"
	export PATH
	echo "Scripts from '$BINPATH' are now available in your \$PATH."
	unset BINPATH
fi
