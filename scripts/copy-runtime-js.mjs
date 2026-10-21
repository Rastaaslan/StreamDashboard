import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const runtimeFiles = [
  'apps/mobile/runtime.js',
  'apps/mobile/shared/autonomy.js',
  'apps/mobile/shared/configuration-transfer.js',
  'apps/mobile/shared/sound-library.js',
  'apps/mobile/shared/planning-handoff.js',
  'apps/mobile/shared/installation.js',
  'apps/mobile/shared/device-permissions.js',
  'apps/mobile/shared/action-definition.js',
  'apps/mobile/shared/youtube-chat.js',
  'packages/core/src/recurrence.js',
  'apps/mobile/shared/recurrence.js',
  'apps/mobile/shared/publication-content.js',
];

for (const source of runtimeFiles) {
  const destination = path.join('dist', source);
  await mkdir(path.dirname(destination), { recursive: true });
  await copyFile(source, destination);
}

console.log(`Runtime JS copied to dist (${runtimeFiles.length} files)`);
