export interface ResourceConfig {
  zram?: number;
  swap?: number;
  free_space?: boolean;
  tmpfs?: number;
}

export type PackageInterface = 'cli' | 'gui' | 'tui' | 'both';

export interface SubpackageDefinition {
  name?: string;
  description?: string;
  arch?: string;
  include?: string[];
  files?: string[];
  auto?: 'dev' | 'doc' | 'static';
  type?: 'auto:dev' | 'auto:doc' | 'auto:static';
  deps?: string[];
  parent_dep?: 'exact' | 'same-version' | 'none' | string;
  recommends?: string[];
  suggests?: string[];
  conflicts?: string[];
  provides?: string[];
  replaces?: string[];
  producer_arch?: string;
  multiarch?: string;
  section?: string;
  priority?: string;
  interface?: PackageInterface;
  tags?: string[];
  component?: string;
}

export interface NamedSubpackageDefinition extends SubpackageDefinition {
  name: string;
}

export interface RecipeDefinition {
  name: string;
  version: string;
  epoch?: number;
  revision?: number;
  arch?: string | string[];
  arches?: string[];
  description?: string;
  license?: string;
  homepage?: string;
  maintainer?: string;
  uploaders?: string[] | string;
  component?: string;
  section?: string;
  priority?: string;
  interface?: PackageInterface;
  tags?: string[];
  build_system?: string;
  source?: string | string[] | null;
  sources?: string[] | null;
  mirrors?: string[] | null;
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
  multiarch?: string;
  subpackages?:
    | Record<string, SubpackageDefinition | 'auto:dev' | 'auto:doc' | 'auto:static'>
    | Array<NamedSubpackageDefinition | 'auto:dev' | 'auto:doc' | 'auto:static'>;
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
  section?: string;
  priority?: string;
  interface?: PackageInterface;
  tags?: string[];
  build_system: string;
  source: string | null;
  sources?: string[];
  mirrors?: string[];
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
  multiarch?: string;
  subpackages?: Record<string, SubpackageDefinition>;
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
  producer_arch?: string;
}
