import { describe, expect, it } from 'bun:test';
import { getMajorMinor, updateRecipeContent } from '../cli/update_recipe.ts';
import { compareSemver, extractSemver } from '../cli/upstream_check.ts';

describe('upstream_check and update_recipe', () => {
  it('extracts semver correctly', () => {
    expect(extractSemver('v3.22.35')).toBe('3.22.35');
    expect(extractSemver('3.9.90')).toBe('3.9.90');
    expect(extractSemver('release-1.2.3-rc1')).toBe('1.2.3-rc1');
    expect(extractSemver('invalid')).toBeNull();
  });

  it('compares semver numerically rather than alphabetically', () => {
    expect(compareSemver('3.22.35', '3.9.90')).toBeGreaterThan(0);
    expect(compareSemver('3.9.90', '3.22.35')).toBeLessThan(0);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
    expect(compareSemver('2.0.0', '1.99.99')).toBeGreaterThan(0);
    expect(compareSemver('1.0.1', '1.0.0')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0', '1.0.0-rc1')).toBeGreaterThan(0);
  });

  it('computes major.minor correctly', () => {
    expect(getMajorMinor('3.22.35')).toBe('3.22');
    expect(getMajorMinor('1.0')).toBe('1.0');
    expect(getMajorMinor('single')).toBeNull();
  });

  it('updates recipe content for latest channel', () => {
    const original = `
import { defineRecipe } from "@core/types.ts";

export default defineRecipe({
  name: "foo",
  version: "1.0.0",
  revision: 2,
  description: "test",
});
`;
    const updated = updateRecipeContent(original, 'latest', '1.1.0');
    expect(updated).toContain('version: "1.1.0"');
    expect(updated).toContain('revision: 0');
    expect(updated).not.toContain('version: "1.0.0"');
  });

  it('updates recipe content for specific channel', () => {
    const original = `
import { defineRecipe } from "@core/types.ts";

export default defineRecipe({
  name: "foo",
  version: "2.0.0",
  revision: 0,
  channels: {
    "1.x": {
      version: "1.0.0",
      revision: 3,
    },
  },
});
`;
    const updated = updateRecipeContent(original, '1.x', '1.0.1');
    expect(updated).toContain('version: "2.0.0"');
    expect(updated).toContain('version: "1.0.1"');
    expect(updated).toContain('revision: 0');
  });
});
