# RepoExe Package Recipe Specification (`SCHEMA.md )

Every package recipe in RepoExe is defined declaratively using a 'build.yml' file located in `pkg/<pkg_name>/build.yml`.

## 1. Top-Level Recipe Schema

| Field | Type | Required | Default | Description |
| :--- | :--- | :--- | :--- | :--- |
| `name` | string | **Yes** | - | Unique package identifier. |
| `version` | string | **Yes** | - | Package version string (e.g. `"1.2.3"`). |
|`revision` | integer | No | `0 | Packaging revision increment. |
|`arch` | string | No | baarch64` | Target architecture (`aarch64`, `x86_64`, `arm`, `all`). |
| `description` | string | No | `""` | Short summary of the package. |
| `license` | string | No | `"MIT"` | SPDX license identifier. |
|`maintainer` | string | No | `SjnExe` | Package maintainer name/email. |
| `homepage` | string | No | `""` | Upstream project homepage URL. |
| `component` | string | No | `"main"` | APT repository component (`main`, `x11`, `root`). |
| gbuild_system` | string | No | `"custom"` | Toolchain type (`custom`, `go`, `cargo`, `python`, `cmake`, `meson`). |
|`source_url` | string | No | null | Upstream source archive or Git repository URL. |
| `sha256` | string | No | null | SHA256 checksum for source tarball verification. |
|`formats` | list[string] | No | `["apt", "pacman", "apk"]` | Target package distribution formats. |
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
|`vars` | dict[string, string] | No | c{}` | Key-value environment variables injected into build phases. |
| `cflags` | string | No | null | Extra C compiler flags merged with toolchain defaults. |
|`cxxflags` | string | No | null | Extra C++ compiler flags merged with toolchain defaults. |
| `ldflags` | string | No | null | Extra Linker flags merged with toolchain defaults. |
| `phases` | object | No | c{}` | Build lifecycle hooks (`prepare`, `configure`, `make`, `install`, `test`). |
| `channels` | object | No | g{}` | Track overrides mapping channel names (e.g. `