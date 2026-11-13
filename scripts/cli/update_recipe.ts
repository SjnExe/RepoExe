import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export function getMajorMinor(versionStr: string): string | null {
  const parts = versionStr.split('.');
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[1]}`;
  }
  return null;
}

export function updateRecipeContent(content: string, channel: string, newVersion: string): string {
  const original = content;

  if (channel === 'latest') {
    // If channels: { ... } exists, isolate top-level by excluding the channels block
    const channelsIdx = content.indexOf('channels:');
    if (channelsIdx !== -1) {
      let braceCount = 0;
      let startBrace = -1;
      let endBrace = -1;
      for (let i = channelsIdx; i < content.length; i++) {
        if (content[i] === '{') {
          if (braceCount === 0) startBrace = i;
          braceCount++;
        } else if (content[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endBrace = i;
            break;
          }
        }
      }

      if (startBrace !== -1 && endBrace !== -1) {
        const before = content.slice(0, channelsIdx);
        const chanBlock = content.slice(channelsIdx, endBrace + 1);
        const after = content.slice(endBrace + 1);

        let updatedBefore = before.replace(/(\bversion:\s*)(['"])[^'"]+\2/, `$1$2${newVersion}$2`);
        updatedBefore = updatedBefore.replace(/(\brevision:\s*)\d+/, '$10');

        let updatedAfter = after;
        if (updatedBefore === before) {
          updatedAfter = after.replace(/(\bversion:\s*)(['"])[^'"]+\2/, `$1$2${newVersion}$2`);
          updatedAfter = updatedAfter.replace(/(\brevision:\s*)\d+/, '$10');
        }
        content = updatedBefore + chanBlock + updatedAfter;
      } else {
        content = content.replace(/(\bversion:\s*)(['"])[^'"]+\2/, `$1$2${newVersion}$2`);
        content = content.replace(/(\brevision:\s*)\d+/, '$10');
      }
    } else {
      content = content.replace(/(\bversion:\s*)(['"])[^'"]+\2/, `$1$2${newVersion}$2`);
      content = content.replace(/(\brevision:\s*)\d+/, '$10');
    }
  } else {
    // Escape regex metacharacters in channel and match key boundary
    const escaped = channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const channelRegex = new RegExp(`(^|\\s|["'])(${escaped})(["']?\\s*:\\s*\\{[\\s\\S]*?\\})`);
    content = content.replace(channelRegex, (match, p1, p2, block) => {
      let updatedBlock = block.replace(/(\bversion:\s*)(['"])[^'"]+\2/, `$1$2${newVersion}$2`);
      updatedBlock = updatedBlock.replace(/(\brevision:\s*)\d+/, '$10');
      return `${p1}${p2}${updatedBlock}`;
    });
  }

  if (content === original) {
    throw new Error(
      `Failed to update version to ${newVersion} for channel ${channel}: target version property not found or unchanged.`,
    );
  }

  return content;
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
