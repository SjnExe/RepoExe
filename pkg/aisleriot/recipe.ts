import { defineRecipe } from '@core/types.ts';

export default defineRecipe({
  name: 'aisleriot',
  version: '3.22.35',
  revision: 2,
  auto_update: true,
  update_strategy: 'git_tag',
  arch: ['aarch64', 'arm', 'x86_64', 'i686'],
  description: 'GNOME solitaire card game collection',
  license: 'GPL-3.0-or-later',
  homepage: 'https://wiki.gnome.org/Apps/AisleRiot',
  maintainer: '@SjnExe',
  build_system: 'custom',
  source: 'https://gitlab.gnome.org/GNOME/aisleriot.git#{version}',
  formats: ['apt'],
  build_deps: ['gtk3', 'guile', 'librsvg', 'libcanberra', 'libxml2', 'desktop-file-utils', 'shared-mime-info'],
  deps: ['gtk3', 'guile', 'librsvg', 'libcanberra', 'libxml2'],
  resources: {
    zram: 0,
    swap: 0,
    tmpfs: 4,
  },
  phases: {
    configure: `export SCCACHE_DISABLE=1
mkdir -p "\${PREFIX}/bin"
mkdir -p "\${PREFIX}/host-bin"

# Cross-compilation target tuple setup for Guile Scheme bytecode compiler
TARGET_TUPLE=""
case "\${TARGET_ARCH:-aarch64}" in
  aarch64|arm64) TARGET_TUPLE="aarch64-linux-android" ;;
  arm) TARGET_TUPLE="arm-linux-androideabi" ;;
  x86_64) TARGET_TUPLE="x86_64-linux-android" ;;
  i686) TARGET_TUPLE="i686-linux-android" ;;
esac
if [ -n "$TARGET_TUPLE" ] && [ -f games/guile-compile ]; then
  if ! sed -i "s|^TARGET_PLATFORM=.*|TARGET_PLATFORM='\${TARGET_TUPLE}'|" games/guile-compile; then
    echo "Error: Failed to patch TARGET_PLATFORM in games/guile-compile" >&2
    exit 1
  fi
fi

if [ -x /usr/bin/guile-3.0 ]; then
  ln -sf /usr/bin/guile-3.0 "\${PREFIX}/host-bin/guile"
  ln -sf /usr/bin/guile-3.0 "\${PREFIX}/host-bin/guile-3.0"
  ln -sf /usr/bin/guile-3.0 "\${PREFIX}/bin/guile"
  ln -sf /usr/bin/guile-3.0 "\${PREFIX}/bin/guile-3.0"
elif [ -x /usr/bin/guile ]; then
  ln -sf /usr/bin/guile "\${PREFIX}/host-bin/guile"
  ln -sf /usr/bin/guile "\${PREFIX}/host-bin/guile-3.0"
  ln -sf /usr/bin/guile "\${PREFIX}/bin/guile"
  ln -sf /usr/bin/guile "\${PREFIX}/bin/guile-3.0"
fi
if command -v glib-compile-resources >/dev/null 2>&1; then
  ln -sf "$(command -v glib-compile-resources)" "\${PREFIX}/host-bin/glib-compile-resources"
  ln -sf "$(command -v glib-compile-resources)" "\${PREFIX}/bin/glib-compile-resources"
fi
export PATH="\${PREFIX}/host-bin:\${PATH}"
export CFLAGS="-Wno-error -Wno-packed -Wno-deprecated-declarations -Wno-format-nonliteral -Wno-cast-function-type-mismatch -Wno-unused-variable -Wno-unused-but-set-variable -Wno-unused-parameter -Wno-pragma-messages \${CFLAGS:-}"
export CXXFLAGS="-Wno-error -Wno-packed -Wno-deprecated-declarations -Wno-format-nonliteral -Wno-cast-function-type-mismatch -Wno-unused-variable -Wno-unused-but-set-variable -Wno-unused-parameter -Wno-pragma-messages \${CXXFLAGS:-}"
CROSS_FILE="/tmp/meson-cross.ini"
if [ -n "\${TMPDIR}" ] && [ -f "\${TMPDIR}/meson-cross.ini" ]; then
  CROSS_FILE="\${TMPDIR}/meson-cross.ini"
fi
meson setup build \\
  --cross-file "\${CROSS_FILE}" \\
  --prefix="\${PREFIX}" \\
  --libdir="\${PREFIX}/lib" \\
  -Dwarning_level=0 \\
  -Dguile=3.0 \\
  -Dtheme_kde=false
`,
    make: `ninja -C build -j4 -k 0
`,
    install: `DESTDIR="\${DESTDIR}" ninja -C build install
rm -rf "\${PREFIX}/host-bin"
rm -f "\${PREFIX}/bin/guile"* "\${PREFIX}/bin/guild"*
rm -f "\${DESTDIR}\${PREFIX}/bin/guile"* "\${DESTDIR}\${PREFIX}/bin/guild"* "\${DESTDIR}\${PREFIX}/bin/glib-compile-resources"
if command -v termux-elf-cleaner >/dev/null 2>&1; then
  termux-elf-cleaner "\${DESTDIR}\${PREFIX}/bin/sol" 2>/dev/null || true
  termux-elf-cleaner "\${DESTDIR}\${PREFIX}/lib/aisleriot/ar-cards/"*.so 2>/dev/null || true
fi
`,
    test: `SOL_PATH=""
if [ -n "\${DESTDIR}" ] && [ -x "\${DESTDIR}\${PREFIX}/bin/sol" ]; then
  SOL_PATH="\${DESTDIR}\${PREFIX}/bin/sol"
elif [ -x "\${PREFIX}/bin/sol" ]; then
  SOL_PATH="\${PREFIX}/bin/sol"
fi
if [ -z "$SOL_PATH" ]; then
  echo "Error: sol executable not found in staged package or PREFIX" >&2
  exit 1
fi
env -u LD_LIBRARY_PATH readelf -h "$SOL_PATH"
HOST_ARCH="$(uname -m)"
if { [ "$HOST_ARCH" = "aarch64" ] || [ "$HOST_ARCH" = "arm64" ]; } && [ -e /system/bin/linker64 ]; then
  env -u LD_LIBRARY_PATH "$SOL_PATH" --help >/dev/null
fi
`,
  },
});
