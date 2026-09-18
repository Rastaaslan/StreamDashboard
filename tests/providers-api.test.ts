import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

let server: DashboardServerHandle | undefined; let folder = '';
afterEach(async () => { await server?.stop(); if (folder) await rm(folder, { recursive: true, force: true }); server = undefined; });

describe('API providers', () => {
  it('configure, teste et déconnecte Streamlabs sans exposer son secret', async () => {
    folder = await mkdtemp(join(tmpdir(), 'streamdashboard-providers-'));
    const secrets = new MemorySecretStore(); const close = vi.fn(async () => undefined);
    const transport = { connect: vi.fn(async (_token: string) => close) };
    server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, streamlabsTransport: transport });
    const call = (path: string, method = 'GET', body?: unknown) => fetch(server!.url + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(await (await call('/api/v1/supports/streamlabs/config', 'PUT', { token: 'private-streamlabs' })).json()).toMatchObject({ status: 'CONNECTED' });
    expect(await secrets.getStreamlabsToken()).toBe('private-streamlabs');
    const state = await call('/api/v1/state').then(value => value.text()); expect(state).not.toContain('private-streamlabs');
    const test = await call('/api/v1/supports/streamlabs/test', 'POST').then(value => value.json()); expect(test).toMatchObject({ test: true, support: { provider: 'streamlabs', message: '[TEST] Soutien Streamlabs' } });
    const supports = await call('/api/v1/supports').then(value => value.json()); expect(supports.history).toHaveLength(1);
    expect(await (await call('/api/v1/supports/streamlabs/config', 'DELETE')).json()).toMatchObject({ status: 'NOT_CONFIGURED' });
    expect(await secrets.getStreamlabsToken()).toBe('');
  });

  it('configure, rafraîchit et déconnecte WizeBot sans exposer son token', async () => {
    folder = await mkdtemp(join(tmpdir(), 'streamdashboard-wizebot-'));
    const secrets = new MemorySecretStore(); const transport = { status: vi.fn(async () => ({ name: 'CampBot', connected: true })) };
    server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, wizebotTransport: transport });
    const call = (path: string, method = 'GET', body?: unknown) => fetch(server!.url + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    expect(await (await call('/api/v1/wizebot/config', 'PUT', { apiBaseUrl: 'https://api.wizebot.example/status', token: 'private-wizebot' })).json()).toMatchObject({ status: 'CONNECTED', profile: { name: 'CampBot' } });
    expect(await (await call('/api/v1/wizebot/refresh', 'POST')).json()).toMatchObject({ status: 'CONNECTED' });
    expect(await call('/api/v1/state').then(value => value.text())).not.toContain('private-wizebot');
    expect(await (await call('/api/v1/wizebot/config', 'DELETE')).json()).toMatchObject({ status: 'NOT_CONFIGURED' });
    expect(await secrets.getWizeBotConfiguration()).toBeNull();
  });
});
