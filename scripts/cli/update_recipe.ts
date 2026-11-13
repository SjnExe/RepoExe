import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function getMajorMinor(versionStr: string): string | null {
  const parts = versionStr.split('.');
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return null;
}

export function findMatchingBrace(str: string, openBraceIdx: number): number {
  let count = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  const templateBraceStack: number[] = [];
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = openBraceIdx; i < str.length; i++) {
    const char = str[i];
    const prev = i > 0 ? str[i - 1] : '';

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '/' && prev === '*') inBlockComment = false;
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && (prev !== '\\' || (i > 1 && str[i - 2] === '\\'))) inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && (prev !== '\\' || (i > 1 && str[i - 2] === '\\'))) inDoubleQuote = false;
      continue;
    }
    if (inTemplate) {
      if (char === '`' && (prev !== '\\' || (i > 1 && str[i - 2] === '\\'))) {
        inTemplate = false;
        continue;
      }
      if (char === '$' && i + 1 < str.length && str[i + 1] === '{') {
        templateBraceStack.push(0);
        i++;
        continue;
      }
      if (templateBraceStack.length > 0) {
        if (char === '{') {
          templateBraceStack[templateBraceStack.length - 1]++;
        } else if (char === '}') {
          const top = templateBraceStack[templateBraceStack.length - 1];
          if (top === 0) {
            templateBraceStack.pop();
          } else {
            templateBraceStack[templateBraceStack.length - 1]--;
          }
        }
        continue;
      }
      continue;
    }

    if (char === '/' && i + 1 < str.length) {
      if (str[i + 1] === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (str[i + 1] === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (char === '`') {
      inTemplate = true;
      continue;
    }

    if (char === '{') {
      count++;
    } else if (char === '}') {
      count--;
      if (count === 0) return i;
    }
  }
  return -1;
}

function findSyntaxMatch(content: string, pattern: RegExp): number {
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  const templateBraceStack: number[] = [];
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i];
    const prev = i > 0 ? content[i - 1] : '';

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '/' && prev === '*') inBlockComment = false;
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && (prev !== '\\' || (i > 1 && content[i - 2] === '\\'))) inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && (prev !== '\\' || (i > 1 && content[i - 2] === '\\'))) inDoubleQuote = false;
      continue;
    }
    if (inTemplate) {
      if (char === '`' && (prev !== '\\' || (i > 1 && content[i - 2] === '\\'))) {
        inTemplate = false;
        continue;
      }
      if (char === '$' && i + 1 < content.length && content[i + 1] === '{') {
        templateBraceStack.push(0);
        i++;
        continue;
      }
      if (templateBraceStack.length > 0) {
        if (char === '{') {
          templateBraceStack[templateBraceStack.length - 1]++;
        } else if (char === '}') {
          const top = templateBraceStack[templateBraceStack.length - 1];
          if (top === 0) templateBraceStack.pop();
          else templateBraceStack[templateBraceStack.length - 1]--;
        }
      }
      continue;
    }

    if (char === '/' && i + 1 < content.length) {
      if (content[i + 1] === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (content[i + 1] === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    const sub = content.slice(i);
    const m = sub.match(pattern);
    if (m && m.index === 0) {
      return i;
    }

    if (char === "'") {
      inSingleQuote = true;
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      continue;
    }
    if (char === '`') {
      inTemplate = true;
      continue;
    }
  }
  return -1;
}

export function updateDirectObjectProperties(
  str: string,
  openBraceIdx: number,
  newVersion: string,
  targetName: string,
): string {
  let count = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  const templateBraceStack: number[] = [];
  let inLineComment = false;
  let inBlockComment = false;
  let lastSignificantToken = '{';

  interface EditRange {
    start: number;
    end: number;
    replacement: string;
  }

  let versionEdit: EditRange | null = null;
  let revisionEdit: EditRange | null = null;

  for (let i = openBraceIdx; i < str.length; i++) {
    const char = str[i];
    const prev = i > 0 ? str[i - 1] : '';

    if (inLineComment) {
      if (char === '\n') inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (char === '/' && prev === '*') inBlockComment = false;
      continue;
    }
    if (inSingleQuote) {
      if (char === "'" && (prev !== '\\' || (i > 1 && str[i - 2] === '\\'))) inSingleQuote = false;
      continue;
    }
    if (inDoubleQuote) {
      if (char === '"' && (prev !== '\\' || (i > 1 && str[i - 2] === '\\'))) inDoubleQuote = false;
      continue;
    }
    if (inTemplate) {
      if (char === '`' && (prev !== '\\' || (i > 1 && str[i - 2] === '\\'))) {
        inTemplate = false;
        continue;
      }
      if (char === '$' && i + 1 < str.length && str[i + 1] === '{') {
        templateBraceStack.push(0);
        i++;
        continue;
      }
      if (templateBraceStack.length > 0) {
        if (char === '{') {
          templateBraceStack[templateBraceStack.length - 1]++;
        } else if (char === '}') {
          const top = templateBraceStack[templateBraceStack.length - 1];
          if (top === 0) {
            templateBraceStack.pop();
          } else {
            templateBraceStack[templateBraceStack.length - 1]--;
          }
        }
        continue;
      }
      continue;
    }

    if (char === '/' && i + 1 < str.length) {
      if (str[i + 1] === '/') {
        inLineComment = true;
        i++;
        continue;
      }
      if (str[i + 1] === '*') {
        inBlockComment = true;
        i++;
        continue;
      }
    }

    // Direct property matching when count === 1 and preceded by '{' or ','
    if (count === 1 && (lastSignificantToken === '{' || lastSignificantToken === ',')) {
      const sub = str.slice(i);
      const verMatch = sub.match(/^(?:(?:\bversion\b)|(?:["']version["']))\s*:\s*(['"])([^'"]*)\1/);
      if (verMatch && verMatch.index === 0) {
        const colonOffset = sub.indexOf(':');
        const quote = verMatch[1];
        const valOffset = sub.indexOf(quote, colonOffset);
        const start = i + valOffset + 1;
        const end = start + verMatch[2].length;
        versionEdit = { start, end, replacement: newVersion };
        lastSignificantToken = ':';
        i += verMatch[0].length - 1;
        continue;
      }

      const revMatch = sub.match(/^(?:(?:\brevision\b)|(?:["']revision["']))\s*:\s*(\d+)/);
      if (revMatch && revMatch.index === 0) {
        const colonOffset = sub.indexOf(':');
        const valStr = revMatch[1];
        const valOffset = sub.indexOf(valStr, colonOffset);
        const start = i + valOffset;
        const end = start + valStr.length;
        revisionEdit = { start, end, replacement: '0' };
        lastSignificantToken = ':';
        i += revMatch[0].length - 1;
        continue;
      }
    }

    if (char === "'") {
      inSingleQuote = true;
      if (count === 1) lastSignificantToken = "'";
      continue;
    }
    if (char === '"') {
      inDoubleQuote = true;
      if (count === 1) lastSignificantToken = '"';
      continue;
    }
    if (char === '`') {
      inTemplate = true;
      if (count === 1) lastSignificantToken = '`';
      continue;
    }

    if (char === '{') {
      count++;
      if (count === 1) lastSignificantToken = '{';
    } else if (char === '}') {
      count--;
      if (count === 0) {
        break;
      }
    } else if (count === 1) {
      if (char === ',') {
        lastSignificantToken = ',';
      } else if (!/\s/.test(char)) {
        lastSignificantToken = char;
      }
    }
  }

  if (!versionEdit) {
    throw new Error(`Failed to update version to ${newVersion} for ${targetName}: version property not found.`);
  }

  const edits: EditRange[] = [versionEdit];
  if (revisionEdit) {
    edits.push(revisionEdit);
  }
  edits.sort((a: EditRange, b: EditRange): number => b.start - a.start);

  let res = str;
  for (const edit of edits) {
    res = res.slice(0, edit.start) + edit.replacement + res.slice(edit.end);
  }
  return res;
}

export function updateRecipeContent(content: string, channel: string, newVersion: string): string {
  if (channel === 'latest') {
    let rootBraceIdx = -1;
    const defIdx = findSyntaxMatch(content, /^defineRecipe\s*\(\s*\{/);
    if (defIdx !== -1) {
      rootBraceIdx = content.indexOf('{', defIdx);
    } else {
      const expIdx = findSyntaxMatch(content, /^export\s+default\s*\{/);
      if (expIdx !== -1) {
        rootBraceIdx = content.indexOf('{', expIdx);
      } else {
        rootBraceIdx = findSyntaxMatch(content, /^\{/);
      }
    }
    if (rootBraceIdx === -1) {
      throw new Error(`Failed to find recipe root object.`);
    }
    return updateDirectObjectProperties(content, rootBraceIdx, newVersion, 'latest');
  } else {
    // Locate the specific channel entry inside channels: { ... }
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const channelKeyRegex = new RegExp(`^(?:${escaped}|["']${escaped}["'])\\s*:\\s*\\{`);
    const chanIdx = findSyntaxMatch(content, channelKeyRegex);
    if (chanIdx === -1) {
      throw new Error(`Channel ${channel} not found in recipe.`);
    }

    const openBraceIdx = content.indexOf('{', chanIdx);
    if (openBraceIdx === -1) {
      throw new Error(`Malformed channel block for ${channel}.`);
    }

    return updateDirectObjectProperties(content, openBraceIdx, newVersion, `channel ${channel}`);
  }
}

export function updateRecipe(pkg: string, channel: string, newVersion: string): void {
  const recipePath = resolve('pkg', pkg, 'recipe.ts');
  if (!existsSync(recipePath)) {
    console.error(`Error: Recipe at ${recipePath} does not exist.`);
    process.exit(1);
  }

  const raw = readFileSync(recipePath, 'utf-8');
  const updated = updateRecipeContent(raw, channel, newVersion);
  writeFileSync(recipePath, updated, 'utf-8');

  console.log(`✓ Successfully updated ${pkg} (${channel}) to ${newVersion}`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args.length < 3) {
    console.error('Usage: bun run scripts/cli/update_recipe.ts <pkg> <channel> <new_version>');
    process.exit(1);
  }
  updateRecipe(args[0], args[1], args[2]);
}
