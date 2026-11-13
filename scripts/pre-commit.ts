import { runPreCommitHook } from './hooks/pre-commit.ts';

export { ensurePrefixPath, runPreCommitHook, type PreCommitOptions } from './hooks/pre-commit.ts';

if (import.meta.main) {
  const args = process.argv.slice(2);
  const success = await runPreCommitHook({
    skipFormat: args.includes('--skip-format'),
    skipHealthCheck: args.includes('--skip-check'),
    skipTests: args.includes('--skip-tests'),
    skipActionlint: args.includes('--skip-actionlint'),
  });
  if (!success) {
    process.exit(1);
  }
}
