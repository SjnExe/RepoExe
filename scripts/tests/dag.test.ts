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

test("DependencyGraph resolveBuildOrder sorts targets", () => {
  const dag = new DependencyGraph("pkg");
  const order = dag.resolveBuildOrder(["repoexe", "aisleriot"]);
  expect(order).toBeArray();
  expect(order).toContain("repoexe");
  expect(order).toContain("aisleriot");
});

test("DependencyGraph getDependents returns dependent packages", () => {
  const dag = new DependencyGraph("pkg");
  // synthetic test recipe graph
  dag.recipes["libtest"] = {
    name: "libtest",
    version: "1.0",
    revision: 0,
    epoch: 0,
    arch: "aarch64",
    deps: [],
    build_deps: [],
    recommends: [],
    suggests: [],
    conflicts: [],
    provides: [],
    replaces: [],
    formats: ["apt"],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 12 },
    active_channel: "latest",
  };
  dag.recipes["apptest"] = {
    name: "apptest",
    version: "1.0",
    revision: 0,
    epoch: 0,
    arch: "aarch64",
    deps: ["libtest"],
    build_deps: [],
    recommends: [],
    suggests: [],
    conflicts: [],
    provides: [],
    replaces: [],
    formats: ["apt"],
    phases: {},
    env: {},
    resources: { zram: 0, swap: 0, free_space: false, tmpfs: 12 },
    active_channel: "latest",
  };

  const dependents = dag.getDependents("libtest");
  expect(dependents.has("apptest")).toBeTrue();

  const order = dag.resolveBuildOrder(["apptest", "libtest"]);
  expect(order.indexOf("libtest")).toBeLessThan(order.indexOf("apptest"));
});
