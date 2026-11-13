import { describe, expect, it } from 'bun:test';
import { fetchAndPrepareSource } from '../cli/build.ts';

describe('build CLI helpers', () => {
  it('returns pDir if recipe has no source', () => {
    const recipe = { name: 'no-source', version: '1.0.0' };
    const workDir = fetchAndPrepareSource(recipe, 'pkg/no-source', '/tmp/dest');
    expect(workDir).toBe('pkg/no-source');
  });
});
