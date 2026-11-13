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
  if (channel === 'latest') {
    // Update top-level version
    content = content.replace(/(\bversion:\s*)"[^"]+"/, `$1"${newVersion}"`);
    // Reset top-level revision
    content = content.replace(/(\brevision:\s*)\d+/, '$10');
  } else {
    // Channel specific update: locate channel block
    const channelRegex = new RegExp(`(["']?${channel}["']?\\s*:\\s*\\{[\\s\\S]*?\\})`);
    content = content.replace(channelRegex, (block) => {
      let updatedBlock = block.replace(/(\bversion:\s*)"[^"]+"/, `$1"${newVersion}"`);
      updatedBlock = updatedBlock.replace(/(\brevision:\s*)\d+/, '$10');
      return updatedBlock;
    });
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
