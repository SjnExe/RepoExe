# RepoExe Package Recipe Schema Specification (`build.yml`)

Every package in RepoExe is defined using a declarative `build.yml` file located in `pkg/<pkg_name>/build.yml`.

## 1. Top-Level Recipe Schema

```yaml
name: tsc                      # Package name (required)
version: "0.1.0"               # Package version (required)
revision: 0                    # Packaging revision integer (default: 0)
architecture: aarch64          # Target architecture (default: aarch64)
description: Short summary     # Package description
license: Apache-2.0            # SPDX License identifier
homepage: https://...          # Upstream homepage URL
maintainer: SjnExe             # Package maintainer
build_system: go               # Toolchain type (go, cargo, python, native, custom)
source_url: https://...        # Upstream source archive URL
sha256: e3b0c44298fc...        # SHA256 verification checksum
auto_update: true              # Automated update checking toggle (default: true)

# Environment variables injected during build phases
vars:
  CGO_ENABLED: "0"

# Lifecycle execution hooks
phases:
  configure: |
    echo "Configuring build..."
  make: |
    go build -ldflags="-s -w" -o tsc ./cmd/tsc
  install: |
    install -Dm755 tsc "${DESTDIR}${PREFIX}/bin/tsc"
```

## 2. Channel Overrides (`channels:`)

Channels allow a single package recipe to maintain multiple release tracks (e.g. `latest`, `v1`, `beta`).

```yaml
channels:
  v1:
    version: "1.4.2"
    source_url: "https://github.com/typescript-go/typescript-go/archive/v1.4.2.tar.gz"
    sha256: "8a91b2c45d..."
    auto_update: false  # Overrides auto-update for this channel only
    vars:
      LEGACY_MODE: "1"
```

To build a specific channel:
```bash
uv --project scripts run python scripts/build.py build <package> --channel <name>
```
