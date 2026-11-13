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

function skipWhitespaceAndComments(str: string, pos: number): number {
  let i = pos;
  while (i < str.length) {
    if (/\s/.test(str[i])) {
      i++;
    } else if (str[i] === '/' && i + 1 < str.length && str[i + 1] === '/') {
      i += 2;
      while (i < str.length && str[i] !== '\n') {
        i++;
      }
      if (i < str.length && str[i] === '\n') {
        i++;
      }
    } else if (str[i] === '/' && i + 1 < str.length && str[i + 1] === '*') {
      const end = str.indexOf('*/', i + 2);
      if (end === -1) {
        return str.length;
      }
      i = end + 2;
    } else {
      break;
    }
  }
  return i;
}

function matchPropertyKey(str: string, pos: number, key: string): number {
  if (str.startsWith(`"${key}"`, pos) || str.startsWith(`'${key}'`, pos)) {
    return pos + key.length + 2;
  }
  if (str.startsWith(key, pos)) {
    const nextChar = str[pos + key.length];
    if (!nextChar || !/[a-zA-Z0-9_$]/.test(nextChar)) {
      return pos + key.length;
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
      if (!versionEdit) {
        const verKeyEnd = matchPropertyKey(str, i, 'version');
        if (verKeyEnd !== -1) {
          const colonPos = skipWhitespaceAndComments(str, verKeyEnd);
          if (colonPos < str.length && str[colonPos] === ':') {
            const valPos = skipWhitespaceAndComments(str, colonPos + 1);
            if (valPos < str.length && (str[valPos] === "'" || str[valPos] === '"')) {
              const quote = str[valPos];
              let endVal = valPos + 1;
              while (endVal < str.length && str[endVal] !== quote) {
                if (str[endVal] === '\\') endVal++;
                endVal++;
              }
              if (endVal < str.length && str[endVal] === quote) {
                const start = valPos + 1;
                const end = endVal;
                versionEdit = { start, end, replacement: newVersion };
                lastSignificantToken = ':';
                i = endVal;
                continue;
              }
            }
          }
        }
      }

      if (!revisionEdit) {
        const revKeyEnd = matchPropertyKey(str, i, 'revision');
        if (revKeyEnd !== -1) {
          const colonPos = skipWhitespaceAndComments(str, revKeyEnd);
          if (colonPos < str.length && str[colonPos] === ':') {
            const valPos = skipWhitespaceAndComments(str, colonPos + 1);
            const digitsMatch = str.slice(valPos).match(/^(\d+)/);
            if (digitsMatch) {
              const start = valPos;
              const end = valPos + digitsMatch[1].length;
              revisionEdit = { start, end, replacement: '0' };
              lastSignificantToken = ':';
              i = end - 1;
              continue;
            }
          }
        }
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

function findExportedRecipeRoot(content: string): number {
  const expDefaultIdx = findSyntaxMatch(content, /^export\s+default\b/);
  if (expDefaultIdx !== -1) {
    const afterExport = content.slice(expDefaultIdx);
    const openBrace = findSyntaxMatch(afterExport, /^\{/);
    if (openBrace !== -1) {
      return expDefaultIdx + openBrace;
    }
  }

  const defIdx = findSyntaxMatch(content, /^defineRecipe\s*\(\s*\{/);
  if (defIdx !== -1) {
    return content.indexOf('{', defIdx);
  }

  return findSyntaxMatch(content, /^\{/);
}

function findDirectObjectPropertyBrace(str: string, openBraceIdx: number, propName: string): number {
  let count = 0;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let inTemplate = false;
  const templateBraceStack: number[] = [];
  let inLineComment = false;
  let inBlockComment = false;
  let lastSignificantToken = '{';

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
          if (top === 0) templateBraceStack.pop();
          else templateBraceStack[templateBraceStack.length - 1]--;
        }
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

    if (count === 1 && (lastSignificantToken === '{' || lastSignificantToken === ',')) {
      const keyEnd = matchPropertyKey(str, i, propName);
      if (keyEnd !== -1) {
        const colonPos = skipWhitespaceAndComments(str, keyEnd);
        if (colonPos < str.length && str[colonPos] === ':') {
          const bracePos = skipWhitespaceAndComments(str, colonPos + 1);
          if (bracePos < str.length && str[bracePos] === '{') {
            return bracePos;
          }
        }
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
      if (count === 0) break;
    } else if (count === 1) {
      if (char === ',') {
        lastSignificantToken = ',';
      } else if (!/\s/.test(char)) {
        lastSignificantToken = char;
      }
    }
  }

  return -1;
}

export function updateRecipeContent(content: string, channel: string, newVersion: string): string {
  const recipeRootBraceIdx = findExportedRecipeRoot(content);
  if (recipeRootBraceIdx === -1) {
    throw new Error(`Failed to find recipe root object.`);
  }

  if (channel === 'latest') {
    return updateDirectObjectProperties(content, recipeRootBraceIdx, newVersion, 'latest');
  } else {
    // Locate the direct channels property of the exported recipe
    const channelsBraceIdx = findDirectObjectPropertyBrace(content, recipeRootBraceIdx, 'channels');
    if (channelsBraceIdx === -1) {
      throw new Error(`Channels property not found in exported recipe.`);
    }

    // Locate the specific channel entry inside channels: { ... }
    const chanBraceIdx = findDirectObjectPropertyBrace(content, channelsBraceIdx, channel);
    if (chanBraceIdx === -1) {
      throw new Error(`Channel ${channel} not found in recipe channels.`);
    }

    return updateDirectObjectProperties(content, chanBraceIdx, newVersion, `channel ${channel}`);
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
