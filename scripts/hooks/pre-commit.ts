import { spawnSync } from 'node:child_process';
import {
  accessSync,
  chmodSync,
  constants,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { basename, delimiter, dirname, isAbsolute, join, relative, resolve } from 'node:path';

import { $ } from 'bun';

/** Ensures that Termux or custom environment PATH entries include PREFIX/bin. */
export function ensurePrefixPath(): void {
  if (process.env.PREFIX) {
    const prefixBinDir = join(process.env.PREFIX, 'bin');
    const pathEntries = (process.env.PATH ?? '').split(delimiter);
    if (!pathEntries.includes(prefixBinDir)) {
      process.env.PATH = `${prefixBinDir}${delimiter}${process.env.PATH ?? ''}`;
    }
  }
}

/** Options for customizing pre-commit hook execution during tests or CI. */
export interface PreCommitOptions {
  stagedFiles?: string[];
  skipFormat?: boolean;
  skipTypeCheck?: boolean;
  skipLint?: boolean;
  skipHealthCheck?: boolean;
  skipActionlint?: boolean;
  skipTests?: boolean;
  quiet?: boolean;
}

export function maskGitHubExpressions(script: string): string {
  let result = '';
  let i = 0;
  const placeholderMap = new Map<string, string>();
  while (i < script.length) {
    if (script.startsWith('${{', i)) {
      let j = i + 3;
      let inString = false;
      let closed = false;
      while (j < script.length) {
        if (inString) {
          if (script[j] === "'") {
            if (script[j + 1] === "'") {
              j += 2;
              continue;
            } else {
              inString = false;
            }
          }
          j++;
        } else {
          if (script[j] === "'") {
            inString = true;
            j++;
          } else if (script.startsWith('}}', j)) {
            j += 2;
            closed = true;
            break;
          } else {
            j++;
          }
        }
      }
      if (!closed) {
        throw new Error('Unterminated GitHub Actions expression ${{ in script.');
      }
      const exprBody = script.slice(i + 3, j - 2).trim();
      const statusArgMatch = result.match(
        /(?:(?:^|[\r\n]|[;&|{(])\s*|\b(?:then|do|else)\s+)(?:exit|return)\s+(['"]?)$/,
      );
      const openingQuote = statusArgMatch?.[1] ?? '';
      const isWholeStatusArg =
        Boolean(statusArgMatch) &&
        (openingQuote ? script[j] === openingQuote : j >= script.length || /[\s;&|)><]/.test(script[j]));
      const literalMatch = exprBody.match(/^'([^']*)'$|^"([^"]*)"$/);
      const literalVal = literalMatch ? (literalMatch[1] ?? literalMatch[2]) : undefined;
      const isLineStart = /(?:^|[\r\n])[ \t]*$/.test(result);
      const isLineEnd = j >= script.length || /^[\r\n]/.test(script.slice(j));
      const heredocQuoteMatch = result.match(/<<-?\s*(['"])$/);
      const heredocQuote = heredocQuoteMatch?.[1];
      const hasMatchingQuote = Boolean(heredocQuote && script[j] === heredocQuote);
      const isHeredocDelimiter =
        literalVal !== undefined &&
        /^[a-zA-Z_0-9]+$/.test(literalVal) &&
        ((isLineStart && isLineEnd && new RegExp(`<<-?\\s*['"]?${literalVal}['"]?(?:\\s|[\r\n]|$)`).test(result)) ||
          /<<-?\s*$/.test(result) ||
          hasMatchingQuote);

      if (isHeredocDelimiter) {
        result += literalVal;
      } else if (/^-?\d+$/.test(exprBody)) {
        result += exprBody;
      } else if (literalVal !== undefined && /^-?\d+$/.test(literalVal)) {
        result += literalVal;
      } else if (isWholeStatusArg) {
        if (literalVal !== undefined) {
          result += literalVal;
        } else {
          result += '0';
        }
      } else {
        if (!placeholderMap.has(exprBody)) {
          placeholderMap.set(exprBody, `__GH_EXPR_${placeholderMap.size}__`);
        }
        result += placeholderMap.get(exprBody)!;
      }
      i = j;
    } else {
      result += script[i];
      i++;
    }
  }
  return result;
}

function stripGitHubExpressions(value: string): string {
  return value.replace(/\$\{\{[\s\S]*?\}\}/g, '');
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqualMatrixValue(a: unknown, b: unknown): boolean {
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    return (
      keysA.length === keysB.length &&
      keysA.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqualMatrixValue(a[k], b[k]))
    );
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, idx) => deepEqualMatrixValue(v, b[idx]));
  }
  if ((typeof a === 'object' && a !== null) || (typeof b === 'object' && b !== null)) {
    return false;
  }
  return String(a) === String(b);
}

function excludeMatrixValueMatches(rowVal: unknown, exVal: unknown): boolean {
  if (isPlainObject(exVal)) {
    if (!isPlainObject(rowVal)) {
      return false;
    }
    return Object.entries(exVal).every(
      ([k, v]) => Object.prototype.hasOwnProperty.call(rowVal, k) && excludeMatrixValueMatches(rowVal[k], v),
    );
  }
  return deepEqualMatrixValue(rowVal, exVal);
}

function resolveMatrixPath(row: Record<string, unknown>, pathSegments: string[]): unknown {
  let current: unknown = row;
  for (const segment of pathSegments) {
    if (Array.isArray(current)) {
      const idx = /^\d+$/.test(segment) ? parseInt(segment, 10) : NaN;
      if (!Number.isNaN(idx) && idx >= 0 && idx < current.length) {
        current = current[idx];
      } else {
        return undefined;
      }
    } else if (isPlainObject(current)) {
      if (Object.prototype.hasOwnProperty.call(current, segment)) {
        current = (current as Record<string, unknown>)[segment];
      } else {
        const segLower = segment.toLowerCase();
        const foundKey = Object.keys(current).find((k) => k.toLowerCase() === segLower);
        if (foundKey && Object.prototype.hasOwnProperty.call(current, foundKey)) {
          current = (current as Record<string, unknown>)[foundKey];
        } else {
          return undefined;
        }
      }
    } else {
      return undefined;
    }
  }
  return current;
}

const MAX_RAW_MATRIX_PRODUCT = 65536;
const MAX_MATRIX_COMBINATIONS = 4096;

function isWindowsRunner(runsOn: unknown): boolean {
  const hasLiteralWindows = (val: string): boolean => {
    const clean = stripGitHubExpressions(val).trim().toLowerCase();
    if (clean === 'windows' || /^windows-(latest|\d+.*)$/.test(clean)) {
      return true;
    }
    const tokens = clean.split(/[\s,]+/);
    return tokens.some((t) => t === 'windows' || /^windows-(latest|\d+.*)$/.test(t));
  };
  if (typeof runsOn === 'string') {
    return hasLiteralWindows(runsOn);
  }
  if (Array.isArray(runsOn)) {
    return runsOn.some((r) => typeof r === 'string' && hasLiteralWindows(r));
  }
  if (runsOn && typeof runsOn === 'object') {
    const labels = (runsOn as Record<string, unknown>).labels;
    if (typeof labels === 'string') {
      return hasLiteralWindows(labels);
    }
    if (Array.isArray(labels)) {
      return labels.some((r) => typeof r === 'string' && hasLiteralWindows(r));
    }
  }
  return false;
}

export function resolveStaticMatrixExpression(expr: string, strategy: unknown): string | undefined {
  if (!strategy || typeof strategy !== 'object') {
    return undefined;
  }
  const matrix = (strategy as Record<string, unknown>).matrix;
  if (!matrix || typeof matrix !== 'object') {
    return undefined;
  }
  const match = expr.match(/^\$\{\{\s*matrix((?:\.[a-zA-Z0-9_-]+|\[['"][a-zA-Z0-9_-]+['"]\]|\[\d+\])+)\s*\}\}$/);
  if (!match) {
    return undefined;
  }
  const segments = match[1]
    .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter(Boolean);
  if (segments.length === 0) {
    return undefined;
  }

  const resolvePath = (obj: unknown, path: string[]): unknown => {
    let curr = obj;
    for (const p of path) {
      if (Array.isArray(curr)) {
        const idx = /^\d+$/.test(p) ? parseInt(p, 10) : NaN;
        if (!Number.isNaN(idx) && idx >= 0 && idx < curr.length) {
          curr = curr[idx];
        } else {
          return undefined;
        }
      } else if (curr && typeof curr === 'object') {
        const lowerP = p.toLowerCase();
        const foundKey = Object.keys(curr as Record<string, unknown>).find((k) => k.toLowerCase() === lowerP);
        if (foundKey !== undefined) {
          curr = (curr as Record<string, unknown>)[foundKey];
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    }
    return curr;
  };

  const matrixObj = matrix as Record<string, unknown>;
  const key = segments[0];
  const axisKey = Object.keys(matrixObj).find((k) => k.toLowerCase() === key.toLowerCase());
  const axis = axisKey !== undefined ? matrixObj[axisKey] : undefined;
  const remaining = segments.slice(1);

  if (Array.isArray(axis)) {
    if (axis.length === 0) {
      return '';
    }
    const resolvedValues = axis.map((row) => (remaining.length > 0 ? resolvePath(row, remaining) : row));
    const stringValues = resolvedValues.map((v) => (v === null || v === undefined ? '' : String(v)));
    const first = stringValues[0];
    if (stringValues.every((v) => v === first)) {
      return first;
    }
    return undefined;
  }
  if (remaining.length > 0 && axis && typeof axis === 'object') {
    const res = resolvePath(axis, remaining);
    if (typeof res === 'string' || typeof res === 'number' || typeof res === 'boolean') {
      return String(res);
    }
    return undefined;
  }
  if (typeof axis === 'string') {
    return axis;
  }
  return undefined;
}

function expandMatrixRows(strategy: unknown, diagnostics?: string[]): Array<Record<string, unknown>> | null {
  if (!strategy || typeof strategy !== 'object') {
    return null;
  }
  const matrix = (strategy as Record<string, unknown>).matrix;
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    return null;
  }
  const matrixObj = matrix as Record<string, unknown>;
  const axes: Record<string, unknown[]> = {};
  for (const [k, v] of Object.entries(matrixObj)) {
    if (k !== 'include' && k !== 'exclude' && Array.isArray(v)) {
      axes[k] = v;
    }
  }
  const axisKeys = Object.keys(axes);
  let estimatedRows = axisKeys.length > 0 ? 1 : 0;
  for (const key of axisKeys) {
    estimatedRows *= axes[key].length;
    if (estimatedRows > MAX_RAW_MATRIX_PRODUCT) {
      diagnostics?.push(
        `Matrix raw axis product exceeds budget of ${MAX_RAW_MATRIX_PRODUCT} combinations; cannot infer runner default shell.`,
      );
      return null;
    }
  }

  let combinations: Array<Record<string, unknown>> = [];
  if (axisKeys.length > 0) {
    combinations = [{}];
    for (const key of axisKeys) {
      const next: Array<Record<string, unknown>> = [];
      for (const comb of combinations) {
        for (const val of axes[key]) {
          next.push({ ...comb, [key]: val });
        }
      }
      combinations = next;
    }
  }

  const exclude: unknown[] = Array.isArray(matrixObj.exclude) ? matrixObj.exclude : [];
  combinations = combinations.filter((comb): boolean => {
    return !exclude.some((ex): boolean => {
      if (!isPlainObject(ex)) {
        return false;
      }
      return Object.entries(ex).every(
        ([k, v]) => Object.prototype.hasOwnProperty.call(comb, k) && excludeMatrixValueMatches(comb[k], v),
      );
    });
  });

  if (combinations.length > MAX_MATRIX_COMBINATIONS) {
    diagnostics?.push(
      `Matrix expansion exceeds budget of ${MAX_MATRIX_COMBINATIONS} combinations; cannot infer runner default shell.`,
    );
    return null;
  }

  const baseEntries = combinations.map((comb) => ({ original: { ...comb }, current: { ...comb } }));
  const extraEntries: Array<Record<string, unknown>> = [];
  const include: unknown[] = Array.isArray(matrixObj.include) ? (matrixObj.include as unknown[]) : [];
  for (const inc of include) {
    if (isPlainObject(inc)) {
      let matched = false;
      for (const entry of baseEntries) {
        const isMatch: boolean = Object.entries(inc).every(([k, v]): boolean => {
          return entry.original[k] === undefined || deepEqualMatrixValue(entry.original[k], v);
        });
        if (isMatch) {
          entry.current = { ...entry.current, ...inc };
          matched = true;
        }
      }
      if (!matched) {
        if (baseEntries.length + extraEntries.length + 1 > MAX_MATRIX_COMBINATIONS) {
          diagnostics?.push(
            `Matrix expansion with include entries exceeds budget of ${MAX_MATRIX_COMBINATIONS} combinations; cannot infer runner default shell.`,
          );
          return null;
        }
        extraEntries.push({ ...inc });
      }
    }
  }
  return [...baseEntries.map((e) => e.current), ...extraEntries];
}

function hasContainer(container: unknown, strategy?: unknown): boolean {
  if (typeof container === 'string') {
    const trimmed = container.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed.includes('${{')) {
      const survivingRows = expandMatrixRows(strategy);
      if (survivingRows && survivingRows.length > 0) {
        const hasAny = survivingRows.some((row) => {
          let rowStr = trimmed;
          rowStr = rowStr.replace(
            /\$\{\{\s*matrix((?:\.[a-zA-Z0-9_-]+|\[['"][a-zA-Z0-9_-]+['"]\]|\[\d+\])+)\s*\}\}/g,
            (_match: string, path: string): string => {
              const segs = path
                .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
                .replace(/\[(\d+)\]/g, '.$1')
                .split('.')
                .filter(Boolean);
              const v = resolveMatrixPath(row, segs);
              return v !== undefined && v !== null ? String(v) : '';
            },
          );
          return rowStr.trim().length > 0;
        });
        return hasAny;
      }
      const resolved = resolveStaticMatrixExpression(trimmed, strategy);
      if (resolved !== undefined) {
        return resolved.trim().length > 0;
      }
      return true;
    }
    return true;
  }
  if (container && typeof container === 'object') {
    const img = (container as Record<string, unknown>).image;
    if (img !== undefined) {
      return hasContainer(img, strategy);
    }
    return true;
  }
  return false;
}

export function getRunnerDefaultShell(
  runsOn: unknown,
  strategy: unknown,
  container: unknown,
  diagnostics?: string[],
): string {
  if (hasContainer(container, strategy)) {
    return 'sh';
  }

  if (isWindowsRunner(runsOn)) {
    return 'pwsh';
  }

  const rawLabels =
    runsOn && typeof runsOn === 'object' && !Array.isArray(runsOn)
      ? (runsOn as Record<string, unknown>).labels
      : runsOn;
  const runsOnStr = typeof rawLabels === 'string' ? rawLabels : Array.isArray(rawLabels) ? rawLabels.join(' ') : '';
  const isExpression = runsOnStr.includes('${{');

  if (isExpression) {
    if (strategy && typeof strategy === 'object') {
      const matrix = (strategy as Record<string, unknown>).matrix;
      if (matrix && typeof matrix === 'object') {
        const referencedPaths = [
          ...runsOnStr.matchAll(/\$\{\{\s*matrix((?:\.[a-zA-Z0-9_-]+|\[['"][a-zA-Z0-9_-]+['"]\]|\[\d+\])+)\s*\}\}/g),
        ]
          .map((m) =>
            m[1]
              .replace(/\[['"]([^'"]+)['"]\]/g, '.$1')
              .replace(/\[(\d+)\]/g, '.$1')
              .split('.')
              .filter(Boolean),
          )
          .filter((segments) => segments.length > 0);
        if (referencedPaths.length === 0) {
          return 'unknown';
        }

        const expanded = expandMatrixRows(strategy, diagnostics);
        if (expanded === null) {
          return 'unknown';
        }
        const combinations = expanded;

        const values: string[] = [];
        for (const comb of combinations) {
          for (const pathSegments of referencedPaths) {
            const resolved = resolveMatrixPath(comb, pathSegments);
            if (typeof resolved === 'string') {
              values.push(resolved);
            } else if (Array.isArray(resolved)) {
              for (const item of resolved) {
                if (typeof item === 'string') {
                  values.push(item);
                }
              }
            }
          }
        }
        if (
          values.some((v) => {
            const l = v.toLowerCase();
            return (
              l.includes('ubuntu') ||
              l.includes('linux') ||
              l.includes('macos') ||
              l.includes('debian') ||
              l.includes('alpine')
            );
          })
        ) {
          return 'bash';
        }
        if (values.some((v) => v.toLowerCase().includes('windows'))) {
          return 'pwsh';
        }
      }
    }
    const lower = runsOnStr.toLowerCase();
    if (lower.includes('windows')) {
      return 'pwsh';
    }
    if (
      lower.includes('ubuntu') ||
      lower.includes('linux') ||
      lower.includes('macos') ||
      lower.includes('debian') ||
      lower.includes('alpine')
    ) {
      return 'bash';
    }
    return 'unknown';
  }

  const lower = runsOnStr.toLowerCase();
  if (
    lower.includes('ubuntu') ||
    lower.includes('linux') ||
    lower.includes('macos') ||
    lower.includes('debian') ||
    lower.includes('alpine')
  ) {
    return 'bash';
  }

  return 'unknown';
}

export function getShellOptions(rawShell?: string): { errexit: boolean; pipefail: boolean } {
  if (!rawShell) {
    return { errexit: false, pipefail: false };
  }
  const tokens = rawShell
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/^"(.*)"$/, '$1'));
  let errexit = false;
  let pipefail = false;
  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === '{0}' || t.includes('{0}') || t === '--' || t === '-c' || t === '+c') {
      break;
    }
    if (t === '-o' || t === '+o') {
      const opt = tokens[++i];
      if (opt === 'errexit') {
        errexit = t === '-o';
      } else if (opt === 'pipefail') {
        pipefail = t === '-o';
      }
      continue;
    }
    if ((t.startsWith('-') && !t.startsWith('--')) || (t.startsWith('+') && !t.startsWith('++'))) {
      const enable = t.startsWith('-');
      const rawFlags = t.slice(1);
      const oIdx = rawFlags.indexOf('o');
      const directFlags = oIdx === -1 ? rawFlags : rawFlags.slice(0, oIdx);
      if (directFlags.includes('e')) {
        errexit = enable;
      }
      if (oIdx !== -1) {
        const opt = oIdx + 1 < rawFlags.length ? rawFlags.slice(oIdx + 1) : tokens[++i];
        if (opt === 'errexit') {
          errexit = enable;
        } else if (opt === 'pipefail') {
          pipefail = enable;
        }
      }
      if (rawFlags.includes('c')) {
        break;
      }
    }
  }
  return { errexit, pipefail };
}

export function shellHasErrexit(rawShell?: string): boolean {
  return getShellOptions(rawShell).errexit;
}

export function insertSetupAfterLeadingComments(content: string, setup: string): string {
  const lines = content.split('\n');
  let insertIdx = 0;
  while (insertIdx < lines.length) {
    const trimmed = lines[insertIdx].trim();
    if (trimmed.startsWith('#') || trimmed === '') {
      insertIdx++;
    } else {
      break;
    }
  }
  const before = lines.slice(0, insertIdx);
  const after = lines.slice(insertIdx);
  return [...before, setup.trimEnd(), ...after].join('\n');
}

export function getStagedWorkflowsSnapshot(workflowDir = '.github/workflows'): string {
  const normWorkflowDir = workflowDir.replace(/^\.\//, '').replace(/\/+$/, '');
  const checkGit = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], { encoding: 'utf-8' });
  const isGitRepo = checkGit.status === 0;

  interface IndexedBlobEntry {
    mode: string;
    sha: string;
    stage: number;
    path: string;
  }
  const byPath = new Map<string, IndexedBlobEntry>();

  if (isGitRepo) {
    const writeTreeRes = spawnSync('git', ['write-tree'], { encoding: 'utf-8' });
    if (writeTreeRes.status === 0 && writeTreeRes.stdout) {
      const treeSha = writeTreeRes.stdout.trim();
      const lsTreeRes = spawnSync('git', ['ls-tree', '-r', '-z', treeSha], {
        encoding: 'utf-8',
        maxBuffer: 20 * 1024 * 1024,
      });
      if (lsTreeRes.status !== 0) {
        throw new Error(
          `git ls-tree failed with exit code ${lsTreeRes.status}: ${lsTreeRes.stderr?.trim() || 'unknown error'}`,
        );
      }
      if (lsTreeRes.stdout) {
        for (const record of lsTreeRes.stdout.split('\0')) {
          if (!record) {
            continue;
          }
          const tabIdx = record.indexOf('\t');
          if (tabIdx === -1) {
            continue;
          }
          const meta = record.slice(0, tabIdx).trim().split(/\s+/);
          const gitPath = record.slice(tabIdx + 1);
          if (meta.length < 3 || !gitPath) {
            continue;
          }
          const [mode, type, sha] = meta;
          if (type !== 'blob') {
            continue;
          }
          byPath.set(gitPath, { mode, sha, stage: 0, path: gitPath });
        }
      }
    } else {
      // Fallback if write-tree cannot run (e.g. unmerged conflicts)
      const diffFilesRes = spawnSync('git', ['diff-files', '-z'], { encoding: 'utf-8' });
      const intentToAddFiles = new Set<string>();
      if (diffFilesRes.status === 0 && diffFilesRes.stdout) {
        const tokens = diffFilesRes.stdout.split('\0');
        for (let i = 0; i < tokens.length - 1; i += 2) {
          const rawStatus = tokens[i];
          const rawPath = tokens[i + 1];
          if (rawStatus && rawPath && rawStatus.includes(' 0000000000000000000000000000000000000000 A')) {
            intentToAddFiles.add(rawPath);
          }
        }
      }
      const lsProc = spawnSync('git', ['ls-files', '--stage', '-z'], {
        encoding: 'utf-8',
        maxBuffer: 20 * 1024 * 1024,
      });
      if (lsProc.status === 0 && lsProc.stdout) {
        for (const record of lsProc.stdout.split('\0')) {
          if (!record) {
            continue;
          }
          const tabIdx = record.indexOf('\t');
          if (tabIdx === -1) {
            continue;
          }
          const meta = record.slice(0, tabIdx).trim().split(/\s+/);
          const gitPath = record.slice(tabIdx + 1);
          if (meta.length < 3 || !gitPath || intentToAddFiles.has(gitPath)) {
            continue;
          }
          const [mode, sha, stageStr] = meta;
          const stage = Number(stageStr);
          if (mode === '160000') {
            continue;
          }
          const existing = byPath.get(gitPath);
          if (stage === 0) {
            byPath.set(gitPath, { mode, sha, stage, path: gitPath });
          } else if (stage === 2 && (!existing || existing.stage !== 0)) {
            byPath.set(gitPath, { mode, sha, stage, path: gitPath });
          }
        }
      }
    }
  }

  const indexedWorkflowEntries = Array.from(byPath.values()).filter(
    (e) => dirname(e.path) === normWorkflowDir && (e.path.endsWith('.yml') || e.path.endsWith('.yaml')),
  );
  const localActionDirs = new Set<string>(['.github/actions']);
  for (const entry of byPath.values()) {
    if (
      entry.path.endsWith('/action.yml') ||
      entry.path.endsWith('/action.yaml') ||
      entry.path === 'action.yml' ||
      entry.path === 'action.yaml'
    ) {
      localActionDirs.add(dirname(entry.path));
    }
  }
  const indexedActionEntries = Array.from(byPath.values()).filter((e) => {
    if (!/(^|\/)action\.ya?ml$/.test(e.path)) {
      return false;
    }
    for (const dir of localActionDirs) {
      if (e.path === dir || e.path.startsWith(`${dir}/`)) {
        return true;
      }
    }
    return false;
  });
  const indexedConfigEntries = Array.from(byPath.values()).filter(
    (e) => e.path === '.github/actionlint.yaml' || e.path === '.github/actionlint.yml',
  );

  const tmpRoot = join(
    process.env.TMPDIR || tmpdir(),
    `staged-repo-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  const tmpSnapshotDir = join(tmpRoot, normWorkflowDir);
  mkdirSync(tmpRoot, { recursive: true, mode: 0o700 });
  try {
    chmodSync(tmpRoot, 0o700);
  } catch {}
  mkdirSync(tmpSnapshotDir, { recursive: true, mode: 0o700 });

  const readBlobBySha = (entry: IndexedBlobEntry): Buffer => {
    const catProc = spawnSync('git', ['cat-file', 'blob', entry.sha], { maxBuffer: 20 * 1024 * 1024 });
    if (catProc.status !== 0 || !catProc.stdout) {
      const errText = catProc.stderr ? catProc.stderr.toString('utf-8').trim() : 'unknown error';
      throw new Error(`Failed to read staged blob '${entry.sha}' for '${entry.path}' from git index: ${errText}`);
    }
    return Buffer.from(catProc.stdout);
  };

  try {
    if (existsSync('.git')) {
      try {
        symlinkSync(resolve('.git'), join(tmpRoot, '.git'));
      } catch {}
    }

    if (isGitRepo) {
      if (indexedActionEntries.length > 0) {
        // Collect local actions actually referenced by workflows (Thread #16)
        const referencedLocalActionDirs = new Set<string>();
        for (const wf of indexedWorkflowEntries) {
          const content = readBlobBySha(wf).toString('utf-8');
          try {
            if (typeof (Bun as { YAML?: { parse?: (s: string) => unknown } }).YAML?.parse === 'function') {
              const parsedWf = Bun.YAML.parse(content);
              if (parsedWf && typeof parsedWf === 'object') {
                const jobs = (parsedWf as Record<string, unknown>).jobs;
                if (jobs && typeof jobs === 'object') {
                  for (const job of Object.values(jobs as Record<string, unknown>)) {
                    if (job && typeof job === 'object') {
                      const steps = (job as Record<string, unknown>).steps;
                      if (Array.isArray(steps)) {
                        for (const step of steps) {
                          if (step && typeof step === 'object') {
                            const usesVal = (step as Record<string, unknown>).uses;
                            if (typeof usesVal === 'string' && (/^\.\//.test(usesVal) || /^\.\\/.test(usesVal))) {
                              const actPath = usesVal
                                .replace(/\\/g, '/')
                                .replace(/^\.?\//, '')
                                .replace(/\/+$/, '')
                                .trim();
                              if (actPath) {
                                referencedLocalActionDirs.add(actPath);
                              }
                            }
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          } catch {}
          const matches = content.matchAll(/(?:^|[\s,{"'])uses['"]?\s*:\s*['"]?(?:\.\/|\.\\)([^'"\s\r\n#]+)['"]?/gm);
          for (const m of matches) {
            const actPath = m[1]
              ?.replace(/\\/g, '/')
              .replace(/^\.?\//, '')
              .replace(/\/+$/, '')
              .trim();
            if (actPath) {
              referencedLocalActionDirs.add(actPath);
            }
          }
        }

        const actionReferencedEntries = new Map<string, IndexedBlobEntry>();
        for (const entry of indexedActionEntries) {
          const linkTarget = entry.mode === '120000' ? readBlobBySha(entry).toString('utf-8') : undefined;
          const sibling =
            linkTarget === undefined
              ? undefined
              : byPath.get(join(dirname(entry.path), linkTarget).replace(/\\/g, '/'));
          const blob = readBlobBySha(sibling !== undefined && sibling.mode !== '120000' ? sibling : entry);
          const targetPath = join(tmpRoot, entry.path);
          try {
            mkdirSync(dirname(targetPath), { recursive: true });
            writeFileSync(targetPath, blob);
          } catch (writeErr) {
            throw new Error(
              `Failed to write staged action file '${entry.path}': ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
            );
          }

          const actDir = dirname(entry.path);
          const isReferencedByWorkflow =
            referencedLocalActionDirs.has(actDir) ||
            referencedLocalActionDirs.has(entry.path) ||
            Array.from(referencedLocalActionDirs).some(
              (r) => actDir === r || actDir.endsWith(`/${r}`) || r.endsWith(`/${actDir}`),
            );
          if (!isReferencedByWorkflow) {
            continue;
          }

          // Inspect manifest for referenced files (Docker image, Node main/pre/post)
          const manifestContent = blob.toString('utf-8');
          const relRefs: string[] = [];
          try {
            const parsedYaml = (Bun as { YAML?: { parse?: (s: string) => unknown } }).YAML?.parse?.(manifestContent);
            if (parsedYaml && typeof parsedYaml === 'object') {
              const runs = (parsedYaml as { runs?: Record<string, unknown> }).runs;
              if (runs && typeof runs === 'object') {
                const using = typeof runs.using === 'string' ? runs.using.toLowerCase() : '';
                if (using !== 'composite') {
                  for (const key of [
                    'image',
                    'main',
                    'pre',
                    'post',
                    'entrypoint',
                    'pre-entrypoint',
                    'post-entrypoint',
                  ]) {
                    const val = runs[key];
                    if (typeof val === 'string' && val.trim()) {
                      relRefs.push(val.trim());
                    }
                  }
                }
              }
            }
          } catch {}

          if (relRefs.length === 0 && !/using:\s*['"]?composite['"]?/i.test(manifestContent)) {
            const matches = manifestContent.matchAll(
              /(?:image|main|pre|post|entrypoint|pre-entrypoint|post-entrypoint):\s*(?:['"]([^'"\r\n]+)['"]|([^\s\r\n,}]+))/gi,
            );
            for (const m of matches) {
              const val = (m[1] ?? m[2])?.replace(/[,}]+$/, '').trim();
              if (val) {
                relRefs.push(val);
              }
            }
          }

          for (const relRef of relRefs) {
            if (relRef.startsWith('docker://')) {
              continue;
            }
            const resolvedPath = join(actDir, relRef).replace(/\\/g, '/');
            const refEntry = byPath.get(resolvedPath);
            if (refEntry) {
              actionReferencedEntries.set(refEntry.path, refEntry);
            }
          }
        }
        for (const refEntry of actionReferencedEntries.values()) {
          let currentEntry = refEntry;
          const visitedPaths = new Set<string>();
          while (currentEntry.mode === '120000') {
            if (visitedPaths.has(currentEntry.path)) {
              throw new Error(`Circular symlink detected in action dependency '${currentEntry.path}'.`);
            }
            visitedPaths.add(currentEntry.path);
            const linkTarget = readBlobBySha(currentEntry).toString('utf-8').trim();
            const resolvedTarget = join(dirname(currentEntry.path), linkTarget).replace(/\\/g, '/');
            const sibling = byPath.get(resolvedTarget);
            if (!sibling) {
              throw new Error(
                `Dangling symlink in action dependency '${currentEntry.path}': target '${resolvedTarget}' does not exist in git index.`,
              );
            }
            currentEntry = sibling;
          }
          const blob = readBlobBySha(currentEntry);
          const targetPath = join(tmpRoot, refEntry.path);
          try {
            mkdirSync(dirname(targetPath), { recursive: true });
            writeFileSync(targetPath, blob);
          } catch (writeErr) {
            throw new Error(
              `Failed to write staged action dependency '${refEntry.path}': ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
            );
          }
        }
      }
      for (const entry of indexedConfigEntries) {
        const linkTarget = entry.mode === '120000' ? readBlobBySha(entry).toString('utf-8') : undefined;
        const sibling =
          linkTarget === undefined ? undefined : byPath.get(join(dirname(entry.path), linkTarget).replace(/\\/g, '/'));
        const blob = readBlobBySha(sibling !== undefined && sibling.mode !== '120000' ? sibling : entry);
        const targetPath = join(tmpRoot, entry.path);
        try {
          mkdirSync(dirname(targetPath), { recursive: true });
          writeFileSync(targetPath, blob);
        } catch (writeErr) {
          throw new Error(
            `Failed to write staged actionlint config file '${entry.path}': ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
          );
        }
      }
    } else if (existsSync('.github/actions')) {
      const destActions = join(tmpRoot, '.github', 'actions');
      mkdirSync(destActions, { recursive: true });
      cpSync(resolve('.github/actions'), destActions, { recursive: true });
    }

    if (isGitRepo && indexedWorkflowEntries.length > 0) {
      for (const entry of indexedWorkflowEntries) {
        const blob = readBlobBySha(entry);
        const baseName = entry.path.split('/').pop()!;
        writeFileSync(join(tmpSnapshotDir, baseName), blob);
      }
    } else if (existsSync(workflowDir)) {
      const diskFiles = readdirSync(workflowDir).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
      for (const file of diskFiles) {
        copyFileSync(join(workflowDir, file), join(tmpSnapshotDir, file));
      }
    }

    if (isGitRepo) {
      // Re-create staged symlinks after regular files are written, verifying targets resolve within the temporary mirror (Thread #9 & #15)
      for (const entry of byPath.values()) {
        if (entry.mode === '120000') {
          const linkTarget = readBlobBySha(entry).toString('utf-8').trim();
          const targetPath = join(tmpRoot, entry.path);
          const resolvedTarget = resolve(dirname(targetPath), linkTarget);
          const relToRoot = relative(tmpRoot, resolvedTarget);
          if (!relToRoot.startsWith('..') && !isAbsolute(relToRoot) && existsSync(resolvedTarget)) {
            try {
              mkdirSync(dirname(targetPath), { recursive: true });
              symlinkSync(linkTarget, targetPath);
            } catch {}
          }
        }
      }
    }
    return tmpSnapshotDir;
  } catch (err) {
    rmSync(tmpRoot, { recursive: true, force: true });
    throw err;
  }
}

/** Validates embedded bash run scripts in workflow files using native shellcheck. */
export async function validateWorkflowScripts(
  workflowDir = '.github/workflows',
  checker?: (script: string, dialect: 'sh' | 'bash') => Promise<{ ok: boolean; error?: string }>,
): Promise<{ ok: boolean; errors: string[] }> {
  if (!existsSync(workflowDir) || (!checker && Bun.which('shellcheck') === null)) {
    return { ok: true, errors: [] };
  }
  const errors: string[] = [];
  const files = readdirSync(workflowDir)
    .filter((f: string): boolean => f.endsWith('.yml') || f.endsWith('.yaml'))
    .sort();

  for (const file of files) {
    const fullPath = join(workflowDir, file);
    const content = readFileSync(fullPath, 'utf-8');
    if (typeof (Bun as { YAML?: { parse?: (s: string) => unknown } }).YAML?.parse !== 'function') {
      console.warn(
        `::warning:: Bun.YAML.parse is unavailable in Bun ${Bun.version}; skipping workflow script shellcheck validation.`,
      );
      break;
    }
    let parsed: unknown;
    try {
      parsed = Bun.YAML.parse(content);
    } catch (e) {
      errors.push(`[${file}] Failed to parse YAML: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }

    if (!parsed || typeof parsed !== 'object') {
      continue;
    }
    const parsedObj = parsed as Record<string, unknown>;
    const jobs = parsedObj.jobs;
    if (!jobs || typeof jobs !== 'object') {
      continue;
    }

    const getShellString = (val: unknown, location: string): string | undefined => {
      if (val === undefined || val === null) {
        return undefined;
      }
      if (typeof val === 'string') {
        return val;
      }
      errors.push(`[${file}] Malformed shell option at ${location}: expected string, got ${typeof val}`);
      return undefined;
    };

    const workflowDefaults =
      parsedObj.defaults && typeof parsedObj.defaults === 'object'
        ? (parsedObj.defaults as Record<string, unknown>)
        : undefined;
    const workflowRun =
      workflowDefaults?.run && typeof workflowDefaults.run === 'object'
        ? (workflowDefaults.run as Record<string, unknown>)
        : undefined;
    const workflowShell = getShellString(workflowRun?.shell, 'defaults.run.shell');

    for (const [jobId, rawJob] of Object.entries(jobs as Record<string, unknown>)) {
      if (!rawJob || typeof rawJob !== 'object') {
        continue;
      }
      const job = rawJob as Record<string, unknown>;
      const jobDefaults =
        job.defaults && typeof job.defaults === 'object' ? (job.defaults as Record<string, unknown>) : undefined;
      const jobRun =
        jobDefaults?.run && typeof jobDefaults.run === 'object'
          ? (jobDefaults.run as Record<string, unknown>)
          : undefined;
      const jobShellRaw = getShellString(jobRun?.shell, `job '${jobId}' defaults.run.shell`) || workflowShell;
      let jobShell = jobShellRaw;
      if (jobShell && jobShell.includes('${{')) {
        const resolved = resolveStaticMatrixExpression(jobShell, job.strategy);
        if (resolved !== undefined) {
          jobShell = resolved;
        }
      }

      const shellDiagnostics: string[] = [];
      const defaultShell = getRunnerDefaultShell(job['runs-on'], job.strategy, job.container, shellDiagnostics);
      const steps = Array.isArray(job.steps) ? job.steps : [];
      let reportedShellDiag = false;

      for (let i = 0; i < steps.length; i++) {
        const rawStep = steps[i];
        if (!rawStep || typeof rawStep !== 'object') {
          continue;
        }
        const step = rawStep as Record<string, unknown>;
        if (typeof step.run !== 'string') {
          continue;
        }

        const stepShell = getShellString(step.shell, `step ${i + 1} (${jobId})`);
        const rawShell = (stepShell || jobShell || '').trim();
        if (!rawShell && shellDiagnostics.length > 0 && !reportedShellDiag) {
          for (const diag of shellDiagnostics) {
            errors.push(`[${file}] Job '${jobId}': ${diag}`);
          }
          reportedShellDiag = true;
        }
        let stepDefaultShell = defaultShell;
        if (!stepShell && !jobShell && typeof step.if === 'string') {
          const ifCond = step.if.trim();
          const hasWindowsCondition =
            /runner\.os\s*==\s*['"]Windows['"]/i.test(ifCond) &&
            !/runner\.os\s*!=\s*['"]Windows['"]/i.test(ifCond) &&
            !/!\s*\(?runner\.os\s*==\s*['"]Windows['"]\)?/i.test(ifCond) &&
            !/runner\.os\s*==\s*['"](Linux|macOS)['"]/i.test(ifCond);
          const allowsNonWindows = /\|\|/i.test(ifCond);
          if (hasWindowsCondition && !allowsNonWindows) {
            stepDefaultShell = 'pwsh';
          }
        }
        const effectiveShell = (stepShell || jobShell || stepDefaultShell).trim();
        const rawToken = effectiveShell.split(/\s+/)[0] || '';
        const shellBinary = basename(rawToken).toLowerCase();

        // Skip steps with non-shell interpreters (e.g. python, node, pwsh)
        const isBash = shellBinary === 'bash';
        const isSh = shellBinary === 'sh';
        if (!isBash && !isSh) {
          continue;
        }

        const dialect = isSh ? 'sh' : 'bash';
        const script = step.run;
        if (!script.trim()) {
          continue;
        }

        // Mask GitHub Actions expressions ${{ ... }} with dummy identifier in a quote-aware manner
        let masked: string;
        try {
          masked = maskGitHubExpressions(script);
        } catch (e) {
          const stepLabel = step.name || step.id || `step ${i + 1}`;
          errors.push(`[${file}: job '${jobId}', ${stepLabel}] ${e instanceof Error ? e.message : String(e)}`);
          continue;
        }

        // Prepend shell-option setup for built-in/default shells enabling workflow execution options (e.g. errexit)
        const isBuiltinBash = rawShell === 'bash' || (!rawShell && isBash);
        const isBuiltinSh = rawShell === 'sh' || (!rawShell && isSh);
        let prefix = '';
        if (rawShell === 'bash') {
          prefix = 'set -eo pipefail\n';
        } else if (isBuiltinBash || isBuiltinSh) {
          prefix = 'set -e\n';
        } else if (rawShell) {
          const opts = getShellOptions(rawShell);
          if (opts.errexit && opts.pipefail) {
            prefix = 'set -eo pipefail\n';
          } else if (opts.errexit) {
            prefix = 'set -e\n';
          } else if (opts.pipefail) {
            prefix = 'set -o pipefail\n';
          }
        }

        let toCheck = masked;
        if (prefix) {
          toCheck = insertSetupAfterLeadingComments(toCheck, prefix);
        }

        if (checker) {
          const checkRes = await checker(toCheck, dialect);
          if (!checkRes.ok) {
            errors.push(`[${file}] Step ${i + 1} (${jobId}): ${checkRes.error || 'ShellCheck validation failed'}`);
          }
          continue;
        }

        const proc = Bun.spawn(
          [
            'shellcheck',
            '--norc',
            '-s',
            dialect,
            '-e',
            'SC2296,SC1083,SC2153,SC2154,SC2050,SC1091,SC2157,SC2043,SC2194',
            '-',
          ],
          {
            stdin: 'pipe',
            stdout: 'pipe',
            stderr: 'pipe',
          },
        );
        proc.stdin.write(toCheck);
        await proc.stdin.end();

        const [stdout, stderr] = await Promise.all([
          new Response(proc.stdout).text(),
          new Response(proc.stderr).text(),
        ]);
        const exitCode = await proc.exited;

        if (exitCode !== 0) {
          const combined =
            [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') || `shellcheck exited with code ${exitCode}`;
          const stepLabel = step.name || step.id || `step ${i + 1}`;
          errors.push(`[${file}: job '${jobId}', ${stepLabel}]\n${combined}`);
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Runs the pre-commit hook validation pipeline using Bun-native tools.
 *
 * @param options - Optional configuration overriding stages.
 * @returns Resolves with true if all pre-commit checks pass, false otherwise.
 */
export async function runPreCommitHook(options?: PreCommitOptions): Promise<boolean> {
  ensurePrefixPath();

  try {
    if (!options?.quiet) {
      console.log('🔍 Running RepoExe pre-commit verification...');
    }

    // 1. Stage and format via native Bun formatter
    if (!options?.skipFormat) {
      if (!options?.quiet) {
        console.log('🎨 Formatting staged files via bun fmt --staged...');
      }
      await $`bun fmt --staged`.quiet();
    }

    // 2. Incremental TypeScript type check via native bun check
    if (!options?.skipTypeCheck) {
      if (!options?.quiet) {
        console.log('⚡ Running incremental type check via bun check...');
      }
      const checkTypes = await $`bun check`.nothrow().quiet();
      if (checkTypes.exitCode !== 0) {
        console.error(
          `=== Type Check Failed (Exit: ${checkTypes.exitCode}) ===\n${checkTypes.stdout}${checkTypes.stderr}`,
        );
        console.error('\n❌ Pre-commit type checks failed.');
        return false;
      }
    }

    // 3. Fast linting via Oxlint
    if (!options?.skipLint) {
      if (!options?.quiet) {
        console.log('📋 Linting via oxlint...');
      }
      const lintRes = await $`bunx oxlint`.nothrow().quiet();
      if (lintRes.exitCode !== 0) {
        console.error(`=== Oxlint Check Failed (Exit: ${lintRes.exitCode}) ===\n${lintRes.stdout}${lintRes.stderr}`);
        console.error('\n❌ Pre-commit lint checks failed.');
        return false;
      }
    }

    // 4. RepoExe orchestrator health check
    if (!options?.skipHealthCheck) {
      if (!options?.quiet) {
        console.log('🏥 Running RepoExe build system & recipe health check...');
      }
      const checkResult = await $`bun scripts/cli/build.ts check`.nothrow();
      if (checkResult.exitCode !== 0) {
        console.error(
          `=== Health Check Failed (Exit: ${checkResult.exitCode}) ===\n${checkResult.stdout}${checkResult.stderr}`,
        );
        console.error('\n❌ Health check failed.');
        return false;
      }
    }

    // 5. GitHub Actions workflow validation via actionlint
    if (!options?.skipActionlint) {
      const isTermux = Boolean(process.env.TERMUX_VERSION) || (process.env.PREFIX || '').includes('com.termux');
      const localActionlint = join(homedir(), '.local', 'bin', 'actionlint');
      let actionlintBin: string | null = null;
      let isLocalExec = false;
      if (existsSync(localActionlint)) {
        try {
          if (statSync(localActionlint).isFile()) {
            accessSync(localActionlint, constants.X_OK);
            isLocalExec = true;
          }
        } catch {}
      }
      if (isLocalExec) {
        actionlintBin = localActionlint;
      } else {
        actionlintBin = Bun.which('actionlint');
      }

      const hasShellcheck = Bun.which('shellcheck') !== null;
      const willRunWorkflows = Boolean(actionlintBin || (isTermux && hasShellcheck));

      if (willRunWorkflows) {
        const stagedWorkflowDir = getStagedWorkflowsSnapshot('.github/workflows');
        try {
          if (actionlintBin) {
            if (!options?.quiet) {
              console.log('🐙 Validating GitHub Actions workflows via actionlint...');
            }
            const tmpRoot =
              basename(dirname(stagedWorkflowDir)) === '.github'
                ? dirname(dirname(stagedWorkflowDir))
                : dirname(stagedWorkflowDir);
            const workflowFiles = existsSync(stagedWorkflowDir)
              ? readdirSync(stagedWorkflowDir)
                  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
                  .map((f) => relative(tmpRoot, join(stagedWorkflowDir, f)))
              : [];

            if (workflowFiles.length > 0) {
              const args = isTermux ? ['-shellcheck=', ...workflowFiles] : workflowFiles;
              const res = await $`${actionlintBin} ${args}`.cwd(tmpRoot).nothrow().quiet();

              if (res.exitCode !== 0) {
                console.error(`=== Actionlint Check Failed (Exit: ${res.exitCode}) ===\n${res.stdout}${res.stderr}`);
                console.error('\n❌ Workflow checks failed.');
                return false;
              }
            }
          }

          // On Termux, actionlint requires -shellcheck="" to prevent SIGSYS (faccessat2) crashes.
          // Validate embedded workflow scripts via native Termux shellcheck for parity with CI.
          // Always run on Termux even when actionlint is absent, as long as shellcheck is available.
          if (isTermux && hasShellcheck) {
            const scRes = await validateWorkflowScripts(stagedWorkflowDir);
            if (!scRes.ok) {
              console.error(`=== Workflow Shellcheck Failed ===\n${scRes.errors.join('\n\n')}`);
              console.error('\n❌ Workflow shellcheck checks failed.');
              return false;
            }
          }
        } finally {
          if (stagedWorkflowDir !== '.github/workflows' && existsSync(stagedWorkflowDir)) {
            const tmpRoot =
              basename(dirname(stagedWorkflowDir)) === '.github'
                ? dirname(dirname(stagedWorkflowDir))
                : dirname(stagedWorkflowDir);
            rmSync(tmpRoot, { recursive: true, force: true });
          }
        }
      }
    }

    // 6. Unit test suite execution
    if (!options?.skipTests) {
      if (!options?.quiet) {
        console.log('🧪 Running Bun unit test suite...');
      }
      const testResult = await $`bun test --parallel`.nothrow();
      if (testResult.exitCode !== 0) {
        console.error(
          `=== Unit Tests Failed (Exit: ${testResult.exitCode}) ===\n${testResult.stdout}${testResult.stderr}`,
        );
        console.error('\n❌ Unit test suite failed.');
        return false;
      }
    }

    if (!options?.quiet) {
      console.log('✨ All RepoExe pre-commit checks passed!');
    }
    return true;
  } catch (error) {
    console.error('Pre-commit hook exception:', error);
    return false;
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const options: PreCommitOptions = {
    skipFormat: args.includes('--skip-format'),
    skipTypeCheck: args.includes('--skip-type-check'),
    skipLint: args.includes('--skip-lint'),
    skipHealthCheck: args.includes('--skip-check'),
    skipActionlint: args.includes('--skip-actionlint'),
    skipTests: args.includes('--skip-tests'),
  };

  const success = await runPreCommitHook(options);
  if (!success) {
    process.exit(1);
  }
}
