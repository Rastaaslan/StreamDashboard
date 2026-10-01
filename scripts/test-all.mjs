import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
// Use the OS temp directory normally; restricted runners may use the npm cache.
// Never place test scratch data inside the sources or the packaged application.
const root = process.cwd();
const outsideRepo = directory => { const relative = path.relative(root, path.resolve(directory)); return relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative); };
let scratch;
for (const base of [tmpdir(), path.join(process.env.npm_config_cache || path.join(homedir(), '.npm'), 'test-tmp')]) {
  if (!outsideRepo(base)) continue;
  try { mkdirSync(base, { recursive: true }); scratch = mkdtempSync(path.join(base, 'streamdashboard-tests-')); break; } catch { /* restricted OS temporary directory */ }
}
if (!scratch) throw new Error('A writable temporary directory outside the repository is required.');
const env = { ...process.env, TMPDIR: scratch, TMP: scratch, TEMP: scratch };
let status = 1;
try {
  const unit = spawnSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run'], { stdio: 'inherit', env });
  if (unit.error) throw unit.error;
  status = unit.status ?? 1;
  if (!status) {
    const node = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'test:node'], { stdio: 'inherit', env, shell: process.platform === 'win32' });
    if (node.error) throw node.error;
    status = node.status ?? 1;
  }
} finally { rmSync(scratch, { recursive: true, force: true }); }
process.exitCode = status;
