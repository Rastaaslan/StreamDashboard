import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => {
  await server?.stop(); server = undefined;
  vi.unstubAllGlobals();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it.each(['local', 'remote'] as const)('resolves a live Google 412 after restart through the real endpoint: %s', async strategy => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb16-update-conflict-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'test-token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600_000) });
  const nativeFetch = globalThis.fetch;
  const updates: Array<{ revision: string; title: string }> = [];
  let reads = 0;
  let readAvailable = false;
  let remote = { id: 'google-id', summary: 'Changed on Google', description: 'Remote description', etag: 'r-new',
    start: { dateTime: '2026-10-01T18:00:00Z' }, end: { dateTime: '2026-10-01T20:00:00Z' } };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url.includes('googleapis.com/calendar/v3/users/me/calendarList')) return Response.json({ items: [] });
    if (url.includes('/calendars/calendar/events/google-id')) {
      if (init?.method === 'PATCH') {
        const revision = new Headers(init.headers).get('If-Match') ?? '';
        const body = JSON.parse(String(init.body));
        updates.push({ revision, title: body.summary });
        if (revision !== remote.etag) return Response.json({ error: 'changed elsewhere' }, { status: 412 });
        remote = { ...remote, ...body, etag: 'r-published' };
        return Response.json(remote);
      }
      if (init?.method && init.method !== 'GET') throw new Error('Unexpected mutation: ' + init.method);
      reads++;
      return readAvailable ? Response.json(remote) : Response.json({ error: 'offline' }, { status: 503 });
    }
    throw new Error('Unexpected network request: ' + url);
  }));
  const options = { port: 0, remoteEnabled: true, dataDir, googleClientId: 'test-client', secretStore: secrets,
    logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  const pairing = await nativeFetch(server.url + '/api/v1/remote/pairing', { method: 'POST' }).then(r => r.json());
  const paired = await nativeFetch(server.url + '/api/v1/remote/pair', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: pairing.id, code: pairing.code, name: 'Android' }) }).then(r => r.json());
  const headers = { 'content-type': 'application/json', authorization: 'Device ' + paired.credential };
  const request = (route: string, body: unknown) => nativeFetch(server!.url + '/api/v1/' + route, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  const sync = async (operations: unknown[] = []) => {
    const response = await request('companion/sync', { schemaVersion: 3, deviceId: paired.deviceId, operations });
    expect(response.status).toBe(200);
    return response.json();
  };
  await sync([{ id: 'create', type: 'create', eventId: 'android-id', baseRevision: 0, patch: {
    title: 'Original', startAtUtc: remote.start.dateTime, endAtUtc: remote.end.dateTime,
    desiredPublication: { local: true, twitch: false, google: true },
    providerLinks: { google: { status: 'synced', remoteId: remote.id, calendarId: 'calendar', revision: 'r-old' } },
  } }]);
  const conflict = await sync([{ id: 'edit', type: 'update', eventId: 'android-id', baseRevision: 1, patch: { title: 'Android edit' } }]);
  expect(conflict.snapshot.planning[0].providers.google.status).toBe('conflict');
  expect(conflict.snapshot.planning[0].conflict.remote).toBeUndefined();
  expect(updates).toEqual([{ revision: 'r-old', title: 'Android edit' }]);

  await server.stop(); server = await startDashboardServer(options);
  // A failed refresh leaves both the content and the conflict intact.
  const unavailable = await request('planning/android-id/conflict/google', { strategy });
  expect(unavailable.ok).toBe(false);
  const stillConflicted = await sync();
  expect(stillConflicted.snapshot.planning[0]).toMatchObject({ title: 'Android edit', providers: { google: { status: 'conflict', remoteRevision: 'r-old' } } });
  expect(updates).toHaveLength(1);
  readAvailable = true;
  const resolution = await request('planning/android-id/conflict/google', { strategy });
  expect(resolution.status, await resolution.clone().text()).toBe(200);
  expect(reads).toBe(2);
  const resolved = await sync();
  expect(resolved.snapshot.providerWork).toEqual({});
  const item = resolved.snapshot.planning[0];
  expect(item.conflict).toBeUndefined();
  expect(item.providerLinks.google).toMatchObject({ status: 'synced', remoteId: 'google-id', calendarId: 'calendar' });
  if (strategy === 'local') {
    expect(updates).toEqual([{ revision: 'r-old', title: 'Android edit' }, { revision: 'r-new', title: 'Android edit' }]);
    expect(item.title).toBe('Android edit');
    expect(item.providerLinks.google.revision).toBe('r-published');
    expect(remote.summary).toBe('Android edit');
  } else {
    expect(updates).toHaveLength(1);
    expect(item).toMatchObject({ title: 'Changed on Google', description: 'Remote description', providerLinks: { google: { revision: 'r-new' } } });
  }
  await server.stop(); server = await startDashboardServer(options);
  const restarted = (await sync()).snapshot.planning[0];
  expect(restarted.title).toBe(item.title);
  expect(restarted.providerLinks.google.revision).toBe(item.providerLinks.google.revision);
  expect(restarted.conflict).toBeUndefined();
});
