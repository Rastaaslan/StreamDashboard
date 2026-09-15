import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const runtimeFiles = [
  'packages/core/src/recurrence.js',
  'apps/mobile/shared/recurrence.js',
];

for (const source of runtimeFiles) {
  const destination = path.join('dist', source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(`Runtime JS copied to dist (${runtimeFiles.length} files)`);
