<<<<<<< SEARCH
		else
			local ELF_CLEANER_VERSION
			ELF_CLEANER_VERSION=$(bash -c ". $SCRIPTDIR/packages/repoexe-elf-cleaner/build.sh; echo \$PKG_VERSION")
			download \
				"https://github.com/repoexe/repoexe-elf-cleaner/releases/download/v${ELF_CLEANER_VERSION}/repoexe-elf-cleaner" \
				"$ELF_CLEANER" \
				59645fb25b84d11f108436e83d9df5e874ba4eb76ab62948869a23a3ee692fa7
			chmod u+x "$ELF_CLEANER"
		fi
=======
		else
			local ELF_CLEANER_VERSION
			ELF_CLEANER_VERSION=$(curl -s https://raw.githubusercontent.com/termux/termux-packages/master/packages/termux-elf-cleaner/build.sh | bash -c '. /dev/stdin; echo "$TERMUX_PKG_VERSION"')
			# Termux's repoexe-elf-cleaner doesn't exist, use termux-elf-cleaner
			download \
				"https://github.com/termux/termux-elf-cleaner/releases/download/v${ELF_CLEANER_VERSION}/termux-elf-cleaner" \
				"$ELF_CLEANER" \
				$(curl -s https://raw.githubusercontent.com/termux/termux-packages/master/packages/termux-elf-cleaner/build.sh | bash -c '. /dev/stdin; echo "$TERMUX_PKG_SHA256"')
			chmod u+x "$ELF_CLEANER"
		fi
>>>>>>> REPLACE
