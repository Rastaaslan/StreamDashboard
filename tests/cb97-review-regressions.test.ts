import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { GoogleCalendarClient } from '../integrations/google-calendar/src/client.js';
import { PlanningOrchestrator } from '../packages/core/src/planning.js';
import type { CalendarItem, RecurrenceRule } from '../packages/contracts/src/index.js';

let server: DashboardServerHandle | undefined;
let dataDir = '';
afterEach(async () => { await server?.stop(); server = undefined; vi.unstubAllGlobals(); if (dataDir) await rm(dataDir, { recursive: true, force: true }); });
const weekly: RecurrenceRule = { frequency: 'weekly', interval: 1, timeZone: 'UTC' };
const local: CalendarItem = { id: 'local', title: 'Live', category: 'live', startAtUtc: '2030-01-01T20:00:00Z', endAtUtc: '2030-01-01T22:00:00Z', desiredPublication: { local: true, twitch: true, google: false } };
const credentials = { clientId: 'client', accessToken: 'token', refreshToken: '', broadcasterId: '42', userName: 'u', displayName: 'U' };
const scopes = { client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] };

it.each<RecurrenceRule>([
  { ...weekly, frequency: 'daily' }, { ...weekly, interval: 2 }, { ...weekly, frequency: 'monthly' },
  { ...weekly, exceptions: { 'local:2030-01-08T20:00:00': { cancelled: true } } },
])('global Twitch HTTP sync cannot bypass a refused create: $frequency/$interval/$exceptions', async recurrence => {
  dataDir = await mkdtemp(join(tmpdir(), 'cb97-twitch-review-'));
  const secrets = new MemorySecretStore(); const logger = { info() {}, warn() {}, error() {} };
  server = await startDashboardServer({ port: 0, dataDir, secretStore: secrets, logger });
  await server.stop();
  const file = join(dataDir, 'dashboard.json'); const state = JSON.parse(await readFile(file, 'utf8'));
  state.twitch = { broadcasterId: '42', userName: 'u', displayName: 'U' }; await writeFile(file, JSON.stringify(state));
  await secrets.setTwitchTokens({ accessToken: 'token', refreshToken: '' });
  const nativeFetch = globalThis.fetch; const mutations: string[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = String(input);
    if (!url.startsWith('https://')) return nativeFetch(input, init);
    if (init?.method && init.method !== 'GET') mutations.push(init.method);
    if (url.includes('/validate')) return Response.json(scopes);
    if (url.includes('/schedule')) return Response.json({ data: { segments: [] } });
    if (url.includes('/channels?')) return Response.json({ data: [{ title: 'Live', game_id: '1' }] });
    return Response.json({ data: [] });
  }));
  server = await startDashboardServer({ port: 0, dataDir, secretStore: secrets, twitchClientId: 'client', logger });
  const post = (route: string, body: unknown) => nativeFetch(server!.url + '/api/v1/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await post('planning', { ...local, recurrence })).ok).toBe(true);
  const snapshot = () => nativeFetch(server!.url + '/api/v1/companion/snapshot').then(r => r.json());
  const before = (await snapshot()).planning;
  expect(before[0].providers.twitch.status).toBe('error');
  const response = await post('twitch/sync', {});
  expect(response.ok).toBe(false); expect(await response.text()).toMatch(/weekly|exceptions/);
  expect(mutations).toEqual([]); expect((await snapshot()).planning).toEqual(before);
});

it.each(['create', 'sync-create', 'recover', 'import'] as const)('Twitch %s → sync → remote edit → update/retry preserves conflict protection', async origin => {
  let segment: any; const patches: unknown[] = [];
  const makeSegment = () => ({ id: 'remote', title: local.title, start_time: local.startAtUtc, end_time: local.endAtUtc, is_recurring: true });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (url.includes('/validate')) return Response.json(scopes);
    if (init?.method === 'POST') segment = makeSegment();
    if (init?.method === 'PATCH') patches.push(init.body);
    return Response.json({ data: { segments: segment ? [segment] : [] } });
  }));
  const client = new TwitchClient(credentials); await client.validateSession();
  const value = { ...structuredClone(local), recurrence: weekly, ownership: 'LOCAL' as const };
  if (origin === 'create') {
    const result = await client.createSegment(value);
    Object.assign(value, { providers: { twitch: { status: 'synced', remoteId: result.id, fingerprint: result.fingerprint } } });
  } else if (origin !== 'sync-create') segment = makeSegment();
  const items = await client.sync(origin === 'import' ? [] : [value]);
  const firstFingerprint = items[0].providers?.twitch?.fingerprint;
  expect(firstFingerprint).toEqual(expect.any(String));
  const synced = await client.sync(items);
  expect(synced[0].providers?.twitch?.fingerprint).toBe(firstFingerprint);
  segment.title = 'Remote edit';
  const planner = new PlanningOrchestrator(synced, { twitch: { create: item => client.createSegment(item), update: (id, item) => client.updateSegment(id, item), delete: id => client.deleteSegment(id) } }, async () => {});
  const updated = await planner.update(synced[0].id, { ...synced[0], title: 'Local edit' });
  expect(updated.providers?.twitch?.status).toBe('conflict');
  expect(updated.conflict?.remote?.title).toBe('Remote edit');
  await expect(planner.retry(updated.id, 'twitch')).rejects.toThrow('Conflit');
  expect(patches).toEqual([]);
});

const master = { id: 'master', summary: 'Weekly', start: { dateTime: local.startAtUtc, timeZone: 'UTC' }, end: { dateTime: local.endAtUtc, timeZone: 'UTC' }, recurrence: ['RRULE:FREQ=WEEKLY;INTERVAL=1'], extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: 'local' } } };
const cancelled = { id: 'cancelled', recurringEventId: 'master', originalStartTime: { dateTime: '2030-01-08T20:00:00Z' }, status: 'cancelled' };
const moved = { ...master, recurrence: undefined, id: 'moved', recurringEventId: 'master', originalStartTime: { dateTime: '2030-01-15T20:00:00Z' }, start: { dateTime: '2030-01-16T20:00:00Z' }, end: { dateTime: '2030-01-16T22:00:00Z' } };

it.each([cancelled, moved])('Google rejects $id on a later page before importing or recovering the managed master identity', async exception => {
  const mutations: unknown[] = [];
  const client = new GoogleCalendarClient('client', { accessToken: 't', refreshToken: 'r', expiresAt: Date.now() + 3600000 }, async () => {}, async (input, init) => {
    if (init?.method) mutations.push(init);
    const url = new URL(String(input));
    if (url.pathname.endsWith('/' + exception.id)) return Response.json(exception);
    return Response.json(url.searchParams.has('pageToken') ? { items: [exception] } : { items: [master], nextPageToken: 'second' });
  });
  await expect(client.events('calendar')).rejects.toMatchObject({ code: 'GOOGLE_RECURRENCE_EXCEPTION_UNSUPPORTED' });
  await expect(client.event('calendar', exception.id)).rejects.toThrow(/exceptions/i);
  await expect(client.create('calendar', { ...local, localId: 'local', recurrence: weekly })).rejects.toMatchObject({ mutationNotStarted: true });
  expect(mutations).toEqual([]);
});

it('Google HTTP sync refuses cancellation and movement atomically without importing an incorrect series', async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'cb97-google-review-'));
  const secrets = new MemorySecretStore(); await secrets.setGoogleTokens({ accessToken: 't', refreshToken: 'r', expiresAt: String(Date.now() + 3600000) });
  const googleFetch: typeof fetch = async input => String(input).includes('/calendarList')
    ? Response.json({ items: [{ id: 'calendar', summary: 'Calendar', accessRole: 'owner' }] })
    : Response.json({ items: [master, cancelled, moved] });
  server = await startDashboardServer({ port: 0, dataDir, secretStore: secrets, googleClientId: 'client', googleFetch, logger: { info() {}, warn() {}, error() {} } });
  const request = (route: string, method: string, body: unknown) => fetch(server!.url + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  expect((await request('google/target', 'PUT', { calendarId: 'calendar' })).ok).toBe(true);
  const response = await request('google/sync', 'POST', {});
  expect(response.ok).toBe(false); expect(await response.text()).toMatch(/exceptions/i);
  const snapshot = await fetch(server.url + '/api/v1/companion/snapshot').then(r => r.json());
  expect(snapshot.planning).toEqual([]);
});
