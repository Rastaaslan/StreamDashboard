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

  it('connecte Streamlabs par OAuth sans exposer les secrets', async () => {
    folder = await mkdtemp(join(tmpdir(), 'streamdashboard-streamlabs-oauth-'));
    const secrets = new MemorySecretStore();
    const close = vi.fn(async () => undefined);
    const transport = { connect: vi.fn(async (_token: string) => close) };
    const streamlabsFetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url === 'https://streamlabs.com/api/v2.0/token') {
        expect(init?.method).toBe('POST');
        expect(JSON.parse(String(init?.body))).toMatchObject({
          grant_type: 'authorization_code',
          client_id: 'client-id',
          client_secret: 'client-secret',
          code: 'oauth-code',
        });
        return new Response(JSON.stringify({ access_token: 'access-secret' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (url === 'https://streamlabs.com/api/v2.0/socket/token') {
        expect(new Headers(init?.headers).get('authorization')).toBe('Bearer access-secret');
        return new Response(JSON.stringify({ socket_token: 'socket-secret' }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`Unexpected Streamlabs URL ${url}`);
    });
    server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, streamlabsTransport: transport, streamlabsFetch });
    const call = (path: string, method = 'GET', body?: unknown) => fetch(server!.url + path, { method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });

    const configured = await (await call('/api/v1/supports/streamlabs/oauth/config', 'PUT', { clientId: 'client-id', clientSecret: 'client-secret' })).json();
    expect(configured).toMatchObject({ configured: true, authorized: false, connected: false, scope: 'socket.token' });
    expect(await secrets.getStreamlabsOAuth()).toEqual({ clientId: 'client-id', clientSecret: 'client-secret' });

    const started = await (await call('/api/v1/supports/streamlabs/oauth/start', 'POST')).json() as { authorizationUrl: string };
    const authorization = new URL(started.authorizationUrl);
    expect(authorization.origin + authorization.pathname).toBe('https://streamlabs.com/api/v2.0/authorize');
    expect(authorization.searchParams.get('client_id')).toBe('client-id');
    expect(authorization.searchParams.get('scope')).toBe('socket.token');
    expect(authorization.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:47832/api/v1/supports/streamlabs/oauth/callback');
    const state = authorization.searchParams.get('state');
    expect(state).toMatch(/^streamlabs_/);

    const callback = await call(`/api/v1/supports/streamlabs/oauth/callback?code=oauth-code&state=${encodeURIComponent(state!)}`);
    expect(callback.status).toBe(200);
    expect(await callback.text()).toContain('Streamlabs connecté');
    expect(transport.connect).toHaveBeenCalledWith('socket-secret', expect.any(Function), expect.any(Function));
    expect(await secrets.getStreamlabsToken()).toBe('socket-secret');
    expect(await secrets.getStreamlabsOAuth()).toEqual({ clientId: 'client-id', clientSecret: 'client-secret', accessToken: 'access-secret' });

    const publicState = await call('/api/v1/state').then(value => value.text());
    for (const secret of ['client-secret', 'access-secret', 'socket-secret']) expect(publicState).not.toContain(secret);
    const status = await call('/api/v1/supports/streamlabs/oauth/status').then(value => value.json());
    expect(status).toMatchObject({ configured: true, authorized: true, connected: true });
    expect(JSON.stringify(status)).not.toContain('client-secret');
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
