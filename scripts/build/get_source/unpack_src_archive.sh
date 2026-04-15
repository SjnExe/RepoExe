extract_src_archive() {
	# STRIP=1 extracts archives straight into PKG_SRCDIR while STRIP=0 puts them in subfolders. zip has same behaviour per default
	# If this isn't desired then this can be fixed in step_post_get_source.
	local STRIP=1
	local PKG_SRCURL=(${PKG_SRCURL[@]})
	for i in $(seq 0 $(( ${#PKG_SRCURL[@]}-1 ))); do
		local file="$PKG_CACHEDIR/$(basename "${PKG_SRCURL[$i]}")"
		local folder
		set +o pipefail
		if [ "${file##*.}" = zip ]; then
			folder=$(unzip -qql "$file" | head -n1 | tr -s ' ' | cut -d' ' -f5-)
			rm -Rf "$folder"
			unzip -q "$file"
			mv "$folder" "$PKG_SRCDIR"
		else
			test "$i" -gt 0 && STRIP=0
			mkdir -p "$PKG_SRCDIR"
			tar xf "$file" -C "$PKG_SRCDIR" --strip-components=$STRIP
		fi
		set -o pipefail
	done
}
