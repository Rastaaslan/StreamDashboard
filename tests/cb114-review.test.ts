import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CalendarItem } from '../packages/contracts/src/index.js';
import { PlanningOrchestrator, type PlanningProvider } from '../packages/core/src/planning.js';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

let server: DashboardServerHandle | undefined;
let folder = '';
afterEach(async () => { vi.useRealTimers(); vi.restoreAllMocks(); await server?.stop(); server = undefined; vi.unstubAllGlobals(); if (folder) await rm(folder, { recursive: true, force: true }); });

it.each(['twitch', 'google'] as const)('%s retains an in-progress occurrence after restart until its exclusive end', async name => {
  vi.useFakeTimers(); vi.setSystemTime('2026-10-05T11:00:00Z');
  let disk: CalendarItem[] = []; let next = 0;
  const remote = new Set<string>();
  const provider: PlanningProvider = { create: vi.fn(async () => { const id = String(++next); remote.add(id); return { id }; }),
    update: vi.fn(async () => ({})), delete: vi.fn(async id => { remote.delete(id); }) };
  const restart = () => new PlanningOrchestrator(structuredClone(disk), { [name]: provider }, async items => { disk = structuredClone(items); });
  const result = await restart().create({ id: 'series', title: 'In progress', startAtUtc: '2026-10-05T12:00:00Z', endAtUtc: '2026-10-05T13:00:00Z',
    desiredPublication: { local: true, twitch: name === 'twitch', google: name === 'google' },
    recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC', until: '2026-10-05T12:00:00Z', exceptions: { 'series:2026-10-05T12:00:00': { patch: { title: 'Active' } } } } });
  const id = Object.values(result.providers![name]!.projections!)[0].remoteId!;
  vi.setSystemTime('2026-10-05T12:01:00Z'); await restart().refreshTwitch(); await restart().retry('series', name);
  expect(remote.has(id)).toBe(true); expect(provider.delete).not.toHaveBeenCalled(); expect(provider.create).toHaveBeenCalledTimes(1);
  vi.setSystemTime('2026-10-05T13:00:00Z'); await restart().refreshTwitch();
  expect(remote.size).toBe(0); expect(provider.delete).toHaveBeenCalledTimes(1);
});

async function runtime(loseResponse = false) {
  folder = await mkdtemp(join(tmpdir(), 'cb114-review-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 365 * 86400000) });
  const google = new Map<string, any>(); const tombstones = new Set<string>();
  const retireGoogle = (key: string) => { google.delete(key); tombstones.add(key); };
  let hideLists = false; let conflicts = 0; let unavailableReads = false;
  const twitch = new Map<string, any>();
  const mutations: { method: string; calendar: string; id?: string }[] = [];
  const posts: string[] = []; let next = 0; let lose = loseResponse;
  const googleFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/calendarList')) return Response.json({ items: ['A', 'B'].map(id => ({ id, summary: id, accessRole: 'owner' })) });
    const match = /\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname)!;
    const calendar = decodeURIComponent(match[1]); const id = match[2];
    if (['POST', 'PATCH', 'DELETE'].includes(init?.method ?? '')) mutations.push({ method: init!.method!, calendar, id });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); body.id ??= `native-${++next}`; const key = calendar + '/' + body.id;
      // Observe the disk checkpoint at the exact moment remote mutation starts.
      const saved = JSON.parse(await readFile(join(folder, 'dashboard.json'), 'utf8'));
      if (body.extendedProperties.private.streamDashboardProjection === 'materialized') {
        const entry = Object.values(saved.planning[0].providers.google.projections).find((v: any) => v.event.localId === body.extendedProperties.private.streamDashboardId) as any;
        expect(entry.calendarId).toBe(calendar); expect(entry.uncertainCreate).toBeTruthy();
        expect(entry.creationId).toBe(body.extendedProperties.private.streamDashboardCreationId);
        expect(entry.uncertainCreate.event.projection.creationId).toBe(entry.creationId);
      } else {
        expect(saved.planning[0].providers.google).toMatchObject({ calendarId: calendar, uncertainCreate: expect.any(Object) });
      }
      posts.push(key);
      if (google.has(key) || tombstones.has(key)) { conflicts++; return Response.json({ error: { message: 'Identifier already exists' } }, { status: 409 }); }
      google.set(key, { ...body, id: body.id, etag: 'v1' });
      if (lose) { lose = false; throw new TypeError('Lost response'); }
      return Response.json(google.get(key));
    }
    if (init?.method === 'DELETE' && google.has(calendar + '/' + id) && new Headers(init.headers).get('If-Match') !== google.get(calendar + '/' + id).etag) return Response.json({ error: { message: 'ETag conflict' } }, { status: 412 });
    if (init?.method === 'DELETE') { retireGoogle(calendar + '/' + id); return new Response(null, { status: 204 }); }
    if (init?.method === 'PATCH') { const value = { ...google.get(calendar + '/' + id), ...JSON.parse(String(init.body)), etag: 'v2' }; google.set(calendar + '/' + id, value); return Response.json(value); }
    if (id && unavailableReads) return Response.json({}, { status: 404 });
    if (id && tombstones.has(calendar + '/' + id)) return Response.json({ id, status: 'cancelled' });
    if (id) return google.has(calendar + '/' + id) ? Response.json(google.get(calendar + '/' + id)) : Response.json({}, { status: 404 });
    const identity = url.searchParams.get('privateExtendedProperty')?.split('=').slice(1).join('=');
    return Response.json({ items: hideLists ? [] : [...google].filter(([key, value]) => key.startsWith(calendar + '/') && (!identity || value.extendedProperties.private.streamDashboardId === identity)).map(([, value]) => value) });
  };
  const nativeFetch = globalThis.fetch;
  vi.stubGlobal('fetch', async (input: any, init: any) => {
    const url = new URL(String(input)); if (url.protocol !== 'https:') return nativeFetch(input, init);
    if (url.pathname.includes('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
    if (url.pathname.includes('/schedule')) {
      const id = url.searchParams.get('id');
      if (init?.method === 'POST') { const body = JSON.parse(String(init.body)); const segment = { ...body, id: String(++next), end_time: new Date(Date.parse(body.start_time) + Number(body.duration) * 60000).toISOString() }; twitch.set(segment.id, segment); return Response.json({ data: { segments: [segment] } }); }
      if (init?.method === 'DELETE') { twitch.delete(id!); return new Response(null, { status: 204 }); }
      return Response.json({ data: { segments: [...twitch.values()].filter(v => !id || v.id === id) } });
    }
    return Response.json({ data: [] });
  });
  const options = { port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', googleClientId: 'client', googleFetch, logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options); await server.stop();
  const path = join(folder, 'dashboard.json'); const saved = JSON.parse(await readFile(path, 'utf8'));
  saved.twitch = { broadcasterId: '42', userName: 'u', displayName: 'U' }; await writeFile(path, JSON.stringify(saved));
  await secrets.setTwitchTokens({ accessToken: 'token', refreshToken: '' });
  const restart = async () => { await server?.stop(); server = await startDashboardServer(options); await server.providersReady; };
  await restart();
  const request = async (route: string, body: unknown = {}, method = 'POST', expectedSuccess = true) => { const res = await nativeFetch(server!.url + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); expect(res.ok, await res.clone().text()).toBe(expectedSuccess); return res.json(); };
  await request('google/target', { calendarId: 'A' }, 'PUT');
  const start = new Date(Date.now() + 86400000); start.setUTCMilliseconds(0);
  const event = { title: 'Review', category: 'live', startAtUtc: start.toISOString(), endAtUtc: new Date(+start + 3600000).toISOString(), desiredPublication: { local: true, twitch: true, google: true }, recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC', until: start.toISOString(), exceptions: {} } };
  return { google, twitch, posts, mutations, event, request, restart, retireGoogle, tombstones,
    loseNextResponse: () => { lose = true; }, hideLists: () => { hideLists = true; }, unavailableReads: (value: boolean) => { unavailableReads = value; }, conflicts: () => conflicts };
}

it.each([false, true])('lost Google CREATE remains scoped to A after selecting B and restart; withdraw=%s', async withdraw => {
  const ctx = await runtime(true);
  await ctx.request('planning', { ...ctx.event, desiredPublication: { local: true, twitch: false, google: false } });
  const item = server!.state().planning[0]; const key = `${item.localId}:${ctx.event.startAtUtc.slice(0, 19)}`;
  await ctx.request(`planning/${item.id}/occurrence`, { occurrenceKey: key, patch: { title: 'Patched' } }, 'PUT');
  await ctx.request(`planning/${item.id}`, { ...ctx.event, recurrence: server!.state().planning[0].recurrence, desiredPublication: { local: true, twitch: false, google: true } }, 'PUT');
  expect(server!.state().planning[0].providers!.google!.projections![key].uncertainCreate).toBeTruthy();
  await ctx.request('google/target', { calendarId: 'B' }, 'PUT');
  if (withdraw) await ctx.request(`planning/${item.id}/occurrence`, { occurrenceKey: key, patch: { desiredPublication: { local: true, twitch: false, google: false } } }, 'PUT');
  await ctx.restart(); await ctx.request(`planning/${item.id}/retry/google`);
  expect(ctx.posts).toHaveLength(1); expect(ctx.posts[0]).toMatch(/^A\//);
  expect(ctx.google.size).toBe(withdraw ? 0 : 1);
  expect(server!.state().planning[0].providers!.google!.status).toBe('synced');
  await ctx.request(`planning/${item.id}`, { local: true, google: true }, 'DELETE'); expect(ctx.google.size).toBe(0);
});

it('occurrence editor API honors both publication toggles before publication, after publication and restart', async () => {
  const ctx = await runtime();
  await ctx.request('planning', { ...ctx.event, desiredPublication: { local: true, twitch: false, google: false } });
  const item = server!.state().planning[0]; const key = `${item.localId}:${ctx.event.startAtUtc.slice(0, 19)}`;
  const toggle = async (enabled: boolean) => ctx.request(`planning/${item.id}/occurrence`, { occurrenceKey: key, patch: { desiredPublication: { local: true, twitch: enabled, google: enabled } } }, 'PUT');
  await toggle(false);
  await ctx.request(`planning/${item.id}`, { ...ctx.event, recurrence: server!.state().planning[0].recurrence }, 'PUT');
  expect(ctx.twitch.size).toBe(0); expect(ctx.google.size).toBe(0);
  await toggle(true); expect(ctx.twitch.size).toBe(1); expect(ctx.google.size).toBe(1);
  await toggle(false); expect(ctx.twitch.size).toBe(0); expect(ctx.google.size).toBe(0);
  await ctx.restart();
  for (const provider of ['twitch', 'google']) await ctx.request(`planning/${item.id}/retry/${provider}`);
  expect(ctx.twitch.size).toBe(0); expect(ctx.google.size).toBe(0);
});


async function projected(ctx: Awaited<ReturnType<typeof runtime>>) {
  await ctx.request('planning', { ...ctx.event, desiredPublication: { local: true, twitch: false, google: false } });
  const item = server!.state().planning[0]; const key = `${item.localId}:${ctx.event.startAtUtc.slice(0, 19)}`;
  await ctx.request(`planning/${item.id}/occurrence`, { occurrenceKey: key, patch: { title: 'Projected' } }, 'PUT');
  const publication = (enabled: boolean) => ctx.request(`planning/${item.id}`, { ...ctx.event,
    recurrence: server!.state().planning[0].recurrence, desiredPublication: { local: true, twitch: false, google: enabled } }, 'PUT');
  await publication(true);
  return { id: item.id, key, publication };
}

it.each(['withdraw', 'cancel', 'remote'] as const)('Google tombstones allow explicit %s republication, restart and lost-response recovery via 409', async mode => {
  const ctx = await runtime(); const { id, key, publication } = await projected(ctx);
  const old = [...ctx.google.keys()][0];
  const logicalId = ctx.google.get(old).extendedProperties.private.streamDashboardId;
  if (mode === 'withdraw') await publication(false);
  else if (mode === 'cancel') await ctx.request(`planning/${id}/occurrence`, { occurrenceKey: key }, 'DELETE');
  else ctx.retireGoogle(old);
  expect(ctx.tombstones.has(old)).toBe(true); expect(ctx.google.size).toBe(0);
  await ctx.request('google/target', { calendarId: 'B' }, 'PUT');
  await ctx.restart();
  expect(ctx.google.size).toBe(0); expect(ctx.posts).toHaveLength(1);
  ctx.loseNextResponse(); ctx.hideLists();
  if (mode === 'withdraw') await publication(true);
  else if (mode === 'cancel') await ctx.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Restored' } }, 'PUT');
  else await ctx.request(`planning/${id}/retry/google`, {}, 'POST', false);
  expect(ctx.google.size).toBe(1);
  const replacement = [...ctx.google.keys()][0];
  expect(replacement).not.toBe(old); expect(replacement).toMatch(/^A\//);
  expect(ctx.google.get(replacement).extendedProperties.private.streamDashboardId).toBe(logicalId);
  const pending = server!.state().planning[0].providers!.google!.projections![key];
  expect(pending.creationId).toBeTruthy(); expect(pending.uncertainCreate).toBeTruthy();
  const creationId = pending.creationId;
  await ctx.restart(); await ctx.request(`planning/${id}/retry/google`);
  expect(ctx.conflicts()).toBe(1); // Stale list -> POST same incarnation -> 409 -> GET active event.
  expect(ctx.posts).toEqual([old, replacement, replacement]);
  expect(ctx.google.size).toBe(1);
  expect(server!.state().planning[0].providers!.google!.projections![key]).toMatchObject({ status: 'synced', creationId, calendarId: 'A' });
  await ctx.request(`planning/${id}`, { local: true, google: true }, 'DELETE'); expect(ctx.google.size).toBe(0);
});

it('settles a legacy uncertain CREATE whose deterministic ID became a tombstone before authorizing a new incarnation', async () => {
  const ctx = await runtime(true); const { id, key } = await projected(ctx);
  const old = [...ctx.google.keys()][0]; ctx.retireGoogle(old); ctx.hideLists();
  await ctx.request('google/target', { calendarId: 'B' }, 'PUT');
  await ctx.restart();
  const entry = server!.state().planning[0].providers!.google!.projections![key];
  expect(entry.uncertainCreate).toBeUndefined(); expect(entry.deletedRemotely).toBe(true);
  expect(ctx.conflicts()).toBe(1); expect(ctx.google.size).toBe(0);
  await ctx.request(`planning/${id}/retry/google`);
  expect(ctx.google.size).toBe(1); expect([...ctx.google.keys()][0]).not.toBe(old);
  expect([...ctx.google.keys()][0]).toMatch(/^A\//);
  await ctx.restart(); expect(ctx.google.size).toBe(1);
});


it('409 followed by an unavailable GET retains the same uncertain CREATE instead of issuing a new incarnation', async () => {
  const ctx = await runtime(true); const { id, key } = await projected(ctx);
  const active = [...ctx.google.keys()][0]; ctx.hideLists(); ctx.unavailableReads(true);
  await ctx.restart(); await ctx.request(`planning/${id}/retry/google`, {}, 'POST', false);
  expect(server!.state().planning[0].providers!.google!.projections![key].uncertainCreate).toBeTruthy();
  expect(new Set(ctx.posts)).toEqual(new Set([active])); expect(ctx.google.size).toBe(1);
  ctx.unavailableReads(false); await ctx.restart(); await ctx.request(`planning/${id}/retry/google`);
  expect(server!.state().planning[0].providers!.google!.projections![key].status).toBe('synced');
  expect(new Set(ctx.posts)).toEqual(new Set([active])); expect(ctx.google.size).toBe(1);
});


it.each(['withdraw', 'cancel', 'window', 'companion'] as const)('Google DELETE 412 for %s supports durable local resolution from retained inventory', async mode => {
  const ctx = await runtime(); const { id, key } = await projected(ctx);
  const remoteId = [...ctx.google.keys()][0]; ctx.google.get(remoteId).etag = 'remote-edited'; ctx.google.get(remoteId).summary = 'Remote edit';
  if (mode === 'withdraw') await ctx.request(`planning/${id}`, { local: true, google: true }, 'DELETE', false);
  else if (mode === 'cancel') await ctx.request(`planning/${id}/occurrence`, { occurrenceKey: key }, 'DELETE');
  else if (mode === 'window') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86400000);
  else {
    const { reconcileCompanionBatch } = await import('../apps/server/src/companion-sync.js');
    await server!.stop();
    const file = join(folder, 'dashboard.json'); const saved = JSON.parse(await readFile(file, 'utf8'));
    const batch = reconcileCompanionBatch(saved.planning, saved.checklist, saved.companion, [{ id: 'delete-companion', eventId: id, type: 'delete', baseRevision: saved.companion.eventRevisions[id], patch: {} }]);
    await writeFile(file, JSON.stringify({ ...saved, planning: batch.planning, companion: batch.companion }));
  }
  await ctx.restart(); await ctx.restart();
  if (mode === 'companion') expect(server!.state().planning).toHaveLength(0);
  else expect(server!.state().planning[0].providers!.google!.projections![key]).toMatchObject({ pendingDeletion: true, status: 'conflict', remoteRevision: 'v1' });
  await ctx.request(`planning/${id}/retry/google`, {}, 'POST', false);
  expect(ctx.google.size).toBe(1); expect(ctx.posts).toHaveLength(1);
  await ctx.request(`planning/${id}/conflict/google`, { occurrenceKey: key, strategy: 'local' });
  // Resolution arms a new precondition, but performs no remote DELETE before its checkpoint.
  expect(ctx.google.size).toBe(1);
  const saved = JSON.parse(await readFile(join(folder, 'dashboard.json'), 'utf8'));
  const journal = mode === 'companion' ? saved.companion.tombstones[id].providerLinks.google : saved.planning.find((item: any) => item.id === id).providers.google;
  expect(journal.projections[key]).toMatchObject({ deletionDecision: 'delete', pendingDeletion: true, remoteRevision: 'remote-edited' });
  await ctx.restart();
  if (mode !== 'companion') await ctx.request(`planning/${id}/retry/google`);
  expect(ctx.google.size).toBe(0); expect(ctx.posts).toHaveLength(1);
  if (mode === 'withdraw') { await ctx.request(`planning/${id}`, { local: true, google: true }, 'DELETE'); expect(server!.state().planning).toHaveLength(0); }
});

it.each(['withdraw', 'cancel', 'window', 'companion'] as const)('Google DELETE conflict %s can keep the remote event as a standalone local row without republishing', async mode => {
  const ctx = await runtime(); const { id, key, publication } = await projected(ctx);
  const remoteId = [...ctx.google.keys()][0]; ctx.google.get(remoteId).etag = 'remote-edited'; ctx.google.get(remoteId).summary = 'Keep remote';
  if (mode === 'withdraw') await publication(false);
  else if (mode === 'cancel') await ctx.request(`planning/${id}/occurrence`, { occurrenceKey: key }, 'DELETE');
  else if (mode === 'window') vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 2 * 86400000);
  else {
    const { reconcileCompanionBatch } = await import('../apps/server/src/companion-sync.js');
    await server!.stop(); const file = join(folder, 'dashboard.json'); const saved = JSON.parse(await readFile(file, 'utf8'));
    const batch = reconcileCompanionBatch(saved.planning, saved.checklist, saved.companion, [{ id: 'delete-remote', eventId: id, type: 'delete', baseRevision: saved.companion.eventRevisions[id], patch: {} }]);
    await writeFile(file, JSON.stringify({ ...saved, planning: batch.planning, companion: batch.companion }));
  }
  await ctx.restart();
  await ctx.request(`planning/${id}/conflict/google`, { occurrenceKey: key, strategy: 'remote' });
  await ctx.restart();
  expect(ctx.google.size).toBe(1); expect(ctx.posts).toHaveLength(1);
  const kept = server!.state().planning.find(item => item.id !== id)!;
  expect(kept).toMatchObject({ title: 'Keep remote', desiredPublication: { google: true }, providers: { google: { remoteRevision: 'remote-edited', calendarId: 'A', status: 'synced' } } });
  expect(kept.recurrence).toBeUndefined();
  if (mode !== 'companion') await ctx.request(`planning/${id}`, { local: true, google: true }, 'DELETE');
  expect(ctx.google.size).toBe(1);
  await ctx.request(`planning/${kept.id}`, { local: true, google: true }, 'DELETE');
  expect(ctx.google.size).toBe(0);
});


it('a new remote edit after deletion approval requires a fresh decision, and a foreign identity is never deleted', async () => {
  const ctx = await runtime(); const { id, key, publication } = await projected(ctx);
  const remoteId = [...ctx.google.keys()][0]; const event = ctx.google.get(remoteId);
  event.etag = 'v2'; await publication(false);
  await ctx.request(`planning/${id}/conflict/google`, { occurrenceKey: key, strategy: 'local' });
  event.etag = 'v3'; await ctx.restart();
  expect(ctx.google.size).toBe(1);
  await ctx.request(`planning/${id}/retry/google`, {}, 'POST', false);
  expect(server!.state().planning[0].providers!.google!.projections![key].status).toBe('conflict');
  event.extendedProperties.private.streamDashboardManaged = 'false';
  await ctx.request(`planning/${id}/conflict/google`, { occurrenceKey: key, strategy: 'local' }, 'POST', false);
  expect(ctx.google.size).toBe(1); expect(ctx.posts).toHaveLength(1);
  event.extendedProperties.private.streamDashboardManaged = 'true';
  await ctx.request(`planning/${id}/conflict/google`, { occurrenceKey: key, strategy: 'local' });
  await ctx.restart(); expect(ctx.google.size).toBe(0);
});

it.each([false, true].flatMap(owned => (['local', 'remote'] as const).map(strategy => ({ owned, strategy }))))(
  'real Google adapter resolves native DELETE 412 despite local exceptions: owned=$owned choice=$strategy', async ({ owned, strategy }) => {
    const ctx = await runtime();
    await ctx.request('planning', { ...ctx.event, desiredPublication: { local: true, twitch: false, google: true } });
    const item = server!.state().planning[0]; const id = item.id;
    const remoteKey = [...ctx.google.keys()][0]; const remote = ctx.google.get(remoteKey);
    expect(remote.recurrence).toHaveLength(1);
    if (!owned) {
      await server!.stop();
      const file = join(folder, 'dashboard.json'); const disk = JSON.parse(await readFile(file, 'utf8'));
      delete disk.planning[0].providers.google.projectionOwned; delete disk.planning[0].providers.google.projectionMode;
      await writeFile(file, JSON.stringify(disk)); await ctx.restart();
    }
    remote.etag = 'v2'; remote.summary = 'Remote retained';
    const key = `${item.localId}:${ctx.event.startAtUtc.slice(0, 19)}`;
    await ctx.request(`planning/${id}/occurrence`, { occurrenceKey: key, patch: { title: 'Local exception' } }, 'PUT');
    await ctx.request(`planning/${id}`, { local: true, google: true }, 'DELETE', false);
    expect(server!.state().planning[0].providers!.google!.status).toBe('conflict');
    expect(ctx.mutations.some(value => value.method === 'DELETE')).toBe(true);
    await ctx.request('google/target', { calendarId: 'B' }, 'PUT');
    await ctx.restart();
    await ctx.request(`planning/${id}/retry/google`, {}, 'POST', false);
    const identity = remote.extendedProperties.private.streamDashboardId;
    remote.extendedProperties.private.streamDashboardId = 'different-owner';
    await ctx.request(`planning/${id}/conflict/google`, { strategy }, 'POST', false);
    remote.extendedProperties.private.streamDashboardId = identity;
    delete remote.etag;
    await ctx.request(`planning/${id}/conflict/google`, { strategy }, 'POST', false);
    remote.etag = 'v2';
    await ctx.request(`planning/${id}/conflict/google`, { strategy });
    const disk = JSON.parse(await readFile(join(folder, 'dashboard.json'), 'utf8'));
    expect(disk.planning[0].providers.google).toMatchObject({ calendarId: 'A', remoteRevision: 'v2' });
    await ctx.restart(); await ctx.request(`planning/${id}/retry/google`); await ctx.restart();
    expect(ctx.posts).toHaveLength(1);
    expect(ctx.mutations.every(value => value.calendar === 'A' && value.method !== 'PATCH')).toBe(true);
    if (strategy === 'remote') {
      expect(ctx.google.get(remoteKey)).toBe(remote);
      expect(server!.state().planning[0].providers!.google).toMatchObject({ nativeRetained: true, status: 'synced' });
      await ctx.request(`planning/${id}`, { local: true, google: true }, 'DELETE');
    }
    expect(ctx.google.size).toBe(0);
  });
