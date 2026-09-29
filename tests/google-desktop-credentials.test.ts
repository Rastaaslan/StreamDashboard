import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import { WebSocket } from 'ws';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { toRemoteDashboardState } from '../apps/server/src/remote-policy.js';

let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => {
  await server?.stop(); server = undefined;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});
const credential = 'test-google-backend-credential';
const clientId = 'credential-test.apps.googleusercontent.com';

async function callback(app: DashboardServerHandle) {
  const start = await fetch(app.url + '/api/v1/google/oauth/start', { method: 'POST' });
  expect(start.status).toBe(201);
  const body = await start.text();
  expect(body).not.toContain(credential);
  const auth = new URL(JSON.parse(body).authorizationUrl);
  expect(auth.searchParams.has('client_secret')).toBe(false);
  expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
  const response = await fetch(`${auth.searchParams.get('redirect_uri')}?state=${auth.searchParams.get('state')}&code=test-code`);
  return { response, auth };
}

it.each(['public', 'environment', 'option', 'explicit-public'] as const)(
  'Desktop %s: exchange and refresh preserve PKCE and backend credential boundaries', async mode => {
    const expected = mode === 'environment' || mode === 'option' ? credential : '';
    vi.stubEnv('GOOGLE_CLIENT_SECRET', mode === 'environment' ? ` ${credential} ` : mode === 'explicit-public' ? credential : '');
    dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-credentials-'));
    const secrets = new MemorySecretStore();
    const requests: URLSearchParams[] = [];
    const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    server = await startDashboardServer({ port: 0, dataDir, googleClientId: clientId, secretStore: secrets, logger,
      ...(mode === 'option' ? { googleClientSecret: ` ${credential} ` } : mode === 'explicit-public' ? { googleClientSecret: '' } : {}),
      googleFetch: async (url, init) => {
        if (String(url) === 'https://oauth2.googleapis.com/token') {
          const body = new URLSearchParams(String(init?.body));
          requests.push(body);
          expect(body.get('client_secret')).toBe(expected || null);
          // Expire the initial token to exercise refresh through the actual server.
          return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: body.get('grant_type') === 'authorization_code' ? 0 : 3600 });
        }
        return Response.json({ items: [] });
      },
    });
    const { response, auth } = await callback(server);
    expect(response.status, await response.text()).toBe(200);
    expect(requests.map(body => body.get('grant_type'))).toEqual(['authorization_code', 'refresh_token']);
    expect(requests[0].get('redirect_uri')).toBe(auth.searchParams.get('redirect_uri'));
    expect(createHash('sha256').update(requests[0].get('code_verifier')!).digest('base64url')).toBe(auth.searchParams.get('code_challenge'));
    expect(requests[1].get('refresh_token')).toBe('test-refresh');
    expect(server.state().google?.connected).toBe(true);
    for (const route of ['/api/v1/state', '/api/v1/connections']) {
      const result = await fetch(server.url + route);
      expect(result.status).toBe(200);
      expect(await result.text()).not.toContain(credential);
    }
    expect(JSON.stringify(server.state())).not.toContain(credential);
    expect(JSON.stringify(toRemoteDashboardState(server.state()))).not.toContain(credential);
    expect(JSON.stringify(await secrets.getGoogleTokens())).not.toContain(credential);
    expect(JSON.stringify(Object.values(logger).map(fn => fn.mock.calls))).not.toContain(credential);
    await server.stop(); server = undefined;
    for (const file of await readdir(dataDir, { recursive: true, withFileTypes: true })) {
      if (file.isFile()) expect(await readFile(path.join(file.parentPath, file.name), 'utf8')).not.toContain(credential);
    }
    const distribution = JSON.parse(await readFile('resources/distribution.json', 'utf8'));
    expect(Object.keys(distribution).sort()).toEqual(['googleClientId', 'twitchClientId']);
  },
);

it('reproduces client_secret is missing, saves locally, retries immediately, refreshes, restores and clears', async () => {
  vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-missing-secret-'));
  const secrets = new MemorySecretStore();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const grants: string[] = [];
  const options = { port: 0, host: '0.0.0.0', remoteEnabled: true, dataDir, googleClientId: clientId, secretStore: secrets, logger,
    googleFetch: (async (url, init) => {
      if (String(url) === 'https://oauth2.googleapis.com/token') {
        const body = new URLSearchParams(String(init?.body));
        if (body.get('client_secret') !== credential) return Response.json({ error: 'invalid_request', error_description: 'client_secret is missing.' }, { status: 400 });
        grants.push(body.get('grant_type')!);
        return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: body.get('grant_type') === 'authorization_code' ? 0 : 3600 });
      }
      return Response.json({ items: [] });
    }) as typeof fetch,
  };
  server = await startDashboardServer(options);
  const failed = await callback(server);
  expect(failed.response.status).toBe(400);
  expect(await failed.response.text()).toContain('Connexion Google impossible : invalid_request: client_secret is missing.');
  expect(server.state().google?.connected).toBe(false);
  expect(await secrets.getGoogleTokens()).toBeNull();
  expect(server.state().google?.error).toContain('Application > Connexions > Google');
  const messages: string[] = [];
  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/ws/v1');
  ws.on('message', data => messages.push(String(data)));
  await new Promise<void>(resolve => ws.once('open', resolve));
  try {
  const saved = await fetch(server.url + '/api/v1/google/oauth/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientSecret: credential }) });
  expect(await saved.json()).toEqual({ clientSecretConfigured: true });
  expect(await secrets.getGoogleClientSecret()).toBe(credential);
  const success = await callback(server);
  expect(success.response.status, await success.response.text()).toBe(200);
  expect(server.state().google?.connected).toBe(true);
  expect(server.state().google?.error).toBeNull();
  expect(grants).toEqual(['authorization_code', 'refresh_token']);
  for (const route of ['/api/v1/state', '/api/v1/connections', '/api/v1/google/oauth/config', '/preview/']) {
    const result = await fetch(server.url + route);
    expect(result.status).toBe(200);
    expect(await result.text()).not.toContain(credential);
  }
  expect(messages.length).toBeGreaterThan(0);
  expect(messages.join('')).not.toContain(credential);
  expect(JSON.stringify(Object.values(logger).map(fn => fn.mock.calls))).not.toContain(credential);
  const lan = Object.values(os.networkInterfaces()).flat().find(item => item?.family === 'IPv4' && !item.internal)!.address;
  const remote = `http://${lan}:${server.port}`;
  const pairing = await fetch(server.url + '/api/v1/remote/pairing', { method: 'POST' }).then(r => r.json());
  const device = await fetch(remote + '/api/v1/remote/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(pairing) }).then(r => r.json());
  const headers = { authorization: `Device ${device.credential}`, 'content-type': 'application/json' };
  for (const method of ['GET', 'POST', 'DELETE']) expect((await fetch(remote + '/api/v1/google/oauth/config', { method, headers })).status).toBe(403);
  const remoteState = await fetch(remote + '/api/v1/state', { headers }).then(r => r.text());
  expect(remoteState).not.toContain(credential);
  expect(remoteState).not.toContain('clientSecretConfigured');
  } finally { ws.terminate(); }
  await server.stop(); server = undefined;
  server = await startDashboardServer(options);
  expect(server.state().google?.clientSecretConfigured).toBe(true);
  const cleared = await fetch(server.url + '/api/v1/google/oauth/config', { method: 'DELETE' });
  expect(await cleared.json()).toEqual({ clientSecretConfigured: false });
  expect(await secrets.getGoogleClientSecret()).toBe('');
  expect(server.state().google?.clientSecretConfigured).toBe(false);
  await fetch(server.url + '/api/v1/google/disconnect', { method: 'POST' });
  expect((await callback(server)).response.status).toBe(400);
});

it('prefers secure storage, preserves credentials on failed writes, and returns to the environment on clear', async () => {
  vi.stubEnv('GOOGLE_CLIENT_SECRET', 'environment-google-value');
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-fallback-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleClientSecret(credential);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const bodies: URLSearchParams[] = [];
  server = await startDashboardServer({ port: 0, dataDir, googleClientId: clientId, secretStore: secrets, logger,
    googleFetch: async (url, init) => {
      if (String(url).endsWith('/token')) {
        const body = new URLSearchParams(String(init?.body)); bodies.push(body);
        // Simulate a provider echoing a credential in its error details.
        return Response.json({ error: 'invalid_client', error_description: `rejected ${body.get('client_secret')}` }, { status: 400 });
      }
      return Response.json({ items: [] });
    },
  });
  const failed = await callback(server);
  expect(await failed.response.text()).not.toContain(credential);
  expect(bodies[0].get('client_secret')).toBe(credential);
  expect(JSON.stringify(server.state())).not.toContain(credential);
  expect(JSON.stringify(Object.values(logger).map(fn => fn.mock.calls))).not.toContain(credential);
  const write = vi.spyOn(secrets, 'setGoogleClientSecret').mockRejectedValue(new Error(credential));
  const rejected = await fetch(server.url + '/api/v1/google/oauth/config', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientSecret: credential }) });
  expect(rejected.status).toBe(503);
  expect(await rejected.text()).not.toContain(credential);
  expect(await secrets.getGoogleClientSecret()).toBe(credential);
  write.mockRestore();
  const cleared = await fetch(server.url + '/api/v1/google/oauth/config', { method: 'DELETE' });
  expect(await cleared.json()).toEqual({ clientSecretConfigured: true });
  expect(await secrets.getGoogleClientSecret()).toBe('');
  await callback(server);
  expect(bodies[1].get('client_secret')).toBe('environment-google-value');
  expect(JSON.stringify(Object.values(logger).map(fn => fn.mock.calls))).not.toContain('environment-google-value');
});

const lateErrorCases = (['authorization_code', 'refresh_token'] as const).flatMap(grant =>
  (['clear', 'replace'] as const).flatMap(change =>
    ([400, 503, 'network'] as const).map(failure => ({ grant, change, failure })),
  ),
);
it.each(lateErrorCases)('redacts delayed $grant $failure errors after secret $change', async ({ grant, change, failure }) => {
  vi.stubEnv('GOOGLE_CLIENT_SECRET', '');
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-late-error-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleClientSecret(credential);
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let release!: () => void;
  const delayed = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void;
  const inFlight = new Promise<void>(resolve => { started = resolve; });
  let sentSecret: string | null = null;
  server = await startDashboardServer({ port: 0, dataDir, googleClientId: clientId, secretStore: secrets, logger,
    googleFetch: async (url, init) => {
      if (!String(url).endsWith('/token')) return Response.json({ items: [] });
      const body = new URLSearchParams(String(init?.body));
      if (body.get('grant_type') !== grant) {
        return Response.json({ access_token: 'test-access', refresh_token: 'test-refresh', expires_in: 0 });
      }
      sentSecret = body.get('client_secret');
      started();
      await delayed;
      if (failure === 'network') throw new Error(`network rejected ${sentSecret}`);
      return Response.json({ error: 'invalid_client', error_description: `rejected ${sentSecret}` }, { status: failure });
    },
  });
  const messages: string[] = [];
  const ws = new WebSocket(server.url.replace('http:', 'ws:') + '/ws/v1');
  ws.on('message', data => messages.push(String(data)));
  await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
  try {
    const pending = callback(server);
    await inFlight;
    expect(sentSecret).toBe(credential);
    const updated = await fetch(server.url + '/api/v1/google/oauth/config', change === 'clear'
      ? { method: 'DELETE' }
      : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientSecret: 'replacement-google-value' }) });
    expect(updated.status).toBe(200);
    expect(server.state().google?.clientSecretConfigured).toBe(change === 'replace');
    release();
    const { response } = await pending;
    expect(response.status).toBe(400);
    const text = await response.text();
    expect(text).not.toContain(credential);
    // Refresh 400 invalidates the session; all other errors retain a redacted diagnostic.
    if (grant !== 'refresh_token' || failure !== 400) expect(text).toContain('[REDACTED]');
    for (const route of ['/api/v1/state', '/api/v1/connections']) {
      const result = await fetch(server.url + route);
      expect(result.status).toBe(200);
      expect(await result.text()).not.toContain(credential);
    }
    expect(JSON.stringify(server.state())).not.toContain(credential);
    expect(JSON.stringify(toRemoteDashboardState(server.state()))).not.toContain(credential);
    await expect.poll(() => messages.some(message => JSON.parse(message).data?.google?.error)).toBe(true);
    expect(messages.join('')).not.toContain(credential);
    expect(logger.error).toHaveBeenCalled();
    for (const call of logger.error.mock.calls) {
      expect(call.map(value => value instanceof Error ? value.stack : String(value)).join(' ')).not.toContain(credential);
    }
  } finally { release(); ws.terminate(); }
});
