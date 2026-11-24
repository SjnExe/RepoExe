import { REPOEXE_VERSION } from '../../pkg/repoexe/recipe.ts';
import { normalizeArch } from '../core/dependencies.ts';

export { REPOEXE_VERSION };
export const PREFIX = process.env.PREFIX || '/data/data/com.termux/files/usr';
export const HOME = process.env.HOME || '/data/data/com.termux/files/home';

export function getBuildArch(): string {
  const raw = process.env.BUILD_ARCH || process.arch || 'x86_64';
  return normalizeArch(raw);
}
