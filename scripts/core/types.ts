export interface ResourceConfig {
  zram?: number;
  swap?: number;
  free_space?: boolean;
  tmpfs?: number;
}

export interface RecipeDefinition {
  name: string;
  version: string;
  epoch?: number;
  revision?: number;
  arch?: string | string[];
  description?: string;
  license?: string;
  homepage?: string;
  maintainer?: string;
  uploaders?: string[] | string;
  component?: string;
  build_system?: string;
  source?: string | null;
  sha256?: string | null;
  formats?: string[];
  build_deps?: string[];
  deps?: string[];
  recommends?: string[];
  suggests?: string[];
  conflicts?: string[];
  provides?: string[];
  replaces?: string[];
  breaks?: string[];
  enhances?: string[];
  maintainer_scripts?: Record<string, string>;
  resources?: ResourceConfig;
  heavy_build?: boolean;
  cache?: boolean;
  auto_update?: boolean;
  update_strategy?: string | null;
  custom_update_cmd?: string | null;
  patches?: string[];
  cflags?: string | null;
  cxxflags?: string | null;
  ldflags?: string | null;
  phases?: Record<string, string>;
  vars?: Record<string, string>;
  env?: Record<string, string>;
  toolchains?: Record<string, string>;
  ndk?: '30' | '23c' | string;
}

export function defineRecipe(definition: RecipeDefinition): RecipeDefinition {
  return definition;
}

export interface PackageRecipe {
  name: string;
  version: string;
  epoch: number;
  revision: number;
  arch: string;
  arches?: string[];
  description: string;
  license: string;
  homepage: string;
  maintainer: string;
  uploaders?: string[];
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
  breaks?: string[];
  enhances?: string[];
  maintainer_scripts?: Record<string, string>;
  resources: ResourceConfig;
  heavy_build: boolean;
  cache: boolean;
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
  state_hash: string;
  ndk?: '30' | '23c' | string;
}
