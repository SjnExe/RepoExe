import { defineRecipe } from '@core/types.ts';

export default defineRecipe({
  name: 'aisleriot',
  version: '3.22.35',
  revision: 1,
  auto_update: true,
  update_strategy: 'git_tag',
  arch: 'aarch64',
  description: 'Solitaire card games collection compiled for Termux X11',
  license: 'GPL-3.0-or-later',
  homepage: 'https://wiki.gnome.org/Apps/AisleRiot',
  maintainer: 'SjnExe',
  build_system: 'custom',
  source: 'https://gitlab.gnome.org/GNOME/aisleriot.git#{version}',
  formats: ['apt'],
  build_deps: ['gtk3', 'guile', 'librsvg', 'libcanberra', 'libxml2', 'desktop-file-utils', 'shared-mime-info'],
  deps: ['gtk3', 'guile', 'librsvg', 'libcanberra', 'libxml2'],
  resources: {
    zram: 0,
    swap: 0,
    tmpfs: 12,
  },
  phases: {
    configure: `export SCCACHE_DISABLE=1
mkdir -p "\${PREFIX}/bin"
# Overwrite target aarch64 binaries with host x86_64 binaries so build-time generators run natively
if [ -x /usr/bin/guile-3.0 ]; then
  ln -sf /usr/bin/guile-3.0 "\${PREFIX}/bin/guile"
  ln -sf /usr/bin/guile-3.0 "\${PREFIX}/bin/guile-3.0"
elif [ -x /usr/bin/guile ]; then
  ln -sf /usr/bin/guile "\${PREFIX}/bin/guile"
  ln -sf /usr/bin/guile "\${PREFIX}/bin/guile-3.0"
fi
if [ -x /usr/bin/guild ]; then
  ln -sf /usr/bin/guild "\${PREFIX}/bin/guild"
elif [ -x /usr/bin/guild-3.0 ]; then
  ln -sf /usr/bin/guild-3.0 "\${PREFIX}/bin/guild"
fi
if command -v glib-compile-resources >/dev/null 2>&1; then
  ln -sf "$(command -v glib-compile-resources)" "\${PREFIX}/bin/glib-compile-resources"
fi
export CFLAGS="-Wno-error -Wno-packed -Wno-deprecated-declarations -Wno-format-nonliteral -Wno-cast-function-type-mismatch -Wno-unused-variable -Wno-unused-but-set-variable -Wno-unused-parameter -Wno-pragma-messages \${CFLAGS:-}"
export CXXFLAGS="-Wno-error -Wno-packed -Wno-deprecated-declarations -Wno-format-nonliteral -Wno-cast-function-type-mismatch -Wno-unused-variable -Wno-unused-but-set-variable -Wno-unused-parameter -Wno-pragma-messages \${CXXFLAGS:-}"
CROSS_FILE="/tmp/meson-cross.ini"
if [ ! -f "\${CROSS_FILE}" ] && [ -n "\${TMPDIR}" ] && [ -f "\${TMPDIR}/meson-cross.ini" ]; then
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
rm -f "\${DESTDIR}\${PREFIX}/bin/guile"* "\${DESTDIR}\${PREFIX}/bin/guild"* "\${DESTDIR}\${PREFIX}/bin/glib-compile-resources"
if command -v termux-elf-cleaner >/dev/null 2>&1; then
  termux-elf-cleaner "\${DESTDIR}\${PREFIX}/bin/sol" 2>/dev/null || true
  termux-elf-cleaner "\${DESTDIR}\${PREFIX}/lib/aisleriot/ar-cards/"*.so 2>/dev/null || true
fi
`,
    test: `SOL_PATH=""
if [ -x "\${PREFIX}/bin/sol" ]; then
  SOL_PATH="\${PREFIX}/bin/sol"
fi
if [ -z "$SOL_PATH" ]; then
  CANDIDATE="$(command -v sol || true)"
  if [ -n "$CANDIDATE" ] && [ "$CANDIDATE" != "/usr/bin/sol" ] && [ "$CANDIDATE" != "/bin/sol" ]; then
    SOL_PATH="$CANDIDATE"
  fi
fi
if [ -z "$SOL_PATH" ]; then
  echo "Error: sol executable not found in staged package or PREFIX" >&2
  exit 1
fi
env -u LD_LIBRARY_PATH readelf -h "$SOL_PATH"
`,
  },
});
