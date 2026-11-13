import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseRecipe } from '../core/parser.ts';
import type { PackageRecipe } from '../core/types.ts';
import { parseDependencyList, extractAllPackageNames } from '../core/dependencies.ts';

export class DependencyGraph {
  packagesDir: string;
  recipes: Record<string, PackageRecipe> = {};

  constructor(packagesDir: string) {
    this.packagesDir = packagesDir;
    this.loadRecipes();
  }

  loadRecipes(): void {
    if (!existsSync(this.packagesDir)) return;
    const glob = new Bun.Glob('**/recipe.ts');
    for (const file of glob.scanSync({ cwd: this.packagesDir })) {
      const full = join(this.packagesDir, file);
      try {
        const r = parseRecipe(full);
        this.recipes[r.name] = r;
      } catch {}
    }
  }

  getRecipeDepNames(recipe: PackageRecipe): Set<string> {
    const raw = [...(recipe.deps || []), ...(recipe.build_deps || [])];
    const clauses = parseDependencyList(raw);
    return extractAllPackageNames(clauses);
  }

  resolveBuildOrder(targetPackages?: string[]): string[] {
    const graph: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};

    const allPkgs = Object.keys(this.recipes);
    for (const p of allPkgs) {
      graph[p] = [];
      inDegree[p] = 0;
    }

    for (const [pkgName, recipe] of Object.entries(this.recipes)) {
      const deps = this.getRecipeDepNames(recipe);
      for (const dep of deps) {
        if (this.recipes[dep]) {
          graph[dep].push(pkgName);
          inDegree[pkgName] = (inDegree[pkgName] || 0) + 1;
        }
      }
    }

    const queue: string[] = allPkgs.filter((p) => inDegree[p] === 0);
    const order: string[] = [];

    while (queue.length > 0) {
      const node = queue.shift()!;
      order.push(node);
      for (const neighbor of graph[node] || []) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          queue.push(neighbor);
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

  getDependents(pkgName: string): Set<string> {
    const dependents = new Set<string>();
    const queue = [pkgName];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const [p, recipe] of Object.entries(this.recipes)) {
        const deps = this.getRecipeDepNames(recipe);
        if (deps.has(current) && !dependents.has(p)) {
          dependents.add(p);
          queue.push(p);
        }
      }
    }
    return dependents;
  }

  getLayers(targetPackages?: string[]): string[][] {
    const pkgs = new Set(targetPackages ? targetPackages.filter((p) => this.recipes[p]) : Object.keys(this.recipes));

    const subGraph: Record<string, Set<string>> = {};
    const inDegree: Record<string, number> = {};

    for (const p of pkgs) {
      subGraph[p] = new Set();
      inDegree[p] = 0;
    }

    for (const p of pkgs) {
      const recipe = this.recipes[p];
      const deps = this.getRecipeDepNames(recipe);
      for (const dep of deps) {
        if (pkgs.has(dep)) {
          subGraph[dep].add(p);
          inDegree[p] = (inDegree[p] || 0) + 1;
        }
      }
    }

    const layers: string[][] = [];
    let currentLayer = Array.from(pkgs).filter((p) => inDegree[p] === 0);

    while (currentLayer.length > 0) {
      layers.push([...currentLayer].sort());
      const nextLayer: string[] = [];
      for (const node of currentLayer) {
        for (const neighbor of subGraph[node]) {
          inDegree[neighbor]--;
          if (inDegree[neighbor] === 0) {
            nextLayer.push(neighbor);
          }
        }
      }
      currentLayer = nextLayer;
    }

    return layers;
  }
}
