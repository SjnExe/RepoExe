import { expect, test } from "bun:test";
import { parseRecipe, computeStateHash } from "../core/parser.ts";

test("parseRecipe parses aisleriot correctly", () => {
  const recipe = parseRecipe("pkg/aisleriot");
  expect(recipe.name).toBe("aisleriot");
  expect(recipe.version).toBe("3.22.35");
  expect(recipe.arch).toBe("aarch64");
  expect(recipe.formats).toEqual(["apt", "pacman", "apk"]);
  expect(recipe.build_deps).toContain("gtk3");
  expect(recipe.state_hash).toBeDefined();
  expect(recipe.state_hash.length).toBe(16);
});

test("parseRecipe parses repoexe correctly", () => {
  const recipe = parseRecipe("pkg/repoexe");
  expect(recipe.name).toBe("repoexe");
  expect(recipe.version).toBe("2.0.0");
  expect(recipe.arch).toBe("all");
  expect(recipe.state_hash).toBeDefined();
});

test("computeStateHash produces deterministic output", () => {
  const r1 = parseRecipe("pkg/repoexe");
  const r2 = parseRecipe("pkg/repoexe");
  expect(r1.state_hash).toBe(r2.state_hash);
});
