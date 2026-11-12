export interface ResourceConfig {
  zram?: number;
  swap?: number;
  free_space?: boolean;
  tmpfs?: number;
}

export interface ChannelOverride {
  epoch?: number;
  version?: string;
  revision?: number;
  arch?: string;
  description?: string;
  license?: string;
  homepage?: string;
  maintainer?: string;
  component?: string;
  build_system?: string;
  source?: string;
  sha256?: string;
  formats?: string[];
  build_deps?: string[];
  deps?: string[];
  recommends?: string[];
  suggests?: string[];
  conflicts?: string[];
  provides?: string[];
  replaces?: string[];
  heavy_build?: boolean;
  auto_update?: boolean;
  update_strategy?: string;
  custom_update_cmd?: string;
  patches?: string[];
  cflags?: string;
  cxxflags?: string;
  ldflags?: string;
  phases?: Record<string, string>;
  vars?: Record<string, string>;
  env?: Record<string, string>;
  toolchains?: Record<string, string>;
}

export interface PackageRecipe {
  name: string;
  version: string;
  epoch: number;
  revision: number;
  arch: string;
  description: string;
  license: string;
  homepage: string;
  maintainer: string;
  component: string;
  build_system: string;
  source: string | null;
  sha256: string | null;
  formats: string[];
  build_deps: string[];
  deps: string[];
  recommends: string[];
  suggests: string[];
  conflicts: string[];
  provides: string[];
  replaces: string[];
  resources: ResourceConfig;
  heavy_build: boolean;
  auto_update: boolean;
  update_strategy: string | null;
  custom_update_cmd: string | null;
  patches: string[];
  cflags: string | null;
  cxxflags: string | null;
  ldflags: string | null;
  phases: Record<string, string>;
  vars: Record<string, string>;
  env: Record<string, string>;
  toolchains: Record<string, string>;
  channels: Record<string, ChannelOverride>;
  active_channel: string;
  state_hash: string;
}
