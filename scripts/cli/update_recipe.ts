import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function getMajorMinor(versionStr: string): string | null {
  const parts = versionStr.split('.');
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return null;
}

function findMatchingBrace(str: string, openBraceIdx: number): number {
  let count = 0;
  for (let i = openBraceIdx; i < str.length; i++) {
    if (str[i] === '{') {
      count++;
    } else if (str[i] === '}') {
      count--;
      if (count === 0) return i;
    }
  }
  return -1;
}

export function updateRecipeContent(content: string, channel: string, newVersion: string): string {
  if (channel === 'latest') {
    // If channels: { ... } exists, isolate top-level by excluding the channels block
    const channelsMatch = content.match(/\bchannels\s*:\s*\{/);
    if (channelsMatch && channelsMatch.index !== undefined) {
      const openBraceIdx = content.indexOf('{', channelsMatch.index);
      const closeBraceIdx = findMatchingBrace(content, openBraceIdx);

      if (openBraceIdx !== -1 && closeBraceIdx !== -1) {
        const before = content.slice(0, channelsMatch.index);
        const chanBlock = content.slice(channelsMatch.index, closeBraceIdx + 1);
        const after = content.slice(closeBraceIdx + 1);

        let versionUpdated = false;
        const updateVer = (part: string) => {
          return part.replace(/(\bversion:\s*)(['"])[^'"]+\2/, (m, p1, q) => {
            versionUpdated = true;
            return `${p1}${q}${newVersion}${q}`;
          });
        };
        const resetRev = (part: string) => part.replace(/(\brevision:\s*)\d+/, '$10');

        let newBefore = updateVer(before);
        let newAfter = after;
        if (!versionUpdated) {
          newAfter = updateVer(after);
        }

        newBefore = resetRev(newBefore);
        newAfter = resetRev(newAfter);

        if (!versionUpdated) {
          throw new Error(`Failed to update version to ${newVersion} for latest: version property not found.`);
        }

        return newBefore + chanBlock + newAfter;
      }
    }

    let versionUpdated = false;
    let res = content.replace(/(\bversion:\s*)(['"])[^'"]+\2/, (m, p1, q) => {
      versionUpdated = true;
      return `${p1}${q}${newVersion}${q}`;
    });
    res = res.replace(/(\brevision:\s*)\d+/, '$10');

    if (!versionUpdated) {
      throw new Error(`Failed to update version to ${newVersion} for latest: version property not found.`);
    }
    return res;
  } else {
    // Locate the specific channel entry inside channels: { ... }
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const channelKeyRegex = new RegExp(`(?:^|\\s|["'])(${escaped})(?:["']?\\s*:\\s*\\{)`);
    const match = content.match(channelKeyRegex);
    if (!match || match.index === undefined) {
      throw new Error(`Channel ${channel} not found in recipe.`);
    }

    const openBraceIdx = content.indexOf('{', match.index);
    const closeBraceIdx = findMatchingBrace(content, openBraceIdx);
    if (openBraceIdx === -1 || closeBraceIdx === -1) {
      throw new Error(`Malformed channel block for ${channel}.`);
    }

    const chanObject = content.slice(openBraceIdx, closeBraceIdx + 1);
    let chanVersionUpdated = false;
    let updatedChanObject = chanObject.replace(/(\bversion:\s*)(['"])[^'"]+\2/, (m, p1, q) => {
      chanVersionUpdated = true;
      return `${p1}${q}${newVersion}${q}`;
    });
    updatedChanObject = updatedChanObject.replace(/(\brevision:\s*)\d+/, '$10');

    if (!chanVersionUpdated) {
      throw new Error(
        `Failed to update version to ${newVersion} for channel ${channel}: version property not found inside channel.`,
      );
    }

    return content.slice(0, openBraceIdx) + updatedChanObject + content.slice(closeBraceIdx + 1);
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
