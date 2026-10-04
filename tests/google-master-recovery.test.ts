import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';
import { googleRecurrence } from '../integrations/google-calendar/src/recurrence.js';

async function fixture(recurrence: string[], allDay = false) {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'google-master-recovery-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600000) });
  let master = { id: 'master', summary: 'Recovered', etag: 'v1', recurrence,
    start: allDay ? { date: '2030-01-31' } : { dateTime: '2030-01-31T19:00:00Z', timeZone: 'Europe/Paris' },
    end: allDay ? { date: '2030-02-01' } : { dateTime: '2030-01-31T20:00:00Z', timeZone: 'Europe/Paris' },
    extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'lost-local-id' } } };
  const writes: Array<{ method: string; body: any; url: string; etag: string | null }> = [];
  const googleFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Target', accessRole: 'owner' }] });
    if (init?.method) {
      const body = JSON.parse(String(init.body));
      writes.push({ method: init.method, body, url, etag: new Headers(init.headers).get('If-Match') });
      master = { ...master, ...body, etag: 'v2' };
      return Response.json(master);
    }
    if (url.endsWith('/master')) return Response.json(master);
    // Actual Google inventory contains the master; expanded query contains instances.
    const instances = [1, 2].map(n => ({ ...master, id: `instance-${n}`, recurrence: undefined, recurringEventId: 'master' }));
    return Response.json({ items: new URL(url).searchParams.get('singleEvents') === 'false' ? [master] : instances });
  };
  const options = { port: 0, dataDir, secretStore: secrets, googleClientId: 'client', googleFetch, logger: { info() {}, warn() {}, error() {} } };
  let server = await startDashboardServer(options);
  const request = (route: string, body: unknown = {}, method = 'POST') => fetch(server.url + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const snapshot = () => fetch(server.url + '/api/v1/companion/snapshot').then(r => r.json());
  await request('google/target', { calendarId: 'calendar' }, 'PUT');
  return { request, snapshot, writes, remote: () => master,
    restart: async () => { await server.stop(); server = await startDashboardServer(options); },
    close: async () => { await server.stop(); await rm(dataDir, { recursive: true, force: true }); } };
}

it.each([
  ['RRULE:FREQ=WEEKLY;INTERVAL=1;UNTIL=20300501T180000Z', false],
  ['RRULE:FREQ=WEEKLY;INTERVAL=2', false],
  ['RRULE:FREQ=WEEKLY', false],
  ['RRULE:UNTIL=20300501T180000Z;INTERVAL=1;FREQ=WEEKLY', false],
  ['RRULE:FREQ=DAILY;INTERVAL=1', false],
  ['RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31,-1;BYSETPOS=1', false],
  ['RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20300501', true],
] as const)('recovers an absent local master through HTTP, restart and title edit: %s allDay=%s', async (line, allDay) => {
  const f = await fixture([line], allDay);
  try {
    expect((await f.snapshot()).planning).toEqual([]);
    const synced = await f.request('google/sync');
    expect(synced.ok, await synced.clone().text()).toBe(true);
    const recovered = (await f.snapshot()).planning;
    expect(recovered).toHaveLength(1);
    const item = recovered[0];
    const expectedRule = googleRecurrence(item);
    expect(item.recurrence.timeZone).toBe(allDay ? 'UTC' : 'Europe/Paris');
    expect(item.providers.google).toMatchObject({ remoteId: 'master', remoteRevision: 'v1', status: 'synced' });
    const window = { from: '2030-02-01', to: '2030-05-01' };
    const future = expandRecurringItems([item], window).map(value => value.startAtUtc);
    expect(future.length).toBeGreaterThan(1);
    if (item.recurrence.frequency === 'monthly') expect(future).toEqual(['2030-02-28T19:00:00.000Z', '2030-03-31T18:00:00.000Z', '2030-04-30T18:00:00.000Z']);
    if (item.recurrence.frequency === 'weekly' && item.recurrence.interval === 1) expect(future).toEqual(expect.arrayContaining(['2030-03-28T19:00:00.000Z', '2030-04-04T18:00:00.000Z']));
    await f.restart();
    expect((await f.snapshot()).planning[0].recurrence).toMatchObject(item.recurrence);
    const response = await f.request(`planning/${encodeURIComponent(item.id)}`, { title: 'Renamed only' }, 'PUT');
    expect(response.ok, await response.clone().text()).toBe(true);
    expect(f.writes).toHaveLength(1);
    expect(f.writes[0]).toMatchObject({ method: 'PATCH', etag: 'v1', body: { summary: 'Renamed only', recurrence: expectedRule, start: f.remote().start, extendedProperties: { private: { streamDashboardId: 'lost-local-id' } } } });
    expect(f.writes[0].url).toMatch(/\/events\/master$/);
    if (!allDay) expect(f.writes[0].body.start.timeZone).toBe('Europe/Paris');
    expect(f.remote().recurrence).toEqual(expectedRule);
    const after = (await f.snapshot()).planning[0];
    expect(after.providers.google).toMatchObject({ remoteId: 'master', remoteRevision: 'v2', status: 'synced' });
    expect(expandRecurringItems([after], window).map(value => value.startAtUtc)).toEqual(future);
    await f.request('google/sync');
    expect((await f.snapshot()).planning).toHaveLength(1);
  } finally { await f.close(); }
});

it.each([
  ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'],
  ['RRULE:FREQ=WEEKLY;COUNT=5'],
  ['RRULE:FREQ=MONTHLY'], // Google skips short months; local model clamps.
  ['RRULE:FREQ=MONTHLY;BYMONTHDAY=31'],
  ['RRULE:FREQ=YEARLY'],
  ['RRULE:FREQ=WEEKLY;__proto__=ignored'],
  ['RRULE:FREQ=DAILY;UNTIL=20300230T190000Z'],
  ['RRULE:FREQ=WEEKLY;INTERVAL=1;INTERVAL=2'],
])('refuses unsupported recovery atomically before any destructive edit: %s', async line => {
  const f = await fixture([line]);
  try {
    for (let attempt = 0; attempt < 2; attempt++) {
      const response = await f.request('google/sync');
      expect(response.ok).toBe(false);
      expect(await response.text()).toMatch(/non représentable/);
      expect((await f.snapshot()).planning).toEqual([]);
      const edit = await f.request('planning/google%3Acalendar%3Amaster', { title: 'Unsafe edit' }, 'PUT');
      expect(edit.ok).toBe(false);
      expect(f.writes).toEqual([]);
      expect(f.remote().recurrence).toEqual([line]);
      await f.restart();
    }
  } finally { await f.close(); }
});
