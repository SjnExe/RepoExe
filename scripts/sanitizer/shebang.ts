import { chmodSync, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { PREFIX } from '../utils/properties.ts';

export function rewriteShebangLine(firstLine: string, prefix: string = PREFIX): string | null {
  const trimmed = firstLine.trim();
  if (!trimmed.startsWith('#!')) {
    return null;
  }
  // Preserve system shell or existing prefix paths
  if (
    trimmed.startsWith(`#!${prefix}/bin/`) ||
    trimmed.startsWith(`#!${prefix}/`) ||
    trimmed.startsWith('#!/system/bin/')
  ) {
    return null;
  }

  // 1. Option-bearing env forms (e.g. #!/usr/bin/env -S python3 -u or #!/bin/env -...)
  const envOptMatch = trimmed.match(
    /^#!\s*(?:\/(?:usr(?:\/local)?)?\/bin\/env|\/bin\/env)\s+(-.+)$/,
  );
  if (envOptMatch) {
    return `#!${prefix}/bin/env ${envOptMatch[1]}`;
  }

  // 2. Simple env without options: #!/usr/bin/env <cmd> ...
  const envMatch = trimmed.match(
    /^#!\s*(?:\/(?:usr(?:\/local)?)?\/bin\/env|\/bin\/env)\s+([a-zA-Z0-9._-]+)(\s.*)?$/,
  );
  if (envMatch) {
    let cmd = envMatch[1];
    const rest = envMatch[2] || '';
    if (cmd === 'python') {
      cmd = 'python3';
    }
    return `#!${prefix}/bin/${cmd}${rest}`;
  }

  // 3. Direct binary paths: #!/bin/<cmd>, #!/usr/bin/<cmd>, #!/usr/local/bin/<cmd>
  const directMatch = trimmed.match(
    /^#!\s*(?:\/(?:usr(?:\/local)?)?\/bin\/|\/bin\/)([a-zA-Z0-9._-]+)(\s.*)?$/,
  );
  if (directMatch) {
    let cmd = directMatch[1];
    const rest = directMatch[2] || '';
    if (cmd === 'python') {
      cmd = 'python3';
    }
    return `#!${prefix}/bin/${cmd}${rest}`;
  }

  return null;
}

const LEGACY_REPLACEMENTS = [
  '#!/bin/sh',
  '#!/bin/bash',
  '#!/usr/bin/env sh',
  '#!/usr/bin/env bash',
  '#!/usr/bin/env python',
  '#!/usr/bin/env python3',
  '#!/usr/bin/python',
  '#!/usr/bin/python3',
];

function isLegacyReplacement(firstLine: string): boolean {
  for (const oldSb of LEGACY_REPLACEMENTS) {
    if (firstLine === oldSb || firstLine.startsWith(`${oldSb} `)) {
      return true;
    }
  }
  return false;
}

export function sanitizeShebangs(stageDir: string, prefix: string = PREFIX): void {
  if (!stageDir || !existsSync(stageDir)) {
    return;
  }

  const traverse = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(full);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        try {
          const stats = statSync(full);
          if (stats.size > 2 * 1024 * 1024) {
            continue;
          }

          const buf = readFileSync(full);
          if (buf.length < 2 || buf[0] !== 0x23 || buf[1] !== 0x21) {
            continue;
          }

          const firstLineEnd = buf.indexOf(0x0a);
          const firstLineRaw = (firstLineEnd !== -1 ? buf.subarray(0, firstLineEnd) : buf).toString(
            'utf-8',
          );
          const firstLine = firstLineRaw.trim();
          const rewritten = rewriteShebangLine(firstLine, prefix);
          if (rewritten && rewritten !== firstLine) {
            const matchesLegacy = isLegacyReplacement(firstLine);
            const remainderBuf = firstLineEnd !== -1 ? buf.subarray(firstLineEnd) : Buffer.alloc(0);
            const rewrittenBuf = Buffer.from(rewritten);
            const newBuf = Buffer.concat([rewrittenBuf, remainderBuf]);
            writeFileSync(full, newBuf);
            if (matchesLegacy) {
              chmodSync(full, 0o755);
            }
          }
        } catch {
          // Ignore binary or read errors
        }
      }
    }
  };

  traverse(stageDir);
}
