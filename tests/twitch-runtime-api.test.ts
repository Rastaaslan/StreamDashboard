import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { toRemoteDashboardState } from '../apps/server/src/remote-policy.js';

let server: DashboardServerHandle | undefined;
let folder = '';
afterEach(async () => { await server?.stop(); vi.restoreAllMocks(); vi.unstubAllGlobals(); if (folder) await rm(folder, { recursive: true, force: true }); });

it('keeps runtime and mobile coherent across chatter errors, offline, scope loss and token expiry', async () => {
  folder = await mkdtemp(join(tmpdir(), 'cb15-'));
  const secrets = new MemorySecretStore();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, logger });
  await server.stop();
  const file = join(folder, 'dashboard.json');
  const local = JSON.parse(await readFile(file, 'utf8'));
  local.twitch = { broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
  await writeFile(file, JSON.stringify(local));
  await secrets.setTwitchTokens({ accessToken: 'private-access', refreshToken: '' });
  let streamStatus = 200, chatterStatus = 200, scopes = ['moderator:read:chatters', 'clips:edit'];
  let live = true;
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://')) return nativeFetch(input, init);
    const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'retry-after': '12' } });
    if (url.includes('/validate')) return json({ client_id: 'client', user_id: '42', scopes });
    if (url.includes('/channels?')) return json({ data: [{ title: 'Title', game_id: '1', game_name: 'Category' }] });
    if (url.includes('/streams?')) return streamStatus !== 200 ? json({ message: 'private-access' }, streamStatus) : json({ data: live ? [{ title: 'Live', game_id: '1', game_name: 'Category', started_at: '2026-09-28T10:00:00Z', viewer_count: 17 }] : [] });
    if (url.includes('/chat/chatters?')) return chatterStatus !== 200 ? json({ message: 'private-access' }, chatterStatus) : json({ data: [{ user_id: '123', user_name: 'Chatter', user_login: 'chatter' }], total: 1 });
    throw new Error('Unexpected provider request');
  }));
  const timers = new Map<number, () => void>();
  const nativeInterval = globalThis.setInterval;
  vi.spyOn(globalThis, 'setInterval').mockImplementation(((callback: () => void, delay: number) => { timers.set(delay, callback); return nativeInterval(callback, delay); }) as typeof setInterval);
  server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', logger });
  await server.providersReady;
  const remote = () => toRemoteDashboardState(server!.state());
  expect(logger.error.mock.calls).toEqual([]);
  expect(remote().controlHub?.audience).toMatchObject({ viewerCount: 17, chatters: [{ id: '123' }] });
  expect(remote().twitch.capabilities).toMatchObject({ chatters: true, chatWrite: false });
  expect(JSON.stringify(remote())).not.toContain('private-access');
  const denied = await nativeFetch(server.url + '/api/v1/twitch/videos/123', { method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ confirmation: 'DELETE 123' }) });
  expect(denied.status).toBe(403);
  chatterStatus = 429; live = false; timers.get(30_000)!();
  await vi.waitFor(() => expect(remote().controlHub?.live.isLive).toBe(false));
  await vi.waitFor(() => expect(remote().controlHub?.audience.chatters).toEqual([]));
  expect(remote().controlHub?.audience.viewerCount).toBeNull();
  const offline = await nativeFetch(server.url + '/api/v1/twitch/clips', { method: 'POST' }); expect(offline.status).toBe(409);
  const limited = await nativeFetch(server.url + '/api/v1/twitch/chatters'); expect(limited.status).toBe(429); expect(limited.headers.get('retry-after')).toBe('12'); expect(await limited.text()).not.toContain('private-access');
  scopes = []; timers.get(60 * 60_000)!();
  await vi.waitFor(() => expect(remote().twitch.capabilities?.chatters).toBe(false));
  expect(remote().twitch.connected).toBe(true);
  streamStatus = 401; timers.get(30_000)!();
  await vi.waitFor(() => expect(remote().twitch.connected).toBe(false));
  await vi.waitFor(() => expect(remote().twitch.channelTitle).toBeNull());
  expect(remote().controlHub?.audience).toEqual({ viewerCount: null, chatters: [] });
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-access');
});

it.each([
  { endpoint: '/users', status: 429 },
  { endpoint: '/users', status: 503 },
  { endpoint: '/validate', status: 429 },
  { endpoint: '/validate', status: 503 },
])('retains the complete old session when reauthorization $endpoint returns $status', async ({ endpoint, status }) => {
  folder = await mkdtemp(join(tmpdir(), 'cb15-reauth-'));
  const secrets = new MemorySecretStore();
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, logger });
  await server.stop();
  const file = join(folder, 'dashboard.json');
  const local = JSON.parse(await readFile(file, 'utf8'));
  local.twitch = { broadcasterId: '42', userName: 'old-account', displayName: 'Old Account' };
  await writeFile(file, JSON.stringify(local));
  const oldTokens = { accessToken: 'private-old', refreshToken: 'private-old-refresh' };
  await secrets.setTwitchTokens(oldTokens);
  const nativeFetch = globalThis.fetch;
  const requests: Array<{ path: string; auth: string | null }> = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.protocol !== 'https:') return nativeFetch(input, init);
    const auth = new Headers(init?.headers).get('authorization');
    requests.push({ path: url.pathname, auth });
    const json = (value: unknown, code = 200) => new Response(JSON.stringify(value), { status: code });
    const candidate = auth?.includes('private-new');
    if (candidate && url.pathname.endsWith(endpoint)) return json({ message: 'private-new private-new-refresh' }, status);
    if (url.pathname.endsWith('/device')) return json({ device_code: 'private-device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 1 });
    if (url.pathname.endsWith('/token')) return json({ access_token: 'private-new', refresh_token: 'private-new-refresh' });
    if (url.pathname.endsWith('/users')) return json({ data: [{ id: '99', login: 'new-account', display_name: 'New Account' }] });
    if (url.pathname.endsWith('/validate')) return json({ client_id: 'client', user_id: candidate ? '99' : '42', scopes: candidate ? ['channel:manage:videos'] : ['clips:edit'] });
    if (url.pathname.endsWith('/channels')) { expect(auth).toBe('Bearer private-old'); expect(url.searchParams.get('broadcaster_id')).toBe('42'); return json({ data: [{ title: 'Old title', game_id: '1', game_name: 'Old category' }] }); }
    if (url.pathname.endsWith('/streams')) { expect(auth).toBe('Bearer private-old'); return json({ data: [] }); }
    throw new Error('Unexpected Twitch request');
  }));
  const options = { port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', logger };
  server = await startDashboardServer(options);
  await server.providersReady;
  const oldCapabilities = server.state().twitch.capabilities;
  expect((await nativeFetch(server.url + '/api/v1/twitch/device', { method: 'POST' })).status).toBe(201);
  await vi.waitFor(() => expect(server!.state().twitch.error).toBeTruthy(), { timeout: 3000 });
  expect(server.state().twitch).toMatchObject({ connected: true, userName: 'old-account', displayName: 'Old Account', capabilities: oldCapabilities, deviceAuthorization: null });
  expect(await secrets.getTwitchTokens()).toEqual(oldTokens);
  expect(JSON.parse(await readFile(file, 'utf8')).twitch).toEqual(local.twitch);
  const mobile = toRemoteDashboardState(server.state());
  expect(mobile.twitch).toMatchObject({ connected: true, capabilities: oldCapabilities });
  expect(JSON.stringify(mobile)).not.toMatch(/private-|New Account|new-account/);
  expect(JSON.stringify(logger.error.mock.calls)).not.toContain('private-');
  expect(requests).toContainEqual({ path: endpoint === '/users' ? '/helix/users' : '/oauth2/validate', auth: endpoint === '/users' ? 'Bearer private-new' : 'OAuth private-new' });
  await server.stop();
  server = await startDashboardServer(options);
  await server.providersReady;
  expect(server.state().twitch).toMatchObject({ connected: true, userName: 'old-account', channelTitle: 'Old title', capabilities: oldCapabilities });
  expect(toRemoteDashboardState(server.state()).twitch).toMatchObject({ connected: true, channelTitle: 'Old title', capabilities: oldCapabilities });
  expect(await secrets.getTwitchTokens()).toEqual(oldTokens);
});
