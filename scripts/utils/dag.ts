import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { filterDepsForArch, parseDependencyList, type VersionConstraint } from '../core/dependencies.ts';
import { parseRecipe } from '../core/parser.ts';
import type { PackageRecipe } from '../core/types.ts';
import { formatDebianVersion, satisfiesVersionConstraint } from '../core/version.ts';

export interface ProviderRecord {
  owner: string;
  version?: string;
}

export interface DependencyTarget {
  name: string;
  owner: string;
  versionConstraint?: VersionConstraint;
}

export class DependencyGraph {
  packagesDir: string;
  recipes: Record<string, PackageRecipe> = Object.create(null);
  subpackageMap: Record<string, string> = Object.create(null);
  subpackageAliasToNameMap: Record<string, string> = Object.create(null);
  providesMap: Record<string, string> = Object.create(null);
  providersMap: Record<string, ProviderRecord[]> = Object.create(null);
  providesVersionMap: Record<string, string | undefined> = Object.create(null);

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
      try {
        const r = parseRecipe(full);
        this.registerRecipe(r);
      } catch (err: unknown) {
        if (err instanceof Error && err.message.includes('collision')) {
          throw err;
        }
      }
    }
  }

  registerRecipe(r: PackageRecipe): void {
    if (this.subpackageMap[r.name]) {
      throw new Error(
        `Package name collision: top-level package '${r.name}' is already emitted as a subpackage by '${this.subpackageMap[r.name]}'.`,
      );
    }

    // Upfront validation: verify all emitted child names before mutating graph state
    const emittedSubpkgs = new Map<string, string>();
    if (r.subpackages) {
      for (const [subKey, subDef] of Object.entries(r.subpackages)) {
        const emittedName = typeof subDef === 'object' && subDef?.name ? subDef.name : subKey;
        if (this.recipes[emittedName]) {
          throw new Error(
            `Package name collision: subpackage '${emittedName}' of '${r.name}' conflicts with top-level package '${emittedName}'.`,
          );
        }
        if (this.subpackageMap[emittedName] && this.subpackageMap[emittedName] !== r.name) {
          throw new Error(
            `Package name collision: subpackage '${emittedName}' is emitted by both '${this.subpackageMap[emittedName]}' and '${r.name}'.`,
          );
        }
        if (emittedSubpkgs.has(emittedName)) {
          throw new Error(
            `Package name collision: subpackage '${emittedName}' is emitted multiple times by '${r.name}'.`,
          );
        }
        emittedSubpkgs.set(emittedName, subKey);
      }
    }

    // If replacing an existing recipe, purge old index entries for r.name first
    if (this.recipes[r.name]) {
      for (const [k, v] of Object.entries(this.subpackageMap)) {
        if (v === r.name) {
          delete this.subpackageMap[k];
        }
      }
      for (const [alias, target] of Object.entries(this.subpackageAliasToNameMap)) {
        if (target.startsWith(`${r.name}-`) || target === r.name) {
          delete this.subpackageAliasToNameMap[alias];
        }
      }
      for (const [k, v] of Object.entries(this.providesMap)) {
        if (v === r.name) {
          delete this.providesMap[k];
          delete this.providesVersionMap[k];
        }
      }
      for (const [prov, list] of Object.entries(this.providersMap)) {
        this.providersMap[prov] = list.filter((p) => p.owner !== r.name);
        if (this.providersMap[prov].length === 0) {
          delete this.providersMap[prov];
          if (this.providesMap[prov] === r.name) {
            delete this.providesMap[prov];
            delete this.providesVersionMap[prov];
          }
        }
      }
    }

    // Commit changes to graph indices
    this.recipes[r.name] = r;
    for (const [emittedName, subKey] of emittedSubpkgs) {
      this.subpackageMap[emittedName] = r.name;
      if (subKey !== emittedName) {
        this.subpackageAliasToNameMap[subKey] = emittedName;
      }
    }

    if (r.subpackages) {
      for (const subDef of Object.values(r.subpackages)) {
        if (typeof subDef === 'object' && Array.isArray(subDef?.provides)) {
          for (const prov of subDef.provides) {
            const provMatch = prov.match(/^([a-zA-Z0-9._+-]+)(?:\s*\(\s*=\s*([^)]+)\))?/);
            const provName = provMatch ? provMatch[1].trim() : prov.replace(/\s*\(.*\)\s*$/, '').trim();
            const provVer = provMatch ? provMatch[2]?.trim() : undefined;
            this.providesMap[provName] = r.name;
            if (!this.providersMap[provName]) {
              this.providersMap[provName] = [];
            }
            this.providersMap[provName].push({ owner: r.name, version: provVer });
            this.providesVersionMap[provName] = provVer;
          }
        }
      }
    }
    if (r.provides) {
      for (const prov of r.provides) {
        const provMatch = prov.match(/^([a-zA-Z0-9._+-]+)(?:\s*\(\s*=\s*([^)]+)\))?/);
        const provName = provMatch ? provMatch[1].trim() : prov.replace(/\s*\(.*\)\s*$/, '').trim();
        const provVer = provMatch ? provMatch[2]?.trim() : undefined;
        this.providesMap[provName] = r.name;
        if (!this.providersMap[provName]) {
          this.providersMap[provName] = [];
        }
        this.providersMap[provName].push({ owner: r.name, version: provVer });
        this.providesVersionMap[provName] = provVer;
      }
    }
  }

  canOwnerSatisfyDep(owner: string, depName: string, versionConstraint?: VersionConstraint): boolean {
    const recipe = this.recipes[owner];
    if (!recipe) {
      return false;
    }
    if (!versionConstraint) {
      return true;
    }
    if (owner === depName || this.subpackageMap[depName] === owner) {
      const ver = formatDebianVersion(recipe);
      return satisfiesVersionConstraint(ver, versionConstraint);
    }
    const providers = this.providersMap[depName] || [];
    const matching = providers.filter((p) => p.owner === owner);
    for (const p of matching) {
      if (p.version && satisfiesVersionConstraint(p.version, versionConstraint)) {
        return true;
      }
    }
    return false;
  }

  getRecipeDepTargets(recipe: PackageRecipe, arch?: string, includeSubpkgs = false): DependencyTarget[][] {
    const targetArch = arch || recipe.arch || 'aarch64';
    const result: DependencyTarget[][] = [];

    if (recipe.build_deps && recipe.build_deps.length > 0) {
      const buildClauses = parseDependencyList(recipe.build_deps);
      const filteredBuild = filterDepsForArch(buildClauses, targetArch);
      for (const clause of filteredBuild) {
        const mappedTargets: DependencyTarget[] = [];
        for (const t of clause) {
          if (
            !this.recipes[t.name] &&
            !this.subpackageMap[t.name] &&
            !this.providesMap[t.name] &&
            !(this.providersMap[t.name] && this.providersMap[t.name].length > 0) &&
            this.subpackageAliasToNameMap[t.name]
          ) {
            throw new Error(
              `Dependency '${t.name}' refers to an internal subpackage record key; use emitted package name '${this.subpackageAliasToNameMap[t.name]}' instead.`,
            );
          }
          if (this.recipes[t.name]) {
            if (t.name !== recipe.name) {
              mappedTargets.push({ name: t.name, owner: t.name, versionConstraint: t.versionConstraint });
            }
          } else if (this.subpackageMap[t.name]) {
            const owner = this.subpackageMap[t.name];
            if (owner !== recipe.name) {
              mappedTargets.push({ name: t.name, owner, versionConstraint: t.versionConstraint });
            }
          } else if (this.providersMap[t.name] && this.providersMap[t.name].length > 0) {
            for (const prov of this.providersMap[t.name]) {
              if (prov.owner !== recipe.name) {
                mappedTargets.push({ name: t.name, owner: prov.owner, versionConstraint: t.versionConstraint });
              }
            }
          } else {
            const owner = this.providesMap[t.name] || t.name;
            if (owner !== recipe.name) {
              mappedTargets.push({ name: t.name, owner, versionConstraint: t.versionConstraint });
            }
          }
        }
        if (mappedTargets.length > 0) {
          result.push(mappedTargets);
        }
      }
    }

    const runtimeClauses = parseDependencyList(recipe.deps || []);
    const filteredRuntime = filterDepsForArch(runtimeClauses, targetArch);
    const allRuntime = [...filteredRuntime];

    if (includeSubpkgs && recipe.subpackages) {
      for (const subDef of Object.values(recipe.subpackages)) {
        if (typeof subDef === 'object' && subDef) {
          const childRaw: string[] = [];
          if (Array.isArray(subDef.deps)) {
            childRaw.push(...subDef.deps);
          }
          if (typeof subDef.parent_dep === 'string' && !['exact', 'same-version', 'none'].includes(subDef.parent_dep)) {
            childRaw.push(subDef.parent_dep);
          }
          if (childRaw.length > 0) {
            const childArch = subDef.arch || (recipe.arch === 'all' ? 'all' : targetArch);
            const childClauses = parseDependencyList(childRaw);
            const filteredChild = filterDepsForArch(childClauses, childArch);
            allRuntime.push(...filteredChild);
          }
        }
      }
    }

    for (const clause of allRuntime) {
      const mappedTargets: DependencyTarget[] = [];
      let selfSatisfied = false;
      for (const t of clause) {
        if (
          !this.recipes[t.name] &&
          !this.subpackageMap[t.name] &&
          !this.providesMap[t.name] &&
          !(this.providersMap[t.name] && this.providersMap[t.name].length > 0) &&
          this.subpackageAliasToNameMap[t.name]
        ) {
          throw new Error(
            `Dependency '${t.name}' refers to an internal subpackage record key; use emitted package name '${this.subpackageAliasToNameMap[t.name]}' instead.`,
          );
        }
        if (this.recipes[t.name]) {
          if (t.name === recipe.name) {
            if (this.canOwnerSatisfyDep(recipe.name, t.name, t.versionConstraint)) {
              selfSatisfied = true;
            }
          } else {
            mappedTargets.push({ name: t.name, owner: t.name, versionConstraint: t.versionConstraint });
          }
        } else if (this.subpackageMap[t.name]) {
          const owner = this.subpackageMap[t.name];
          if (owner === recipe.name) {
            if (this.canOwnerSatisfyDep(recipe.name, t.name, t.versionConstraint)) {
              selfSatisfied = true;
            }
          } else {
            mappedTargets.push({ name: t.name, owner, versionConstraint: t.versionConstraint });
          }
        } else if (this.providersMap[t.name] && this.providersMap[t.name].length > 0) {
          for (const prov of this.providersMap[t.name]) {
            if (prov.owner === recipe.name) {
              if (this.canOwnerSatisfyDep(recipe.name, t.name, t.versionConstraint)) {
                selfSatisfied = true;
              }
            } else {
              mappedTargets.push({ name: t.name, owner: prov.owner, versionConstraint: t.versionConstraint });
            }
          }
        } else {
          const owner = this.providesMap[t.name] || t.name;
          if (owner === recipe.name) {
            if (this.canOwnerSatisfyDep(recipe.name, t.name, t.versionConstraint)) {
              selfSatisfied = true;
            }
          } else {
            mappedTargets.push({ name: t.name, owner, versionConstraint: t.versionConstraint });
          }
        }
      }
      if ((!selfSatisfied || includeSubpkgs) && mappedTargets.length > 0) {
        result.push(mappedTargets);
      }
    }

    return result;
  }

  getRecipeDepClauses(recipe: PackageRecipe, arch?: string, includeSubpkgs = false): string[][] {
    const targets = this.getRecipeDepTargets(recipe, arch, includeSubpkgs);
    return targets.map((clause) => Array.from(new Set(clause.map((t) => t.owner))));
  }

  getRecipeDepNames(recipe: PackageRecipe, arch?: string, includeSubpkgs = false): Set<string> {
    const clauses = this.getRecipeDepClauses(recipe, arch, includeSubpkgs);
    const canonical = new Set<string>();
    for (const clause of clauses) {
      for (const dep of clause) {
        canonical.add(dep);
      }
    }
    return canonical;
  }

  resolveBuildOrder(targetPackages?: string[], arch?: string): string[] {
    const allPkgs = Object.keys(this.recipes);
    const candidateSet = new Set(allPkgs);
    const completed = new Set<string>();
    const order: string[] = [];

    const pkgTargets = new Map<string, DependencyTarget[][]>();
    for (const p of allPkgs) {
      pkgTargets.set(p, this.getRecipeDepTargets(this.recipes[p], arch));
    }

    const isReady = (p: string): boolean => {
      const clauses = pkgTargets.get(p) || [];
      return clauses.every((clause) =>
        clause.some(
          (t) =>
            !candidateSet.has(t.owner) ||
            (completed.has(t.owner) && this.canOwnerSatisfyDep(t.owner, t.name, t.versionConstraint)),
        ),
      );
    };

    const remaining = new Set(allPkgs);
    while (remaining.size > 0) {
      const ready = Array.from(remaining).filter((p) => isReady(p));
      if (ready.length === 0) {
        const leftover = Array.from(remaining).sort();
        order.push(...leftover);
        break;
      }
      const depCounts = new Map<string, number>();
      for (const p of ready) {
        let count = 0;
        for (const other of remaining) {
          if ((pkgTargets.get(other) || []).some((clause) => clause.some((t) => t.owner === p))) {
            count++;
          }
        }
        depCounts.set(p, count);
      }
      ready.sort((a, b) => (depCounts.get(b) || 0) - (depCounts.get(a) || 0) || a.localeCompare(b));

      const nextNode = ready[0];
      order.push(nextNode);
      completed.add(nextNode);
      remaining.delete(nextNode);
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
    const queue = [pkgName];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const [p, recipe] of Object.entries(this.recipes)) {
        const deps = this.getRecipeDepNames(recipe, arch, true);
        if (deps.has(current) && !dependents.has(p)) {
          dependents.add(p);
          queue.push(p);
        }
      }
    }
    return dependents;
  }

  getLayers(targetPackages?: string[], arch?: string): string[][] {
    const pkgs = new Set(targetPackages ? targetPackages.filter((p) => this.recipes[p]) : Object.keys(this.recipes));
    const completed = new Set<string>();
    const remaining = new Set(pkgs);

    const pkgTargets = new Map<string, DependencyTarget[][]>();
    for (const p of pkgs) {
      pkgTargets.set(p, this.getRecipeDepTargets(this.recipes[p], arch));
    }

    const isReady = (p: string): boolean => {
      const clauses = pkgTargets.get(p) || [];
      return clauses.every((clause) =>
        clause.some(
          (t) =>
            !pkgs.has(t.owner) ||
            (completed.has(t.owner) && this.canOwnerSatisfyDep(t.owner, t.name, t.versionConstraint)),
        ),
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

    return layers;
  }
}
