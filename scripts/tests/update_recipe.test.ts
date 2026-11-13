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
    expect(compareSemver('1.0.0-preview-2', '1.0.0-preview-1')).toBeGreaterThan(0);
    expect(compareSemver('1.0.0-rc.2', '1.0.0-rc.10')).toBeLessThan(0);
  });

  it('computes major.minor correctly', () => {
    expect(getMajorMinor('3.22.35')).toBe('3.22');
    expect(getMajorMinor('1.0')).toBe('1.0');
    expect(getMajorMinor('single')).toBeNull();
  });

  it('updates recipe content for latest channel with single or double quotes', () => {
    const original = `
import { defineRecipe } from "@core/types.ts";

export default defineRecipe({
  name: "foo",
  version: '1.0.0',
  revision: 2,
  description: "test",
});
`;
    const updated = updateRecipeContent(original, 'latest', '1.1.0');
    expect(updated).toContain("version: '1.1.0'");
    expect(updated).toContain('revision: 0');
    expect(updated).not.toContain("version: '1.0.0'");
  });

  it('updates recipe content for specific channel and preserves top-level revision', () => {
    const original = `
import { defineRecipe } from "@core/types.ts";

export default defineRecipe({
  name: "foo",
  version: "2.0.0",
  revision: 5,
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
    // Top-level revision should remain 5
    expect(updated).toMatch(/version:\s*"2\.0\.0",\s*revision:\s*5/);
    // Channel revision should be reset to 0
    expect(updated).toMatch(/"1\.x":\s*\{[\s\S]*version:\s*"1\.0\.1",\s*revision:\s*0/);
  });

  it('updates top-level version and revision independently when channels is between them', () => {
    const original = `
export default defineRecipe({
  revision: 3,
  channels: {
    "1.x": { version: "1.0.0" }
  },
  version: "2.0.0",
});
`;
    const updated = updateRecipeContent(original, 'latest', '2.1.0');
    expect(updated).toMatch(/version:\s*"2\.1\.0"/);
    expect(updated).toMatch(/revision:\s*0/);
    expect(updated).toContain('"1.x": { version: "1.0.0" }');
  });

  it('updates channel with nested objects preceding version', () => {
    const original = `
export default defineRecipe({
  version: "2.0.0",
  channels: {
    "1.x": {
      phases: {
        configure: "echo hi",
      },
      version: "1.0.0",
      revision: 4,
    },
  },
});
`;
    const updated = updateRecipeContent(original, '1.x', '1.0.1');
    expect(updated).toContain('version: "2.0.0"');
    expect(updated).toContain('configure: "echo hi"');
    expect(updated).toMatch(/version:\s*"1\.0\.1"/);
    expect(updated).toMatch(/revision:\s*0/);
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
    const updated = updateRecipeContent(original, 'latest', '1.0.1');
    expect(updated).toContain('version: "tool"');
    expect(updated).toContain('version: "1.0.1"');
    expect(updated).toContain('revision: 0');
  });

  it('ignores braces inside strings, comments, and template literals during channel matching', (): void => {
    const original = `
export default defineRecipe({
  version: "2.0.0",
  channels: {
    "1.x": {
      // comment with } and {
      /* block comment with } */
      phases: {
        configure: "echo } and {",
        build: \`echo \${"nested" + "}"} }\`,
      },
      vars: {
        version: "inner",
      },
      version: "1.0.0",
      revision: 4,
    },
  },
});
`;
    const updated = updateRecipeContent(original, '1.x', '1.0.1');
    expect(updated).toContain('version: "2.0.0"');
    expect(updated).toContain('version: "inner"');
    expect(updated).toContain('version: "1.0.1"');
    expect(updated).toContain('revision: 0');
  });

  it('recognizes quoted property keys and updates only the value', (): void => {
    const original = `
export default defineRecipe({
  "name": "foo",
  "version": "1.0.0",
  "revision": 3,
});
`;
    const updated = updateRecipeContent(original, 'latest', '1.1.0');
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
    const updated = updateRecipeContent(original, 'latest', '1.1.0');
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
    const updated = updateRecipeContent(original, 'latest', '1.2.0');
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
    const updated = updateRecipeContent(original, 'latest', '1.2.0');
    expect(updated).toContain('version: "0.0.1"');
    expect(updated).toContain('revision: 1');
    expect(updated).toContain('version: "1.2.0"');
    expect(updated).toContain('revision: 0');
  });

  it('restricts channel search to exported recipe channels property when earlier objects have matching keys', (): void => {
    const original = `
const earlierConfig = {
  "1.x": {
    version: "0.1.0",
    revision: 1,
  },
};

export default defineRecipe({
  version: "2.0.0",
  revision: 1,
  channels: {
    "1.x": {
      version: "1.0.0",
      revision: 4,
    },
  },
});
`;
    const updated = updateRecipeContent(original, '1.x', '1.0.1');
    expect(updated).toContain('version: "0.1.0"');
    expect(updated).toContain('version: "1.0.1"');
    expect(updated).toMatch(/channels:\s*\{[\s\S]*"1\.x":\s*\{[\s\S]*version:\s*"1\.0\.1",\s*revision:\s*0/);
  });

  it('locates channels and channel entries when separated by whitespace and comments', (): void => {
    const original = `
export default defineRecipe({
  version: "2.0.0",
  revision: /* initial */ 1,
  channels /* release channels */ : /* tracks */ {
    // legacy track
    "1.x" /* semver */ : // start of 1.x object
    {
      version: /* release track ver */ "1.0.0",
      revision: // revision count
        3,
    },
  },
});
`;
    const updated = updateRecipeContent(original, '1.x', '1.0.1');
    expect(updated).toContain('version: "2.0.0"');
    expect(updated).toContain('revision: /* initial */ 1');
    expect(updated).toContain('version: /* release track ver */ "1.0.1"');
    expect(updated).toContain('revision: // revision count\n        0');
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
    const updated = updateRecipeContent(original, 'latest', '1.1.0');
    expect(updated).toContain("version /* ver */ : /* current */ '1.1.0'");
    expect(updated).toContain('revision // rev\n    : /* count */ 0');
  });

  it('throws when target version cannot be found or unchanged', (): void => {
    const original = `export default defineRecipe({ name: "foo" });`;
    expect(() => updateRecipeContent(original, 'latest', '1.0.0')).toThrow();
  });
});
