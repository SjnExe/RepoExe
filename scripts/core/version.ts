import { spawnSync } from 'node:child_process';

import type { VersionConstraint } from './dependencies.ts';
import type { PackageRecipe } from './types.ts';

/** Formats standard Debian deb version string: [epoch:]version[-revision] */
export function formatDebianVersion(
  recipe: Pick<PackageRecipe, 'version'> & Partial<Pick<PackageRecipe, 'epoch' | 'revision'>>,
): string {
  const revision = recipe.revision ?? 0;
  const epoch = recipe.epoch ?? 0;
  const verBody = revision > 0 ? `${recipe.version}-${revision}` : recipe.version;
  return epoch > 0 ? `${epoch}:${verBody}` : verBody;
}

/** Formats Debian filename version string (replaces ':' with '_' in filename to avoid filesystem issues) */
export function formatDebianFilenameVersion(
  recipe: Pick<PackageRecipe, 'version'> & Partial<Pick<PackageRecipe, 'epoch' | 'revision'>>,
): string {
  const revision = recipe.revision ?? 0;
  const epoch = recipe.epoch ?? 0;
  const verBody = revision > 0 ? `${recipe.version}-${revision}` : recipe.version;
  return epoch > 0 ? `${epoch}_${verBody}` : verBody;
}

function order(c: string): number {
  if (!c) {
    return 0;
  }
  if (c >= '0' && c <= '9') {
    return 0;
  }
  if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z')) {
    return c.charCodeAt(0);
  }
  if (c === '~') {
    return -1;
  }
  return c.charCodeAt(0) + 256;
}

function cmpDebianPart(a: string, b: string): number {
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    while ((i < a.length && !(a[i] >= '0' && a[i] <= '9')) || (j < b.length && !(b[j] >= '0' && b[j] <= '9'))) {
      const ac = i < a.length ? a[i] : '';
      const bc = j < b.length ? b[j] : '';
      const ao = order(ac);
      const bo = order(bc);
      if (ao !== bo) {
        return ao - bo;
      }
      if (i < a.length) {
        i++;
      }
      if (j < b.length) {
        j++;
      }
    }
    while (i < a.length && a[i] === '0') {
      i++;
    }
    while (j < b.length && b[j] === '0') {
      j++;
    }
    let aDigits = 0;
    while (i + aDigits < a.length && a[i + aDigits] >= '0' && a[i + aDigits] <= '9') {
      aDigits++;
    }
    let bDigits = 0;
    while (j + bDigits < b.length && b[j + bDigits] >= '0' && b[j + bDigits] <= '9') {
      bDigits++;
    }
    if (aDigits !== bDigits) {
      return aDigits - bDigits;
    }
    while (aDigits > 0) {
      if (a[i] !== b[j]) {
        return a.charCodeAt(i) - b.charCodeAt(j);
      }
      i++;
      j++;
      aDigits--;
      bDigits--;
    }
  }
  return 0;
}

export function compareDebianVersions(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  try {
    const res = spawnSync('dpkg', ['--compare-versions', a, 'eq', b]);
    if (res.status === 0) {
      return 0;
    }
    const ltRes = spawnSync('dpkg', ['--compare-versions', a, 'lt', b]);
    if (ltRes.status === 0) {
      return -1;
    }
    if (res.status === 1 && ltRes.status === 1 && !res.error && !ltRes.error) {
      return 1;
    }
  } catch {}

  const parseVer = (v: string): { epoch: number; upstream: string; revision: string } => {
    let epoch = 0;
    let rest = v;
    const colon = v.indexOf(':');
    if (colon !== -1) {
      const epStr = v.slice(0, colon);
      const parsedEp = parseInt(epStr, 10);
      if (!isNaN(parsedEp)) {
        epoch = parsedEp;
      }
      rest = v.slice(colon + 1);
    }
    let upstream = rest;
    let revision = '';
    const lastHyphen = rest.lastIndexOf('-');
    if (lastHyphen !== -1) {
      upstream = rest.slice(0, lastHyphen);
      revision = rest.slice(lastHyphen + 1);
    }
    return { epoch, upstream, revision };
  };

  const pa = parseVer(a);
  const pb = parseVer(b);
  if (pa.epoch !== pb.epoch) {
    return pa.epoch - pb.epoch;
  }
  const cmpUp = cmpDebianPart(pa.upstream, pb.upstream);
  if (cmpUp !== 0) {
    return cmpUp;
  }
  return cmpDebianPart(pa.revision, pb.revision);
}

export function satisfiesVersionConstraint(ver: string, constraint?: VersionConstraint): boolean {
  if (!constraint || (!constraint.operator && !constraint.version)) {
    return true;
  }
  if (constraint.operator && !constraint.version) {
    return false;
  }
  if (!ver) {
    return false;
  }
  try {
    const res = spawnSync('dpkg', ['--compare-versions', ver, constraint.operator, constraint.version]);
    if (res.status !== null && !res.error) {
      return res.status === 0;
    }
  } catch {}
  const cmp = compareDebianVersions(ver, constraint.version);
  switch (constraint.operator) {
    case '=':
      return cmp === 0;
    case '<<':
      return cmp < 0;
    case '<=':
      return cmp <= 0;
    case '>>':
      return cmp > 0;
    case '>=':
      return cmp >= 0;
    default:
      return false;
  }
}

export function satisfiesAllConstraints(ver: string, constraints?: VersionConstraint[]): boolean {
  if (!constraints || constraints.length === 0) {
    return true;
  }
  return constraints.every((c) => satisfiesVersionConstraint(ver, c));
}
