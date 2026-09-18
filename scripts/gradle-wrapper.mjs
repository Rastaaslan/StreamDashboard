import { spawnSync } from 'node:child_process';
import path from 'node:path';

const wrapper = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(wrapper, process.argv.slice(2), {
  cwd: path.resolve('android'),
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
