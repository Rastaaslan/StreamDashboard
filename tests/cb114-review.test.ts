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
afterEach(async () => { vi.useRealTimers(); await server?.stop(); server = undefined; vi.unstubAllGlobals(); if (folder) await rm(folder, { recursive: true, force: true }); });

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
  await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600000) });
  const google = new Map<string, any>(); const twitch = new Map<string, any>();
  const posts: string[] = []; let next = 0; let lose = loseResponse;
  const googleFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/calendarList')) return Response.json({ items: ['A', 'B'].map(id => ({ id, summary: id, accessRole: 'owner' })) });
    const match = /\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname)!;
    const calendar = decodeURIComponent(match[1]); const id = match[2];
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); const key = calendar + '/' + body.id;
      // Observe the disk checkpoint at the exact moment remote mutation starts.
      const saved = JSON.parse(await readFile(join(folder, 'dashboard.json'), 'utf8'));
      const entry = Object.values(saved.planning[0].providers.google.projections).find((v: any) => v.event.localId === body.extendedProperties.private.streamDashboardId) as any;
      expect(entry.calendarId).toBe(calendar); expect(entry.uncertainCreate).toBeTruthy();
      posts.push(key); google.set(key, { ...body, id: body.id, etag: 'v1' });
      if (lose) { lose = false; throw new TypeError('Lost response'); }
      return Response.json(google.get(key));
    }
    if (init?.method === 'DELETE') { google.delete(calendar + '/' + id); return new Response(null, { status: 204 }); }
    if (init?.method === 'PATCH') { const value = { ...google.get(calendar + '/' + id), ...JSON.parse(String(init.body)), etag: 'v2' }; google.set(calendar + '/' + id, value); return Response.json(value); }
    if (id) return google.has(calendar + '/' + id) ? Response.json(google.get(calendar + '/' + id)) : Response.json({}, { status: 404 });
    const identity = url.searchParams.get('privateExtendedProperty')?.split('=').slice(1).join('=');
    return Response.json({ items: [...google].filter(([key, value]) => key.startsWith(calendar + '/') && (!identity || value.extendedProperties.private.streamDashboardId === identity)).map(([, value]) => value) });
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
  const restart = async () => { await server?.stop(); server = await startDashboardServer(options); };
  await restart();
  const request = async (route: string, body: unknown = {}, method = 'POST') => { const res = await nativeFetch(server!.url + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); expect(res.ok, await res.clone().text()).toBe(true); return res.json(); };
  await request('google/target', { calendarId: 'A' }, 'PUT');
  const start = new Date(Date.now() + 86400000); start.setUTCMilliseconds(0);
  const event = { title: 'Review', category: 'live', startAtUtc: start.toISOString(), endAtUtc: new Date(+start + 3600000).toISOString(), desiredPublication: { local: true, twitch: true, google: true }, recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC', until: start.toISOString(), exceptions: {} } };
  return { google, twitch, posts, event, request, restart };
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
