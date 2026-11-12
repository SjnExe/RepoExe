import { expect, test } from "bun:test";
import { getExpectedAssetFilenames, identifyOutdatedAssets } from "../cli/prune.ts";
import { parseRecipe } from "../core/parser.ts";

test("getExpectedAssetFilenames returns native format filenames", () => {
  const recipe = parseRecipe("pkg/aisleriot");
  const expected = getExpectedAssetFilenames(recipe);

  expect(expected.has("aisleriot_3.22.35_arm64.deb")).toBeTrue();
  expect(expected.has("aisleriot-3.22.35-1-aarch64.pkg.tar.zst")).toBeTrue();
  expect(expected.has("aisleriot-3.22.35-r0.apk")).toBeTrue();
  expect(expected.has("metadata.json")).toBeTrue();
  // Ensure no pip wheels or npm tgz are generated
  expect(Array.from(expected).some((f) => f.endsWith(".whl"))).toBeFalse();
  expect(Array.from(expected).some((f) => f.endsWith(".tgz"))).toBeFalse();
});

test("identifyOutdatedAssets filters unknown assets", () => {
  const recipe = parseRecipe("pkg/aisleriot");
  const assets = [
    { name: "aisleriot_3.22.35_arm64.deb", id: 1 },
    { name: "aisleriot_3.20.0_arm64.deb", id: 2 },
  ];

  const outdated = identifyOutdatedAssets(assets, recipe, "aisleriot");
  expect(outdated.length).toBe(1);
  expect(outdated[0].id).toBe(2);
});
