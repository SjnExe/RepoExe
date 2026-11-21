import { normalizeRecipe } from '../core/parser.ts';
import type { PackageRecipe, RecipeDefinition } from '../core/types.ts';

export function createRecipe(overrides: Partial<RecipeDefinition> = {}): PackageRecipe {
  return normalizeRecipe({
    name: 'testpkg',
    version: '1.0.0',
    description: 'Test package description',
    license: 'MIT',
    homepage: 'https://example.com',
    ...overrides,
  });
}
