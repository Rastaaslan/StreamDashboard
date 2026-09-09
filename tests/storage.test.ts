import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { AtomicJsonStore, DASHBOARD_SCHEMA_VERSION, MemorySecretStore, migratePlaintextTwitchTokens } from '../apps/server/src/storage.js';
let directory = '';
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = ''; });
async function location() { directory = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-storage-')); return path.join(directory, 'config', 'dashboard.json'); }

describe('persistance applicative', () => {
  it('écrit atomiquement et ne laisse aucun fichier temporaire', async () => {
    const file = await location(); const store = new AtomicJsonStore(file);
    await store.write({ schemaVersion: 2, value: 'ok' });
    expect(JSON.parse(await readFile(file, 'utf8'))).toMatchObject({ value: 'ok' });
    expect((await readdir(path.dirname(file))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
  it('met en quarantaine une configuration corrompue', async () => {
    const file = await location(); await writeFile(file, '{cassé', { encoding: 'utf8', flag: 'w' }).catch(async () => { const store = new AtomicJsonStore(file); await store.write({ value: 'seed' }); await writeFile(file, '{cassé'); });
    const result = await new AtomicJsonStore<{ value: string }>(file).read({ value: 'fallback' });
    expect(result.value).toBe('fallback'); expect((await readdir(path.dirname(file))).some(name => name.includes('.corrupt-'))).toBe(true);
  });
  it('migre les tokens en stockage secret puis nettoie le JSON de façon idempotente', async () => {
    const memory = new MemorySecretStore(); const retained = { schemaVersion: 1, twitch: { accessToken: 'a', refreshToken: 'r', displayName: 'Public' } };
    expect(await migratePlaintextTwitchTokens(retained, memory)).toBe(false);
    expect(retained.twitch.accessToken).toBe('a');
    const secrets = Object.assign(new MemorySecretStore(), { persistent: true as const }); const data = { schemaVersion: 1, twitch: { accessToken: 'a', refreshToken: 'r', displayName: 'Public' } };
    expect(await migratePlaintextTwitchTokens(data, secrets)).toBe(true);
    expect(await secrets.getTwitchTokens()).toEqual({ accessToken: 'a', refreshToken: 'r' });
    expect(data).toEqual({ schemaVersion: DASHBOARD_SCHEMA_VERSION, twitch: { displayName: 'Public' } });
    expect(await migratePlaintextTwitchTokens(data, secrets)).toBe(false);
  });
});
