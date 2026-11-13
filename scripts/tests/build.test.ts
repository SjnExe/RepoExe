import { describe, expect, it } from 'bun:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fetchAndPrepareSource } from '../cli/build.ts';

describe('build CLI helpers', () => {
  it('returns pDir if recipe has no source', () => {
    const recipe = { name: 'no-source', version: '1.0.0' };
    const dest = join(process.env.TMPDIR || tmpdir(), 'dest');
    const workDir = fetchAndPrepareSource(recipe, 'pkg/no-source', dest);
    expect(workDir).toBe('pkg/no-source');
  });
});
