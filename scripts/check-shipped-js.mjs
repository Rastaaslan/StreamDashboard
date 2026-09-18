import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

const roots = ['apps/mobile', 'apps/web'];

async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? discover(target) : [target];
  }));
  return files.flat();
}

const files = (await Promise.all(roots.map(discover)))
  .flat()
  .filter(file => /\.(?:js|mjs|cjs)$/.test(file))
  .sort();

if (!files.length) throw new Error('No shipped JavaScript files were discovered.');
for (const file of files) execFileSync(process.execPath, ['--check', file], { stdio: 'inherit' });
console.log(`Shipped JavaScript syntax OK (${files.length} files)`);
