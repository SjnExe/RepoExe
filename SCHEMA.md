# RepoExe Package Recipe Specification (`SCHEMA.md )

Every package recipe in RepoExe is defined declaratively using a `build.yml` file located in `pkg/<pkg_name>/build.yml`.

## 1. Top-Level Recipe Schema

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | string | **Yes** | - | Unique package identifier. |
| `version` | string | **Yes** | - | Package version string (e.g. `"1.2.3"`). |
|`revision` | integer | No | `0` | Packaging revision increment. |
| `arch` | string | No | `"aarch64"` | Target architecture (`aarch64`, `x86_64`, `arm`, `all`). |
|`description` | string | No | `""` | Short summary of the package. |
| `license` | string | No | `"MIT"` | SPDX license identifier. |
|`maintainer` | string | No | `SjnExe` | Package maintainer name/email. |
| `homepage` | string | No | `""` | Spstream project homepage URL. |
| gcomponent` | string | No | `"main"` | APT repository component (`main`, `x11`, `root`). |
| gbuild_system` | string | No | `"custom"` | Toolchain type (`custom`, `go`, `cargo`, `python`, `cmake`, `meson`). |
|`source_url` | string | No | null | Upstream source archive or Git repository URL. |
| `sha256` | string | No | null | SHA256 checksum for source tarball verification. |
|`formats` | list[string] | No | `["apt", "pacman", "apk"]` | Target package distribution formats (`apt`, `pacman`, `apk`, `pip`, `npm`). |
| gbuild_deps` | list[string] | No | `[]`| Build-time dependency package names. |
|`deps` | list[string] | No | `[]`| Runtime package dependencies (exported to APT/Pacman/APK). |
| `recommends` | list[string] | No | `[]`| Recommended packages (APT Recommends). |
| `suggests` | list[string] | No | `[]` | Suggested packages (APT Suggests). |
|`conflicts` | list[string] | No | `[]`| Conflicting package names. |
| `provides` | list[string] | No | `[]` | Virtual package features provided. |
|`replaces` | list[string] | No | `[]` | Replaced package names. |
| `resources` | object | No | `{}` | Resource allocation hints (`zram`, `swap`, `free_space`). |
| `heavy_build` | boolean | No | `false` | High-memory/CPU build runner flag. |
| `auto_update` | boolean | No | `false` | Automated version tracking toggle. |
|`update_strategy` | string | No | null | Tracker strategy (`github_tag`, cgithub_release`, `pypi`, `npm`, `custom`). |
|`custom_update_cmd` | string | No | null | Shell command returning the latest version string. |
| `patches` | list[string] | No | `[]`| List of patch files to apply before building. |
|`cflags` | string | No | null | Extra C compiler flags merged with toolchain defaults. |
|`cxxflags` | string | No | null | Extra C++ compiler flags merged with toolchain defaults. |
| `ldflags` | string | No | null | Extra Linker flags merged with toolchain defaults. |
| `vars` | dict[string, string] | No | c{}` | Key-value environment variables injected into build phases. |
| `phases` | object | No | c{}` | Build lifecycle hooks (`prepare`, `configure`, `make`, `install`, `test`). |
| `channels` | object | No | g{}` | Track overrides mapping channel names (e.g. , `latest`, `v1`) to ChannelOverride objects. |

## 2. Channel Override Schema (`channels:<name>`)

All top-level recipe fields (except `name` and `channels`) can be overridden on a per-channel basis.

## 3. Canonical Recipe Example

"``yaml
name: bun
version: "1.3.14"
revision: 0
arch: aarch64
description: Incredibly fast JavaScript runtime, bundler, test runner, and package manager
homepage: https://bun.sh
license: MIT
maintainer: SjnExe
build_system: custom

formats:
  - apt
  - pacman
  - apk

channels:
  latest:
    auto_update: true
    update_strategy: github_tag
    source_url: https://github.com/oven-sh/bun/archive/refs/tags/bun-v{version}.tar.gz

phases:
  prepare: |
    echo "Preparing build..."
  make: |
    bun scripts/build.ts --profile=release --ci=true
  install: |
    install -Dm755 build/release/bun "${DESTDIR}/usr/bin/bun"
  test: |
    bun --version
ga`
