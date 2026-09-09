import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopLogger } from '../apps/desktop/src/logger.js';
let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });
describe('logs desktop', () => {
  it('expurge tous les secrets connus', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-logs-')); const logger = new DesktopLogger(directory);
    await logger.error({ accessToken: 'access-value', refresh_token: 'refresh-value', deviceCode: 'device-value', obsPassword: 'obs-value' }, 'Authorization: Bearer bearer-value');
    const contents = await readFile(logger.file, 'utf8');
    expect(contents).toContain('[REDACTED]');
    for (const secret of ['access-value', 'refresh-value', 'device-value', 'obs-value', 'bearer-value']) expect(contents).not.toContain(secret);
  });
});
