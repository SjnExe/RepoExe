#!/bin/sh

# This script clears massive amounts of space on GitHub Action runners very quickly
# by aggressively deleting large tools using a combined rm -rf command in the background.

if [ "${CI-false}" != "true" ]; then
	echo "ERROR: not running on CI, not deleting system files to free space!"
	exit 1
else
	# Fast deletion of massive tool directories run concurrently.
	# We combine these to avoid multiple process instantiations.
	sudo rm -rf \
		/opt/ghc \
		/opt/az \
		/opt/hostedtoolcache \
		/opt/actionarchivecache \
		/opt/runner-cache \
		/opt/pipx \
		/usr/share/dotnet \
		/usr/share/swift \
		/usr/share/miniconda \
		/usr/share/az_* \
		/usr/share/gradle-* \
		/usr/share/java \
		/home/runner/.rustup \
		/etc/skel \
		/home/packer \
		/home/linuxbrew \
		/usr/local/lib/android \
		"$AGENT_TOOLSDIRECTORY" \
		/var/lib/containerd/io.containerd.content.v1.content/ &

	# We don't need to wait for it; it runs in the background while the runner executes subsequent steps.
fi