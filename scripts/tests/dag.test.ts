import { expect, test } from "bun:test";
import { DependencyGraph } from "../utils/dag.ts";

test("DependencyGraph loads recipes and resolves layers", () => {
  const dag = new DependencyGraph("pkg");
  expect(dag.recipes["aisleriot"]).toBeDefined();
  expect(dag.recipes["repoexe"]).toBeDefined();

  const layers = dag.getLayers();
  expect(layers.length).toBeGreaterThan(0);
  const flattened = layers.flat();
  expect(flattened).toContain("aisleriot");
  expect(flattened).toContain("repoexe");
});
