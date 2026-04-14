#!/bin/sh

# This script clears massive amounts of space on GitHub Action runners very quickly
# by aggressively deleting large tools using rm -rf instead of apt purge.

if [ "${CI-false}" != "true" ]; then
	echo "ERROR: not running on CI, not deleting system files to free space!"
	exit 1
else
	# Fast deletion of massive tool directories
	sudo rm -rf /opt/ghc /opt/az /opt/hostedtoolcache /opt/actionarchivecache /opt/runner-cache
	sudo rm -rf /opt/pipx /usr/share/dotnet /usr/share/swift /usr/share/miniconda /usr/share/az_* /usr/share/gradle-* /usr/share/java /home/runner/.rustup
	sudo rm -rf /etc/skel /home/packer /home/linuxbrew
	sudo rm -rf /usr/local /usr/src/

	# Android SDKs and NDKs (we use our own dockerized versions)
	sudo rm -rf /usr/local/lib/android

	# https://github.com/actions/runner-images/issues/709#issuecomment-612569242
	sudo rm -rf "$AGENT_TOOLSDIRECTORY"

	# Clean compressed docker images
	sudo rm -rf /var/lib/containerd/io.containerd.content.v1.content/
fi
