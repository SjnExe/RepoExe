import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { parseRecipe } from "../core/parser.ts";
import type { PackageRecipe } from "../core/types.ts";

export class DependencyGraph {
  packagesDir: string;
  recipes: Record<string, PackageRecipe> = {};

  constructor(packagesDir: string) {
    this.packagesDir = packagesDir;
    this.loadRecipes();
  }

  loadRecipes(): void {
    if (!existsSync(this.packagesDir)) return;
    const entries = readdirSync(this.packagesDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const recipeFile = join(this.packagesDir, entry.name, "pkg.yml");
        if (existsSync(recipeFile)) {
          try {
            const r = parseRecipe(recipeFile);
            this.recipes[r.name] = r;
          } catch {}
        }
      }
    }
  }

  resolveBuildOrder(): string[] {
    const graph: Record<string, string[]> = {};
    const inDegree: Record<string, number> = {};

    for (const p of Object.keys(this.recipes)) {
      graph[p] = [];
      inDegree[p] = 0;
    }

    for (const [pkgName, recipe] of Object.entries(this.recipes)) {
      const deps = new Set([...recipe.deps, ...recipe.build_deps]);
      for (const dep of deps) {
        if (this.recipes[dep]) {
          graph[dep].push(pkgName);
          inDegree[pkgName] = (inDegree[pkgName] || 0) + 1;
        }
      }
    }

    const queue: string[] = Object.keys(this.recipes).filter((p) => inDegree[p] === 0);
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

    if (order.length !== Object.keys(this.recipes).length) {
      return Object.keys(this.recipes);
    }
    return order;
  }

  getLayers(targetPackages?: string[]): string[][] {
    const pkgs = new Set(
      targetPackages ? targetPackages.filter((p) => this.recipes[p]) : Object.keys(this.recipes)
    );

    const subGraph: Record<string, Set<string>> = {};
    const inDegree: Record<string, number> = {};

    for (const p of pkgs) {
      subGraph[p] = new Set();
      inDegree[p] = 0;
    }

    for (const p of pkgs) {
      const recipe = this.recipes[p];
      const deps = new Set([...recipe.deps, ...recipe.build_deps]);
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
