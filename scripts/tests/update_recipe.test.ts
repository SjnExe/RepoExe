import { describe, expect, it } from 'bun:test';

import { bumpRecipeRevisionContent, getMajorMinor, updateRecipeContent } from '../cli/update_recipe.ts';
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
    expect(compareSemver('1.0.0-preview-2', '1.0.0-preview-1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
  });

  it('computes major.minor correctly', () => {
    expect(getMajorMinor('3.22.35')).toBe('3.22');
    expect(getMajorMinor('1.0')).toBe('1.0');
    expect(getMajorMinor('single')).toBeNull();
  });

  it('updates recipe content with 2-argument signature', () => {
    const original = `
import { defineRecipe } from "@core/types.ts";

export default defineRecipe({
  name: "foo",
  version: '1.0.0',
  revision: 2,
  description: "test",
});
`;
    const updated = updateRecipeContent(original, '1.1.0');
    expect(updated).toContain("version: '1.1.0'");
    expect(updated).toContain('revision: 0');
    expect(updated).not.toContain("version: '1.0.0'");
  });

  it('ignores nested vars.version and correctly updates top-level direct version', (): void => {
    const original = `
export default defineRecipe({
  name: "foo",
  vars: {
    version: "tool",
  },
  version: "1.0.0",
  revision: 3,
});
`;
    const updated = updateRecipeContent(original, '1.0.1');
    expect(updated).toContain('version: "tool"');
    expect(updated).toContain('version: "1.0.1"');
    expect(updated).toContain('revision: 0');
  });

  it('preserves nested phases and updates top-level version', (): void => {
    const original = `
export default defineRecipe({
  name: "foo",
  phases: {
    configure: "echo hi",
  },
  version: "1.0.0",
  revision: 4,
});
`;
    const updated = updateRecipeContent(original, '1.0.1');
    expect(updated).toContain('configure: "echo hi"');
    expect(updated).toMatch(/version:\s*"1\.0\.1"/);
    expect(updated).toMatch(/revision:\s*0/);
  });

  it('recognizes quoted property keys and updates only the value', (): void => {
    const original = `
export default defineRecipe({
  "name": "foo",
  "version": "1.0.0",
  "revision": 3,
});
`;
    const updated = updateRecipeContent(original, '1.1.0');
    expect(updated).toContain('"version": "1.1.0"');
    expect(updated).toContain('"revision": 0');
  });

  it('does not match version identifier in ternary expression operand', (): void => {
    const original = `
const version = "stable";
export default defineRecipe({
  version: "1.0.0",
  revision: 3,
  description: true ? version : "fallback",
});
`;
    const updated = updateRecipeContent(original, '1.1.0');
    expect(updated).toContain('version: "1.1.0"');
    expect(updated).toContain('description: true ? version : "fallback"');
    expect(updated).toContain('revision: 0');
  });

  it('excludes commented defineRecipe when locating root object', (): void => {
    const original = `
// defineRecipe({ version: "0.0.0", revision: 1 });
/* defineRecipe({ version: "0.0.1" }); */
export default defineRecipe({
  version: "1.0.0",
  revision: 2,
});
`;
    const updated = updateRecipeContent(original, '1.2.0');
    expect(updated).toContain('// defineRecipe({ version: "0.0.0", revision: 1 });');
    expect(updated).toContain('/* defineRecipe({ version: "0.0.1" }); */');
    expect(updated).toContain('version: "1.2.0"');
    expect(updated).toContain('revision: 0');
  });

  it('updates exported recipe when preceded by helper defineRecipe objects', (): void => {
    const original = `
const helper = defineRecipe({
  version: "0.0.1",
  revision: 1,
});

export default defineRecipe({
  version: "1.0.0",
  revision: 3,
});
`;
    const updated = updateRecipeContent(original, '1.2.0');
    expect(updated).toContain('version: "0.0.1"');
    expect(updated).toContain('revision: 1');
    expect(updated).toContain('version: "1.2.0"');
    expect(updated).toContain('revision: 0');
  });

  it('updates top-level version and revision when comments appear around colon and values', (): void => {
    const original = `
export default defineRecipe({
  name: "foo",
  /* metadata comment */
  version /* ver */ : /* current */ '1.0.0',
  revision // rev
    : /* count */ 5,
});
`;
    const updated = updateRecipeContent(original, '1.1.0');
    expect(updated).toContain("version /* ver */ : /* current */ '1.1.0'");
    expect(updated).toContain('revision // rev\n    : /* count */ 0');
  });

  it('throws when target version cannot be found or unchanged', (): void => {
    const original = `export default defineRecipe({ name: "foo" });`;
    expect(() => updateRecipeContent(original, '1.0.0')).toThrow();
  });

  it('increments existing revision without altering version', (): void => {
    const original = `
export default defineRecipe({
  name: 'aisleriot',
  version: '3.22.35',
  revision: 2,
});
`;
    const res = bumpRecipeRevisionContent(original);
    expect(res.oldRevision).toBe(2);
    expect(res.newRevision).toBe(3);
    expect(res.updated).toContain("version: '3.22.35'");
    expect(res.updated).toContain('revision: 3,');
  });

  it('inserts revision: 1 after version when revision is omitted', (): void => {
    const original = `
export default defineRecipe({
  name: 'foo',
  version: '1.2.3',
});
`;
    const res = bumpRecipeRevisionContent(original);
    expect(res.oldRevision).toBe(0);
    expect(res.newRevision).toBe(1);
    expect(res.updated).toContain("version: '1.2.3',\n  revision: 1,");
  });
});
