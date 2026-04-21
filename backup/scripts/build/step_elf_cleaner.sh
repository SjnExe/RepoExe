step_elf_cleaner() {
	step_elf_cleaner__from_paths . \( -path "./bin/*" -o -path "./lib/*" -o -path "./lib32/*" -o -path "./libexec/*" -o -path "./opt/*" \)
}

step_elf_cleaner__from_paths() {
	# Remove entries unsupported by Android's linker:
	find "$@" -type f -print0 | xargs -r -0 \
		"$ELF_CLEANER" --api-level "$PKG_API_LEVEL"
}
