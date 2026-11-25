import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { postinstallTask, resolveGitDir } from '../hooks/postinstall.ts';
import {
  getRunnerDefaultShell,
  getStagedWorkflowsSnapshot,
  insertSetupAfterLeadingComments,
  isStepWindowsOnlyCondition,
  maskGitHubExpressions,
  resolveActionlintBinary,
  runPreCommitHook,
  shellHasErrexit,
  validateWorkflowScripts,
} from '../hooks/pre-commit.ts';

const tmpBase = process.env.TMPDIR || tmpdir();
const testDir = join(tmpBase, 'repoexe-hook-test-' + Date.now());

describe('pre-commit and postinstall hooks', () => {
  beforeAll(() => {
    mkdirSync(join(testDir, '.git', 'hooks'), { recursive: true });
    // Write fake HEAD
    Bun.write(join(testDir, '.git', 'HEAD'), 'ref: refs/heads/main\n');
  });

  afterAll(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('resolves normal .git directory', async (): Promise<void> => {
    const gitDir = await resolveGitDir(join(testDir, '.git'));
    expect(gitDir).toBe(join(testDir, '.git'));
  });

  it('resolves gitdir pointers in worktree or submodules', async (): Promise<void> => {
    const worktreeDir = join(testDir, 'worktree');
    mkdirSync(worktreeDir, { recursive: true });
    await Bun.write(join(worktreeDir, '.git'), `gitdir: ../.git\n`);

    const gitDir = await resolveGitDir(join(worktreeDir, '.git'));
    expect(gitDir).toBe(join(testDir, '.git'));
  });

  it('installs pre-commit hook in git repository via postinstallTask', async (): Promise<void> => {
    const installed = await postinstallTask(join(testDir, '.git'));
    expect(installed).toBe(true);

    const hookFile = Bun.file(join(testDir, '.git', 'hooks', 'pre-commit'));
    expect(await hookFile.exists()).toBe(true);
    const content = await hookFile.text();
    expect(content).toContain('bun scripts/hooks/pre-commit.ts');
  });

  it('skips hook binding when not in a git repo', async (): Promise<void> => {
    const nonGitDir = join(testDir, 'nongit');
    mkdirSync(nonGitDir, { recursive: true });
    const installed = await postinstallTask(join(nonGitDir, '.git'));
    expect(installed).toBe(false);
  });

  it('runs runPreCommitHook successfully with options', async (): Promise<void> => {
    const success = await runPreCommitHook({
      stagedFiles: [],
      skipFormat: true,
      skipHealthCheck: false,
      skipTests: true, // Avoid recursive test spawning inside test runner
      skipActionlint: true,
      quiet: true,
    });
    expect(success).toBe(true);
  }, 15000);

  it('correctly masks GitHub Actions expressions with nested quotes', (): void => {
    expect(maskGitHubExpressions("echo ${{ '}}' }}")).toBe('echo __GH_EXPR_0__');
    expect(maskGitHubExpressions("echo ${{ 'it''s ok }}' }}")).toBe('echo __GH_EXPR_0__');
    expect(maskGitHubExpressions('val=${{ github.event.issue.number }}')).toBe('val=__GH_EXPR_0__');
    expect(maskGitHubExpressions('echo ${{ foo }} ${{ bar }} ${{ foo }}')).toBe(
      'echo __GH_EXPR_0__ __GH_EXPR_1__ __GH_EXPR_0__',
    );
    expect(maskGitHubExpressions('exit ${{ 0 }}')).toBe('exit 0');
    expect(maskGitHubExpressions('exit ${{ inputs.exit_code }}')).toBe('exit 0');
    expect(maskGitHubExpressions('exit \\\n ${{ inputs.code }}')).toBe('exit \\\n 0');
    expect(maskGitHubExpressions('return \\\r\n ${{ inputs.code }}')).toBe('return \\\r\n 0');
    expect(maskGitHubExpressions('code=${{ 42 }}')).toBe('code=42');
    expect(maskGitHubExpressions("cat <<${{ 'END:DATA' }}\nhello\nEND:DATA")).toBe(
      'cat <<END:DATA\nhello\nEND:DATA',
    );
  });

  it('correctly detects runner default shell from matrix combinations', (): void => {
    expect(
      getRunnerDefaultShell(
        '${{ matrix.os }}',
        { matrix: { os: ['ubuntu-latest'], mode: ['debug', 'release'] } },
        undefined,
      ),
    ).toBe('bash');
    expect(
      getRunnerDefaultShell(
        '${{ matrix.os }}',
        { matrix: { os: ['windows-latest'], include: [{ OS: 'ubuntu-latest' }] } },
        undefined,
      ),
    ).toBe('bash');
    expect(
      getRunnerDefaultShell(
        '${{ matrix.os }}',
        { matrix: { os: ['windows-latest'], include: [{ OS: 'windows-2022' }] } },
        undefined,
      ),
    ).toBe('pwsh');
    expect(
      getRunnerDefaultShell(
        '${{ matrix.os }}',
        { matrix: { os: ['ubuntu-latest', 'windows-latest'] } },
        undefined,
      ),
    ).toBe('bash');
    expect(
      getRunnerDefaultShell('${{ matrix.os }}', { matrix: { os: ['windows-latest'] } }, undefined),
    ).toBe('pwsh');
    expect(
      getRunnerDefaultShell(
        '${{ matrix.runner }}',
        { matrix: { include: [{ runner: 'ubuntu-latest', mode: 'debug' }] } },
        undefined,
      ),
    ).toBe('bash');
    expect(
      getRunnerDefaultShell(
        '${{ matrix.runner }}',
        {
          matrix: {
            mode: ['debug', 'release'],
            include: [{ runner: 'ubuntu-latest' }, { runner: 'windows-latest' }],
          },
        },
        undefined,
      ),
    ).toBe('pwsh');
  });

  it('accepts workflow scripts with expression placeholders that would trigger SC2157', async (): Promise<void> => {
    if (Bun.which('shellcheck') === null) {
      return;
    }
    const wfDir = join(testDir, 'wf-sc2157');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'sc2157.yml'),
      `name: Test SC2157
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: |
          if [ -z "\${{ env.OPTIONAL }}" ]; then echo empty; fi
`,
    );
    const result = await validateWorkflowScripts(wfDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('skips validation for Windows runners defaulting to PowerShell and verifies dispatch via recording checker', async (): Promise<void> => {
    if (!Bun.YAML?.parse) {
      return;
    }
    const wfDir = join(testDir, 'wf-windows');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'windows.yml'),
      `name: Windows Job
jobs:
  build:
    runs-on: windows-latest
    steps:
      - run: if ($true) { Write-Host "Hello from Windows PowerShell" }
  linux-control:
    runs-on: ubuntu-latest
    steps:
      - run: echo "Hello from Linux Bash"
`,
    );
    const recorded: Array<{ script: string; dialect: string }> = [];
    const recordingChecker = async (
      script: string,
      dialect: 'sh' | 'bash',
    ): Promise<{ ok: boolean }> => {
      recorded.push({ script, dialect });
      return { ok: true };
    };

    const result = await validateWorkflowScripts(wfDir, recordingChecker);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
    expect(recorded).toHaveLength(1);
    expect(recorded[0].script).toContain('Hello from Linux Bash');
    expect(recorded[0].dialect).toBe('bash');
  });

  it('validates container jobs using POSIX sh dialect', async (): Promise<void> => {
    if (Bun.which('shellcheck') === null) {
      return;
    }
    const validDir = join(testDir, 'wf-container-valid');
    mkdirSync(validDir, { recursive: true });
    // Valid POSIX sh script should pass
    await Bun.write(
      join(validDir, 'container-valid.yml'),
      `name: Container Valid
jobs:
  test:
    runs-on: ubuntu-latest
    container: alpine:latest
    steps:
      - run: test 1 -eq 1 && echo "OK"
`,
    );
    const validResult = await validateWorkflowScripts(validDir);
    expect(validResult.ok).toBe(true);

    const invalidDir = join(testDir, 'wf-container-invalid');
    mkdirSync(invalidDir, { recursive: true });
    // Bashism ([[ ... ]]) in container job should be flagged under sh dialect
    await Bun.write(
      join(invalidDir, 'container-invalid.yml'),
      `name: Container Invalid
jobs:
  test:
    runs-on: ubuntu-latest
    container:
      image: alpine:latest
    steps:
      - run: if [[ 1 == 1 ]]; then echo "Bashism"; fi
`,
    );
    const invalidResult = await validateWorkflowScripts(invalidDir);
    expect(invalidResult.ok).toBe(false);
    expect(
      invalidResult.errors.some(
        (err: string): boolean => err.includes('SC3010') || err.includes('POSIX sh'),
      ),
    ).toBe(true);
  });

  it('validates default Linux shell script with cd src followed by echo ready without SC2164', async (): Promise<void> => {
    if (Bun.which('shellcheck') === null) {
      return;
    }
    const wfDir = join(testDir, 'wf-default-shell-cd');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'cd-test.yml'),
      `name: Default Shell CD
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: |
          cd src
          echo ready
`,
    );
    const result = await validateWorkflowScripts(wfDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('verifies shell startup option injection and errexit detection', (): void => {
    expect(shellHasErrexit('bash -e {0}')).toBe(true);
    expect(shellHasErrexit('bash {0}')).toBe(false);
    expect(shellHasErrexit('sh -o errexit {0}')).toBe(true);
    const withSetup = insertSetupAfterLeadingComments('cd src\necho ok', 'set -eo pipefail\n');
    expect(withSetup).toBe('set -eo pipefail\ncd src\necho ok');
  });

  it('accepts expression-substituted case statements without SC2194 warning', async (): Promise<void> => {
    if (Bun.which('shellcheck') === null) {
      return;
    }
    const wfDir = join(testDir, 'wf-case-expr');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'case-test.yml'),
      `name: Case Expression
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - run: |
          case "\${{ matrix.os }}" in
            ubuntu*) echo "linux" ;;
            *) echo "other" ;;
          esac
`,
    );
    const result = await validateWorkflowScripts(wfDir);
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('validates actionlint with local composite action metadata rejecting misspelled zarm and accepting zram through runPreCommitHook', async (): Promise<void> => {
    const actionlint = resolveActionlintBinary();
    if (!actionlint) {
      return;
    }
    const tmpRoot = join(tmpBase, 'repoexe-actionlint-test-' + Date.now());
    const origCwd = process.cwd();
    const gitEnvKeys = [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_COMMON_DIR',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_PARAMETERS',
      'GIT_CONFIG',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_SYSTEM',
      ...Object.keys(process.env).filter((k) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)),
    ];
    const savedGitEnv: Record<string, string | undefined> = {};
    const cleanGitEnv = { ...process.env };
    for (const key of gitEnvKeys) {
      savedGitEnv[key] = process.env[key];
      delete cleanGitEnv[key];
    }

    try {
      mkdirSync(join(tmpRoot, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(tmpRoot, '.github', 'actions', 'setup-memory'), { recursive: true });
      const initRes = Bun.spawnSync(['git', 'init'], { cwd: tmpRoot, env: cleanGitEnv });
      expect(initRes.exitCode).toBe(0);
      expect(existsSync(join(tmpRoot, '.git'))).toBe(true);

      await Bun.write(
        join(tmpRoot, '.github', 'actions', 'setup-memory', 'action.yml'),
        `name: setup-memory
description: memory setup
inputs:
  zram:
    description: zram size
    required: false
runs:
  using: composite
  steps:
    - run: echo ok
      shell: bash
`,
      );

      const wfPath = join(tmpRoot, '.github', 'workflows', 'test.yml');
      await Bun.write(
        wfPath,
        `name: Test
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-memory
        with:
          zarm: 4G
`,
      );

      // Stage the invalid workflow
      const addRes1 = Bun.spawnSync(['git', 'add', '-f', '-A'], { cwd: tmpRoot, env: cleanGitEnv });
      expect(addRes1.exitCode).toBe(0);

      // Change working tree copy to valid zram without staging it
      await Bun.write(
        wfPath,
        `name: Test
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: ./.github/actions/setup-memory
        with:
          zram: 4G
`,
      );

      process.chdir(tmpRoot);
      for (const key of gitEnvKeys) {
        delete process.env[key];
      }

      // The pre-commit hook runs actionlint against staged snapshot (which has zarm), so it must fail
      const initialRes = await runPreCommitHook({
        skipFormat: true,
        skipTypeCheck: true,
        skipLint: true,
        skipHealthCheck: true,
        skipTests: true,
        quiet: true,
      });
      expect(initialRes).toBe(false);

      // Now stage the fixed valid file
      const addRes2 = Bun.spawnSync(['git', 'add', '-f', '.github/workflows/test.yml'], {
        cwd: tmpRoot,
        env: cleanGitEnv,
      });
      expect(addRes2.exitCode).toBe(0);

      const finalRes = await runPreCommitHook({
        skipFormat: true,
        skipTypeCheck: true,
        skipLint: true,
        skipHealthCheck: true,
        skipTests: true,
        quiet: true,
      });
      expect(finalRes).toBe(true);
    } finally {
      for (const key of gitEnvKeys) {
        if (savedGitEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedGitEnv[key];
        }
      }
      process.chdir(origCwd);
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('resolves root-relative directory alias pointing to "." canonically for actionlint', async (): Promise<void> => {
    const actionlint = resolveActionlintBinary();
    if (!actionlint) {
      return;
    }
    const tmpRoot = join(tmpBase, 'repoexe-actionlint-alias-test-' + Date.now());
    const origCwd = process.cwd();
    const gitEnvKeys = [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_COMMON_DIR',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_PARAMETERS',
      'GIT_CONFIG',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_SYSTEM',
      ...Object.keys(process.env).filter((k) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)),
    ];
    const savedGitEnv: Record<string, string | undefined> = {};
    const cleanGitEnv = { ...process.env };
    for (const key of gitEnvKeys) {
      savedGitEnv[key] = process.env[key];
      delete cleanGitEnv[key];
    }

    try {
      mkdirSync(join(tmpRoot, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(tmpRoot, 'tools', 'setup'), { recursive: true });
      const initRes = Bun.spawnSync(['git', 'init'], { cwd: tmpRoot, env: cleanGitEnv });
      expect(initRes.exitCode).toBe(0);

      await Bun.write(
        join(tmpRoot, 'tools', 'setup', 'action.yml'),
        `name: setup
description: memory setup
inputs:
  zram:
    description: zram size
    required: false
runs:
  using: composite
  steps:
    - run: echo ok
      shell: bash
`,
      );
      const lnRes = Bun.spawnSync(['ln', '-s', '.', 'repo-alias'], { cwd: tmpRoot });
      expect(lnRes.exitCode).toBe(0);

      const wfPath = join(tmpRoot, '.github', 'workflows', 'test.yml');
      await Bun.write(
        wfPath,
        `name: Test
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: ./repo-alias/tools/setup
        with:
          zarm: 4G
`,
      );
      expect(
        Bun.spawnSync(['git', 'add', '-f', '-A'], { cwd: tmpRoot, env: cleanGitEnv }).exitCode,
      ).toBe(0);

      process.chdir(tmpRoot);
      for (const key of gitEnvKeys) {
        delete process.env[key];
      }

      const invalidRes = await runPreCommitHook({
        skipFormat: true,
        skipTypeCheck: true,
        skipLint: true,
        skipHealthCheck: true,
        skipTests: true,
        quiet: true,
      });
      expect(invalidRes).toBe(false);

      await Bun.write(
        wfPath,
        `name: Test
on: push
jobs:
  t:
    runs-on: ubuntu-latest
    steps:
      - uses: ./repo-alias/tools/setup
        with:
          zram: 4G
`,
      );
      expect(
        Bun.spawnSync(['git', 'add', '-f', '.github/workflows/test.yml'], {
          cwd: tmpRoot,
          env: cleanGitEnv,
        }).exitCode,
      ).toBe(0);

      const validRes = await runPreCommitHook({
        skipFormat: true,
        skipTypeCheck: true,
        skipLint: true,
        skipHealthCheck: true,
        skipTests: true,
        quiet: true,
      });
      expect(validRes).toBe(true);
    } finally {
      for (const key of gitEnvKeys) {
        if (savedGitEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedGitEnv[key];
        }
      }
      process.chdir(origCwd);
      rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('Finding #12: preserves standalone matrix.include runners and supports object-form runs-on expressions', (): void => {
    // Pure include-only matrix: windows-latest must not overwrite ubuntu-latest
    expect(
      getRunnerDefaultShell(
        '${{ matrix.runner }}',
        { matrix: { include: [{ runner: 'ubuntu-latest' }, { runner: 'windows-latest' }] } },
        undefined,
      ),
    ).toBe('bash');

    // Object-form runs-on.labels expression resolving exclusively to Windows
    expect(
      getRunnerDefaultShell(
        { labels: '${{ matrix.os }}' },
        { matrix: { os: ['windows-latest'] } },
        undefined,
      ),
    ).toBe('pwsh');
  });

  it('Finding #12: shellHasErrexit avoids false positives on -opipefail and stops at -- or {0}', (): void => {
    expect(shellHasErrexit('bash -opipefail {0}')).toBe(false);
    expect(shellHasErrexit('bash -eo pipefail {0}')).toBe(true);
    expect(shellHasErrexit('sh -oerrexit {0}')).toBe(true);
    expect(shellHasErrexit('bash -- -e {0}')).toBe(false);
    expect(shellHasErrexit('bash {0} -e')).toBe(false);
    expect(shellHasErrexit('bash -e +e {0}')).toBe(false);
  });

  it('Finding #12: validateWorkflowScripts reports unterminated expressions without aborting other files', async (): Promise<void> => {
    const wfDir = join(testDir, 'wf-unterminated');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, '01-bad.yml'),
      `name: Bad\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo \${{ github.sha\n`,
    );
    await Bun.write(
      join(wfDir, '02-good.yml'),
      `name: Good\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - run: echo ok\n`,
    );

    const seen: string[] = [];
    const result = await validateWorkflowScripts(
      wfDir,
      async (script): Promise<{ ok: boolean }> => {
        seen.push(script);
        return { ok: true };
      },
    );

    expect(result.ok).toBe(false);
    expect(result.errors.some((e) => e.includes('Unterminated GitHub Actions expression'))).toBe(
      true,
    );
    expect(seen.some((s) => s.includes('echo ok'))).toBe(true);
  });

  it('masks expression arguments to return numerically while keeping literal invalid returns flagged', (): void => {
    expect(maskGitHubExpressions("return ${{ '0' }}")).toBe('return 0');
    expect(maskGitHubExpressions('return "${{ inputs.code }}"')).toBe('return "0"');
    expect(maskGitHubExpressions("if true; then return '${{ inputs.code }}'; fi")).toBe(
      "if true; then return '0'; fi",
    );
    expect(maskGitHubExpressions('return invalid')).toBe('return invalid');
  });

  it('resolves matrix expressions with windows variable names, nested object paths, structural exclude/include, and expansion budgets', (): void => {
    // Variable name containing "windows" resolving to ubuntu-latest must return bash
    expect(
      getRunnerDefaultShell(
        '${{ matrix.windows_runner }}',
        { matrix: { windows_runner: ['ubuntu-latest'] } },
        undefined,
      ),
    ).toBe('bash');
    expect(getRunnerDefaultShell('windows-latest', undefined, undefined)).toBe('pwsh');

    // Nested object-valued matrix path
    expect(
      getRunnerDefaultShell(
        '${{ matrix.target.os }}',
        { matrix: { target: [{ os: 'ubuntu-latest' }], other: ['windows-latest'] } },
        undefined,
      ),
    ).toBe('bash');

    // Structural object matching in exclude & include
    expect(
      getRunnerDefaultShell(
        '${{ matrix.target.os }}',
        {
          matrix: {
            target: [
              { id: 1, os: 'ubuntu-latest' },
              { id: 2, os: 'windows-latest' },
            ],
            exclude: [{ target: { id: 1 } }],
          },
        },
        undefined,
      ),
    ).toBe('pwsh');

    expect(
      getRunnerDefaultShell(
        '${{ matrix.target.os }}',
        {
          matrix: {
            target: [{ id: 1, os: 'ubuntu-latest' }],
            include: [{ target: { id: 2, os: 'windows-latest' } }],
          },
        },
        undefined,
      ),
    ).toBe('bash');

    expect(
      getRunnerDefaultShell(
        '${{ matrix.target.os }}',
        {
          matrix: {
            target: [{ id: 1, os: 'windows-latest' }],
            include: [{ target: { id: 2, os: 'ubuntu-latest' } }],
          },
        },
        undefined,
      ),
    ).toBe('bash');

    // Matrix expansion budget guard (25 two-value axes = 33,554,432 rows)
    const hugeMatrix: Record<string, string[]> = {};
    for (let i = 0; i < 25; i++) {
      hugeMatrix[`axis_${i}`] = ['a', 'b'];
    }
    const diagnostics: string[] = [];
    expect(
      getRunnerDefaultShell('${{ matrix.axis_0 }}', { matrix: hugeMatrix }, undefined, diagnostics),
    ).toBe('unknown');
    expect(diagnostics.some((d) => d.includes('exceeds budget'))).toBe(true);

    // Matrix whose raw axis product exceeds 4096 but post-exclude count is within budget (Thread #7)
    const largeExcludeMatrix: Record<string, unknown> = {
      os: ['ubuntu-latest'],
    };
    for (let i = 0; i < 13; i++) {
      largeExcludeMatrix[`bin_${i}`] = ['0', '1'];
    }
    largeExcludeMatrix.exclude = [
      { bin_0: '1' },
      { bin_1: '1' },
      { bin_2: '1' },
      { bin_3: '1' },
      { bin_4: '1' },
      { bin_5: '1' },
    ];
    const postExcludeDiags: string[] = [];
    expect(
      getRunnerDefaultShell(
        '${{ matrix.os }}',
        { matrix: largeExcludeMatrix },
        undefined,
        postExcludeDiags,
      ),
    ).toBe('bash');
    expect(postExcludeDiags).toHaveLength(0);
  });

  it('injects set -e for unspecified shell and set -eo pipefail only for explicit bash', async (): Promise<void> => {
    const wfDir = join(testDir, 'wf-shell-prefix');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'prefix.yml'),
      `name: Prefix Test
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - run: echo implicit
      - shell: bash
        run: echo explicit-bash
      - shell: sh
        run: echo explicit-sh
`,
    );

    const seen: string[] = [];
    const res = await validateWorkflowScripts(wfDir, async (script): Promise<{ ok: boolean }> => {
      seen.push(script);
      return { ok: true };
    });
    expect(res.ok).toBe(true);
    expect(seen).toEqual([
      'set -e\necho implicit',
      'set -eo pipefail\necho explicit-bash',
      'set -e\necho explicit-sh',
    ]);
  });

  it('shellHasErrexit detects errexit in composite bash flags like -ce', (): void => {
    expect(shellHasErrexit('bash -ce \'. "$1"\' _ {0}')).toBe(true);
    expect(shellHasErrexit('bash -c "echo hello"')).toBe(false);
  });

  it('validateWorkflowScripts skips Windows-only step in mixed matrix', async (): Promise<void> => {
    const wfDir = join(testDir, 'wf-windows-mixed');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'mixed.yml'),
      `name: Mixed Test
jobs:
  j:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - run: echo linux-step
      - if: runner.os == 'Windows'
        run: if ($true) { Write-Host "ok" }
`,
    );

    const checked: string[] = [];
    const res = await validateWorkflowScripts(wfDir, async (script): Promise<{ ok: boolean }> => {
      checked.push(script);
      return { ok: true };
    });
    expect(res.ok).toBe(true);
    expect(checked.some((s) => s.includes('Write-Host'))).toBe(false);
    expect(checked.some((s) => s.includes('echo linux-step'))).toBe(true);
  });

  it('validateWorkflowScripts does not skip condition allowing both Windows and Linux', async (): Promise<void> => {
    const wfDir = join(testDir, 'wf-windows-linux');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'both.yml'),
      `name: Both Test
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - if: runner.os == 'Windows' || runner.os == 'Linux'
        run: echo valid-bash-step
`,
    );

    const checked: string[] = [];
    const res = await validateWorkflowScripts(wfDir, async (script): Promise<{ ok: boolean }> => {
      checked.push(script);
      return { ok: true };
    });
    expect(res.ok).toBe(true);
    expect(checked.some((s) => s.includes('echo valid-bash-step'))).toBe(true);
  });

  it('validateWorkflowScripts checks negated Windows condition with nested parentheses on ubuntu-latest', async (): Promise<void> => {
    const wfDir = join(testDir, 'wf-windows-nested-not');
    mkdirSync(wfDir, { recursive: true });
    await Bun.write(
      join(wfDir, 'nested.yml'),
      `name: Nested Windows Negation
jobs:
  j:
    runs-on: ubuntu-latest
    steps:
      - if: \${{ !((runner.os == 'Windows')) }}
        run: echo linux-nested-step
      - if: runner.os == 'Windows'
        run: if ($true) { Write-Host "windows-step" }
`,
    );

    const checked: string[] = [];
    const res = await validateWorkflowScripts(wfDir, async (script): Promise<{ ok: boolean }> => {
      checked.push(script);
      return { ok: true };
    });
    expect(res.ok).toBe(true);
    expect(checked.some((s) => s.includes('echo linux-nested-step'))).toBe(true);
    expect(checked.some((s) => s.includes('Write-Host'))).toBe(false);
  });

  it('Thread #9: maskGitHubExpressions preserves statically known heredoc delimiters', (): void => {
    const script = `cat <<EOF\nhello\n\${{ 'EOF' }}\n`;
    const masked = maskGitHubExpressions(script);
    expect(masked).toBe(`cat <<EOF\nhello\nEOF\n`);

    const openScript = `cat <<\${{ 'MYDELIM' }}\ncontent\nMYDELIM\n`;
    const openMasked = maskGitHubExpressions(openScript);
    expect(openMasked).toBe(`cat <<MYDELIM\ncontent\nMYDELIM\n`);

    const hyphenScript = `cat <<\${{ 'END-OF-DATA' }}\ncontent\nEND-OF-DATA\n`;
    const hyphenMasked = maskGitHubExpressions(hyphenScript);
    expect(hyphenMasked).toBe(`cat <<END-OF-DATA\ncontent\nEND-OF-DATA\n`);

    const dotScript = `cat <<\${{ 'EOF.done' }}\ncontent\nEOF.done\n`;
    const dotMasked = maskGitHubExpressions(dotScript);
    expect(dotMasked).toBe(`cat <<EOF.done\ncontent\nEOF.done\n`);

    // Quoted heredoc opener preserves quoted delimiter (Thread #8)
    const quotedOpenScript = `cat <<'\${{ 'EOF' }}'\ncontent\nEOF\n`;
    const quotedOpenMasked = maskGitHubExpressions(quotedOpenScript);
    expect(quotedOpenMasked).toBe(`cat <<'EOF'\ncontent\nEOF\n`);

    // Non-delimiter expressions remain masked
    const regularScript = `echo \${{ 'normal-val' }}`;
    const regularMasked = maskGitHubExpressions(regularScript);
    expect(regularMasked.includes('__GH_EXPR_')).toBe(true);
  });
  it('getStagedWorkflowsSnapshot normalizes local action paths and safely recreates in-tree symlinks', async (): Promise<void> => {
    const gitDir = join(tmpBase, 'repoexe-staged-snap-test-' + Date.now());
    const gitEnvKeys = [
      'GIT_DIR',
      'GIT_WORK_TREE',
      'GIT_INDEX_FILE',
      'GIT_OBJECT_DIRECTORY',
      'GIT_ALTERNATE_OBJECT_DIRECTORIES',
      'GIT_COMMON_DIR',
      'GIT_CONFIG_COUNT',
      'GIT_CONFIG_PARAMETERS',
      'GIT_CONFIG',
      'GIT_CONFIG_GLOBAL',
      'GIT_CONFIG_SYSTEM',
      ...Object.keys(process.env).filter((k) => /^GIT_CONFIG_(KEY|VALUE)_\d+$/.test(k)),
    ];
    const savedGitEnv: Record<string, string | undefined> = {};
    const cleanGitEnv = { ...process.env };
    for (const key of gitEnvKeys) {
      savedGitEnv[key] = process.env[key];
      delete cleanGitEnv[key];
    }

    const origCwd = process.cwd();
    let snapDir = '';
    try {
      mkdirSync(join(gitDir, '.github', 'workflows'), { recursive: true });
      mkdirSync(join(gitDir, '.github', 'actions', 'my-action'), { recursive: true });
      mkdirSync(join(gitDir, 'shared'), { recursive: true });

      Bun.spawnSync(['git', 'init'], { cwd: gitDir, env: cleanGitEnv });
      Bun.spawnSync(['git', 'config', 'user.name', 'Test'], { cwd: gitDir, env: cleanGitEnv });
      Bun.spawnSync(['git', 'config', 'user.email', 'test@example.com'], {
        cwd: gitDir,
        env: cleanGitEnv,
      });

      writeFileSync(join(gitDir, 'shared', 'target.txt'), 'hello from shared\n');
      writeFileSync(
        join(gitDir, '.github', 'workflows', 'ci.yml'),
        'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: ./.github/actions/my-action/\n',
      );
      writeFileSync(
        join(gitDir, '.github', 'actions', 'my-action', 'action.yml'),
        'name: my-action\ndescription: test\nruns:\n  using: node24\n  main: index.js\n',
      );
      writeFileSync(
        join(gitDir, '.github', 'actions', 'my-action', 'index.js'),
        'console.log("staged");\n',
      );

      symlinkSync(
        '../actions/my-action/action.yml',
        join(gitDir, '.github', 'workflows', 'safe-link.txt'),
      );
      const externalTarget = join(gitDir, 'outside-mirror.txt');
      writeFileSync(externalTarget, 'outside the mirror\n');
      symlinkSync(externalTarget, join(gitDir, '.github', 'workflows', 'unsafe-escape.txt'));
      symlinkSync('nonexistent.txt', join(gitDir, '.github', 'workflows', 'broken-link.txt'));

      const addRes = Bun.spawnSync(['git', 'add', '-f', '-A'], { cwd: gitDir, env: cleanGitEnv });
      expect(addRes.exitCode).toBe(0);
      writeFileSync(
        join(gitDir, '.github', 'actions', 'my-action', 'index.js'),
        'console.log("worktree");\n',
      );

      for (const key of gitEnvKeys) {
        delete process.env[key];
      }
      process.chdir(gitDir);
      snapDir = getStagedWorkflowsSnapshot('.github/workflows');
      const snapRoot = dirname(dirname(snapDir));

      expect(existsSync(join(snapDir, 'ci.yml'))).toBe(true);
      expect(existsSync(join(snapRoot, '.github', 'actions', 'my-action', 'action.yml'))).toBe(
        true,
      );
      expect(
        await Bun.file(join(snapRoot, '.github', 'actions', 'my-action', 'index.js')).text(),
      ).toBe('console.log("staged");\n');
      expect(existsSync(join(snapDir, 'safe-link.txt'))).toBe(true);
      expect(lstatSync(join(snapDir, 'safe-link.txt')).isSymbolicLink()).toBe(true);
      const snapEntries = readdirSync(snapDir);
      expect(snapEntries).not.toContain('unsafe-escape.txt');
      expect(snapEntries).not.toContain('broken-link.txt');
    } finally {
      process.chdir(origCwd);
      for (const key of gitEnvKeys) {
        if (savedGitEnv[key] === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = savedGitEnv[key];
        }
      }
      if (snapDir && existsSync(snapDir)) {
        const snapRoot = dirname(dirname(snapDir));
        rmSync(snapRoot, { recursive: true, force: true });
      }
      rmSync(gitDir, { recursive: true, force: true });
    }
  });

  it('resolves dotted and bracket-indexed matrix selectors in step.if before running shellcheck', async (): Promise<void> => {
    const tmpWfDir = join(tmpBase, 'repoexe-matrix-bracket-if-' + Date.now());
    mkdirSync(tmpWfDir, { recursive: true });
    try {
      await Bun.write(
        join(tmpWfDir, 'matrix.yml'),
        `name: Matrix
on: push
jobs:
  build:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - name: Win dotted
        if: matrix.os == 'windows-latest'
        run: Write-Host "win"
      - name: Win bracket
        if: matrix['os'] == 'windows-latest'
        run: Write-Host "win-bracket"
      - name: Ubuntu only
        if: matrix['os'] == 'ubuntu-latest'
        run: echo "ubuntu"
`,
      );
      const seen: Array<{ script: string; dialect: string }> = [];
      const res = await validateWorkflowScripts(
        tmpWfDir,
        async (script: string, dialect: 'sh' | 'bash'): Promise<{ ok: boolean }> => {
          seen.push({ script, dialect });
          return { ok: true };
        },
      );
      expect(res.ok).toBe(true);
      expect(seen.length).toBe(1);
      expect(seen[0].dialect).toBe('bash');
      expect(seen[0].script).toContain('echo "ubuntu"');
    } finally {
      rmSync(tmpWfDir, { recursive: true, force: true });
    }
  });

  it('resolves numeric matrix indexes in expressions', (): void => {
    const strategy = {
      matrix: {
        target: [{ labels: ['ubuntu-latest', 'x64'] }],
      },
    };
    const shell = getRunnerDefaultShell('${{ matrix.target.labels[0] }}', strategy, undefined);
    expect(shell).toBe('bash');
  });

  it('does not treat inherited prototype properties as matrix axis keys during include matching (Thread #7)', (): void => {
    const strategy = {
      matrix: {
        mode: ['release'],
        include: [{ constructor: 'ubuntu-latest' }, { constructor: 'windows-latest' }],
      },
    };
    const shell = getRunnerDefaultShell('${{ matrix.constructor }}', strategy, undefined);
    expect(shell).toBe('pwsh');
  });

  it('does not infer bash from custom capability labels such as linux-tools (Thread #8)', (): void => {
    const strategy = {
      matrix: {
        os: ['windows'],
        capability: ['linux-tools'],
      },
    };
    const shell = getRunnerDefaultShell(
      ['self-hosted', '${{ matrix.os }}', '${{ matrix.capability }}'],
      strategy,
      undefined,
    );
    expect(shell).toBe('pwsh');
  });

  it('interpolates runner label expressions like ubuntu-${{ matrix.release }} (Thread #8)', (): void => {
    const strategy = {
      matrix: {
        release: ['latest'],
      },
    };
    const shell = getRunnerDefaultShell('ubuntu-${{ matrix.release }}', strategy, undefined);
    expect(shell).toBe('bash');
  });

  it('correctly evaluates isStepWindowsOnlyCondition without being fooled by quoted strings (Thread #9)', (): void => {
    expect(
      isStepWindowsOnlyCondition("contains('runner.os == \"Windows\"', 'runner.os')"),
    ).toBeFalse();
    expect(isStepWindowsOnlyCondition("runner.os == 'Windows'")).toBeTrue();
    expect(isStepWindowsOnlyCondition("(runner.os) == 'Windows'")).toBeTrue();
    expect(isStepWindowsOnlyCondition("((runner.os)) == ('Windows')")).toBeTrue();
    expect(isStepWindowsOnlyCondition("!( (runner.os) != 'Windows' )")).toBeTrue();
    expect(isStepWindowsOnlyCondition("runner.os != 'Windows'")).toBeFalse();
    expect(isStepWindowsOnlyCondition("runner.os == 'Linux'")).toBeFalse();
  });

  it('evaluates Windows-only || conditions in isStepWindowsOnlyCondition (Thread #10)', (): void => {
    expect(
      isStepWindowsOnlyCondition(
        "(runner.os == 'Windows' && matrix.mode == 'debug') || (runner.os == 'Windows' && matrix.mode == 'release')",
      ),
    ).toBeTrue();
    expect(
      isStepWindowsOnlyCondition("runner.os == 'Windows' || runner.os == 'Linux'"),
    ).toBeFalse();
    expect(
      isStepWindowsOnlyCondition(
        "(runner.os == 'Windows' || matrix.mode == 'release') && success()",
      ),
    ).toBeFalse();
    expect(isStepWindowsOnlyCondition("!(runner.os != 'Windows')")).toBeTrue();
    expect(isStepWindowsOnlyCondition("!(runner.os != 'Windows' || matrix.debug)")).toBeTrue();
    expect(isStepWindowsOnlyCondition("!(matrix.debug || runner.os != 'Windows')")).toBeTrue();
    expect(isStepWindowsOnlyCondition("runner['os'] == 'Windows'")).toBeTrue();
    expect(isStepWindowsOnlyCondition("!(runner['os'] != 'Windows')")).toBeTrue();
    expect(isStepWindowsOnlyCondition("!runner.os != 'Windows'")).toBeFalse();
    expect(
      isStepWindowsOnlyCondition(
        "fromJSON('[true,false]')[true && runner.os == 'Windows' && true]",
      ),
    ).toBeFalse();
  });

  it('does not infer OS from strings inside expressions in getRunnerDefaultShell', (): void => {
    const runsOnExpr =
      "${{ contains(inputs.note, 'choose ubuntu-latest here') && 'windows-latest' || 'windows-2022' }}";
    const shell = getRunnerDefaultShell(runsOnExpr, undefined, undefined);
    expect(shell).toBe('unknown');

    const quotedBracesExpr =
      "runs-on: ${{ contains('}} windows ', github.ref) && 'ubuntu-latest' || 'ubuntu-22.04' }}";
    const shellQuoted = getRunnerDefaultShell(quotedBracesExpr, undefined, undefined);
    expect(shellQuoted).toBe('unknown');
  });

  it('recognizes xcode-27 and bracket-indexed matrix keys with dots in getRunnerDefaultShell', (): void => {
    expect(getRunnerDefaultShell('xcode-27', undefined, undefined)).toBe('bash');

    const strategy = {
      matrix: {
        target: [{ 'image.tag': 'latest' }],
      },
    };
    const shell = getRunnerDefaultShell(
      "ubuntu-${{ matrix.target['image.tag'] }}",
      strategy,
      undefined,
    );
    expect(shell).toBe('bash');
  });
});
