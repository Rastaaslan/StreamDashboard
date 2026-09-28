import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { createNativeProviderAdapter, createStandaloneProviderSync } from '../apps/mobile/provider-sync.js';
import { createCompanionStore } from '../apps/mobile/companion-store.js';

let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => {
  await server?.stop(); server = undefined;
  vi.unstubAllGlobals();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

it.each(['local', 'remote', 'android'] as const)('resolves a Google 412 deletion after restart through the paired endpoint: %s', async strategy => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb16-delete-conflict-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'test-token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600_000) });
  const nativeFetch = globalThis.fetch;
  const deletions: string[] = [];
  let reads = 0;
  const remote = { id: 'google-id', summary: 'Changed on Google', etag: 'r-new',
    start: { dateTime: '2026-10-01T18:00:00Z' }, end: { dateTime: '2026-10-01T20:00:00Z' } };
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url.includes('googleapis.com/calendar/v3/users/me/calendarList')) return Response.json({ items: [] });
    if (url.includes('/calendars/calendar/events/google-id')) {
      if (init?.method === 'DELETE') {
        const revision = new Headers(init.headers).get('If-Match') ?? '';
        deletions.push(revision);
        return revision === 'r-new' ? new Response(null, { status: 204 })
          : Response.json({ error: 'changed elsewhere' }, { status: 412 });
      }
      reads++;
      return Response.json(remote);
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
  const deletion = await sync([{ id: 'delete', type: 'delete', eventId: 'android-id', baseRevision: 1 }]);
  expect(deletion.snapshot.planning).toEqual([]);
  expect(deletion.snapshot.tombstones[0].providerLinks.google.status).toBe('conflict');
  expect(deletions).toEqual(['r-old']);
  // Keep a real Android tombstone to verify cancellation restores the mobile cache.
  const values = new Map<string, string>();
  const disk = { getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); } } as Storage;
  let store = createCompanionStore(disk);
  store.applySyncResponse(deletion);
  store = createCompanionStore(disk);
  const nativeDelete = vi.fn((payload: string) => {
    expect(JSON.parse(payload).link.revision).toBe('r-new');
    return JSON.stringify({ ok: true });
  });
  const adapter = createNativeProviderAdapter({
    googleTest: () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['calendar'] }),
    googleDeletePlanning: nativeDelete,
  });
  expect(store.snapshot().tombstones[0].providerLinks.google.revision).toBe('r-old');
  await createStandaloneProviderSync({ store, adapter }).apply('ONLINE_STANDALONE', store.snapshot().tombstones[0], 'delete');
  expect(nativeDelete).not.toHaveBeenCalled();
  expect(store.snapshot().tombstones[0].providerLinks.google.status).toBe('conflict');

  await server.stop(); server = await startDashboardServer(options);
  expect(deletions).toEqual(['r-old']); // restart must not bypass the conflict
  const blockedRetry = await request('planning/android-id/retry/google', {});
  expect(blockedRetry.ok).toBe(false);
  expect(deletions).toEqual(['r-old']);
  const resolution = await request('planning/android-id/conflict/google', { strategy: strategy === 'android' ? 'local' : strategy });
  expect(resolution.status, await resolution.clone().text()).toBe(200);
  expect(reads).toBe(1);
  expect(deletions).toEqual(['r-old']); // resolution itself performs no delete
  const resolved = { acknowledged: [], snapshot: await nativeFetch(server.url + '/api/v1/companion/snapshot').then(response => response.json()) };
  if (strategy === 'android') {
    store.applySyncResponse(resolved);
    store = createCompanionStore(disk);
    await createStandaloneProviderSync({ store, adapter }).apply('ONLINE_STANDALONE', store.snapshot().tombstones[0], 'delete');
    expect(nativeDelete).toHaveBeenCalledTimes(1);
    expect(store.snapshot().tombstones[0].providerLinks.google).toMatchObject({ status: 'deleted', remoteId: null, revision: null });
    const finished = await sync(store.snapshot().pending);
    expect(finished.snapshot.providerWork).toEqual({});
    expect(deletions).toEqual(['r-old']);
  } else if (strategy === 'local') {
    expect(resolved.snapshot.providerWork['android-id:google']).toMatchObject({ action: 'delete', status: 'queued' });
    const retried = await request('planning/android-id/retry/google', {});
    expect(retried.status, await retried.clone().text()).toBe(200);
    expect(deletions).toEqual(['r-old', 'r-new']);
    const finished = await sync();
    expect(finished.snapshot.providerWork).toEqual({});
    expect(finished.snapshot.planning).toEqual([]);
    expect(finished.snapshot.tombstones[0].providerLinks.google.status).toBe('not-published');
  } else {
    expect(resolved.snapshot.providerWork).toEqual({});
    expect(resolved.snapshot.tombstones).toEqual([]);
    expect(resolved.snapshot.planning).toMatchObject([{ id: 'android-id', title: 'Changed on Google',
      providerLinks: { google: { remoteId: remote.id, revision: 'r-new', status: 'synced' } } }]);
    store.applySyncResponse(resolved);
    expect(store.snapshot().planning).toHaveLength(1);
    expect(store.snapshot().tombstones).toEqual([]);
    await server.stop(); server = await startDashboardServer(options);
    expect((await sync()).snapshot.planning[0].title).toBe('Changed on Google');
    expect(deletions).toEqual(['r-old']);
  }
});
