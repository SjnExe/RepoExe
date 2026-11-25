import { spawnSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';

export function maskGitHubExpressions(script: string): string {
  let result = '';
  let i = 0;
  const placeholderMap = new Map<string, string>();
  const observedHeredocDelimiters = new Set<string>();

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
      const tail = result.slice(Math.max(0, result.length - 200));
      const statusArgMatch = tail.match(
        /(?:(?:^|[\r\n]|[;&|{(])\s*|\b(?:then|do|else)\s+)(?:exit|return)(?:[ \t]*(?<!\\)(?:\\\\)*\\(?:\r\n|\r|\n)[ \t]*|[ \t]+)+(['"]?)$/,
      );
      const openingQuote = statusArgMatch?.[1] ?? '';
      const isWholeStatusArg =
        Boolean(statusArgMatch) &&
        (openingQuote
          ? script[j] === openingQuote
          : j >= script.length || /[\s;&|)><]/.test(script[j]));
      const literalMatch = exprBody.match(/^'([^']*)'$|^"([^"]*)"$/);
      const literalVal = literalMatch ? (literalMatch[1] ?? literalMatch[2]) : undefined;
      const isLineStart = /(?:^|[\r\n])[ \t]*$/.test(tail);
      const isLineEnd = j >= script.length || /^[\r\n]/.test(script.slice(j));
      const heredocQuoteMatch = tail.match(/<<-?\s*(['"])$/);
      const heredocQuote = heredocQuoteMatch?.[1];
      const hasMatchingQuote = Boolean(heredocQuote && script[j] === heredocQuote);
      const isDirectHeredocOpener = /<<-?\s*$/.test(tail);
      const isQuotedHeredocSafe =
        literalVal !== undefined && literalVal.length > 0 && !/[\r\n]/.test(literalVal);
      const isUnquotedHeredocSafe =
        literalVal !== undefined && /^[a-zA-Z0-9_.:-]+$/.test(literalVal);
      const isHeredocDelimiter =
        (isLineStart &&
          isLineEnd &&
          literalVal !== undefined &&
          observedHeredocDelimiters.has(literalVal)) ||
        (isDirectHeredocOpener && isUnquotedHeredocSafe) ||
        (hasMatchingQuote && isQuotedHeredocSafe);

      if (isHeredocDelimiter) {
        observedHeredocDelimiters.add(literalVal);
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
      if (script.startsWith('<<', i)) {
        const quotedHMatch = script.slice(i).match(/^<<-?\s*(['"])([^\r\n]+?)\1/);
        const unquotedHMatch = quotedHMatch
          ? null
          : script.slice(i).match(/^<<-?\s*([a-zA-Z0-9_.:-]+)/);
        const delim = quotedHMatch?.[2] ?? unquotedHMatch?.[1];
        if (delim) {
          observedHeredocDelimiters.add(delim);
        }
      }
      result += script[i];
      i++;
    }
  }
  return result;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function deepEqualMatrixValue(a: unknown, b: unknown): boolean {
  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) {
      return false;
    }
    return keysA.every((kA) => {
      const matchBKey = keysB.find((kB) => kB.toLowerCase() === kA.toLowerCase());
      return matchBKey !== undefined && deepEqualMatrixValue(a[kA], b[matchBKey]);
    });
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
    return Object.entries(exVal).every(([k, v]) => {
      const kLower = k.toLowerCase();
      const matchRowKey = Object.keys(rowVal).find((rk) => rk.toLowerCase() === kLower);
      return matchRowKey !== undefined && excludeMatrixValueMatches(rowVal[matchRowKey], v);
    });
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
    if (val.includes('${{')) {
      return false;
    }
    const clean = val.trim().toLowerCase();
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
  if (runsOn && typeof runsOn === 'object' && !Array.isArray(runsOn)) {
    const rObj = runsOn as Record<string, unknown>;
    const lKey = Object.keys(rObj).find((k) => k.toLowerCase() === 'labels');
    const labels = lKey !== undefined ? rObj[lKey] : undefined;
    if (typeof labels === 'string') {
      return hasLiteralWindows(labels);
    }
    if (Array.isArray(labels)) {
      return labels.some((r) => typeof r === 'string' && hasLiteralWindows(r));
    }
  }
  return false;
}

export function parseMatrixPathExpression(pathExpr: string): string[] {
  const norm = pathExpr.startsWith('.') || pathExpr.startsWith('[') ? pathExpr : `.${pathExpr}`;
  const segments: string[] = [];
  const regex = /\.(?<prop>[a-zA-Z0-9_-]+)|\[(?:['"](?<quoted>[^'"]+)['"]|(?<index>\d+))\]/g;
  let lastIndex = 0;
  for (const match of norm.matchAll(regex)) {
    if (match.index !== lastIndex) {
      return [];
    }
    lastIndex = match.index + match[0].length;
    const val = match.groups?.prop ?? match.groups?.quoted ?? match.groups?.index;
    if (val !== undefined) {
      segments.push(val);
    }
  }
  if (lastIndex !== norm.length) {
    return [];
  }
  return segments;
}

const MATRIX_SEGMENT_PATTERN = `(?:\\.[a-zA-Z0-9_-]+|\\[(?:['"][^'"]+['"]|\\d+)\\])`;
const MATRIX_REF_REGEX = new RegExp(`^\\$\\{\\{\\s*matrix(${MATRIX_SEGMENT_PATTERN}+)\\s*\\}\\}$`);
export const MATRIX_SCAN_REGEX = new RegExp(
  `\\$\\{\\{\\s*matrix(${MATRIX_SEGMENT_PATTERN}+)\\s*\\}\\}`,
  'g',
);

export function parseMatrixReference(expr: string): string[] | undefined {
  const match = expr.match(MATRIX_REF_REGEX);
  if (!match) {
    return undefined;
  }
  const segments = parseMatrixPathExpression(match[1]);
  return segments.length > 0 ? segments : undefined;
}

export function resolveStaticMatrixExpression(expr: string, strategy: unknown): string | undefined {
  if (!strategy || typeof strategy !== 'object') {
    return undefined;
  }
  const matrix = (strategy as Record<string, unknown>).matrix;
  if (!matrix || typeof matrix !== 'object') {
    return undefined;
  }
  const segments = parseMatrixReference(expr);
  if (!segments) {
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
        const foundKey = Object.keys(curr as Record<string, unknown>).find(
          (k) => k.toLowerCase() === lowerP,
        );
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
    const rows: unknown[] = axis;
    if (rows.length === 0) {
      return '';
    }
    const resolvedValues = rows.map((row): unknown =>
      remaining.length > 0 ? resolvePath(row, remaining) : row,
    );
    const stringValues = resolvedValues.map((v): string =>
      v === null || v === undefined ? '' : String(v),
    );
    const first = stringValues[0];
    if (stringValues.every((v): boolean => v === first)) {
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

function expandMatrixRows(
  strategy: unknown,
  diagnostics?: string[],
): Array<Record<string, unknown>> | null {
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
      return Object.entries(ex).every(([k, v]) => {
        let matchedKey: string | undefined;
        if (Object.prototype.hasOwnProperty.call(comb, k)) {
          matchedKey = k;
        } else {
          const kLower = k.toLowerCase();
          matchedKey = Object.keys(comb).find((ck) => ck.toLowerCase() === kLower);
        }
        return (
          matchedKey !== undefined &&
          Object.prototype.hasOwnProperty.call(comb, matchedKey) &&
          excludeMatrixValueMatches(comb[matchedKey], v)
        );
      });
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
  const include: unknown[] = Array.isArray(matrixObj.include)
    ? (matrixObj.include as unknown[])
    : [];
  for (const inc of include) {
    if (isPlainObject(inc)) {
      let matched = false;
      for (const entry of baseEntries) {
        const isMatch: boolean = Object.entries(inc).every(([k, v]): boolean => {
          const kLower = k.toLowerCase();
          const origKey = Object.keys(entry.original).find((ok) => ok.toLowerCase() === kLower);
          return origKey === undefined || deepEqualMatrixValue(entry.original[origKey], v);
        });
        if (isMatch) {
          for (const [incK, incV] of Object.entries(inc)) {
            const incKLower = incK.toLowerCase();
            const existingKey = Object.keys(entry.current).find(
              (ck) => ck.toLowerCase() === incKLower,
            );
            if (existingKey !== undefined && existingKey !== incK) {
              delete entry.current[existingKey];
            }
            entry.current[incK] = incV;
          }
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

function evalMatrixConditionClause(
  clause: string,
  row: Record<string, unknown>,
): boolean | undefined {
  let c = clause.trim();
  if (c.startsWith('${{') && c.endsWith('}}')) {
    c = c.slice(3, -2).trim();
  }
  c = c.replace(MATRIX_SCAN_REGEX, (_match: string, path: string): string => {
    const segs = parseMatrixPathExpression(path);
    if (segs.length === 0) {
      return _match;
    }
    const v = resolveMatrixPath(row, segs);
    if (v === undefined || v === null) {
      return "''";
    }
    return typeof v === 'string' ? `'${v.replace(/'/g, "\\'")}'` : String(v);
  });

  const resolveOperand = (
    quotedSingle: string | undefined,
    quotedDouble: string | undefined,
    bare: string | undefined,
  ): { known: boolean; value: string } => {
    if (quotedSingle !== undefined) {
      return { known: true, value: quotedSingle };
    }
    if (quotedDouble !== undefined) {
      return { known: true, value: quotedDouble };
    }
    if (bare === undefined) {
      return { known: false, value: '' };
    }
    if (bare.startsWith('matrix.') || bare.startsWith('matrix[')) {
      const segs = parseMatrixPathExpression(bare.slice('matrix'.length));
      if (segs.length > 0) {
        const v = resolveMatrixPath(row, segs);
        return { known: true, value: v === undefined || v === null ? '' : String(v) };
      }
      return { known: false, value: '' };
    }
    if (/^(?:true|false|-?\d+(?:\.\d+)?)$/i.test(bare)) {
      return { known: true, value: bare };
    }
    return { known: false, value: '' };
  };

  const eqMatch = c.match(
    /^\s*(?:'([^']*)'|"([^"]*)"|(\S+))\s*(==|!=)\s*(?:'([^']*)'|"([^"]*)"|(\S+))\s*$/,
  );
  if (eqMatch) {
    const left = resolveOperand(eqMatch[1], eqMatch[2], eqMatch[3]);
    const right = resolveOperand(eqMatch[5], eqMatch[6], eqMatch[7]);
    if (!left.known || !right.known) {
      return undefined;
    }
    const isEqual = left.value.toLowerCase() === right.value.toLowerCase();
    return eqMatch[4] === '==' ? isEqual : !isEqual;
  }

  // Bare matrix boolean/truthy check (e.g. `matrix.use_container` or `!matrix.skip`)
  const neg = c.startsWith('!');
  const bareExpr = (neg ? c.slice(1) : c).trim();
  if (bareExpr.startsWith('matrix.') || bareExpr.startsWith('matrix[')) {
    const segs = parseMatrixPathExpression(bareExpr.slice('matrix'.length));
    if (segs.length > 0) {
      const v = resolveMatrixPath(row, segs);
      const truthy = Boolean(v) && v !== 'false';
      return neg ? !truthy : truthy;
    }
  }
  return undefined;
}

function evalContainerExprForRow(expr: string, row: Record<string, unknown>): string | undefined {
  let inner = expr.trim();
  if (inner.startsWith('${{') && inner.endsWith('}}')) {
    inner = inner.slice(3, -2).trim();
  } else if (inner.includes('${{')) {
    let allResolved = true;
    const substituted = inner.replace(MATRIX_SCAN_REGEX, (_match: string, path: string): string => {
      const segs = parseMatrixPathExpression(path);
      if (segs.length === 0) {
        allResolved = false;
        return '';
      }
      const v = resolveMatrixPath(row, segs);
      return v !== undefined && v !== null ? String(v) : '';
    });
    if (!allResolved || substituted.includes('${{')) {
      return undefined;
    }
    return substituted;
  }

  const ternMatch = inner.match(
    /^(.+?)\s*&&\s*(?:'([^']*)'|"([^"]*)")\s*\|\|\s*(?:'([^']*)'|"([^"]*)")$/,
  );
  if (ternMatch) {
    const condVal = evalMatrixConditionClause(ternMatch[1], row);
    if (condVal === undefined) {
      return undefined;
    }
    const trueStr = ternMatch[2] ?? ternMatch[3] ?? '';
    const falseStr = ternMatch[4] ?? ternMatch[5] ?? '';
    return condVal ? trueStr : falseStr;
  }

  if (inner.startsWith('matrix.') || inner.startsWith('matrix[')) {
    const segs = parseMatrixPathExpression(inner.slice('matrix'.length));
    if (segs.length > 0) {
      const v = resolveMatrixPath(row, segs);
      return v !== undefined && v !== null ? String(v) : '';
    }
  }
  return undefined;
}

function hasContainer(
  container: unknown,
  strategy?: unknown,
  eligibleRows?: Array<Record<string, unknown>>,
): boolean {
  if (typeof container === 'string') {
    const trimmed = container.trim();
    if (!trimmed) {
      return false;
    }
    if (trimmed.includes('${{')) {
      const survivingRows = eligibleRows || expandMatrixRows(strategy);
      if (survivingRows && survivingRows.length > 0) {
        const hasAny = survivingRows.some((row): boolean => {
          const resolved = evalContainerExprForRow(trimmed, row);
          return resolved !== undefined && resolved.trim().length > 0;
        });
        return hasAny;
      }
      const resolved = resolveStaticMatrixExpression(trimmed, strategy);
      if (resolved !== undefined) {
        return resolved.trim().length > 0;
      }
      return false;
    }
    return true;
  }
  if (container && typeof container === 'object') {
    const img = (container as Record<string, unknown>).image;
    if (img !== undefined) {
      return hasContainer(img, strategy, eligibleRows);
    }
    return true;
  }
  return false;
}

function splitTopLevelAnd(expr: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < expr.length; i++) {
    const ch = expr[i];
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (!inSingle && !inDouble && ch === '&' && expr[i + 1] === '&') {
      parts.push(cur.trim());
      cur = '';
      i++;
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) {
    parts.push(cur.trim());
  }
  return parts;
}

function getStepEligibleRows(
  stepIf: string | undefined,
  survivingRows: Array<Record<string, unknown>> | null,
): Array<Record<string, unknown>> | undefined {
  if (!survivingRows || survivingRows.length === 0 || !stepIf) {
    return survivingRows ?? undefined;
  }
  let cond = stepIf.trim();
  if (cond.startsWith('${{') && cond.endsWith('}}')) {
    cond = cond.slice(3, -2).trim();
  }
  const clauses = splitTopLevelAnd(cond);
  const filtered = survivingRows.filter((row): boolean => {
    for (const clause of clauses) {
      const res = evalMatrixConditionClause(clause, row);
      if (res === false) {
        return false;
      }
    }
    return true;
  });
  return filtered;
}

function isLinuxRunnerLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  return (
    l === 'linux' ||
    l === 'ubuntu' ||
    /^ubuntu-(latest|slim|\d+.*)$/.test(l) ||
    l === 'macos' ||
    /^macos-(latest(-large|-xlarge)?|\d+.*)$/.test(l) ||
    l === 'xcode-27' ||
    l === 'debian' ||
    /^debian-(latest|\d+.*)$/.test(l) ||
    l === 'alpine' ||
    /^alpine-(latest|\d+.*)$/.test(l)
  );
}

function isWindowsRunnerLabel(label: string): boolean {
  const l = label.trim().toLowerCase();
  return l === 'windows' || /^windows-(latest|\d+.*)$/.test(l);
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
      ? (() => {
          const rObj = runsOn as Record<string, unknown>;
          const lKey = Object.keys(rObj).find((k) => k.toLowerCase() === 'labels');
          return lKey !== undefined ? rObj[lKey] : undefined;
        })()
      : runsOn;
  const runsOnStr =
    typeof rawLabels === 'string' ? rawLabels : Array.isArray(rawLabels) ? rawLabels.join(' ') : '';
  const isExpression = runsOnStr.includes('${{');

  if (isExpression) {
    if (strategy && typeof strategy === 'object') {
      const matrix = (strategy as Record<string, unknown>).matrix;
      if (matrix && typeof matrix === 'object') {
        const referencedPaths: string[][] = [...runsOnStr.matchAll(MATRIX_SCAN_REGEX)]
          .map((m): string[] => parseMatrixPathExpression(m[1]))
          .filter((segments: string[]): boolean => segments.length > 0);
        if (referencedPaths.length > 0) {
          const expanded = expandMatrixRows(strategy, diagnostics);
          if (expanded === null) {
            return 'unknown';
          }
          const combinations = expanded;

          const labelTemplates: string[] = Array.isArray(rawLabels)
            ? rawLabels.map((l: unknown): string => (typeof l === 'string' ? l : String(l)))
            : typeof rawLabels === 'string'
              ? [rawLabels]
              : [];

          const renderLabelForComb = (tmpl: string, comb: Record<string, unknown>): string[] => {
            const wholeSegments = parseMatrixReference(tmpl.trim());
            if (wholeSegments) {
              const resolved = resolveMatrixPath(comb, wholeSegments);
              if (Array.isArray(resolved)) {
                return resolved.map(String);
              }
              if (
                typeof resolved === 'string' ||
                typeof resolved === 'number' ||
                typeof resolved === 'boolean'
              ) {
                return [String(resolved)];
              }
              return [];
            }
            const rendered = tmpl.replace(
              MATRIX_SCAN_REGEX,
              (_fullMatch: string, pathExpr: string): string => {
                const segments = parseMatrixPathExpression(pathExpr);
                const resolved = resolveMatrixPath(comb, segments);
                if (
                  typeof resolved === 'string' ||
                  typeof resolved === 'number' ||
                  typeof resolved === 'boolean'
                ) {
                  return String(resolved);
                }
                return '';
              },
            );
            return [rendered];
          };

          let anyRowLinux = false;
          let anyRowWindows = false;

          for (const comb of combinations) {
            const rowValues: string[] = [];
            for (const tmpl of labelTemplates) {
              rowValues.push(...renderLabelForComb(tmpl, comb));
            }
            const isRowLinux = rowValues.some((v) => isLinuxRunnerLabel(v));
            const isRowWindows = rowValues.some((v) => isWindowsRunnerLabel(v));
            if (isRowLinux) {
              anyRowLinux = true;
            } else if (isRowWindows) {
              anyRowWindows = true;
            }
          }
          if (anyRowLinux) {
            return 'bash';
          }
          if (anyRowWindows) {
            return 'pwsh';
          }
        }
      }
    }
    const labelItems: string[] = Array.isArray(rawLabels)
      ? rawLabels.flatMap((l: unknown): string[] => {
          const s = typeof l === 'string' ? l : String(l);
          return s.includes('${{') ? [s] : s.split(/[\s,]+/);
        })
      : runsOnStr.includes('${{')
        ? [runsOnStr]
        : runsOnStr.split(/[\s,]+/);

    for (const label of labelItems) {
      const trimmed = label.trim();
      if (trimmed && !trimmed.includes('${{')) {
        if (isLinuxRunnerLabel(trimmed)) {
          return 'bash';
        }
        if (isWindowsRunnerLabel(trimmed)) {
          return 'pwsh';
        }
      }
    }
    return 'unknown';
  }

  const rawTokens: string[] = Array.isArray(rawLabels)
    ? rawLabels.flatMap((l: unknown): string[] =>
        typeof l === 'string' ? l.split(/[\s,]+/) : [String(l)],
      )
    : runsOnStr.split(/[\s,]+/);

  for (const token of rawTokens) {
    const trimmed = token.trim();
    if (trimmed) {
      if (isLinuxRunnerLabel(trimmed)) {
        return 'bash';
      }
      if (isWindowsRunnerLabel(trimmed)) {
        return 'pwsh';
      }
    }
  }

  return 'unknown';
}

interface ActionExpressionToken {
  type: 'string' | 'paren_open' | 'paren_close' | 'and' | 'or' | 'not' | 'eq' | 'neq' | 'ident';
  value: string;
}

export function isStepWindowsOnlyCondition(rawCond: string): boolean {
  let cond = rawCond.trim();
  if (cond.startsWith('${{') && cond.endsWith('}}')) {
    cond = cond.slice(3, -2).trim();
  }
  if (!cond) {
    return false;
  }

  const tokens: ActionExpressionToken[] = [];
  let i = 0;
  while (i < cond.length) {
    const ch = cond[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "'") {
      let strVal = '';
      i++;
      while (i < cond.length) {
        if (cond[i] === "'") {
          if (i + 1 < cond.length && cond[i + 1] === "'") {
            strVal += "'";
            i += 2;
          } else {
            i++;
            break;
          }
        } else {
          strVal += cond[i];
          i++;
        }
      }
      tokens.push({ type: 'string', value: strVal });
      continue;
    }
    if (ch === '(') {
      tokens.push({ type: 'paren_open', value: '(' });
      i++;
      continue;
    }
    if (ch === ')') {
      tokens.push({ type: 'paren_close', value: ')' });
      i++;
      continue;
    }
    if (cond.startsWith('&&', i)) {
      tokens.push({ type: 'and', value: '&&' });
      i += 2;
      continue;
    }
    if (cond.startsWith('||', i)) {
      tokens.push({ type: 'or', value: '||' });
      i += 2;
      continue;
    }
    if (cond.startsWith('==', i)) {
      tokens.push({ type: 'eq', value: '==' });
      i += 2;
      continue;
    }
    if (cond.startsWith('!=', i)) {
      tokens.push({ type: 'neq', value: '!=' });
      i += 2;
      continue;
    }
    if (ch === '!') {
      tokens.push({ type: 'not', value: '!' });
      i++;
      continue;
    }
    const match = cond.slice(i).match(/^[a-zA-Z0-9_.-]+/);
    if (match) {
      tokens.push({ type: 'ident', value: match[0] });
      i += match[0].length;
      continue;
    }
    tokens.push({ type: 'ident', value: ch });
    i++;
  }

  if (tokens.length === 0) {
    return false;
  }

  const normalizedTokens: ActionExpressionToken[] = [];
  for (let idx = 0; idx < tokens.length; idx++) {
    if (
      tokens[idx].type === 'ident' &&
      tokens[idx].value.toLowerCase() === 'runner' &&
      idx + 3 < tokens.length &&
      tokens[idx + 1].value === '[' &&
      tokens[idx + 2].type === 'string' &&
      tokens[idx + 2].value.toLowerCase() === 'os' &&
      tokens[idx + 3].value === ']'
    ) {
      normalizedTokens.push({ type: 'ident', value: 'runner.os' });
      idx += 3;
    } else {
      normalizedTokens.push(tokens[idx]);
    }
  }

  const stripOuterParens = (toks: ActionExpressionToken[]): ActionExpressionToken[] => {
    let current = toks;
    while (
      current.length >= 2 &&
      current[0].type === 'paren_open' &&
      current[current.length - 1].type === 'paren_close'
    ) {
      let d = 0;
      let balanced = true;
      for (let idx = 0; idx < current.length - 1; idx++) {
        if (current[idx].type === 'paren_open') {
          d++;
        } else if (current[idx].type === 'paren_close') {
          d--;
        }
        if (d === 0) {
          balanced = false;
          break;
        }
      }
      if (balanced) {
        current = current.slice(1, -1);
      } else {
        break;
      }
    }
    return current;
  };

  const evaluateConditionRequiresWindows = (toks: ActionExpressionToken[]): boolean => {
    const current = stripOuterParens(toks);
    if (current.length === 0) {
      return false;
    }

    // 1. Check for top-level OR (||) at depth 0:
    // C1 || C2 || ... requires Windows iff EVERY branch requires Windows
    const orBranches: ActionExpressionToken[][] = [];
    let branch: ActionExpressionToken[] = [];
    let depth = 0;
    for (const tok of current) {
      if (tok.type === 'paren_open' || (tok.type === 'ident' && tok.value === '[')) {
        depth++;
        branch.push(tok);
      } else if (tok.type === 'paren_close' || (tok.type === 'ident' && tok.value === ']')) {
        depth--;
        branch.push(tok);
      } else if (tok.type === 'or' && depth === 0) {
        orBranches.push(branch);
        branch = [];
      } else {
        branch.push(tok);
      }
    }
    orBranches.push(branch);

    if (orBranches.length > 1) {
      return orBranches.every((b) => evaluateConditionRequiresWindows(b));
    }

    // 2. Check for top-level AND (&&) at depth 0:
    // C1 && C2 && ... requires Windows if AT LEAST ONE branch requires Windows
    const andBranches: ActionExpressionToken[][] = [];
    branch = [];
    depth = 0;
    for (const tok of current) {
      if (tok.type === 'paren_open' || (tok.type === 'ident' && tok.value === '[')) {
        depth++;
        branch.push(tok);
      } else if (tok.type === 'paren_close' || (tok.type === 'ident' && tok.value === ']')) {
        depth--;
        branch.push(tok);
      } else if (tok.type === 'and' && depth === 0) {
        andBranches.push(branch);
        branch = [];
      } else {
        branch.push(tok);
      }
    }
    andBranches.push(branch);

    if (andBranches.length > 1) {
      return andBranches.some((b) => evaluateConditionRequiresWindows(b));
    }

    // 3. Check for leading NOT (!)
    if (current[0].type === 'not') {
      const rest = current.slice(1);
      if (rest.length > 0 && rest[0].type === 'paren_open') {
        const inner = stripOuterParens(rest);
        if (inner.length < rest.length) {
          const isNeqWindows = (exprTokens: ActionExpressionToken[]): boolean => {
            const stripped = stripOuterParens(exprTokens);
            let cmpIdx = -1;
            let dInner = 0;
            for (let idx = 0; idx < stripped.length; idx++) {
              const tok = stripped[idx];
              if (tok.type === 'paren_open' || (tok.type === 'ident' && tok.value === '[')) {
                dInner++;
              } else if (
                tok.type === 'paren_close' ||
                (tok.type === 'ident' && tok.value === ']')
              ) {
                dInner--;
              } else if (dInner === 0 && tok.type === 'neq') {
                if (cmpIdx !== -1) {
                  return false;
                }
                cmpIdx = idx;
              }
            }
            if (cmpIdx > 0 && cmpIdx < stripped.length - 1) {
              const left = stripOuterParens(stripped.slice(0, cmpIdx));
              const right = stripOuterParens(stripped.slice(cmpIdx + 1));
              return (
                (left.length === 1 &&
                  left[0].type === 'ident' &&
                  left[0].value.toLowerCase() === 'runner.os' &&
                  right.length === 1 &&
                  right[0].type === 'string' &&
                  right[0].value.toLowerCase() === 'windows') ||
                (left.length === 1 &&
                  left[0].type === 'string' &&
                  left[0].value.toLowerCase() === 'windows' &&
                  right.length === 1 &&
                  right[0].type === 'ident' &&
                  right[0].value.toLowerCase() === 'runner.os')
              );
            }
            return false;
          };

          if (isNeqWindows(inner)) {
            return true;
          }

          // Check top-level || group inside negation: !(A || B) requires !A && !B
          const orSegments: ActionExpressionToken[][] = [];
          let currentSeg: ActionExpressionToken[] = [];
          let dOr = 0;
          for (let idx = 0; idx < inner.length; idx++) {
            const tok = inner[idx];
            if (tok.type === 'paren_open' || (tok.type === 'ident' && tok.value === '[')) {
              dOr++;
              currentSeg.push(tok);
            } else if (tok.type === 'paren_close' || (tok.type === 'ident' && tok.value === ']')) {
              dOr--;
              currentSeg.push(tok);
            } else if (dOr === 0 && tok.type === 'or') {
              orSegments.push(currentSeg);
              currentSeg = [];
            } else {
              currentSeg.push(tok);
            }
          }
          orSegments.push(currentSeg);

          if (orSegments.length > 1 && orSegments.some((seg) => isNeqWindows(seg))) {
            return true;
          }
        }
      }
      return false;
    }

    // 4. Base comparison: positive equality with Windows
    let cmpOpIndex = -1;
    let d = 0;
    for (let idx = 0; idx < current.length; idx++) {
      const tok = current[idx];
      if (tok.type === 'paren_open' || (tok.type === 'ident' && tok.value === '[')) {
        d++;
      } else if (tok.type === 'paren_close' || (tok.type === 'ident' && tok.value === ']')) {
        d--;
      } else if (d === 0 && (tok.type === 'eq' || tok.type === 'neq')) {
        if (cmpOpIndex !== -1) {
          cmpOpIndex = -1;
          break;
        }
        cmpOpIndex = idx;
      }
    }

    if (cmpOpIndex > 0 && cmpOpIndex < current.length - 1) {
      const left = stripOuterParens(current.slice(0, cmpOpIndex));
      const right = stripOuterParens(current.slice(cmpOpIndex + 1));
      const op = current[cmpOpIndex].type;
      if (op === 'eq') {
        if (
          (left.length === 1 &&
            left[0].type === 'ident' &&
            left[0].value.toLowerCase() === 'runner.os' &&
            right.length === 1 &&
            right[0].type === 'string' &&
            right[0].value.toLowerCase() === 'windows') ||
          (left.length === 1 &&
            left[0].type === 'string' &&
            left[0].value.toLowerCase() === 'windows' &&
            right.length === 1 &&
            right[0].type === 'ident' &&
            right[0].value.toLowerCase() === 'runner.os')
        ) {
          return true;
        }
      }
    }

    return false;
  };

  return evaluateConditionRequiresWindows(normalizedTokens);
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
  let gitIndexLookupSucceeded = false;

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
      gitIndexLookupSucceeded = true;
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
          if (
            rawStatus &&
            rawPath &&
            rawStatus.includes(' 0000000000000000000000000000000000000000 A')
          ) {
            intentToAddFiles.add(rawPath);
          }
        }
      }
      const lsProc = spawnSync('git', ['ls-files', '--stage', '-z'], {
        encoding: 'utf-8',
        maxBuffer: 20 * 1024 * 1024,
      });
      if (lsProc.status === 0) {
        gitIndexLookupSucceeded = true;
      }
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
    (e) =>
      dirname(e.path) === normWorkflowDir && (e.path.endsWith('.yml') || e.path.endsWith('.yaml')),
  );
  const indexedActionEntries: IndexedBlobEntry[] = [];
  const localActionDirs = new Set<string>(['.github/actions']);
  for (const entry of byPath.values()) {
    if (/(^|\/)action\.ya?ml$/.test(entry.path)) {
      indexedActionEntries.push(entry);
      localActionDirs.add(dirname(entry.path));
    }
  }
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

  const readBlobBySha = (entry: IndexedBlobEntry): Buffer => {
    const catProc = spawnSync('git', ['cat-file', 'blob', entry.sha], {
      maxBuffer: 20 * 1024 * 1024,
    });
    if (catProc.status !== 0 || !catProc.stdout) {
      const errText = catProc.stderr ? catProc.stderr.toString('utf-8').trim() : 'unknown error';
      throw new Error(
        `Failed to read staged blob '${entry.sha}' for '${entry.path}' from git index: ${errText}`,
      );
    }
    return Buffer.from(catProc.stdout);
  };

  try {
    mkdirSync(tmpSnapshotDir, { recursive: true, mode: 0o700 });
    if (isGitRepo) {
      mkdirSync(join(tmpRoot, '.git'), { recursive: true });
    }

    const writtenWorkflowPaths = new Set<string>();
    if (isGitRepo) {
      const resolveStagedEntry = (
        pathStr: string,
        visitedPrefixes: Set<string> = new Set(),
      ): IndexedBlobEntry | undefined => {
        const direct = byPath.get(pathStr);
        if (direct) {
          return direct;
        }
        const parts = pathStr.split('/');
        for (let i = 1; i < parts.length; i++) {
          const prefix = parts.slice(0, i).join('/');
          const prefixEntry = byPath.get(prefix);
          if (prefixEntry && prefixEntry.mode === '120000') {
            if (visitedPrefixes.has(prefix)) {
              return undefined;
            }
            visitedPrefixes.add(prefix);
            const linkTarget = readBlobBySha(prefixEntry).toString('utf-8').trim();
            const resolvedPrefix = join(dirname(prefix), linkTarget).replace(/\\/g, '/');
            const remainder = parts.slice(i).join('/');
            const newPath = join(resolvedPrefix, remainder).replace(/\\/g, '/');
            const res = resolveStagedEntry(newPath, visitedPrefixes);
            if (res) {
              return res;
            }
          }
        }
        return undefined;
      };

      const resolveStagedLinkChain = (entry: IndexedBlobEntry, label: string): IndexedBlobEntry => {
        let currentEntry = entry;
        const visitedPaths = new Set<string>();
        while (currentEntry.mode === '120000') {
          if (visitedPaths.has(currentEntry.path)) {
            throw new Error(`Circular symlink detected in ${label} '${currentEntry.path}'.`);
          }
          visitedPaths.add(currentEntry.path);
          const linkTarget = readBlobBySha(currentEntry).toString('utf-8').trim();
          const joinedTarget = join(dirname(currentEntry.path), linkTarget);
          const resolvedTarget =
            process.platform === 'win32' ? joinedTarget.replace(/\\/g, '/') : joinedTarget;
          const sibling = resolveStagedEntry(resolvedTarget);
          if (!sibling) {
            throw new Error(
              `Dangling symlink in ${label} '${currentEntry.path}': target '${resolvedTarget}' does not exist in git index.`,
            );
          }
          currentEntry = sibling;
        }
        return currentEntry;
      };

      if (indexedActionEntries.length > 0) {
        // Collect local actions actually referenced by workflows (Thread #16)
        const referencedLocalActionDirs = new Set<string>();
        const addReferencedActionDir = (actPath: string): void => {
          if (!actPath || actPath === '.') {
            referencedLocalActionDirs.add('.');
            return;
          }
          referencedLocalActionDirs.add(actPath);
          // Resolve directory alias chains through staged tree
          const parts = actPath.split('/');
          let resolved = '';
          for (const part of parts) {
            resolved = resolved && resolved !== '.' ? `${resolved}/${part}` : part;
            const visited = new Set<string>([resolved]);
            while (true) {
              const entry = byPath.get(resolved);
              if (!entry || entry.mode !== '120000') {
                break;
              }
              const target = readBlobBySha(entry).toString('utf-8').trim();
              const next = join(dirname(resolved), target)
                .replace(/\\/g, '/')
                .replace(/^\.?\//, '');
              if (visited.has(next)) {
                break;
              }
              visited.add(next);
              resolved = next;
            }
          }
          if (resolved && resolved !== actPath) {
            referencedLocalActionDirs.add(resolved);
          }
          for (const candidateBase of [actPath, resolved]) {
            if (!candidateBase) {
              continue;
            }
            for (const manifestName of ['action.yml', 'action.yaml']) {
              const probePath =
                candidateBase === '.' ? manifestName : `${candidateBase}/${manifestName}`;
              const manifestEntry = resolveStagedEntry(probePath);
              if (manifestEntry) {
                referencedLocalActionDirs.add(dirname(manifestEntry.path));
              }
            }
          }
        };

        for (const wf of indexedWorkflowEntries) {
          const blob = readBlobBySha(wf);
          const baseName = wf.path.split('/').pop()!;
          writeFileSync(join(tmpSnapshotDir, baseName), blob);
          writtenWorkflowPaths.add(wf.path);

          const content = blob.toString('utf-8');
          let parsedSuccessfully = false;
          try {
            if (
              typeof (Bun as { YAML?: { parse?: (s: string) => unknown } }).YAML?.parse ===
              'function'
            ) {
              const parsedWf = Bun.YAML.parse(content);
              if (parsedWf && typeof parsedWf === 'object') {
                parsedSuccessfully = true;
                const jobs = (parsedWf as Record<string, unknown>).jobs;
                if (jobs && typeof jobs === 'object') {
                  for (const job of Object.values(jobs as Record<string, unknown>)) {
                    if (job && typeof job === 'object') {
                      const steps = (job as Record<string, unknown>).steps;
                      if (Array.isArray(steps)) {
                        for (const step of steps) {
                          if (step && typeof step === 'object') {
                            const usesVal = (step as Record<string, unknown>).uses;
                            if (
                              typeof usesVal === 'string' &&
                              (/^\.\//.test(usesVal) || /^\.\\/.test(usesVal))
                            ) {
                              const actPath = posix
                                .normalize(usesVal.replace(/\\/g, '/').trim())
                                .replace(/^\.?\//, '')
                                .replace(/\/+$/, '');
                              addReferencedActionDir(actPath);
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
          if (!parsedSuccessfully) {
            const strippedContent = content
              .split(/\r?\n/)
              .filter((line) => !line.trim().startsWith('#'))
              .join('\n');
            const matches = strippedContent.matchAll(
              /(?:^|[\s,{"'])uses['"]?\s*:\s*['"]?(?:\.\/|\.\\)([^'"\s\r\n#]+)['"]?/gm,
            );
            for (const m of matches) {
              const actPath = posix
                .normalize((m[1] ?? '').replace(/\\/g, '/').trim())
                .replace(/^\.?\//, '')
                .replace(/\/+$/, '');
              addReferencedActionDir(actPath);
            }
          }
        }

        const actionReferencedEntries = new Map<string, IndexedBlobEntry>();
        for (const entry of indexedActionEntries) {
          const entryDir = dirname(entry.path);
          const isReachable =
            referencedLocalActionDirs.has(entryDir) ||
            (entryDir === '.' && referencedLocalActionDirs.has('.'));
          if (!isReachable) {
            continue;
          }
          let currentEntry = entry;
          const visitedInChain = new Set<string>([entry.path]);
          let isCycle = false;
          let isBroken = false;

          while (currentEntry.mode === '120000') {
            const linkTarget = readBlobBySha(currentEntry).toString('utf-8').trim();
            const resolvedPath = join(dirname(currentEntry.path), linkTarget).replace(/\\/g, '/');
            if (visitedInChain.has(resolvedPath)) {
              isCycle = true;
              break;
            }
            visitedInChain.add(resolvedPath);
            const nextEntry = resolveStagedEntry(resolvedPath);
            if (!nextEntry) {
              isBroken = true;
              break;
            }
            currentEntry = nextEntry;
          }

          if (isCycle) {
            throw new Error(
              `Cyclic symlink chain detected in staged action manifest '${entry.path}'.`,
            );
          }
          if (isBroken) {
            throw new Error(
              `Broken symlink chain pointing to missing staged file for '${entry.path}'.`,
            );
          }

          const blob = readBlobBySha(currentEntry);
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
            const parsedYaml = (Bun as { YAML?: { parse?: (s: string) => unknown } }).YAML?.parse?.(
              manifestContent,
            );
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
                    if (typeof val === 'string' && val.length > 0) {
                      relRefs.push(val);
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
              const val = (m[1] ?? m[2])?.replace(/[,}]+$/, '');
              if (val) {
                relRefs.push(val);
              }
            }
          }

          for (const relRef of relRefs) {
            if (relRef.startsWith('docker://')) {
              continue;
            }
            const joinedPath = join(actDir, relRef);
            const resolvedPath =
              process.platform === 'win32' ? joinedPath.replace(/\\/g, '/') : joinedPath;
            const refEntry = resolveStagedEntry(resolvedPath);
            if (refEntry) {
              actionReferencedEntries.set(resolvedPath, refEntry);
            }
          }
        }
        for (const [originalPath, refEntry] of actionReferencedEntries.entries()) {
          const currentEntry = resolveStagedLinkChain(refEntry, 'action dependency');
          const blob = readBlobBySha(currentEntry);
          const targetPath = join(tmpRoot, refEntry.path);
          try {
            mkdirSync(dirname(targetPath), { recursive: true });
            writeFileSync(targetPath, blob);
          } catch (writeErr) {
            throw new Error(
              `Failed to write staged action dependency '${originalPath}': ${writeErr instanceof Error ? writeErr.message : String(writeErr)}`,
            );
          }
        }
      }
      for (const entry of indexedConfigEntries) {
        const resolvedEntry = resolveStagedLinkChain(entry, 'actionlint config');
        const blob = readBlobBySha(resolvedEntry);
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

    if (gitIndexLookupSucceeded) {
      for (const entry of indexedWorkflowEntries) {
        if (writtenWorkflowPaths.has(entry.path)) {
          continue;
        }
        const blob = readBlobBySha(entry);
        const baseName = entry.path.split('/').pop()!;
        writeFileSync(join(tmpSnapshotDir, baseName), blob);
      }
    } else if (isGitRepo) {
      throw new Error('Failed to read staged git index for workflow snapshot.');
    } else if (existsSync(workflowDir)) {
      const diskFiles = readdirSync(workflowDir).filter(
        (f) => f.endsWith('.yml') || f.endsWith('.yaml'),
      );
      for (const file of diskFiles) {
        copyFileSync(join(workflowDir, file), join(tmpSnapshotDir, file));
      }
    }

    if (isGitRepo) {
      // Re-create staged symlinks after regular files are written, verifying targets resolve within the temporary mirror (Thread #9, #15, #17)
      const linkTextByBlob = new Map<string, string>();
      const readLinkText = (entry: IndexedBlobEntry): string => {
        let text = linkTextByBlob.get(entry.sha);
        if (text === undefined) {
          text = readBlobBySha(entry).toString('utf-8').trim();
          linkTextByBlob.set(entry.sha, text);
        }
        return text;
      };
      const pendingLinks = Array.from(byPath.values()).filter((e) => e.mode === '120000');
      let createdAny = true;
      while (createdAny && pendingLinks.length > 0) {
        createdAny = false;
        for (let idx = pendingLinks.length - 1; idx >= 0; idx--) {
          const entry = pendingLinks[idx];
          const linkTarget = readLinkText(entry);
          const targetPath = join(tmpRoot, entry.path);
          const rawTargetPath = isAbsolute(linkTarget)
            ? linkTarget
            : join(dirname(targetPath), linkTarget);
          const isEscapingRoot = (relPath: string): boolean => {
            return relPath === '..' || relPath.startsWith(`..${sep}`) || relPath.startsWith('../');
          };
          if (!isAbsolute(linkTarget) && existsSync(rawTargetPath)) {
            try {
              const realTarget = realpathSync(rawTargetPath);
              const realRoot = realpathSync(tmpRoot);
              const realRel = relative(realRoot, realTarget);
              if (!isEscapingRoot(realRel) && !isAbsolute(realRel)) {
                mkdirSync(dirname(targetPath), { recursive: true });
                symlinkSync(linkTarget, targetPath);
                createdAny = true;
                pendingLinks.splice(idx, 1);
              }
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
        `Bun.YAML.parse is unavailable in Bun ${Bun.version}; skipping workflow script shellcheck validation.`,
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
      errors.push(
        `[${file}] Malformed shell option at ${location}: expected string, got ${typeof val}`,
      );
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
        job.defaults && typeof job.defaults === 'object'
          ? (job.defaults as Record<string, unknown>)
          : undefined;
      const jobRun =
        jobDefaults?.run && typeof jobDefaults.run === 'object'
          ? (jobDefaults.run as Record<string, unknown>)
          : undefined;
      const survivingRows = expandMatrixRows(job.strategy);
      const jobShellRaw =
        getShellString(jobRun?.shell, `job '${jobId}' defaults.run.shell`) || workflowShell;
      let jobShell = jobShellRaw;
      let jobShellPattern: string | undefined;
      if (jobShell && jobShell.includes('${{')) {
        if (survivingRows && survivingRows.length > 0) {
          jobShellPattern = jobShell;
        } else {
          const resolved = resolveStaticMatrixExpression(jobShell, job.strategy);
          if (resolved !== undefined) {
            jobShell = resolved;
          }
        }
      }

      const shellDiagnostics: string[] = [];
      const defaultShell = getRunnerDefaultShell(
        job['runs-on'],
        job.strategy,
        job.container,
        shellDiagnostics,
      );
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
        const stepEligibleRows = getStepEligibleRows(
          typeof step.if === 'string' ? step.if : undefined,
          survivingRows,
        );
        if (stepEligibleRows && stepEligibleRows.length === 0) {
          continue;
        }
        let stepDefaultShell = defaultShell;
        if (job.container) {
          const stepHasContainer = hasContainer(job.container, job.strategy, stepEligibleRows);
          if (stepHasContainer) {
            stepDefaultShell = 'sh';
          } else if (defaultShell === 'sh') {
            stepDefaultShell = getRunnerDefaultShell(
              job['runs-on'],
              job.strategy,
              undefined,
              undefined,
            );
          }
        }
        if (!stepShell && !jobShell && typeof step.if === 'string') {
          if (isStepWindowsOnlyCondition(step.if)) {
            stepDefaultShell = 'pwsh';
          }
        }

        interface ShellCandidate {
          shell: string;
          isImplicit: boolean;
        }
        let candidateShells: ShellCandidate[];
        if (!stepShell && jobShellPattern && stepEligibleRows && stepEligibleRows.length > 0) {
          const resolvedRowShells = new Map<string, ShellCandidate>();
          for (const row of stepEligibleRows) {
            const s = jobShellPattern
              .replace(MATRIX_SCAN_REGEX, (_match: string, path: string): string => {
                const segs = parseMatrixPathExpression(path);
                if (segs.length === 0) {
                  return _match;
                }
                const v = resolveMatrixPath(row, segs);
                return v !== undefined && v !== null ? String(v) : '';
              })
              .trim();
            if (s) {
              resolvedRowShells.set(`explicit:${s}`, { shell: s, isImplicit: false });
            } else {
              const rowStrategy = { matrix: { include: [row] } };
              let rowDefault = getRunnerDefaultShell(job['runs-on'], rowStrategy, job.container);
              if (job.container && !hasContainer(job.container, rowStrategy, [row])) {
                rowDefault = getRunnerDefaultShell(job['runs-on'], rowStrategy, undefined);
              }
              if (typeof step.if === 'string' && isStepWindowsOnlyCondition(step.if)) {
                rowDefault = 'pwsh';
              }
              if (rowDefault) {
                resolvedRowShells.set(`implicit:${rowDefault}`, {
                  shell: rowDefault,
                  isImplicit: true,
                });
              }
            }
          }
          candidateShells = Array.from(resolvedRowShells.values());
        } else if (!stepShell && !jobShell && stepEligibleRows && stepEligibleRows.length > 0) {
          const resolvedRowShells = new Map<string, ShellCandidate>();
          for (const row of stepEligibleRows) {
            const rowStrategy = { matrix: { include: [row] } };
            let rowDefault = getRunnerDefaultShell(job['runs-on'], rowStrategy, job.container);
            if (job.container && !hasContainer(job.container, rowStrategy, [row])) {
              rowDefault = getRunnerDefaultShell(job['runs-on'], rowStrategy, undefined);
            }
            if (typeof step.if === 'string' && isStepWindowsOnlyCondition(step.if)) {
              rowDefault = 'pwsh';
            }
            if (rowDefault) {
              resolvedRowShells.set(`implicit:${rowDefault}`, {
                shell: rowDefault,
                isImplicit: true,
              });
            }
          }
          candidateShells = Array.from(resolvedRowShells.values());
        } else {
          const effectiveShell = (stepShell || jobShell || stepDefaultShell).trim();
          candidateShells = effectiveShell
            ? [{ shell: effectiveShell, isImplicit: !rawShell }]
            : [];
        }

        const script = step.run;
        if (!script.trim()) {
          continue;
        }

        const shellVariants = new Map<string, { dialect: 'bash' | 'sh'; prefix: string }>();
        for (const { shell: candidateShell, isImplicit } of candidateShells) {
          const rawToken = candidateShell.split(/\s+/)[0] || '';
          const shellBinary = basename(rawToken).toLowerCase();
          const isBash = shellBinary === 'bash' || shellBinary === 'bash.exe';
          const isSh = shellBinary === 'sh' || shellBinary === 'sh.exe';
          if (!isBash && !isSh) {
            continue;
          }
          const dialect: 'bash' | 'sh' = isSh ? 'sh' : 'bash';
          const effectiveRaw = isImplicit
            ? ''
            : !stepShell && jobShellPattern
              ? candidateShell
              : rawShell;
          const isBuiltinBash = effectiveRaw === 'bash' || (!effectiveRaw && isBash);
          const isBuiltinSh = effectiveRaw === 'sh' || (!effectiveRaw && isSh);
          let prefix = '';
          if (effectiveRaw === 'bash') {
            prefix = 'set -eo pipefail\n';
          } else if (isBuiltinBash || isBuiltinSh) {
            prefix = 'set -e\n';
          } else if (effectiveRaw) {
            const opts = getShellOptions(effectiveRaw);
            if (opts.errexit && opts.pipefail) {
              prefix = 'set -eo pipefail\n';
            } else if (opts.errexit) {
              prefix = 'set -e\n';
            } else if (opts.pipefail) {
              prefix = 'set -o pipefail\n';
            }
          }
          shellVariants.set(`${dialect}:${prefix}`, { dialect, prefix });
        }

        if (shellVariants.size === 0) {
          continue;
        }

        // Mask GitHub Actions expressions ${{ ... }} with dummy identifier in a quote-aware manner
        let masked: string;
        try {
          masked = maskGitHubExpressions(script);
        } catch (e) {
          const stepLabel = step.name || step.id || `step ${i + 1}`;
          errors.push(
            `[${file}: job '${jobId}', ${stepLabel}] ${e instanceof Error ? e.message : String(e)}`,
          );
          continue;
        }

        for (const { dialect, prefix } of shellVariants.values()) {
          let toCheck = masked;
          if (prefix) {
            toCheck = insertSetupAfterLeadingComments(toCheck, prefix);
          }

          if (checker) {
            const checkRes = await checker(toCheck, dialect);
            if (!checkRes.ok) {
              errors.push(
                `[${file}] Step ${i + 1} (${jobId}): ${checkRes.error || 'ShellCheck validation failed'}`,
              );
              break;
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
              [stdout.trim(), stderr.trim()].filter(Boolean).join('\n') ||
              `shellcheck exited with code ${exitCode}`;
            const stepLabel = step.name || step.id || `step ${i + 1}`;
            errors.push(`[${file}: job '${jobId}', ${stepLabel}]\n${combined}`);
            break;
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors };
}
