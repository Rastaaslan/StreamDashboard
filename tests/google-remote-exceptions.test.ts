import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';

let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => {
  await server?.stop(); server = undefined;
  vi.unstubAllGlobals();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

const exceptions = [
  { id: 'moved', recurringEventId: 'master', originalStartTime: { dateTime: '2026-10-13T19:00:00Z' }, start: { dateTime: '2026-10-14T19:00:00Z' }, end: { dateTime: '2026-10-14T20:00:00Z' } },
  { id: 'renamed', recurringEventId: 'master', originalStartTime: { dateTime: '2026-10-13T19:00:00Z' }, summary: 'Special', start: { dateTime: '2026-10-13T19:00:00Z' }, end: { dateTime: '2026-10-13T20:00:00Z' } },
  // Google guarantees no dates or private properties on cancelled exceptions.
  { id: 'cancelled', recurringEventId: 'master', originalStartTime: { dateTime: '2026-10-13T19:00:00Z' }, status: 'cancelled' },
];

it.each(exceptions)('refuses sync and retries after restart for remote $id exceptions', async exception => {
  dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-exceptions-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600000) });
  const nativeFetch = globalThis.fetch;
  let master: Record<string, unknown> | undefined;
  let withException = false;
  const writes = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url.includes('/users/me/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Target', accessRole: 'owner' }] });
    if (url.includes('/calendars/calendar/events')) {
      if (init?.method === 'POST') {
        writes(); master = { ...JSON.parse(String(init.body)), id: 'master', etag: 'v1' };
        return Response.json(master);
      }
      if (init?.method) { writes(); throw new Error('Unexpected mutation'); }
      if (url.includes('/events?')) {
        const query = new URL(url).searchParams;
        if (withException && query.get('singleEvents') === 'false') {
          expect(query.has('timeMin')).toBe(false);
          expect(query.has('privateExtendedProperty')).toBe(false);
          // Exception on another page, with no inherited private metadata.
          if (query.get('pageToken') === 'exceptions') return Response.json({ items: [exception] });
          return Response.json({ items: [master], nextPageToken: 'exceptions' });
        }
        return Response.json({ items: master ? [master] : [] });
      }
      return Response.json(master);
    }
    throw new Error('Unexpected provider request: ' + url);
  }));
  const options = { port: 0, remoteEnabled: true, dataDir, googleClientId: 'client', secretStore: secrets, logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  const request = (route: string, body: unknown, method = 'POST') => nativeFetch(server!.url + '/api/v1/' + route, {
    method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
  const snapshot = () => nativeFetch(server!.url + '/api/v1/companion/snapshot').then(response => response.json());
  await request('google/target', { calendarId: 'calendar' }, 'PUT');
  const value = { id: 'local', title: 'Series', startAtUtc: '2026-10-06T19:00:00Z', endAtUtc: '2026-10-06T20:00:00Z',
    desiredPublication: { local: true, google: true, twitch: false }, recurrence: { frequency: 'weekly' as const, interval: 1 as const, timeZone: 'Europe/Paris' } };
  expect((await request('planning', value)).ok).toBe(true);
  const before = (await snapshot()).planning[0];
  withException = true;
  const sync = await request('google/sync', {});
  expect(sync.ok).toBe(false);
  expect(await sync.text()).toContain('Exceptions Google distantes');
  expect((await snapshot()).planning[0]).toEqual(before);
  await server.stop(); server = await startDashboardServer(options);
  const retry = await request(`planning/${before.id}/retry/google`, {});
  expect(retry.ok).toBe(false);
  expect(await retry.text()).toContain('Exceptions Google distantes');
  const after = (await snapshot()).planning[0];
  expect(after.providers.google).toMatchObject({ status: 'error', remoteId: 'master', remoteRevision: 'v1' });
  expect(after.recurrence).toEqual(before.recurrence);
  // Lost-create-response recovery must refuse too, even without a linked ID.
  const api = new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }, async () => {});
  await expect(api.create('calendar', { ...value, localId: before.localId ?? before.id })).rejects.toMatchObject({ mutationNotStarted: true });
  await expect(api.event('calendar', 'master')).rejects.toThrow(/Exceptions Google distantes/);
  // Removing local recurrence must not bypass the remote exception guard.
  await expect(api.update('calendar', 'master', { ...value, localId: 'local', recurrence: undefined }, 'v1')).rejects.toThrow(/Exceptions Google distantes/);
  expect(writes).toHaveBeenCalledTimes(1);
});

it.each([[false, false], [true, false], [false, true], [true, true]])('creates and recovers independent B despite cancelled A (allDay=%s, responseLost=%s)', async (allDay, responseLost) => {
  const input = { localId: 'B', title: 'Independent', allDay,
    startAtUtc: '2026-10-06T00:00:00Z', endAtUtc: '2026-10-07T00:00:00Z' };
  const masterA = { id: 'master', summary: 'Series A',
    start: { dateTime: '2026-10-06T19:00:00Z', timeZone: 'Europe/Paris' },
    end: { dateTime: '2026-10-06T20:00:00Z', timeZone: 'Europe/Paris' },
    recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1'],
    extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'A' } } };
  let remoteB: Record<string, unknown> | undefined;
  const writes = vi.fn();
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      writes(body);
      remoteB = { ...body, id: 'remote-B', etag: 'etag-B' };
      // Simulate a successful remote creation whose response was lost.
      if (responseLost) throw new Error('response lost');
      return Response.json(remoteB);
    }
    expect(init?.method).toBeUndefined();
    const query = new URL(String(url)).searchParams;
    expect(query.get('singleEvents')).toBe('false');
    expect(query.has('privateExtendedProperty')).toBe(false);
    if (query.get('pageToken') === 'exceptions') return Response.json({ items: [exceptions[2]] });
    return Response.json({ items: [masterA, ...(remoteB ? [remoteB] : [])], nextPageToken: 'exceptions' });
  });
  const api = new GoogleCalendarClient('client', { accessToken: 'token', refreshToken: 'refresh', expiresAt: Date.now() + 3600000 }, async () => {}, request);
  if (responseLost) await expect(api.create('calendar', input)).rejects.toThrow('response lost');
  else await expect(api.create('calendar', input)).resolves.toMatchObject({ id: 'remote-B', etag: 'etag-B' });
  expect(writes).toHaveBeenCalledTimes(1);
  expect(writes.mock.calls[0][0]).toMatchObject({
    start: allDay ? { date: '2026-10-06' } : { dateTime: input.startAtUtc },
    end: allDay ? { date: '2026-10-07' } : { dateTime: input.endAtUtc },
    extendedProperties: { private: { streamDashboardId: 'B' } },
  });
  const recovered = await api.create('calendar', input);
  expect(recovered).toMatchObject({ id: 'remote-B', localId: 'B', etag: 'etag-B', allDay });
  expect(writes).toHaveBeenCalledTimes(1);
  // The same unfiltered inventory must still reject recovery of affected A.
  await expect(api.create('calendar', { ...input, localId: 'A', allDay: false,
    startAtUtc: masterA.start.dateTime, endAtUtc: masterA.end.dateTime,
    recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' },
  })).rejects.toMatchObject({ mutationNotStarted: true, message: expect.stringContaining('Exceptions Google distantes') });
  expect(writes).toHaveBeenCalledTimes(1);
});
