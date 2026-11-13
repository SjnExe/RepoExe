export type VersionOperator = '<<' | '<=' | '=' | '>=' | '>>';

export interface VersionConstraint {
  operator: VersionOperator;
  version: string;
}

export interface DependencyToken {
  name: string;
  multiArch?: string; // e.g., "any", "native", "aarch64"
  versionConstraint?: VersionConstraint;
  architectures?: string[]; // normalized e.g., ["aarch64", "x86_64"]
  negatedArch?: boolean; // true if [!i686]
}

export type DependencyClause = DependencyToken[]; // Alternatives separated by '|'

export const ARCH_ALIASES: Record<string, string> = {
  arm64: 'aarch64',
  aarch64: 'aarch64',
  amd64: 'x86_64',
  x86_64: 'x86_64',
  armhf: 'arm',
  armel: 'arm',
  armv7: 'arm',
  arm: 'arm',
  i386: 'i686',
  i686: 'i686',
};

export function normalizeArch(arch: string): string {
  const clean = arch.trim().toLowerCase();
  return ARCH_ALIASES[clean] || clean;
}

export function parseSingleToken(raw: string): DependencyToken {
  const trimmed = raw.trim();
  // Regex to extract name, optional multi-arch, optional version constraint, optional arch restriction
  // Example: python3:any (>= 3.10) [!i686]
  const pattern =
    /^([a-zA-Z0-9._+-]+)(?::([a-zA-Z0-9_-]+))?(?:\s*\(\s*(<<|<=|>=|>>|=|<|>)\s*([^)]+)\))?(?:\s*\[([^\]]+)\])?$/;
  const match = trimmed.match(pattern);

  if (!match) {
    return { name: trimmed };
  }

  const name = match[1];
  const multiArch = match[2];
  let opRaw = match[3];
  const verRaw = match[4];
  const archSpec = match[5];

  let versionConstraint: VersionConstraint | undefined;
  if (opRaw && verRaw) {
    if (opRaw === '<') opRaw = '<=';
    if (opRaw === '>') opRaw = '>=';
    versionConstraint = {
      operator: opRaw as VersionOperator,
      version: verRaw.trim(),
    };
  }

  let architectures: string[] | undefined;
  let negatedArch = false;

  if (archSpec) {
    const tokens = archSpec.trim().split(/\s+/).filter(Boolean);
    const archList: string[] = [];
    for (const t of tokens) {
      if (t.startsWith('!')) {
        negatedArch = true;
        archList.push(normalizeArch(t.slice(1)));
      } else {
        archList.push(normalizeArch(t));
      }
    }
    if (archList.length > 0) {
      architectures = archList;
    }
  }

  const result: DependencyToken = { name };
  if (multiArch) result.multiArch = multiArch;
  if (versionConstraint) result.versionConstraint = versionConstraint;
  if (architectures && architectures.length > 0) {
    result.architectures = architectures;
    result.negatedArch = negatedArch;
  }

  return result;
}

export function parseDependencyClause(clauseStr: string): DependencyClause {
  return clauseStr
    .split('|')
    .map((item) => item.trim())
    .filter(Boolean)
    .map(parseSingleToken);
}

export function parseDependencyList(deps: string[] | string): DependencyClause[] {
  const rawClauses: string[] = [];

  if (typeof deps === 'string') {
    rawClauses.push(...deps.split(','));
  } else if (Array.isArray(deps)) {
    for (const d of deps) {
      if (typeof d === 'string') {
        rawClauses.push(...d.split(','));
      }
    }
  }

  const clauses: DependencyClause[] = [];
  for (const rc of rawClauses) {
    const trimmed = rc.trim();
    if (!trimmed) continue;
    const clause = parseDependencyClause(trimmed);
    if (clause.length > 0) {
      clauses.push(clause);
    }
  }

  return clauses;
}

export function matchArchWildcard(pattern: string, normTarget: string): boolean {
  const normPattern = normalizeArch(pattern);
  if (normPattern === 'any') return true;
  if (normPattern === normTarget) return true;

  if (pattern.includes('-')) {
    const parts = pattern.split('-');
    if (parts.length === 2) {
      const [os, cpu] = parts;
      const osMatch = os === 'any' || os === 'linux';
      const cpuMatch = cpu === 'any' || normalizeArch(cpu) === normTarget;
      return osMatch && cpuMatch;
    }
  }
  return false;
}

export function filterDepsForArch(clauses: DependencyClause[], targetArch: string): DependencyClause[] {
  const normTarget = normalizeArch(targetArch);
  const result: DependencyClause[] = [];

  for (const branch of clauses) {
    const matchedTokens: DependencyToken[] = [];

    for (const token of branch) {
      if (!token.architectures || token.architectures.length === 0 || normTarget === 'all') {
        matchedTokens.push({ ...token, architectures: undefined, negatedArch: undefined });
      } else {
        const matches = token.architectures.some((archPattern) => matchArchWildcard(archPattern, normTarget));
        const include = token.negatedArch ? !matches : matches;
        if (include) {
          matchedTokens.push({ ...token, architectures: undefined, negatedArch: undefined });
        }
      }
    }

    if (matchedTokens.length > 0) {
      result.push(matchedTokens);
    }
  }

  return result;
}

export function formatDebianDependency(clauses: DependencyClause[]): string {
  return clauses
    .map((branch) =>
      branch
        .map((t) => {
          const ma = t.multiArch ? `:${t.multiArch}` : '';
          const ver = t.versionConstraint ? ` (${t.versionConstraint.operator} ${t.versionConstraint.version})` : '';
          return `${t.name}${ma}${ver}`;
        })
        .join(' | '),
    )
    .join(', ');
}

export function formatPacmanDependency(clauses: DependencyClause[]): string[] {
  const result: string[] = [];
  for (const branch of clauses) {
    if (branch.length === 0) continue;
    const primary = branch[0];
    let ver = '';
    if (primary.versionConstraint) {
      const op = primary.versionConstraint.operator;
      const pacmanOp = op === '>=' ? '>=' : op === '<=' ? '<=' : op === '=' ? '=' : op === '>>' ? '>' : '<';
      ver = `${pacmanOp}${primary.versionConstraint.version}`;
    }
    result.push(`${primary.name}${ver}`);
  }
  return result;
}

export function formatAlpineDependency(clauses: DependencyClause[]): string[] {
  const result: string[] = [];
  for (const branch of clauses) {
    if (branch.length === 0) continue;
    const primary = branch[0];
    let ver = '';
    if (primary.versionConstraint) {
      const op = primary.versionConstraint.operator;
      const apkOp = op === '>=' ? '>=' : op === '<=' ? '<=' : op === '=' ? '=' : op === '>>' ? '>' : '<';
      ver = `${apkOp}${primary.versionConstraint.version}`;
    }
    result.push(`${primary.name}${ver}`);
  }
  return result;
}

export function extractAllPackageNames(clauses: DependencyClause[]): Set<string> {
  const names = new Set<string>();
  for (const branch of clauses) {
    for (const token of branch) {
      if (token.name) {
        names.add(token.name);
      }
    }
  }
  return names;
}

export function extractPrimaryPackageNames(clauses: DependencyClause[]): string[] {
  const names: string[] = [];
  for (const branch of clauses) {
    if (branch.length > 0 && branch[0].name) {
      names.push(branch[0].name);
    }
  }
  return names;
}
