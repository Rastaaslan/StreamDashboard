import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { DesktopLogger } from '../apps/desktop/src/logger.js';
let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });

describe('logs desktop', () => {
  it('expurge tous les secrets connus, y compris Authorization JSON', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-logs-')); const logger = new DesktopLogger(directory);
    await logger.error({ accessToken: 'access-value', refresh_token: 'refresh-value', deviceCode: 'device-value', obsPassword: 'obs-value', Authorization: 'Bearer bearer-json' }, 'Authorization: Bearer bearer-value');
    const contents = await readFile(logger.file, 'utf8');
    expect(contents).toContain('[REDACTED]');
    for (const secret of ['access-value', 'refresh-value', 'device-value', 'obs-value', 'bearer-value', 'bearer-json']) expect(contents).not.toContain(secret);
  });

  it('sérialise plusieurs écritures simultanées sans perdre de lignes', async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-logs-')); const logger = new DesktopLogger(directory);
    await Promise.all(Array.from({ length: 30 }, (_, index) => logger.info(`line-${index}`)));
    await logger.flush();
    const contents = await readFile(logger.file, 'utf8');
    for (let index = 0; index < 30; index++) expect(contents).toContain(`line-${index}`);
  });
});
