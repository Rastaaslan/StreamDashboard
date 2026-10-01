import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await server?.stop(); server = undefined; if (dataDir) await rm(dataDir, { recursive: true, force: true }); });
async function start(clientId = 'desktop-client', providerError = '') {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-errors-'));
  server = await startDashboardServer({ port: 0, dataDir, googleClientId: clientId, secretStore: new MemorySecretStore(),
    googleFetch: async () => Response.json({ error: providerError }, { status: 400 }), logger: { info() {}, warn() {}, error() {} } });
  return server;
}
it('reports missing public Desktop configuration explicitly', async () => {
  const app = await start('');
  const res = await fetch(app.url + '/api/v1/google/oauth/start', { method: 'POST' });
  expect(res.ok).toBe(false);
  expect(await res.text()).toContain('GOOGLE_CLIENT_ID');
});
it.each(['invalid_client', 'redirect_uri_mismatch'])('reports %s with exact redirect and credential type', async error => {
  const app = await start('desktop-client', error);
  const { authorizationUrl } = await fetch(app.url + '/api/v1/google/oauth/start', { method: 'POST' }).then(r => r.json());
  const auth = new URL(authorizationUrl);
  const redirect = auth.searchParams.get('redirect_uri')!;
  const res = await fetch(`${redirect}?state=${auth.searchParams.get('state')}&code=mock`);
  expect(res.status).toBe(400);
  expect(await res.text()).toContain(error);
  expect(app.state().google?.error).toContain(redirect);
  expect(app.state().google?.error).toContain('Desktop');
  expect(app.state().google?.connected).toBe(false);
});
it('reports provider denial', async () => {
  const app = await start();
  const { authorizationUrl } = await fetch(app.url + '/api/v1/google/oauth/start', { method: 'POST' }).then(r => r.json());
  const auth = new URL(authorizationUrl);
  const res = await fetch(`${auth.searchParams.get('redirect_uri')}?state=${auth.searchParams.get('state')}&error=access_denied`);
  expect(res.status).toBe(400);
  expect(app.state().google?.error).toContain('access_denied');
});
it('keeps repeated clicks on the PKCE deadline, expires, then reconnects successfully', async () => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-deadline-'));
  const secrets = new MemorySecretStore();
  const provider = vi.fn(async (url: string | URL | Request) => String(url).includes('/token')
    ? Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 3600 })
    : Response.json({ items: [] }));
  server = await startDashboardServer({ port: 0, dataDir, googleClientId: 'deadline-client', secretStore: secrets,
    googleFetch: provider, logger: { info() {}, warn() {}, error() {} } });
  const app = server;
  // Keep HTTP/intervals real, but advance both the PKCE clock and OAuth timeout.
  vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
  const begin = async () => new URL((await fetch(app.url + '/api/v1/google/oauth/start', { method: 'POST' }).then(r => r.json())).authorizationUrl);
  const callback = (auth: URL) => fetch(`${auth.searchParams.get('redirect_uri')}?state=${auth.searchParams.get('state')}&code=mock`);
  const first = await begin();
  await vi.advanceTimersByTimeAsync(9 * 60_000);
  expect((await begin()).href).toBe(first.href);
  await vi.advanceTimersByTimeAsync(60_000 - 1);
  expect(app.state().google?.error).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(app.state().google?.error).toContain('Callback Google non reçu');
  await vi.advanceTimersByTimeAsync(60_000);
  expect((await callback(first)).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
  const renewed = await begin();
  expect(renewed.searchParams.get('state')).not.toBe(first.searchParams.get('state'));
  expect(renewed.searchParams.get('code_challenge')).not.toBe(first.searchParams.get('code_challenge'));
  expect(app.state().google?.error).toBeNull();
  await vi.advanceTimersByTimeAsync(9 * 60_000);
  expect((await callback(renewed)).status).toBe(200);
  expect(app.state().google?.connected).toBe(true);
  expect((await secrets.getGoogleTokens())?.refreshToken).toBe('refresh');
  await vi.advanceTimersByTimeAsync(2 * 60_000);
  expect(app.state().google?.error).toBeNull();
});
