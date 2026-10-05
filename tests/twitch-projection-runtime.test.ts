import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { toRemoteDashboardState } from '../apps/server/src/remote-policy.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

let server: DashboardServerHandle | undefined;
let folder = '';
afterEach(async () => { await server?.stop(); vi.unstubAllGlobals(); if (folder) await rm(folder, { recursive: true, force: true }); });

it.each(['local', 'remote'] as const)('persists identities and resolves an occurrence conflict through the API after restart: %s', async strategy => {
  folder = await mkdtemp(join(tmpdir(), 'twitch-projection-'));
  const secrets = new MemorySecretStore();
  const options = { port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', logger: { info() {}, warn() {}, error() {} } };
  server = await startDashboardServer(options); await server.stop();
  const path = join(folder, 'dashboard.json');
  const state = JSON.parse(await readFile(path, 'utf8'));
  state.twitch = { broadcasterId: '42', userName: 'u', displayName: 'U' };
  await writeFile(path, JSON.stringify(state));
  await secrets.setTwitchTokens({ accessToken: 'token', refreshToken: '' });
  const nativeFetch = globalThis.fetch;
  const segments = new Map<string, any>(); let creates = 0;
  vi.stubGlobal('fetch', vi.fn(async (input, init) => {
    const url = new URL(String(input));
    if (url.protocol !== 'https:') return nativeFetch(input, init);
    if (url.pathname.includes('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
    if (url.pathname.includes('/schedule')) {
      const id = url.searchParams.get('id');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const segment = { ...body, id: `managed-${++creates}`, end_time: new Date(Date.parse(body.start_time) + Number(body.duration) * 60000).toISOString() };
        segments.set(segment.id, segment);
        return Response.json({ data: { segments: [segment] } });
      }
      if (init?.method === 'PATCH') {
        const body = JSON.parse(String(init.body));
        const segment = segments.get(id!);
        Object.assign(segment, body);
        return Response.json({ data: { segments: [segment] } });
      }
      if (init?.method === 'DELETE') { segments.delete(id!); return new Response(null, { status: 204 }); }
      return Response.json({ data: { segments: [...segments.values()].filter(segment => !id || segment.id === id) } });
    }
    return Response.json({ data: [] });
  }));
  server = await startDashboardServer(options);
  const post = (route: string, body: unknown) => nativeFetch(server!.url + '/api/v1/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const start = Date.now() + 86400000;
  expect((await post('planning', { title: 'Projected', category: 'live', startAtUtc: new Date(start).toISOString(), endAtUtc: new Date(start + 3600000).toISOString(), desiredPublication: { local: true, twitch: true, google: false }, recurrence: { frequency: 'weekly', interval: 2, timeZone: 'UTC' } })).ok).toBe(true);
  expect(creates).toBe(7);
  const original = server.state().planning.find(item => item.title === 'Projected')!;
  const identities = Object.values(original.providers!.twitch!.projections!).map(entry => entry.remoteId);
  const publicLink = toRemoteDashboardState(server.state()).planning.find(item => item.id === original.id)!.providers!.twitch!;
  expect(publicLink.projectionMode).toBe('materialized');
  expect(Object.values(publicLink.occurrenceStatuses!)).toEqual(Array.from({ length: 7 }, () => ({ status: 'synced' })));
  expect(JSON.stringify(publicLink)).not.toContain('managed-');
  await server.stop(); server = await startDashboardServer(options);
  const restored = server.state().planning.find(item => item.id === original.id)!;
  expect(Object.values(restored.providers!.twitch!.projections!).map(entry => entry.remoteId)).toEqual(identities);
  expect(creates).toBe(7);
  expect((await post('twitch/sync', {})).ok).toBe(true);
  expect(server.state().planning.filter(item => item.title === 'Projected')).toHaveLength(1);
  expect(creates).toBe(7);
  const key = Object.keys(restored.providers!.twitch!.projections!)[0];
  const remoteId = restored.providers!.twitch!.projections![key].remoteId!;
  segments.get(remoteId).title = 'Remote edit';
  expect((await post('twitch/sync', {})).ok).toBe(true);
  expect(server.state().planning.find(item => item.id === original.id)!.providers!.twitch!.projections![key].status).toBe('conflict');
  await server.stop(); server = await startDashboardServer(options);
  const resolved = await post(`planning/${original.id}/conflict/twitch`, { strategy, occurrenceKey: key });
  expect(resolved.ok).toBe(true);
  expect(segments.get(remoteId).title).toBe(strategy === 'local' ? 'Projected' : 'Remote edit');
  await server.stop(); server = await startDashboardServer(options);
  expect((await post('twitch/sync', {})).ok).toBe(true);
  const afterResolution = server.state().planning.find(item => item.id === original.id)!;
  expect(afterResolution.providers!.twitch!.projections![key]).toMatchObject({ status: 'synced', remoteId });
  expect(afterResolution.title).toBe('Projected');
  if (strategy === 'remote') expect(afterResolution.recurrence!.exceptions![key].patch!.title).toBe('Remote edit');
  expect(creates).toBe(7);
  segments.set('external', { id: 'external', title: 'External', start_time: new Date(start).toISOString(), end_time: new Date(start + 3600000).toISOString(), is_recurring: false });
  const removed = await nativeFetch(server.url + '/api/v1/planning/' + original.id, { method: 'DELETE' });
  expect(removed.ok).toBe(true);
  expect([...segments.keys()]).toEqual(['external']);
});
