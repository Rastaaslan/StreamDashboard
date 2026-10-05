import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { expandRecurringItems } from '../packages/core/src/recurrence.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

let server: DashboardServerHandle | undefined;
let folder = '';
afterEach(async () => { await server?.stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); if (folder) await rm(folder, { recursive: true, force: true }); });

async function fixture(provider: 'twitch' | 'google') {
  folder = await mkdtemp(join(tmpdir(), 'cb122-'));
  const secrets = new MemorySecretStore();
  const remote = new Map<string, any>();
  const writes: { method: string; id: string; body: any; ifMatch?: string | null }[] = [];
  let sequence = 0, offline = false, rejectCreate = false, loseCreateResponse = false;
  let raceGooglePatch = false;
  const nativeFetch = globalThis.fetch;
  const http: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol !== 'https:') return nativeFetch(input, init);
    if (url.pathname.includes('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
    if (url.pathname.includes('/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Target', accessRole: 'owner' }] });
    const google = url.pathname.includes('/events');
    if (!google && !url.pathname.includes('/schedule')) return Response.json({ data: [] });
    if (offline) return Response.json({ message: 'provider offline', error: { message: 'provider offline' } }, { status: 503, headers: { 'Retry-After': '0' } });
    const id = google ? url.pathname.split('/events/')[1] : url.searchParams.get('id');
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    const current = id ? remote.get(id) : undefined;
    if (method === 'GET') {
      if (id) return current ? Response.json(google ? current : { data: { segments: [current] } }) : Response.json({}, { status: 404 });
      let values = [...remote.values()];
      if (google) {
        const filters = url.searchParams.getAll('privateExtendedProperty');
        values = values.filter(event => filters.every(filter => { const [key, value] = filter.split('='); return event.extendedProperties?.private?.[key] === value; }));
        if (url.searchParams.get('showDeleted') !== 'true') values = values.filter(event => event.status !== 'cancelled');
      }
      return Response.json(google ? { items: values } : { data: { segments: values } });
    }
    if (method === 'POST') {
      if (rejectCreate) return Response.json({ message: 'creation forbidden', error: { message: 'creation forbidden' } }, { status: 403 });
      const createdId = body.id ?? `remote-${++sequence}`;
      if (remote.has(createdId)) return Response.json({}, { status: 409 });
      const event = google ? { ...body, id: createdId, etag: `v${++sequence}`, status: 'confirmed' }
        : { ...body, id: createdId, end_time: new Date(Date.parse(body.start_time) + Number(body.duration) * 60000).toISOString() };
      remote.set(createdId, event); writes.push({ method, id: createdId, body });
      if (loseCreateResponse) { loseCreateResponse = false; throw new Error('CREATE response lost'); }
      return Response.json(google ? event : { data: { segments: [event] } });
    }
    if (!current || current.status === 'cancelled') return Response.json({}, { status: 404 });
    if (google && method === 'PATCH' && raceGooglePatch) { current.etag = 'concurrent-edit'; raceGooglePatch = false; }
    if (google && new Headers(init?.headers).get('If-Match') !== current.etag) return Response.json({ error: { message: 'ETag mismatch' } }, { status: 412 });
    if (!google && method === 'PATCH' && ('is_recurring' in body || (current.is_recurring && body.start_time))) return Response.json({ message: 'Immutable recurrence/start' }, { status: 400 });
    writes.push({ method, id: id!, body, ifMatch: new Headers(init?.headers).get('If-Match') });
    if (method === 'DELETE') {
      if (google) remote.set(id!, { ...current, status: 'cancelled', etag: `v${++sequence}` }); else remote.delete(id!);
      return new Response(null, { status: 204 });
    }
    Object.assign(current, body);
    if (google) current.etag = `v${++sequence}`;
    else current.end_time = new Date(Date.parse(current.start_time) + Number(current.duration) * 60000).toISOString();
    return Response.json(google ? current : { data: { segments: [current] } });
  };
  const options = { port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', googleClientId: 'client', googleFetch: http, logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options); await server.stop();
  const file = join(folder, 'dashboard.json');
  const state = JSON.parse(await readFile(file, 'utf8'));
  state.twitch = { broadcasterId: '42', userName: 'u', displayName: 'U' };
  await writeFile(file, JSON.stringify(state));
  if (provider === 'twitch') await secrets.setTwitchTokens({ accessToken: 'token', refreshToken: '' });
  else await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 365 * 86400000) });
  vi.stubGlobal('fetch', http);
  server = await startDashboardServer(options);
  await server.providersReady;
  const request = async (route: string, body: unknown = {}, method = 'POST', ok = true) => {
    const response = await nativeFetch(server!.url + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.ok, await response.clone().text()).toBe(ok);
    return response.json();
  };
  if (provider === 'google') await request('google/target', { calendarId: 'calendar' }, 'PUT');
  const start = new Date(); start.setUTCDate(start.getUTCDate() + 1); start.setUTCHours(12, 0, 0, 0);
  const input = { title: 'Matrix', category: 'live', startAtUtc: start.toISOString(), endAtUtc: new Date(+start + 3600000).toISOString(), desiredPublication: { local: true, twitch: provider === 'twitch', google: provider === 'google' } };
  const item = () => server!.state().planning.find(value => value.title === 'Matrix')!;
  return { request, input, item, remote, writes, offline: (value: boolean) => { offline = value; },
    raceGooglePatch: () => { raceGooglePatch = true; },
    loseCreateResponse: () => { loseCreateResponse = true; },
    rejectCreate: (value: boolean) => { rejectCreate = value; },
    active: () => [...remote.values()].filter(event => event.status !== 'cancelled'),
    restart: async () => { await server!.stop(); server = await startDashboardServer(options); await server.providersReady; },
    disk: async () => JSON.parse(await readFile(file, 'utf8')).planning as CalendarItem[],
  };
}

const cases = [
  ['weekly', 1, 'simple'], ['weekly', 1, 'until'], ['weekly', 1, 'cancel'], ['weekly', 1, 'patch'],
  ['daily', 1, 'simple'], ['weekly', 2, 'simple'], ['monthly', 1, 'simple'],
] as const;
for (const provider of ['twitch', 'google'] as const) {
  it.each(cases)(`${provider} HTTP lifecycle %s/%s %s`, async (frequency, interval, variant) => {
    const f = await fixture(provider);
    const recurrence: NonNullable<CalendarItem['recurrence']> = { frequency, interval, timeZone: 'Europe/Paris' };
    if (variant === 'until') recurrence.until = new Date(Date.parse(f.input.startAtUtc) + 17 * 86400000).toISOString();
    await f.request('planning', { ...f.input, recurrence });
    const id = f.item().id;
    if (variant === 'cancel' || variant === 'patch') {
      const key = expandRecurringItems([f.item()], { from: Date.now(), to: Date.now() + 28 * 86400000 })[1].occurrenceKey!;
      await f.request(`planning/${id}/occurrence`, { occurrenceKey: key, ...(variant === 'patch' ? { patch: { title: 'Exception' } } : {}) }, variant === 'cancel' ? 'DELETE' : 'PUT');
    }
    const materialized = provider === 'twitch' ? frequency !== 'weekly' || interval !== 1 || variant !== 'simple' : ['cancel', 'patch'].includes(variant);
    expect(f.item().providers![provider]).toMatchObject({ status: 'synced', projectionMode: materialized ? 'materialized' : 'native' });
    const ids = f.active().map(event => event.id).sort();
    expect(ids.length).toBeGreaterThan(0);
    await f.restart();
    await f.request(`planning/${id}/retry/${provider}`);
    expect(f.active().map(event => event.id).sort()).toEqual(ids);
    expect((await f.disk()).find(item => item.id === id)!.providers![provider]!.status).toBe('synced');
    const before = f.writes.length;
    await f.request(`planning/${id}`, { description: 'Edited' }, 'PUT');
    expect(f.active().map(event => event.id).sort()).toEqual(ids);
    if (provider === 'google') expect(f.writes.length).toBeGreaterThan(before);
    await f.request(`planning/${id}`, { confirmRecurring: true }, 'DELETE');
    expect(f.active()).toEqual([]);
  });
}

it.each(['remove', 'move', 'timezone', 'add'] as const)('Twitch replaces native identity durably on %s', async change => {
  const f = await fixture('twitch');
  const recurrence = { frequency: 'weekly', interval: 1, timeZone: 'UTC' };
  await f.request('planning', { ...f.input, ...(change === 'add' ? {} : { recurrence }) });
  const id = f.item().id, old = f.active()[0].id;
  const changes = change === 'remove' ? { recurrence: null } : change === 'timezone' ? { recurrence: { ...recurrence, timeZone: 'Europe/Paris' } }
    : change === 'add' ? { recurrence } : { startAtUtc: new Date(Date.parse(f.input.startAtUtc) + 3600000).toISOString(), endAtUtc: new Date(Date.parse(f.input.endAtUtc) + 3600000).toISOString() };
  f.offline(true);
  await f.request(`planning/${id}`, changes, 'PUT');
  expect(f.item().providers!.twitch!.status).toBe('error');
  f.offline(false); await f.restart();
  await f.request(`planning/${id}/retry/twitch`);
  expect(f.item().providers!.twitch!.status).toBe('synced');
  expect(f.active()).toHaveLength(1); expect(f.active()[0].id).not.toBe(old);
  expect(f.active()[0].is_recurring).toBe(change !== 'remove');
  const writes = f.writes.length;
  await f.restart(); await f.request('twitch/sync');
  expect(f.writes).toHaveLength(writes);
});

it.each(['local', 'remote'] as const)('Google native-to-materialized 412 resolves %s through the endpoint after restart', async strategy => {
  const f = await fixture('google');
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id, master = f.active()[0];
  master.etag = 'external-edit'; master.summary = 'Remote edit';
  const key = expandRecurringItems([f.item()], { from: Date.now(), to: Date.now() + 28 * 86400000 })[0].occurrenceKey!;
  await f.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Exception' } }, 'PUT');
  expect(f.item().providers!.google!.status).toBe('conflict');
  await f.restart();
  await f.request(`planning/${id}/conflict/google`, { strategy });
  await f.request(`planning/${id}/retry/google`);
  expect((await f.disk()).find(item => item.id === id)!.providers!.google!.status).toBe('synced');
  if (strategy === 'local') {
    expect(f.active().some(event => event.id === master.id)).toBe(false);
    expect(f.active().every(event => !event.recurrence?.length)).toBe(true);
  } else {
    const saved = (await f.disk()).find(item => item.id === id)!;
    expect(Object.keys(saved.recurrence?.exceptions ?? {})).toEqual([]);
    expect(saved.title).toBe('Remote edit'); expect(f.active()).toEqual([master]);
    await f.request(`planning/${id}`, { description: 'After resolution' }, 'PUT');
    expect(f.active().map(event => event.id)).toEqual([master.id]);
  }
});

it.each(['twitch', 'google'] as const)('%s conversion cycles, cancelled remote retry and rolling shift preserve ownership', async provider => {
  const f = await fixture(provider);
  const recurrence = { frequency: 'weekly', interval: 1, timeZone: 'UTC' };
  await f.request('planning', { ...f.input, recurrence });
  const id = f.item().id;
  const external = provider === 'twitch' ? { id: 'external', title: 'External', start_time: f.input.startAtUtc, end_time: f.input.endAtUtc, is_recurring: false }
    : { id: 'external', summary: 'External', etag: 'external', start: { dateTime: f.input.startAtUtc }, end: { dateTime: f.input.endAtUtc } };
  f.remote.set('external', external);
  const managed = () => f.active().filter(event => event.id !== 'external');
  for (let cycle = 0; cycle < 2; cycle++) {
    const key = expandRecurringItems([f.item()], { from: Date.now(), to: Date.now() + 28 * 86400000 })[0].occurrenceKey!;
    await f.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Exception' } }, 'PUT');
    expect(f.item().providers![provider]!.projectionMode).toBe('materialized');
    expect(managed()).toHaveLength(4);
    await f.restart();
    const first = managed()[0];
    if (provider === 'google') f.remote.set(first.id, { id: first.id, status: 'cancelled' }); else f.remote.delete(first.id);
    await f.restart();
    expect(f.item().providers![provider]!.status).toBe('error');
    await f.request(`planning/${id}/retry/${provider}`);
    expect(f.item().providers![provider]!.status).toBe('synced');
    expect(managed()).toHaveLength(4);
    await f.request(`planning/${id}`, { recurrence }, 'PUT');
    expect(f.item().providers![provider]!.projectionMode).toBe('native');
    expect(managed()).toHaveLength(1);
    await f.restart();
    expect(managed()).toHaveLength(1);
  }
  // Make both providers materialize, then move the rolling horizon by a week.
  const key = expandRecurringItems([f.item()], { from: Date.now(), to: Date.now() + 28 * 86400000 })[0].occurrenceKey!;
  await f.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Exception' } }, 'PUT');
  const previous = new Set(managed().map(event => event.id));
  const future = Date.now() + 7 * 86400000;
  vi.spyOn(Date, 'now').mockReturnValue(future);
  await f.restart();
  expect(managed()).toHaveLength(4);
  expect(managed().filter(event => previous.has(event.id))).toHaveLength(3);
  const writes = f.writes.length;
  await f.restart(); expect(f.writes).toHaveLength(writes);
  await f.request(`planning/${id}`, { recurrence: null }, 'PUT');
  expect(managed()).toHaveLength(1);
  await f.request(`planning/${id}`, { confirmRecurring: true }, 'DELETE');
  expect(f.active()).toEqual([external]);
  expect(f.writes.some(write => write.id === 'external')).toBe(false);
});

it.each(['local', 'remote'] as const)('Twitch retirement detects remote conflict and resolves %s without blind deletion', async strategy => {
  const f = await fixture('twitch');
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id, old = f.active()[0];
  old.title = 'External edit';
  await f.request(`planning/${id}`, { recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' } }, 'PUT');
  expect(f.item().providers!.twitch!.status).toBe('conflict');
  expect(f.active()).toEqual([old]);
  await f.restart();
  await f.request(`planning/${id}/retry/twitch`, {}, 'POST', false);
  expect(f.active()).toEqual([old]);
  await f.request(`planning/${id}/conflict/twitch`, { strategy });
  await f.request(`planning/${id}/retry/twitch`);
  const saved = (await f.disk()).find(item => item.id === id)!;
  expect(saved.providers!.twitch!.status).toBe('synced');
  if (strategy === 'remote') {
    expect(saved.recurrence!.frequency).toBe('weekly'); expect(f.active()).toEqual([old]);
  } else { expect(f.active().length).toBeGreaterThan(20); expect(f.active()).toHaveLength(Object.keys(saved.providers!.twitch!.projections!).length); expect(f.remote.has(old.id)).toBe(false); }
});

it.each(['twitch', 'google'] as const)('%s legacy pre-rolling identities require explicit withdrawal; bulk excludes the series', async provider => {
  const f = await fixture(provider);
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id;
  await server!.stop();
  const file = join(folder, 'dashboard.json'), state = JSON.parse(await readFile(file, 'utf8'));
  delete state.planning[0].providers[provider].projectionOwned;
  delete state.planning[0].providers[provider].projectionMode;
  await writeFile(file, JSON.stringify(state));
  await f.restart();
  const key = expandRecurringItems([f.item()], { from: Date.now(), to: Date.now() + 28 * 86400000 })[0].occurrenceKey!;
  await f.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Exception' } }, 'PUT');
  expect(f.item().providers![provider]!.status).toBe('error');
  expect(f.item().providers![provider]!.lastError).toContain('explicitement');
  const writes = f.writes.length;
  await f.restart(); await f.request(`planning/${id}/retry/${provider}`, {}, 'POST', false);
  expect(f.writes).toHaveLength(writes); expect(f.active()).toHaveLength(1);
  const preview = await f.request('planning/bulk-delete/preview', { start: f.input.startAtUtc, end: new Date(Date.parse(f.input.endAtUtc) + 86400000).toISOString(), destinations: { [provider]: true } });
  expect(preview.count).toBe(0);
  await f.request('planning/bulk-delete/confirm', { token: preview.token, confirm: true });
  expect(f.active()).toHaveLength(1);
  await f.request(`planning/${id}`, { confirmRecurring: true }, 'DELETE');
  expect(f.active()).toEqual([]);
});

it('Twitch replacement resumes after confirmed deletion followed by a rejected CREATE and restart', async () => {
  const f = await fixture('twitch');
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id;
  f.rejectCreate(true);
  await f.request(`planning/${id}`, { recurrence: null }, 'PUT');
  expect(f.active()).toEqual([]);
  expect(f.item().providers!.twitch!.status).toBe('error');
  expect((await f.disk())[0].providers!.twitch!.nativeReplacementRequested).toBeDefined();
  f.rejectCreate(false);
  await f.restart();
  expect(f.active()).toHaveLength(1);
  expect(f.active()[0].is_recurring).toBe(false);
  expect(f.item().providers!.twitch!.status).toBe('synced');
  const writes = f.writes.length;
  await f.restart(); expect(f.writes).toHaveLength(writes);
});

it('pre-rolling recurrence rejection disappears from persisted state after successful projection', async () => {
  const f = await fixture('twitch');
  await f.request('planning', { ...f.input, desiredPublication: { local: true, twitch: false, google: false }, recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' } });
  await server!.stop();
  const file = join(folder, 'dashboard.json'), state = JSON.parse(await readFile(file, 'utf8'));
  state.planning[0].desiredPublication.twitch = true;
  state.planning[0].syncError = 'Twitch : récurrence non représentable';
  state.planning[0].providers.twitch = { status: 'error', lastError: state.planning[0].syncError };
  await writeFile(file, JSON.stringify(state));
  await f.restart();
  expect(f.item().providers!.twitch!.status).toBe('synced');
  expect(f.item().syncError).toBeUndefined();
  expect((await f.disk())[0].syncError).toBeUndefined();
  const writes = f.writes.length;
  await f.restart(); expect(f.writes).toHaveLength(writes);
});

it('a conflicting Twitch retirement cannot remove the local owner and orphan the native remote', async () => {
  const f = await fixture('twitch');
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id;
  f.active()[0].title = 'External edit';
  await f.request(`planning/${id}`, { recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' } }, 'PUT');
  await f.request(`planning/${id}`, { confirmRecurring: true }, 'DELETE', false);
  expect((await f.disk()).some(item => item.id === id)).toBe(true);
  expect(f.active()).toHaveLength(1);
  await f.request(`planning/${id}/conflict/twitch`, { strategy: 'remote' });
  await f.restart(); await f.request(`planning/${id}/retry/twitch`);
  expect((await f.disk()).find(item => item.id === id)!.desiredPublication!.twitch).toBe(true);
  expect(f.active()).toHaveLength(1);
});

it.each(['twitch', 'google'] as const)('%s native remote deletion becomes an error and explicit retry recreates once', async provider => {
  const f = await fixture(provider);
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id, old = f.active()[0];
  if (provider === 'google') old.status = 'cancelled'; else f.remote.delete(old.id);
  await f.request(`${provider}/sync`);
  expect(f.item().providers![provider]!.status).toBe('error');
  expect(f.active()).toEqual([]);
  await f.restart();
  expect(f.active()).toEqual([]);
  await f.request(`planning/${id}/retry/${provider}`);
  expect(f.item().providers![provider]!.status).toBe('synced');
  expect(f.active()).toHaveLength(1); expect(f.active()[0].id).not.toBe(old.id);
  const creates = f.writes.filter(write => write.method === 'POST').length;
  await f.request(`planning/${id}/retry/${provider}`);
  expect(f.writes.filter(write => write.method === 'POST')).toHaveLength(creates);
});

it.each(['twitch', 'google'] as const)('%s offline occurrence move survives reload and retry with stable identity', async provider => {
  const f = await fixture(provider);
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id;
  const key = expandRecurringItems([f.item()], { from: Date.now(), to: Date.now() + 28 * 86400000 })[0].occurrenceKey!;
  await f.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Exception' } }, 'PUT');
  const original = f.item().providers![provider]!.projections![key].remoteId!;
  const ids = f.active().map(event => event.id).sort();
  f.offline(true);
  const moved = new Date(Date.parse(f.input.startAtUtc) + 2 * 3600000).toISOString();
  await f.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Moved', startAtUtc: moved, endAtUtc: new Date(Date.parse(moved) + 3600000).toISOString() } }, 'PUT');
  expect(f.item().providers![provider]!.status).toBe('error');
  await f.restart();
  expect(f.item().providers![provider]!.status).toBe('error');
  f.offline(false);
  await f.request(`planning/${id}/retry/${provider}`);
  expect(f.item().providers![provider]!.status).toBe('synced');
  expect(f.item().providers![provider]!.projections![key].remoteId).toBe(original);
  expect(f.active().map(event => event.id).sort()).toEqual(ids);
  const remote = f.remote.get(original);
  expect(provider === 'google' ? remote.start.dateTime : remote.start_time).toBe(moved);
  expect(f.item().providers![provider]!.lastError).toBeUndefined();
});

it('Twitch sync settles a lost replacement CREATE response without retiring the recovered identity again', async () => {
  const f = await fixture('twitch');
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id;
  f.loseCreateResponse();
  await f.request(`planning/${id}`, { recurrence: null }, 'PUT');
  expect(f.item().providers!.twitch!.status).toBe('error');
  expect(f.item().providers!.twitch!.uncertainCreate).toBeTruthy();
  expect(f.active()).toHaveLength(1);
  const remoteId = f.active()[0].id, writes = f.writes.length;
  await f.restart();
  await f.request('twitch/sync');
  expect(f.item().providers!.twitch!.status).toBe('synced');
  expect(f.item().providers!.twitch!.uncertainCreate).toBeFalsy();
  expect(f.item().providers!.twitch!.nativeReplacementRequested).toBeUndefined();
  await f.restart(); await f.request(`planning/${id}/retry/twitch`);
  expect(f.active().map(event => event.id)).toEqual([remoteId]);
  expect(f.writes).toHaveLength(writes);
});

for (const change of ['frequency', 'timezone', 'remove'] as const) {
  it.each(['local', 'remote'] as const)(`Google native recurrence conflict ${change}: resolves %s after restart with the same master`, async strategy => {
    const f = await fixture('google');
    const recurrence = { frequency: 'weekly', interval: 1, timeZone: 'UTC' };
    await f.request('planning', { ...f.input, recurrence });
    const id = f.item().id, master = f.active()[0], remoteId = master.id;
    const initialRule = [...master.recurrence];
    master.summary = 'Remote version'; master.etag = 'remote-edit';
    const intended = change === 'remove' ? null : { ...recurrence, ...(change === 'frequency' ? { frequency: 'daily' } : { timeZone: 'Europe/Paris' }) };
    await f.request(`planning/${id}`, { title: 'Local version', recurrence: intended }, 'PUT');
    let saved = (await f.disk()).find(item => item.id === id)!;
    expect(saved.providers!.google).toMatchObject({ status: 'conflict', remoteId, projectionMode: 'native' });
    expect(saved.providers!.google!.nativeWithdrawalRequested).toBeUndefined();
    expect(master.recurrence).toEqual(initialRule);
    await f.restart();
    await f.request(`planning/${id}/retry/google`, {}, 'POST', false);
    const writes = f.writes.length;
    await f.request(`planning/${id}/conflict/google`, { strategy });
    saved = (await f.disk()).find(item => item.id === id)!;
    expect(saved.conflict).toBeUndefined();
    expect(saved.providers!.google).toMatchObject({ status: 'synced', remoteId, calendarId: 'calendar', remoteRevision: master.etag });
    expect(saved.providers!.google!.lastError).toBeUndefined();
    expect(saved.title).toBe(strategy === 'local' ? 'Local version' : 'Remote version');
    expect(master.summary).toBe(saved.title);
    if (strategy === 'remote') {
      expect(saved.recurrence).toMatchObject(recurrence);
      expect(master.recurrence).toEqual(initialRule);
      expect(f.writes).toHaveLength(writes);
    } else {
      expect(f.writes).toHaveLength(writes + 1);
      expect(f.writes.at(-1)).toMatchObject({ method: 'PATCH', id: remoteId, ifMatch: 'remote-edit' });
      if (intended === null) { expect(saved.recurrence).toBeUndefined(); expect(master.recurrence).toEqual([]); }
      else {
        expect(saved.recurrence).toMatchObject(intended);
        expect(master.recurrence[0]).toContain(change === 'frequency' ? 'FREQ=DAILY' : 'FREQ=WEEKLY');
        expect(master.start.timeZone).toBe(intended.timeZone);
        expect(master.end.timeZone).toBe(intended.timeZone);
      }
    }
    await f.restart();
    await f.request(`planning/${id}/retry/google`);
    saved = (await f.disk()).find(item => item.id === id)!;
    expect(saved.conflict).toBeUndefined();
    expect(saved.providers!.google).toMatchObject({ status: 'synced', remoteId, remoteRevision: master.etag });
    expect(f.active().map(event => event.id)).toEqual([remoteId]);
    expect(f.writes.filter(write => write.method === 'POST')).toHaveLength(1);
    expect(f.writes.some(write => write.method === 'DELETE')).toBe(false);
  });
}

for (const invalid of ['identity', 'ownership', 'etag', 'rule', 'event-id'] as const) {
  it.each(['local', 'remote'] as const)(`Google native conflict refuses invalid ${invalid} for %s resolution`, async strategy => {
    const f = await fixture('google');
    await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
    const id = f.item().id, master = f.active()[0];
    master.etag = 'remote-edit';
    await f.request(`planning/${id}`, { recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' } }, 'PUT');
    if (invalid === 'identity') master.extendedProperties.private.streamDashboardId = 'another-series';
    if (invalid === 'ownership') delete master.extendedProperties;
    if (invalid === 'etag') delete master.etag;
    if (invalid === 'rule') master.recurrence = ['RRULE:FREQ=WEEKLY;BYDAY=MO,WE'];
    if (invalid === 'event-id') master.id = 'another-master';
    const snapshot = structuredClone(master), writes = f.writes.length;
    await f.restart();
    await f.request(`planning/${id}/conflict/google`, { strategy }, 'POST', false);
    const saved = (await f.disk()).find(item => item.id === id)!;
    expect(saved.providers!.google!.status).toBe('conflict');
    expect(saved.conflict?.provider).toBe('google');
    expect(saved.recurrence!.frequency).toBe('daily');
    expect(f.writes).toHaveLength(writes);
    expect(master).toEqual(snapshot);
  });
}

it('Google native conflict preserves a concurrent 412 during explicit local resolution', async () => {
  const f = await fixture('google');
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id, master = f.active()[0], rule = [...master.recurrence];
  master.etag = 'remote-edit';
  await f.request(`planning/${id}`, { recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' } }, 'PUT');
  await f.restart();
  f.raceGooglePatch();
  const writes = f.writes.length;
  await f.request(`planning/${id}/conflict/google`, { strategy: 'local' }, 'POST', false);
  expect(f.writes).toHaveLength(writes);
  expect(master.recurrence).toEqual(rule);
  expect((await f.disk())[0].providers!.google!.status).toBe('conflict');
  await f.restart();
  await f.request(`planning/${id}/conflict/google`, { strategy: 'local' });
  expect(f.writes.at(-1)).toMatchObject({ method: 'PATCH', id: master.id, ifMatch: 'concurrent-edit' });
  expect(master.recurrence[0]).toContain('FREQ=DAILY');
  expect((await f.disk())[0].providers!.google).toMatchObject({ status: 'synced', remoteId: master.id, remoteRevision: master.etag });
  expect((await f.disk())[0].conflict).toBeUndefined();
});

it('Google native conflict remote choice also restores a remotely removed recurrence', async () => {
  const f = await fixture('google');
  await f.request('planning', { ...f.input, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } });
  const id = f.item().id, master = f.active()[0];
  master.etag = 'remote-edit'; master.recurrence = [];
  await f.request(`planning/${id}`, { recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' } }, 'PUT');
  await f.restart();
  const writes = f.writes.length;
  await f.request(`planning/${id}/conflict/google`, { strategy: 'remote' });
  expect(f.writes).toHaveLength(writes);
  expect((await f.disk())[0].recurrence).toBeUndefined();
  await f.restart(); await f.request(`planning/${id}/retry/google`);
  expect(master.recurrence).toEqual([]);
  expect((await f.disk())[0].providers!.google).toMatchObject({ status: 'synced', remoteId: master.id });
  expect((await f.disk())[0].conflict).toBeUndefined();
});
