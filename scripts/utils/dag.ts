import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  type DependencyClause,
  type DependencyToken,
  filterDepsForArch,
  normalizeArch,
  parseDependencyList,
  type VersionConstraint,
} from '../core/dependencies.ts';
import { parseRecipe, RecipeCollisionError } from '../core/parser.ts';
import { resolveChildProducerArch } from '../core/subpkg.ts';
import type { PackageRecipe, SubpackageDefinition } from '../core/types.ts';
import { formatDebianVersion, satisfiesVersionConstraint } from '../core/version.ts';

export interface ProviderRecord {
  owner: string;
  pkgName: string;
  version?: string;
  arch?: string;
}

export interface DependencyTarget {
  name: string;
  owner: string;
  versionConstraint?: VersionConstraint;
  isProvider?: boolean;
  arch?: string;
}

const COMMON_EXTERNAL_PACKAGES = new Set([
  'bash',
  'coreutils',
  'dpkg',
  'apt',
  'git',
  'tar',
  'grep',
  'sed',
  'curl',
  'wget',
  'python',
  'python3',
  'clang',
  'binutils',
  'make',
  'cmake',
  'ninja',
  'pkg-config',
  'openssl',
  'zlib',
  'libandroid-support',
  'termux-tools',
  'liblzma',
]);

function parseProviderEntry(raw: string): Array<{
  provName: string;
  provVer?: string;
  architectures?: string[];
  negatedArch?: boolean;
}> {
  if (typeof raw !== 'string') {
    return [];
  }
  const clauses = parseDependencyList([raw]);
  const results: Array<{
    provName: string;
    provVer?: string;
    architectures?: string[];
    negatedArch?: boolean;
  }> = [];
  for (const clause of clauses) {
    if (clause.length > 1) {
      throw new Error(
        `Invalid Provides relationship '${clause.map((t) => t.name).join(' | ')}': Debian policy does not permit alternatives ('|') in Provides.`,
      );
    }
    for (const tok of clause) {
      const provName = tok.name.split(':')[0].trim();
      const provVer = tok.versionConstraint?.version;
      const debPkgNameRegex = /^[a-z0-9][a-z0-9+.-]+$/;
      if (!debPkgNameRegex.test(provName)) {
        throw new Error(
          `Invalid Provides relationship '${tok.name}': package name must match Debian package naming rules.`,
        );
      }
      if (provName) {
        if (tok.versionConstraint) {
          if (tok.versionConstraint.operator !== '=') {
            throw new Error(
              `Invalid Provides relationship '${tok.name} (${tok.versionConstraint.operator} ${tok.versionConstraint.version})': Debian policy permits only '=' in versioned Provides.`,
            );
          }
          if (!provVer || !provVer.trim()) {
            throw new Error(
              `Invalid Provides relationship '${tok.name} (${tok.versionConstraint.operator})': a versioned Provides requires a version.`,
            );
          }
          const debVersionRegex = /^(?:[0-9]+:)?[0-9][a-zA-Z0-9.+:~-]*$/;
          if (!debVersionRegex.test(provVer.trim())) {
            throw new Error(
              `Invalid Provides relationship '${tok.name} (${tok.versionConstraint.operator} ${tok.versionConstraint.version})': version must conform to Debian version syntax.`,
            );
          }
        }
        results.push({
          provName,
          provVer,
          architectures: tok.architectures,
          negatedArch: tok.negatedArch,
        });
      }
    }
  }
  return results;
}

function matchesProviderArch(targetArch: string, architectures?: string[], negatedArch?: boolean): boolean {
  if (!architectures || architectures.length === 0) {
    return true;
  }
  const dummyClause: DependencyClause = [
    {
      name: 'provider',
      architectures,
      negatedArch,
    },
  ];
  return filterDepsForArch([dummyClause], targetArch).length > 0;
}

function serializeClause(clause: DependencyClause): string {
  return clause
    .map(
      (t) =>
        `${t.name}${t.multiArch ? `:${t.multiArch}` : ''}${t.versionConstraint ? `${t.versionConstraint.operator}${t.versionConstraint.version}` : ''}${t.architectures ? `[${t.negatedArch ? '!' : ''}${t.architectures.join(' ')}]` : ''}`,
    )
    .join('|');
}

export class DependencyGraph {
  packagesDir: string;
  recipes: Record<string, PackageRecipe> = Object.create(null);
  subpackageMap: Record<string, string> = Object.create(null);
  subpackageAliasToNameMap: Record<string, string> = Object.create(null);
  providesMap: Record<string, string> = Object.create(null);
  providersMap: Record<string, ProviderRecord[]> = Object.create(null);
  providesVersionMap: Record<string, string | undefined> = Object.create(null);
  rejectedRecipes: Record<string, string> = Object.create(null);

  constructor(packagesDir: string) {
    this.packagesDir = packagesDir;
    this.loadRecipes();
  }

  loadRecipes(): void {
    if (!existsSync(this.packagesDir)) {
      return;
    }
    const glob = new Bun.Glob('*/recipe.ts');
    for (const file of glob.scanSync({ cwd: this.packagesDir })) {
      const full = join(this.packagesDir, file);
      const pkgName = file.split('/')[0];
      try {
        const r = parseRecipe(full);
        this.registerRecipe(r);
      } catch (err: unknown) {
        if (err instanceof RecipeCollisionError) {
          throw err;
        }
        const msg = err instanceof Error ? err.message : String(err);
        this.rejectedRecipes[pkgName] = msg;
      }
    }
  }

  registerRecipe(r: PackageRecipe): void {
    if (this.subpackageMap[r.name] && this.subpackageMap[r.name] !== r.name) {
      throw new RecipeCollisionError(
        `Package name collision: top-level package '${r.name}' is already emitted as a subpackage by '${this.subpackageMap[r.name]}'.`,
      );
    }

    // Upfront validation: verify all emitted child names before mutating graph state
    const emittedSubpkgs = new Map<string, string>();
    if (r.subpackages) {
      for (const [subKey, subDef] of Object.entries(r.subpackages)) {
        const emittedName = typeof subDef === 'object' && subDef?.name ? subDef.name : subKey;
        if (emittedName === r.name) {
          throw new RecipeCollisionError(
            `Package name collision: subpackage '${emittedName}' in '${r.name}' cannot use the same name as the top-level package.`,
          );
        }
        if (this.recipes[emittedName]) {
          throw new RecipeCollisionError(
            `Package name collision: subpackage '${emittedName}' of '${r.name}' conflicts with top-level package '${emittedName}'.`,
          );
        }
        if (this.subpackageMap[emittedName] && this.subpackageMap[emittedName] !== r.name) {
          throw new RecipeCollisionError(
            `Package name collision: subpackage '${emittedName}' of '${r.name}' is already emitted by '${this.subpackageMap[emittedName]}'.`,
          );
        }
        if (emittedSubpkgs.has(emittedName)) {
          throw new RecipeCollisionError(
            `Package name collision: subpackage '${emittedName}' is emitted multiple times by '${r.name}'.`,
          );
        }
        emittedSubpkgs.set(emittedName, subKey);
      }
    }

    // Upfront validation: validate all provider entries before changing graph indexes (Thread #22)
    interface ParsedProvider {
      provName: string;
      provVer?: string;
      pkgName: string;
      arch?: string;
    }
    const validatedProviders: ParsedProvider[] = [];
    if (Array.isArray(r.provides)) {
      for (const prov of r.provides) {
        if (typeof prov !== 'string') {
          throw new Error(`Invalid provides entry in '${r.name}': must be a string, got ${typeof prov}`);
        }
        const entries = parseProviderEntry(prov);
        if (entries.length === 0) {
          throw new Error(`Invalid provides entry '${prov}' in '${r.name}'`);
        }
        const emittedArches =
          r.arch === 'all' ? ['all'] : r.arches && r.arches.length > 0 ? r.arches : [r.arch || 'aarch64'];
        for (const { provName, provVer, architectures, negatedArch } of entries) {
          for (const eArch of emittedArches) {
            if (normalizeArch(eArch) === 'all' && architectures && architectures.length > 0) {
              throw new Error(
                `Package '${r.name}' has architecture 'all' but declares architecture-restricted Provides '${provName} [${architectures.join(' ')}]'.`,
              );
            }
            if (matchesProviderArch(eArch, architectures, negatedArch)) {
              validatedProviders.push({ provName, provVer, pkgName: r.name, arch: eArch });
            }
          }
        }
      }
    }
    if (r.subpackages) {
      for (const [subKey, subDef] of Object.entries(r.subpackages)) {
        if (typeof subDef === 'object' && Array.isArray(subDef?.provides)) {
          for (const prov of subDef.provides) {
            if (typeof prov !== 'string') {
              throw new Error(
                `Invalid provides entry in subpackage of '${r.name}': must be a string, got ${typeof prov}`,
              );
            }
            const entries = parseProviderEntry(prov);
            if (entries.length === 0) {
              throw new Error(`Invalid provides entry '${prov}' in subpackage of '${r.name}'`);
            }
            const sName = typeof subDef === 'object' && subDef?.name ? subDef.name : subKey;
            for (const { provName, provVer, architectures, negatedArch } of entries) {
              if (typeof subDef === 'object' && subDef?.arch) {
                if (normalizeArch(subDef.arch) === 'all' && architectures && architectures.length > 0) {
                  throw new Error(
                    `Package '${sName}' has architecture 'all' but declares architecture-restricted Provides '${provName} [${architectures.join(' ')}]'.`,
                  );
                }
                if (matchesProviderArch(subDef.arch, architectures, negatedArch)) {
                  validatedProviders.push({ provName, provVer, pkgName: sName, arch: subDef.arch });
                }
              } else {
                const parentTargets =
                  r.arch === 'all' ? ['all'] : r.arches && r.arches.length > 0 ? r.arches : [r.arch || 'aarch64'];
                for (const pArch of parentTargets) {
                  if (normalizeArch(pArch) === 'all' && architectures && architectures.length > 0) {
                    throw new Error(
                      `Package '${sName}' has architecture 'all' but declares architecture-restricted Provides '${provName} [${architectures.join(' ')}]'.`,
                    );
                  }
                  if (matchesProviderArch(pArch, architectures, negatedArch)) {
                    validatedProviders.push({ provName, provVer, pkgName: sName, arch: pArch });
                  }
                }
              }
            }
          }
        }
      }
    }

    // If replacing an existing recipe, purge old index entries for r.name first
    if (this.recipes[r.name]) {
      const oldEmittedNames = new Set<string>();
      for (const [k, v] of Object.entries(this.subpackageMap)) {
        if (v === r.name) {
          oldEmittedNames.add(k);
          delete this.subpackageMap[k];
        }
      }
      for (const [alias, target] of Object.entries(this.subpackageAliasToNameMap)) {
        if (oldEmittedNames.has(target) || target === r.name) {
          delete this.subpackageAliasToNameMap[alias];
        }
      }
      for (const [prov, list] of Object.entries(this.providersMap)) {
        const remaining = list.filter((p) => p.owner !== r.name);
        if (remaining.length === 0) {
          delete this.providersMap[prov];
          if (this.providesMap[prov] === r.name) {
            delete this.providesMap[prov];
            delete this.providesVersionMap[prov];
          }
        } else {
          this.providersMap[prov] = remaining;
          if (this.providesMap[prov] === r.name) {
            const first = remaining[0];
            this.providesMap[prov] = first.owner;
            if (first.version) {
              this.providesVersionMap[prov] = first.version;
            } else {
              delete this.providesVersionMap[prov];
            }
          }
        }
      }
    }

    // Commit changes to graph indices
    this.recipes[r.name] = r;
    delete this.rejectedRecipes[r.name];
    for (const [emittedName, subKey] of emittedSubpkgs) {
      this.subpackageMap[emittedName] = r.name;
      if (subKey !== emittedName) {
        this.subpackageAliasToNameMap[subKey] = emittedName;
      }
    }

    for (const { provName, provVer, pkgName, arch } of validatedProviders) {
      this.providesMap[provName] = r.name;
      if (!this.providersMap[provName]) {
        this.providersMap[provName] = [];
      }
      this.providersMap[provName].push({ owner: r.name, pkgName, version: provVer, arch });
      this.providesVersionMap[provName] = provVer;
    }
  }

  canOwnerSatisfyDep(
    owner: string,
    depName: string,
    versionConstraint?: VersionConstraint,
    cache?: Map<string, boolean>,
    targetArch?: string,
  ): boolean {
    const recipe = this.recipes[owner];
    if (!recipe) {
      return false;
    }
    const normTarget = targetArch ? normalizeArch(targetArch) : undefined;
    if (owner === depName || this.subpackageMap[depName] === owner) {
      let archMatches = true;
      if (normTarget) {
        if (owner === depName) {
          const rArch = recipe.arch ? normalizeArch(recipe.arch) : 'aarch64';
          const rArches = recipe.arches?.map(normalizeArch);
          archMatches = rArch === 'all' || rArch === normTarget || Boolean(rArches && rArches.includes(normTarget));
        } else {
          const subDef: SubpackageDefinition | undefined =
            recipe.subpackages &&
            Object.entries(recipe.subpackages).find(([key, s]) => s && (s.name || key) === depName)?.[1];
          if (subDef?.arch) {
            const sArch = normalizeArch(subDef.arch);
            archMatches = sArch === 'all' || sArch === normTarget;
          } else {
            const rArch = recipe.arch ? normalizeArch(recipe.arch) : 'aarch64';
            const rArches = recipe.arches?.map(normalizeArch);
            archMatches = rArch === 'all' || rArch === normTarget || Boolean(rArches?.includes(normTarget));
          }
        }
      }
      if (archMatches) {
        if (!versionConstraint) {
          return true;
        }
        const ver = formatDebianVersion(recipe);
        if (satisfiesVersionConstraint(ver, versionConstraint, cache)) {
          return true;
        }
      }
    }
    const providers = this.providersMap[depName] || [];
    const matching = providers.filter((p) => p.owner === owner);
    for (const p of matching) {
      const pNormArch = p.arch ? normalizeArch(p.arch) : undefined;
      if (normTarget && pNormArch && pNormArch !== 'all' && pNormArch !== normTarget) {
        continue;
      }
      if (!versionConstraint) {
        return true;
      }
      if (p.version && satisfiesVersionConstraint(p.version, versionConstraint, cache)) {
        return true;
      }
    }
    return false;
  }

  ownerProducesDep(owner: string, depName: string, arch?: string, versionConstraint?: VersionConstraint): boolean {
    if (!arch) {
      return true;
    }
    const reqArch = normalizeArch(arch);
    const recipe = this.recipes[owner];
    if (!recipe) {
      return false;
    }
    if (recipe.name === depName) {
      if (versionConstraint) {
        const ver = formatDebianVersion(recipe);
        if (satisfiesVersionConstraint(ver, versionConstraint)) {
          if (recipe.arch === 'all') {
            return true;
          }
          const rArches =
            recipe.arches && recipe.arches.length > 0
              ? recipe.arches.map(normalizeArch)
              : [normalizeArch(recipe.arch || 'aarch64')];
          return rArches.includes(reqArch);
        }
      } else {
        if (recipe.arch === 'all') {
          return true;
        }
        const rArches =
          recipe.arches && recipe.arches.length > 0
            ? recipe.arches.map(normalizeArch)
            : [normalizeArch(recipe.arch || 'aarch64')];
        return rArches.includes(reqArch);
      }
    }
    if (recipe.subpackages) {
      for (const [subKey, subDef] of Object.entries(recipe.subpackages)) {
        if (!subDef || typeof subDef !== 'object') {
          continue;
        }
        const sName = (subDef as SubpackageDefinition).name || subKey;
        if (sName === depName) {
          const sArch = (subDef as SubpackageDefinition).arch;
          if (sArch === 'all') {
            if (recipe.arch === 'all') {
              return true;
            }
            const parentArches =
              recipe.arches && recipe.arches.length > 0
                ? recipe.arches.map(normalizeArch)
                : [normalizeArch(recipe.arch || 'aarch64')];
            const designatedProducer = parentArches.includes('aarch64') ? 'aarch64' : parentArches[0];
            const childProducer = (subDef as SubpackageDefinition).producer_arch
              ? normalizeArch((subDef as SubpackageDefinition).producer_arch!)
              : designatedProducer;
            return reqArch === childProducer;
          }
          const effectiveArch = sArch ? normalizeArch(sArch) : undefined;
          return effectiveArch ? effectiveArch === reqArch : true;
        }
      }
    }

    // 2. Virtual package check against ProviderRecords declaring Provides for depName (Thread #27)
    const providers = this.providersMap[depName];
    if (providers && providers.length > 0) {
      for (const prov of providers) {
        if (prov.owner !== owner) {
          continue;
        }
        const provArch = prov.arch ? normalizeArch(prov.arch) : undefined;
        if (provArch && provArch !== 'all' && provArch !== reqArch) {
          continue;
        }
        if (versionConstraint && (!prov.version || !satisfiesVersionConstraint(prov.version, versionConstraint))) {
          continue;
        }
        if (this.ownerProducesDep(owner, prov.pkgName, arch)) {
          return true;
        }
      }
    }

    return false;
  }

  canOwnerSupplyDepUnified(
    owner: string,
    depName: string,
    requiredArch: string | undefined,
    plannedOwnerArch: string,
    versionConstraint?: VersionConstraint,
    cache?: Map<string, boolean>,
  ): boolean {
    const recipe = this.recipes[owner];
    if (!recipe) {
      return false;
    }
    const normReq = requiredArch ? normalizeArch(requiredArch) : undefined;
    const normPlan = normalizeArch(plannedOwnerArch);

    // 1. Top-level package
    if (recipe.name === depName) {
      const ver = formatDebianVersion(recipe);
      if (!versionConstraint || satisfiesVersionConstraint(ver, versionConstraint, cache)) {
        if (recipe.arch === 'all') {
          return true;
        } else {
          const rArches =
            recipe.arches && recipe.arches.length > 0
              ? recipe.arches.map(normalizeArch)
              : [normalizeArch(recipe.arch || 'aarch64')];
          const archMatches = !normReq || rArches.includes(normReq);
          if (archMatches && normPlan === (normReq || normPlan)) {
            return true;
          }
        }
      }
    }

    // 2. Subpackages
    if (recipe.subpackages) {
      for (const [subKey, subDef] of Object.entries(recipe.subpackages)) {
        if (!subDef || typeof subDef !== 'object') {
          continue;
        }
        const sName = (subDef as SubpackageDefinition).name || subKey;
        if (sName === depName) {
          const ver = formatDebianVersion(recipe);
          if (!versionConstraint || satisfiesVersionConstraint(ver, versionConstraint, cache)) {
            const rawSubArch = (subDef as SubpackageDefinition).arch || (recipe.arch === 'all' ? 'all' : undefined);
            const isChildArchAll = rawSubArch === 'all';
            if (isChildArchAll) {
              if (recipe.arch === 'all') {
                return true;
              }
              const designatedProducer = resolveChildProducerArch(recipe, subDef as SubpackageDefinition);
              if (normPlan === designatedProducer) {
                return true;
              }
            } else {
              const effSubArch = rawSubArch ? normalizeArch(rawSubArch) : undefined;
              const archMatches = !normReq || (effSubArch ? effSubArch === normReq : true);
              if (archMatches && normPlan === (normReq || normPlan)) {
                return true;
              }
            }
          }
        }
      }
    }

    // 3. Virtual providers (ProviderRecords)
    const providers = this.providersMap[depName] || [];
    const matching = providers.filter((p) => p.owner === owner);
    for (const prov of matching) {
      if (versionConstraint && (!prov.version || !satisfiesVersionConstraint(prov.version, versionConstraint, cache))) {
        continue;
      }
      const pNormArch = prov.arch ? normalizeArch(prov.arch) : undefined;
      const isProvAll = pNormArch === 'all';
      if (isProvAll) {
        if (prov.pkgName === recipe.name) {
          return true;
        } else if (recipe.subpackages) {
          const sDef = Object.entries(recipe.subpackages).find(
            ([key, s]) => s && ((s as SubpackageDefinition).name || key) === prov.pkgName,
          )?.[1];
          if (sDef && typeof sDef === 'object') {
            if (recipe.arch === 'all') {
              return true;
            }
            const designatedProducer = resolveChildProducerArch(recipe, sDef as SubpackageDefinition);
            if (normPlan === designatedProducer) {
              return true;
            }
          }
        }
      } else {
        const archMatches = !normReq || (pNormArch ? pNormArch === normReq : true);
        if (archMatches && normPlan === (normReq || normPlan)) {
          return true;
        }
      }
    }

    return false;
  }

  private isDepArchAll(owner: string, depName: string): boolean {
    const recipe = this.recipes[owner];
    if (!recipe) {
      return false;
    }
    if (recipe.name === depName) {
      return recipe.arch === 'all';
    }
    if (recipe.subpackages) {
      for (const [subKey, subDef] of Object.entries(recipe.subpackages)) {
        if (!subDef || typeof subDef !== 'object') {
          continue;
        }
        const sName = (subDef as SubpackageDefinition).name || subKey;
        if (sName === depName) {
          const sArch = (subDef as SubpackageDefinition).arch || (recipe.arch === 'all' ? 'all' : undefined);
          return sArch === 'all';
        }
      }
    }
    const providers = this.providersMap[depName];
    if (providers) {
      for (const p of providers) {
        if (p.owner === owner && p.arch === 'all') {
          return true;
        }
      }
    }
    return false;
  }

  getRecipeDepTargets(
    recipe: PackageRecipe,
    arch?: string,
    includeSubpkgs = false,
    versionCache?: Map<string, boolean>,
    keepSelfSatisfiedAlternatives = false,
    includeRuntime = true,
    includeBuild = true,
    filterPrerequisitesByProducer = false,
  ): DependencyTarget[][] {
    const targetArches = arch
      ? [arch]
      : recipe.arches && recipe.arches.length > 0
        ? recipe.arches
        : [recipe.arch || 'aarch64'];
    const result: DependencyTarget[][] = [];
    const targetCache = versionCache || new Map<string, boolean>();

    const mapTokensToTargets = (
      clause: DependencyToken[],
      isRuntime: boolean,
      clauseArch?: string,
    ): DependencyTarget[] => {
      const mappedTargets: DependencyTarget[] = [];
      let selfSatisfied = false;
      let selfProduced = false;

      for (const t of clause) {
        if (
          !this.recipes[t.name] &&
          !this.subpackageMap[t.name] &&
          !this.providesMap[t.name] &&
          !(this.providersMap[t.name] && this.providersMap[t.name].length > 0) &&
          this.subpackageAliasToNameMap[t.name] &&
          !COMMON_EXTERNAL_PACKAGES.has(t.name) &&
          !existsSync(join(this.packagesDir, t.name))
        ) {
          throw new Error(
            `Dependency '${t.name}' refers to an internal subpackage record key; use emitted package name '${this.subpackageAliasToNameMap[t.name]}' instead.`,
          );
        }

        const concreteOwners = new Set<string>();
        const providerOwners = new Set<string>();
        if (this.recipes[t.name]) {
          concreteOwners.add(t.name);
        }
        if (this.subpackageMap[t.name]) {
          concreteOwners.add(this.subpackageMap[t.name]);
        }
        if (this.providersMap[t.name] && this.providersMap[t.name].length > 0) {
          for (const prov of this.providersMap[t.name]) {
            if (concreteOwners.has(prov.owner)) {
              continue;
            }
            const pNormArch = prov.arch ? normalizeArch(prov.arch) : undefined;
            if (clauseArch && pNormArch && pNormArch !== 'all' && pNormArch !== normalizeArch(clauseArch)) {
              continue;
            }
            let satisfies = true;
            if (t.versionConstraint) {
              satisfies = prov.version
                ? satisfiesVersionConstraint(prov.version, t.versionConstraint, targetCache)
                : false;
            }
            if (satisfies) {
              providerOwners.add(prov.owner);
            }
          }
        }
        if (concreteOwners.size === 0 && providerOwners.size === 0) {
          concreteOwners.add(t.name);
        }

        const effTargetArch = clauseArch || (arch === 'all' ? 'aarch64' : arch);
        // Emit concrete owners before compatible providers so concrete packages are preferred while providers stay available
        for (const owner of concreteOwners) {
          if (owner === recipe.name) {
            if (this.canOwnerSatisfyDep(recipe.name, t.name, t.versionConstraint, targetCache, clauseArch)) {
              selfSatisfied = true;
              if (this.ownerProducesDep(recipe.name, t.name, effTargetArch, t.versionConstraint)) {
                selfProduced = true;
              }
            }
          } else {
            mappedTargets.push({
              name: t.name,
              owner,
              versionConstraint: t.versionConstraint,
              isProvider: false,
              arch: effTargetArch,
            });
          }
        }
        for (const owner of providerOwners) {
          if (owner === recipe.name) {
            if (this.canOwnerSatisfyDep(recipe.name, t.name, t.versionConstraint, targetCache, clauseArch)) {
              selfSatisfied = true;
              if (this.ownerProducesDep(recipe.name, t.name, effTargetArch, t.versionConstraint)) {
                selfProduced = true;
              }
            }
          } else {
            mappedTargets.push({
              name: t.name,
              owner,
              versionConstraint: t.versionConstraint,
              isProvider: true,
              arch: effTargetArch,
            });
          }
        }
      }

      if (isRuntime && selfSatisfied && selfProduced && !keepSelfSatisfiedAlternatives) {
        return [];
      }
      return mappedTargets;
    };

    if (includeBuild && recipe.build_deps && recipe.build_deps.length > 0) {
      const buildClauses = parseDependencyList(recipe.build_deps);
      const seenBuildKeys = new Set<string>();
      for (const tArch of targetArches) {
        const buildArch = tArch === 'all' ? 'aarch64' : tArch;
        const filteredBuild = filterDepsForArch(buildClauses, buildArch);
        for (const clause of filteredBuild) {
          const clauseKey = `${normalizeArch(buildArch)}:${serializeClause(clause)}`;
          if (seenBuildKeys.has(clauseKey)) {
            continue;
          }
          seenBuildKeys.add(clauseKey);
          const mapped = mapTokensToTargets(clause, false, buildArch);
          if (mapped.length > 0) {
            result.push(mapped);
          }
        }
      }
    }

    if (includeRuntime) {
      const runtimeClauses = parseDependencyList(recipe.deps || []);
      const allRuntimeClauses: Array<{ clause: DependencyClause; arch?: string }> = [];
      const seenRuntimeKeys = new Set<string>();

      const nativeTargets = ['aarch64', 'arm', 'x86_64', 'i686'];
      const topRuntimeArches = arch ? targetArches : recipe.arch === 'all' ? nativeTargets : targetArches;

      for (const tArch of topRuntimeArches) {
        const filteredRuntime = filterDepsForArch(runtimeClauses, tArch);
        for (const clause of filteredRuntime) {
          const clauseKey = `${normalizeArch(tArch)}:${serializeClause(clause)}`;
          if (!seenRuntimeKeys.has(clauseKey)) {
            seenRuntimeKeys.add(clauseKey);
            allRuntimeClauses.push({ clause, arch: tArch });
          }
        }
      }

      if (includeSubpkgs && recipe.subpackages) {
        for (const subDef of Object.values(recipe.subpackages)) {
          if (typeof subDef === 'object' && subDef) {
            if (filterPrerequisitesByProducer && arch && subDef.arch === 'all') {
              const parentArches =
                recipe.arches && recipe.arches.length > 0
                  ? recipe.arches.map(normalizeArch)
                  : [normalizeArch(recipe.arch || 'aarch64')];
              const designatedProducer = parentArches.includes('aarch64') ? 'aarch64' : parentArches[0];
              const childProducer = subDef.producer_arch ? normalizeArch(subDef.producer_arch) : designatedProducer;
              if (recipe.arch !== 'all' && normalizeArch(arch) !== childProducer) {
                continue;
              }
            }
            const childRaw: string[] = [];
            if (Array.isArray(subDef.deps)) {
              childRaw.push(...subDef.deps);
            }
            if (
              typeof subDef.parent_dep === 'string' &&
              !['exact', 'same-version', 'none'].includes(subDef.parent_dep)
            ) {
              childRaw.push(subDef.parent_dep);
            }
            if (childRaw.length > 0) {
              const inheritsAll = subDef.arch === 'all' || (!subDef.arch && recipe.arch === 'all');
              const childArches = inheritsAll
                ? arch
                  ? [arch]
                  : nativeTargets
                : subDef.arch
                  ? [subDef.arch]
                  : arch
                    ? [arch]
                    : targetArches;
              const childClauses = parseDependencyList(childRaw);
              for (const cArch of childArches) {
                const filteredChild = filterDepsForArch(childClauses, cArch);
                for (const clause of filteredChild) {
                  const clauseKey = `${normalizeArch(cArch)}:${serializeClause(clause)}`;
                  if (!seenRuntimeKeys.has(clauseKey)) {
                    seenRuntimeKeys.add(clauseKey);
                    allRuntimeClauses.push({ clause, arch: cArch });
                  }
                }
              }
            }
          }
        }
      }

      for (const item of allRuntimeClauses) {
        const mapped = mapTokensToTargets(item.clause, true, item.arch);
        if (mapped.length > 0) {
          result.push(mapped);
        }
      }
    }

    return result;
  }

  getRecipeDepClauses(
    recipe: PackageRecipe,
    arch?: string,
    includeSubpkgs = false,
    keepSelfSatisfiedAlternatives = false,
  ): string[][] {
    const versionCache = new Map<string, boolean>();
    const targets = this.getRecipeDepTargets(recipe, arch, includeSubpkgs, versionCache, keepSelfSatisfiedAlternatives);
    return targets.map((clause) => {
      const hasSatisfiedConcrete = clause.some(
        (t) =>
          !t.isProvider &&
          (this.recipes[t.owner]
            ? this.canOwnerSatisfyDep(t.owner, t.name, t.versionConstraint, versionCache, t.arch)
            : false),
      );
      const effective =
        hasSatisfiedConcrete && !keepSelfSatisfiedAlternatives ? clause.filter((t) => !t.isProvider) : clause;
      return Array.from(new Set(effective.map((t) => t.owner)));
    });
  }

  getRecipeDepNames(
    recipe: PackageRecipe,
    arch?: string,
    includeSubpkgs = false,
    keepSelfSatisfiedAlternatives = false,
  ): Set<string> {
    const clauses = this.getRecipeDepClauses(recipe, arch, includeSubpkgs, keepSelfSatisfiedAlternatives);
    const canonical = new Set<string>();
    for (const clause of clauses) {
      for (const dep of clause) {
        canonical.add(dep);
      }
    }
    return canonical;
  }

  resolveBuildOrder(targetPackages?: string[], arch?: string, includeSubpkgs = false): string[] {
    if (targetPackages && targetPackages.length > 0) {
      for (const p of targetPackages) {
        if (this.rejectedRecipes[p]) {
          throw new Error(`Cannot resolve build order: recipe for '${p}' is invalid: ${this.rejectedRecipes[p]}`);
        }
        if (!this.recipes[p]) {
          throw new Error(`Cannot resolve build order: target package '${p}' does not exist in recipe graph.`);
        }
      }
    }
    const hasTargets = Boolean(targetPackages && targetPackages.length > 0);
    const candidateSet = hasTargets ? new Set(targetPackages!) : new Set(Object.keys(this.recipes));
    const allPkgs = hasTargets ? Array.from(candidateSet) : Object.keys(this.recipes);
    const completed = new Set<string>();
    const order: string[] = [];
    const versionCache = new Map<string, boolean>();

    const pkgTargets = new Map<string, DependencyTarget[][]>();
    const pkgBuildTargets = new Map<string, DependencyTarget[][]>();
    for (const p of allPkgs) {
      const effArch =
        arch ||
        (this.recipes[p].arches && this.recipes[p].arches.length > 0
          ? this.recipes[p].arches[0]
          : this.recipes[p].arch || 'aarch64');
      pkgTargets.set(
        p,
        this.getRecipeDepTargets(this.recipes[p], effArch, includeSubpkgs, versionCache, false, true, true, true),
      );
      pkgBuildTargets.set(
        p,
        this.getRecipeDepTargets(this.recipes[p], effArch, includeSubpkgs, versionCache, false, false, true, true),
      );
    }

    // Precompute reverse index: owner -> distinct consumers in allPkgs (Thread #25)
    const consumersOfOwner = new Map<string, Set<string>>();
    for (const p of allPkgs) {
      consumersOfOwner.set(p, new Set());
    }
    for (const [consumer, clauses] of pkgTargets) {
      for (const clause of clauses) {
        for (const t of clause) {
          if (consumersOfOwner.has(t.owner) && t.owner !== consumer) {
            consumersOfOwner.get(t.owner)!.add(consumer);
          }
        }
      }
    }

    const remainingConsumerCount = new Map<string, number>();
    for (const p of allPkgs) {
      remainingConsumerCount.set(p, consumersOfOwner.get(p)!.size);
    }

    const isReadyForTargets = (p: string, targetsMap: Map<string, DependencyTarget[][]>): boolean => {
      const clauses = targetsMap.get(p) || [];
      return clauses.every((clause) => {
        const canSupply = (owner: string, t: DependencyTarget): boolean => {
          const effArch = arch || t.arch;
          const ownerRecipe = this.recipes[owner];
          const plannedOwnerArch =
            arch || (ownerRecipe ? ownerRecipe.arches?.[0] || ownerRecipe.arch || 'aarch64' : 'aarch64');
          return this.canOwnerSupplyDepUnified(
            owner,
            t.name,
            effArch,
            plannedOwnerArch,
            t.versionConstraint,
            versionCache,
          );
        };
        const hasLocalSchedulable = clause.some((t) => candidateSet.has(t.owner) && canSupply(t.owner, t));
        return clause.some((t) =>
          candidateSet.has(t.owner) ? completed.has(t.owner) && canSupply(t.owner, t) : !hasLocalSchedulable,
        );
      });
    };
    const isReady = (p: string): boolean => isReadyForTargets(p, pkgTargets);
    const isBuildReady = (p: string): boolean => isReadyForTargets(p, pkgBuildTargets);

    const remaining = new Set(allPkgs);
    while (remaining.size > 0) {
      let ready = Array.from(remaining).filter((p) => isReady(p));
      if (ready.length === 0) {
        const buildReady = Array.from(remaining).filter((p) => isBuildReady(p));
        if (buildReady.length > 0) {
          ready = buildReady;
        } else {
          const leftover = Array.from(remaining).sort();
          order.push(...leftover);
          break;
        }
      }

      ready.sort(
        (a, b) => (remainingConsumerCount.get(b) || 0) - (remainingConsumerCount.get(a) || 0) || a.localeCompare(b),
      );

      const nextNode = ready[0];
      order.push(nextNode);
      completed.add(nextNode);
      remaining.delete(nextNode);

      // Decrement consumer counts for owners that nextNode depended on
      const nextNodeClauses = pkgTargets.get(nextNode) || [];
      const updatedOwners = new Set<string>();
      for (const clause of nextNodeClauses) {
        for (const t of clause) {
          if (t.owner !== nextNode && consumersOfOwner.has(t.owner) && !updatedOwners.has(t.owner)) {
            updatedOwners.add(t.owner);
            const cur = remainingConsumerCount.get(t.owner) || 0;
            if (cur > 0) {
              remainingConsumerCount.set(t.owner, cur - 1);
            }
          }
        }
      }
    }

    const fullOrder = order.length === allPkgs.length ? order : allPkgs;
    if (!targetPackages || targetPackages.length === 0) {
      return fullOrder;
    }

    const targetSet = new Set(targetPackages);
    return fullOrder.filter((p) => targetSet.has(p));
  }

  getDependents(pkgName: string, arch?: string): Set<string> {
    const dependents = new Set<string>();
    const reverseGraph = new Map<string, Set<string>>();
    for (const [p, recipe] of Object.entries(this.recipes)) {
      const deps = this.getRecipeDepNames(recipe, arch, true, true);
      for (const d of deps) {
        let set = reverseGraph.get(d);
        if (!set) {
          set = new Set();
          reverseGraph.set(d, set);
        }
        set.add(p);
      }
    }

    const queue = [pkgName];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const consumers = reverseGraph.get(current);
      if (consumers) {
        for (const p of consumers) {
          if (!dependents.has(p)) {
            dependents.add(p);
            queue.push(p);
          }
        }
      }
    }
    return dependents;
  }

  getLayers(targetPackages?: string[], arch?: string, includeSubpkgs = false): string[][] {
    if (targetPackages && targetPackages.length > 0) {
      for (const p of targetPackages) {
        if (this.rejectedRecipes[p]) {
          throw new Error(`Cannot compute layers: recipe for '${p}' is invalid: ${this.rejectedRecipes[p]}`);
        }
      }
    }
    const pkgs = new Set(targetPackages ? targetPackages.filter((p) => this.recipes[p]) : Object.keys(this.recipes));
    const completed = new Set<string>();
    const remaining = new Set(pkgs);
    const versionCache = new Map<string, boolean>();

    const pkgTargets = new Map<string, DependencyTarget[][]>();
    for (const p of pkgs) {
      pkgTargets.set(
        p,
        this.getRecipeDepTargets(this.recipes[p], arch, includeSubpkgs, versionCache, false, true, true, true),
      );
    }

    const canSupply = (owner: string, t: DependencyTarget): boolean => {
      const effArch = arch || t.arch;
      const ownerRecipe = this.recipes[owner];
      const plannedOwnerArch =
        arch || (ownerRecipe ? ownerRecipe.arches?.[0] || ownerRecipe.arch || 'aarch64' : 'aarch64');
      return this.canOwnerSupplyDepUnified(owner, t.name, effArch, plannedOwnerArch, t.versionConstraint, versionCache);
    };

    const isReady = (p: string): boolean => {
      const clauses = pkgTargets.get(p) || [];
      return clauses.every((clause) =>
        clause.some((t) => {
          if (!pkgs.has(t.owner)) {
            return !clause.some((other) => pkgs.has(other.owner) && canSupply(other.owner, other));
          }
          return completed.has(t.owner) && canSupply(t.owner, t);
        }),
      );
    };

    const layers: string[][] = [];
    while (remaining.size > 0) {
      const currentLayer = Array.from(remaining).filter((p) => isReady(p));
      if (currentLayer.length === 0) {
        break;
      }
      currentLayer.sort();
      layers.push(currentLayer);
      for (const p of currentLayer) {
        completed.add(p);
        remaining.delete(p);
      }
    }

    if (remaining.size > 0) {
      throw new Error(
        `Failed to schedule all packages; cycle or unsatisfiable dependencies for: ${Array.from(remaining).sort().join(', ')}`,
      );
    }

    return layers;
  }
}
