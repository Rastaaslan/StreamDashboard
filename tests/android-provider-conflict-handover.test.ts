import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { createCompanionStore } from '../apps/mobile/companion-store.js';
import { createStandaloneProviderSync } from '../apps/mobile/provider-sync.js';

let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => {
  await server?.stop(); server = undefined;
  vi.unstubAllGlobals();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it.each([
  ['google', 'local'], ['google', 'remote'], ['twitch', 'local'], ['twitch', 'remote'],
] as const)('resolves an Android %s conflict after Desktop restart using %s', async (provider, strategy) => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb16-android-conflict-'));
  await writeFile(path.join(dataDir, 'dashboard.json'), JSON.stringify({ twitch: { broadcasterId: '42', userName: 'tester', displayName: 'Tester' } }));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'google-token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600_000) });
  await secrets.setTwitchTokens({ accessToken: 'twitch-token' });
  const nativeFetch = globalThis.fetch;
  const updates: Array<{ title: string; etag: string | null }> = [];
  let reads = 0;
  const startAtUtc = '2030-10-01T18:00:00Z', endAtUtc = '2030-10-01T20:00:00Z';
  let segment = { id: 'remote-one', title: 'Remote title', start_time: startAtUtc, end_time: endAtUtc, category: { id: 'game', name: 'Game' } };
  const googleEvent = () => ({ id: 'remote-one', summary: segment.title, etag: 'etag-current', start: { dateTime: startAtUtc }, end: { dateTime: endAtUtc } });
  const fingerprint = () => createHash('sha256').update([segment.title, startAtUtc, endAtUtc, 'game'].join('\u001f')).digest('base64url');
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/validate')) return Response.json({ client_id: 'twitch-client', user_id: '42', scopes: ['channel:manage:schedule'] });
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url.includes('/users/me/calendarList')) return Response.json({ items: [] });
    if (url.includes('/calendars/calendar/events?')) return Response.json({ items: [googleEvent()] });
    const isGoogle = url.includes('/calendars/calendar/events/remote-one');
    const isTwitch = url.includes('api.twitch.tv/helix/schedule');
    if (isGoogle || isTwitch) {
      if (init?.method === 'PATCH') {
        const value = JSON.parse(String(init.body));
        const etag = new Headers(init.headers).get('If-Match');
        if (isGoogle) expect(etag).toBe('etag-current');
        updates.push({ title: value.summary ?? value.title, etag });
        segment = { ...segment, title: value.summary ?? value.title };
        return isGoogle ? Response.json({ ...googleEvent(), etag: 'etag-after' }) : Response.json({ data: { segments: [segment] } });
      }
      if (init?.method && init.method !== 'GET') throw new Error('Unexpected write: ' + init.method);
      reads++;
      return isGoogle ? Response.json(googleEvent()) : Response.json({ data: { segments: [segment] } });
    }
    throw new Error('Unexpected request: ' + url);
  }));
  const options = { port: 0, remoteEnabled: true, dataDir, googleClientId: 'google-client', twitchClientId: 'twitch-client',
    secretStore: secrets, logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  const pairing = await nativeFetch(server.url + '/api/v1/remote/pairing', { method: 'POST' }).then(r => r.json());
  const paired = await nativeFetch(server.url + '/api/v1/remote/pair', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: pairing.id, code: pairing.code, name: 'Android' }) }).then(r => r.json());
  const headers = { 'content-type': 'application/json', authorization: 'Device ' + paired.credential };
  const request = (route: string, body: unknown) => nativeFetch(server!.url + '/api/v1/' + route, { method: 'POST', headers, body: JSON.stringify(body) });
  const data = new Map<string, string>();
  const mobile = createCompanionStore({ getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); } } as Storage);
  mobile.createEvent({ id: 'android-id', title: 'Android title', startAtUtc, endAtUtc, twitchCategoryId: 'game',
    desiredPublication: { local: true, google: provider === 'google', twitch: provider === 'twitch' },
    providerLinks: { [provider]: { status: 'synced', remoteId: 'remote-one', calendarId: 'calendar', revision: 'old-etag', fingerprint: 'old-fingerprint' } },
  });
  const mutate = vi.fn(async () => { throw Object.assign(new Error('changed elsewhere'), { code: 'CONFLICT', current: { native: 'not a CalendarItem' } }); });
  await createStandaloneProviderSync({ store: mobile, adapter: { mutate } as any }).apply('ONLINE_STANDALONE', mobile.snapshot().planning[0], 'update', provider);
  const sync = async (operations: unknown[] = []) => {
    const response = await request('companion/sync', { schemaVersion: 3, deviceId: paired.deviceId, operations });
    expect(response.status).toBe(200); return response.json();
  };
  const imported = await sync(mobile.snapshot().pending);
  expect(imported.snapshot.planning[0].providers[provider].status).toBe('conflict');
  expect(updates).toEqual([]);
  await server.stop(); server = await startDashboardServer(options);
  const result = await request('planning/android-id/conflict/' + provider, { strategy });
  expect(result.status, await result.clone().text()).toBe(200);
  expect(reads).toBeGreaterThan(0);
  const final = await sync();
  const item = final.snapshot.planning[0];
  expect(item.conflict).toBeUndefined();
  expect(item.providerLinks[provider]).toMatchObject({ status: 'synced', remoteId: 'remote-one' });
  expect(final.snapshot.providerWork).toEqual({});
  expect(item.title).toBe(strategy === 'local' ? 'Android title' : 'Remote title');
  expect(updates).toHaveLength(strategy === 'local' ? 1 : 0);
  if (provider === 'google') expect(item.providerLinks.google.revision).toBe(strategy === 'local' ? 'etag-after' : 'etag-current');
  else expect(item.providerLinks.twitch.fingerprint).toBe(fingerprint());
  await server.stop(); server = await startDashboardServer(options);
  expect((await sync()).snapshot.planning[0].providers[provider].status).toBe('synced');
});
