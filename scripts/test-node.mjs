import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
async function discover(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => entry.isDirectory()
    ? discover(`${directory}/${entry.name}`)
    : entry.name.endsWith('.test.mjs') ? [`${directory}/${entry.name}`] : []))).flat();
}
const files = (await discover('tests')).sort();
if (!files.length) throw new Error('No Node tests discovered');
const result = spawnSync(process.execPath, ['--test', '--test-concurrency=2', ...files], { stdio: 'inherit' });
if (result.error) throw result.error;
process.exit(result.status ?? 1);
