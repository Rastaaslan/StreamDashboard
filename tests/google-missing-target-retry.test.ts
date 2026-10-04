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

it.each([['desktop', false], ['companion', false], ['desktop', true], ['companion', true]] as const)('retries Google creation from %s (recurring=%s) after missing target, restart and calendar selection', async (origin, recurring) => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb16-missing-target-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600_000) });
  const nativeFetch = globalThis.fetch;
  const writes = vi.fn();
  const eventReads = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url.includes('/users/me/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Target', accessRole: 'owner' }] });
    if (url.includes('/calendars/calendar/events')) {
      if (init?.method === 'POST') {
        writes(JSON.parse(String(init.body)));
        return Response.json({ ...JSON.parse(String(init.body)), id: 'remote-one', etag: 'r1' });
      }
      eventReads();
      return Response.json({ items: [] });
    }
    throw new Error('Unexpected provider request: ' + url);
  }));
  const options = { port: 0, remoteEnabled: true, dataDir, googleClientId: 'client', secretStore: secrets,
    logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  const request = (route: string, body: unknown, method = 'POST', authorization?: string) => nativeFetch(server!.url + '/api/v1/' + route, {
    method, headers: { 'content-type': 'application/json', ...(authorization ? { authorization } : {}) }, body: JSON.stringify(body),
  });
  const item = { id: 'missing-target', title: 'Live', startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T19:00:00Z',
    desiredPublication: { local: true, twitch: false, google: true },
    ...(recurring ? { recurrence: { frequency: 'weekly', interval: 2, timeZone: 'Europe/Paris', until: '2031-01-01T00:00:00Z' } } : {}) };
  if (origin === 'desktop') {
    const response = await request('planning', item);
    expect(response.ok, await response.clone().text()).toBe(true);
  } else {
    const pairing = await request('remote/pairing', {}).then(r => r.json());
    const paired = await request('remote/pair', { id: pairing.id, code: pairing.code, name: 'Android' }).then(r => r.json());
    const response = await request('companion/sync', { schemaVersion: 3, deviceId: paired.deviceId,
      operations: [{ id: 'create', type: 'create', eventId: item.id, baseRevision: 0, patch: item }] }, 'POST', 'Device ' + paired.credential);
    expect(response.ok, await response.clone().text()).toBe(true);
  }
  const snapshot = () => nativeFetch(server!.url + '/api/v1/companion/snapshot').then(r => r.json());
  const verifyFailure = async () => {
    const state = await snapshot();
    expect(state.planning[0].providers.google).toMatchObject({ status: 'error', lastError: 'Choisissez un calendrier Google cible.' });
    expect(state.planning[0].providers.google.uncertainCreate).toBeUndefined();
    if (origin === 'companion') expect(state.providerWork[item.id + ':google']).toMatchObject({ status: 'error', uncertain: false });
    expect(writes).not.toHaveBeenCalled();
    expect(eventReads).not.toHaveBeenCalled();
  };
  await verifyFailure();
  await server.stop(); server = await startDashboardServer(options);
  await verifyFailure();
  const selected = await request('google/target', { calendarId: 'calendar' }, 'PUT');
  expect(selected.ok, await selected.clone().text()).toBe(true);
  expect(writes).not.toHaveBeenCalled();
  const planningId = (await snapshot()).planning[0].id;
  const retried = await request('planning/' + planningId + '/retry/google', {});
  expect(retried.ok, await retried.clone().text()).toBe(true);
  const finished = await snapshot();
  expect(finished.planning[0].providers.google).toMatchObject({ status: 'synced', remoteId: 'remote-one', remoteRevision: 'r1', calendarId: 'calendar' });
  expect(finished.planning[0].providers.google.uncertainCreate).toBeUndefined();
  expect(finished.providerWork).toEqual({});
  expect(writes).toHaveBeenCalledTimes(1);
  if (recurring) expect(writes.mock.calls[0][0]).toMatchObject({
    recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=2;UNTIL=20310101T000000Z'],
    start: { dateTime: item.startAtUtc, timeZone: 'Europe/Paris' },
    end: { dateTime: item.endAtUtc, timeZone: 'Europe/Paris' },
  });
});
