import { expect, test } from "bun:test";
import { generateControlFile, formatDebianVersion } from "../builders/debian.ts";
import { parseRecipe } from "../core/parser.ts";

test("generateControlFile formats valid Debian control file", () => {
  const recipe = parseRecipe("pkg/aisleriot");
  const control = generateControlFile(recipe, 1024);

  expect(control).toContain("Package: aisleriot");
  expect(control).toContain("Version: 3.22.35");
  expect(control).toContain("Architecture: aarch64");
  expect(control).toContain("Maintainer: SjnExe");
  expect(control).toContain("Installed-Size: 1024");
  expect(control).toContain("Depends: gtk3, guile, librsvg, libcanberra, libxml2");
});

test("formatDebianVersion handles epoch and revision", () => {
  const recipe = parseRecipe("pkg/repoexe");
  expect(formatDebianVersion(recipe)).toBe("2.0.0");

  recipe.revision = 1;
  expect(formatDebianVersion(recipe)).toBe("2.0.0-1");

  recipe.epoch = 2;
  expect(formatDebianVersion(recipe)).toBe("2:2.0.0-1");
});
