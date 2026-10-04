import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bulkDeleteSelection } from '../packages/core/src/planning-bulk-delete.js';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

const start = '2030-10-01T00:00:00Z', end = '2030-10-02T00:00:00Z';
const item: CalendarItem = { id: 'one', title: 'Live', startAtUtc: '2030-10-01T18:00:00Z', endAtUtc: '2030-10-01T20:00:00Z' };
let server: DashboardServerHandle | undefined, folder = '';
afterEach(async () => { await server?.stop(); server = undefined; vi.unstubAllGlobals(); if (folder) await rm(folder, { recursive: true, force: true }); });
const nativeFetch = globalThis.fetch;
async function call(route: string, body?: unknown, method = 'POST') {
  return nativeFetch(server!.url + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function boot() { folder = await mkdtemp(join(tmpdir(), 'bulk-delete-')); server = await startDashboardServer({ port: 0, dataDir: folder, logger: { info() {}, warn() {}, error() {} } }); }
async function preview(destinations = {}) { const response = await call('planning/bulk-delete/preview', { start, end, destinations }); expect(response.ok, await response.clone().text()).toBe(true); return response.json(); }
async function snapshot() { return (await call('state', undefined, 'GET')).json(); }

it('selects only fully contained local events, protecting every recurrence representation and uncertain work', () => {
  const variants: CalendarItem[] = [item,
    { ...item, id: 'boundary', startAtUtc: start, endAtUtc: end },
    { ...item, id: 'overlap', startAtUtc: '2030-09-30T23:00:00Z' },
    { ...item, id: 'after', startAtUtc: end, endAtUtc: '2030-10-02T01:00:00Z' },
    { ...item, id: 'external', ownership: 'EXTERNAL' },
    { ...item, id: 'series', recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' }, startAtUtc: '2029-01-01T00:00:00Z' },
    { ...item, id: 'occurrence', occurrenceKey: 'key' }, { ...item, id: 'series-id', seriesId: 'series' },
    { ...item, id: 'twitch', twitchRecurring: true },
    { ...item, id: 'google', providers: { google: { status: 'synced', occurrences: { key: { remoteId: 'remote' } } } } },
    { ...item, id: 'uncertain', providers: { google: { status: 'error', uncertainCreate: { event: {}, publishedContent: '' } } } },
    { ...item, id: 'busy' },
  ];
  const selected = bulkDeleteSelection(variants, start, end, ['busy']);
  expect(selected.eligible.map(i => i.id)).toEqual(['one', 'boundary']);
  expect(selected.excluded).toHaveLength(9);
  expect(() => bulkDeleteSelection(variants, end, start)).toThrow('Période invalide');
  expect(() => bulkDeleteSelection(variants, 'bad', end)).toThrow();
});

it('requires confirmation, rejects stale previews, deletes only previewed items and rejects replay', async () => {
  await boot();
  for (const value of [item, { ...item, id: 'outside', startAtUtc: end, endAtUtc: '2030-10-02T01:00:00Z' }, { ...item, id: 'series', recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } }]) expect((await call('planning', value)).ok).toBe(true);
  const first = await preview(); const id = first.items[0].id; expect(first.count).toBe(1); expect(first.excluded).toHaveLength(1);
  expect((await call('planning/bulk-delete/confirm', { token: first.token })).ok).toBe(false);
  expect((await snapshot()).planning).toHaveLength(3);
  expect((await call('planning/' + id, { ...item, title: 'Changed' }, 'PUT')).ok).toBe(true);
  expect((await call('planning/bulk-delete/confirm', { token: first.token, confirm: true })).ok).toBe(false);
  const next = await preview();
  expect(await (await call('planning/bulk-delete/confirm', { token: next.token, confirm: true })).json()).toEqual({ deleted: [id], failed: [] });
  expect((await snapshot()).planning).toHaveLength(2);
  expect((await snapshot()).planning.some((i: CalendarItem) => i.id === id)).toBe(false);
  expect((await call('planning/bulk-delete/confirm', { token: next.token, confirm: true })).ok).toBe(false);
});

it.each(['local', 'failure', 'moved', 'recurring', 'cancelled'])('Google copies: %s retains retry identity and protects remote changes', async mode => {
  const remote = mode !== 'local';
  let changedRemote = true;
  folder = await mkdtemp(join(tmpdir(), 'bulk-provider-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600_000) });
  let failDelete = true;
  const deletes = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url.includes('/users/me/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Target', accessRole: 'owner' }] });
    if (url.includes('/calendars/calendar/events')) {
      if (init?.method === 'POST') return Response.json({ ...JSON.parse(String(init.body)), id: 'remote-one', etag: 'r1' });
      if (init?.method === 'DELETE') { deletes(); return failDelete ? Response.json({ error: { message: 'Unavailable' } }, { status: 503 }) : new Response(null, { status: 204 }); }
      if (url.includes('/events/remote-one') && mode === 'cancelled') return Response.json({ id: 'remote-one', status: 'cancelled' });
      if (url.includes('/events/remote-one')) return Response.json({ id: 'remote-one', etag: 'r1', summary: 'Live', start: { dateTime: changedRemote && mode === 'moved' ? '2030-10-03T18:00:00Z' : item.startAtUtc }, end: { dateTime: changedRemote && mode === 'moved' ? '2030-10-03T20:00:00Z' : item.endAtUtc }, ...(changedRemote && mode === 'recurring' ? { recurrence: ['RRULE:FREQ=WEEKLY'] } : {}) });
      return Response.json({ items: [] });
    }
    throw new Error('Unexpected provider request: ' + url);
  }));
  const options = { port: 0, dataDir: folder, googleClientId: 'client', secretStore: secrets, logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  expect((await call('google/target', { calendarId: 'calendar' }, 'PUT')).ok).toBe(true);
  expect((await call('planning', { ...item, desiredPublication: { local: true, twitch: false, google: true } })).ok).toBe(true);
  expect((await call('planning', { ...item, id: 'local-only' })).ok).toBe(true);
  const before = (await snapshot()).planning;
  const id = before[0].id, localId = before[1].id;
  const first = await preview({ google: remote });
  const result = await (await call('planning/bulk-delete/confirm', { token: first.token, confirm: true })).json();
  if (mode === 'cancelled') { expect(result.deleted).toHaveLength(2); expect(deletes).not.toHaveBeenCalled(); return; }
  if (!remote) { expect(result.deleted).toHaveLength(2); expect(deletes).not.toHaveBeenCalled(); return; }
  expect(result.deleted).toEqual([localId]); expect(result.failed).toHaveLength(1);
  await server.stop(); server = await startDashboardServer(options);
  const retained = (await snapshot()).planning.find((i: CalendarItem) => i.id === id);
  expect(retained.providers.google).toMatchObject({ remoteId: 'remote-one', status: 'error' });
  expect(retained.desiredPublication.google).toBe(false);
  expect(retained.providers.google.deletionPeriod).toEqual({ start, end });
  expect((await call(`planning/${id}/retry/google`, {})).ok).toBe(false);
  expect((await call(`planning/${id}`, { ...item, title: 'Edited after refusal' }, 'PUT')).ok).toBe(true);
  expect((await snapshot()).planning[0].providers.google.remoteId).toBe('remote-one');
  if (mode === 'moved' || mode === 'recurring') expect(deletes).not.toHaveBeenCalled();
  failDelete = false; changedRemote = false;
  expect((await call(`planning/${id}/retry/google`, {})).ok).toBe(true);
  expect((await snapshot()).planning[0].providers.google.remoteId).toBeUndefined();
  const retry = await preview({ google: true });
  expect(await (await call('planning/bulk-delete/confirm', { token: retry.token, confirm: true })).json()).toEqual({ deleted: [id], failed: [] });
  expect((await snapshot()).planning).toEqual([]);
});


it('retains a linked Twitch event when Twitch is disconnected, including after restart', async () => {
  await boot(); await server!.stop();
  const file = join(folder, 'dashboard.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  data.planning = [{ ...item, ownership: 'LOCAL', twitchSegmentId: 'segment', providers: { twitch: { status: 'synced', remoteId: 'segment' } }, desiredPublication: { local: true, twitch: true, google: false } }];
  await writeFile(file, JSON.stringify(data));
  const options = { port: 0, dataDir: folder, logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  const first = await preview({ twitch: true });
  const response = await (await call('planning/bulk-delete/confirm', { token: first.token, confirm: true })).json();
  expect(response.deleted).toEqual([]); expect(response.failed).toHaveLength(1);
  await server.stop(); server = await startDashboardServer(options);
  expect((await snapshot()).planning[0]).toMatchObject({ id: item.id, twitchSegmentId: 'segment', desiredPublication: { twitch: false }, providers: { twitch: { remoteId: 'segment', status: 'error' } } });
});


it.each(['success', 'failure', 'moved', 'recurring'])('connected Twitch: %s respects durable scope on retry and edit after restart', async mode => {
  await boot(); await server!.stop();
  const file = join(folder, 'dashboard.json');
  const data = JSON.parse(await readFile(file, 'utf8'));
  data.twitch = { broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
  data.planning = [{ ...item, ownership: 'LOCAL', twitchSegmentId: 'segment', providers: { twitch: { status: 'synced', remoteId: 'segment' } }, desiredPublication: { local: true, twitch: true, google: false } }];
  await writeFile(file, JSON.stringify(data));
  const secrets = new MemorySecretStore();
  await secrets.setTwitchTokens({ accessToken: 'token', refreshToken: '' });
  let changedRemote = true, failDelete = mode === 'failure', removed = false;
  const deletes = vi.fn();
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (!url.startsWith('https://')) return nativeFetch(input, init);
    if (url.includes('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
    if (url.includes('/channels?')) return Response.json({ data: [{ title: 'Live', game_id: '1', game_name: 'Category' }] });
    if (url.includes('/streams?')) return Response.json({ data: [] });
    if (url.includes('/schedule/segment?') && init?.method === 'DELETE') {
      deletes();
      if (failDelete) return Response.json({ message: 'Unavailable' }, { status: 503 });
      removed = true; return new Response(null, { status: 204 });
    }
    if (url.includes('/schedule?')) return Response.json({ data: { segments: removed ? [] : [{ id: 'segment', title: 'Live', start_time: changedRemote && mode === 'moved' ? '2030-10-03T18:00:00Z' : item.startAtUtc, end_time: changedRemote && mode === 'moved' ? '2030-10-03T20:00:00Z' : item.endAtUtc, is_recurring: changedRemote && mode === 'recurring', category: { id: '1', name: 'Category' } }] } });
    throw new Error('Unexpected Twitch request: ' + url);
  }));
  const options = { port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options);
  expect((await snapshot()).twitch.connected).toBe(true);
  const first = await preview({ twitch: true });
  const response = await (await call('planning/bulk-delete/confirm', { token: first.token, confirm: true })).json();
  if (mode === 'success') { expect(response).toEqual({ deleted: [item.id], failed: [] }); expect(deletes).toHaveBeenCalledTimes(1); return; }
  expect(response.deleted).toEqual([]); expect(response.failed).toHaveLength(1);
  await server.stop(); server = await startDashboardServer(options);
  expect((await snapshot()).planning[0].providers.twitch.deletionPeriod).toEqual({ start, end });
  expect((await call(`planning/${item.id}/retry/twitch`, {})).ok).toBe(false);
  expect((await call(`planning/${item.id}`, { ...item, title: 'Edited after refusal' }, 'PUT')).ok).toBe(true);
  expect((await snapshot()).planning[0]).toMatchObject({ twitchSegmentId: 'segment', providers: { twitch: { remoteId: 'segment', status: 'error' } } });
  if (mode === 'moved' || mode === 'recurring') expect(deletes).not.toHaveBeenCalled();
  failDelete = false; changedRemote = false;
  expect((await call(`planning/${item.id}/retry/twitch`, {})).ok).toBe(true);
  expect(removed).toBe(true);
  expect((await snapshot()).planning[0].providers.twitch.remoteId).toBeUndefined();
  const retry = await preview({ twitch: true });
  expect(await (await call('planning/bulk-delete/confirm', { token: retry.token, confirm: true })).json()).toEqual({ deleted: [item.id], failed: [] });
});
