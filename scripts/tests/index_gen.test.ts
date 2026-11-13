import { expect, test } from "bun:test";
import { getExactPackageArtifacts } from "../cli/index_gen.ts";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("getExactPackageArtifacts prevents prefix collision", (): void => {
  const testDir = join(tmpdir(), `repoexe-test-artifacts-${Date.now()}`);
  mkdirSync(testDir, { recursive: true });

  writeFileSync(join(testDir, "foo_1.0.0_arm64.deb"), "");
  writeFileSync(join(testDir, "foo-1.0.0-1-aarch64.pkg.tar.zst"), "");
  writeFileSync(join(testDir, "foo-1.0.0-r0.apk"), "");

  // Sibling packages with matching prefix
  writeFileSync(join(testDir, "foo-tools_1.0.0_arm64.deb"), "");
  writeFileSync(join(testDir, "foo-tools-1.0.0-1-aarch64.pkg.tar.zst"), "");
  writeFileSync(join(testDir, "foo-tools-1.0.0-r0.apk"), "");
  writeFileSync(join(testDir, "foo-extra-2.0.0-r1.apk"), "");

  const fooMatches = getExactPackageArtifacts(testDir, "foo");
  expect(fooMatches.length).toBe(3);
  expect(fooMatches.some((f) => f.includes("foo-tools"))).toBeFalse();
  expect(fooMatches.some((f) => f.includes("foo-extra"))).toBeFalse();

  const fooToolsMatches = getExactPackageArtifacts(testDir, "foo-tools");
  expect(fooToolsMatches.length).toBe(3);
  expect(fooToolsMatches.every((f) => f.includes("foo-tools"))).toBeTrue();

  rmSync(testDir, { recursive: true, force: true });
});
