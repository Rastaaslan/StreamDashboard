import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const roots = ['apps/mobile', 'apps/web'];
const files = [];
async function walk(folder) {
  for (const entry of await readdir(folder, { withFileTypes: true })) {
    const value = path.join(folder, entry.name);
    if (entry.isDirectory()) await walk(value);
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(value);
  }
}
for (const root of roots) await walk(root);
for (const file of files.sort()) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); process.exit(result.status || 1); }
}
console.log(`JavaScript syntax OK (${files.length} shipped files)`);
