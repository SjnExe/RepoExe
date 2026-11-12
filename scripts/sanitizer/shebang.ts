import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { PREFIX } from "../utils/properties.ts";

const REPLACEMENTS: Record<string, string> = {
  "#!/bin/sh": `#!${PREFIX}/bin/sh`,
  "#!/bin/bash": `#!${PREFIX}/bin/bash`,
  "#!/usr/bin/env sh": `#!${PREFIX}/bin/sh`,
  "#!/usr/bin/env bash": `#!${PREFIX}/bin/bash`,
  "#!/usr/bin/env python": `#!${PREFIX}/bin/python3`,
  "#!/usr/bin/env python3": `#!${PREFIX}/bin/python3`,
  "#!/usr/bin/python": `#!${PREFIX}/bin/python3`,
  "#!/usr/bin/python3": `#!${PREFIX}/bin/python3`,
};

export function sanitizeShebangs(stageDir: string): void {
  if (!stageDir || !existsSync(stageDir)) return;

  const traverse = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        traverse(full);
      } else if (entry.isFile() && !entry.isSymbolicLink()) {
        try {
          const stats = statSync(full);
          if (stats.size > 2 * 1024 * 1024) continue;

          const content = readFileSync(full, "utf-8");
          const firstLineEnd = content.indexOf("\n");
          const firstLine = (firstLineEnd !== -1 ? content.slice(0, firstLineEnd) : content).trim();

          for (const [oldSb, newSb] of Object.entries(REPLACEMENTS)) {
            if (firstLine === oldSb || firstLine.startsWith(`${oldSb} `)) {
              const newContent = content.replace(firstLine, newSb);
              writeFileSync(full, newContent, "utf-8");
              chmodSync(full, 0o755);
              break;
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
