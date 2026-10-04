import { expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

it('Google recurring master survives sync, restart, ETag conflict resolution, retry and deletion', async () => {
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb97-google-'));
  const secrets = new MemorySecretStore();
  await secrets.setGoogleTokens({ accessToken: 'token', refreshToken: 'refresh', expiresAt: String(Date.now() + 3600000) });
  let remote: any; let fail = false; let version = 1; let posts = 0;
  const writes: Array<{ method?: string; headers?: HeadersInit; body?: any }> = [];
  const googleFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    if (url.includes('/calendarList')) return Response.json({ items: [{ id: 'calendar', summary: 'Target', accessRole: 'owner' }] });
    if (init?.method) {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      writes.push({ method: init.method, headers: init.headers, body });
      if (fail) return Response.json({ error: { message: 'ETag conflict' } }, { status: 412 });
      if (init.method === 'DELETE') { remote = undefined; return new Response(null, { status: 204 }); }
      if (init.method === 'POST') posts++;
      remote = { ...body, id: 'master', etag: `v${version++}` }; return Response.json(remote);
    }
    if (url.endsWith('/master')) return remote ? Response.json(remote) : Response.json({}, { status: 404 });
    return Response.json({ items: remote && !new URL(url).searchParams.has('timeMin') ? [remote] : [] });
  };
  const options = { port: 0, dataDir, secretStore: secrets, googleClientId: 'client', googleFetch, logger: { info() {}, warn() {}, error() {} } };
  let server = await startDashboardServer(options);
  const request = async (route: string, body: unknown = {}, method = 'POST') => {
    const response = await fetch(server.url + '/api/v1/' + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.ok, await response.clone().text()).toBe(true); return response.json();
  };
  const snapshot = async () => (await fetch(server.url + '/api/v1/companion/snapshot')).json();
  try {
    await request('google/target', { calendarId: 'calendar' }, 'PUT');
    const event = { title: 'Monthly', startAtUtc: '2020-01-31T19:00:00Z', endAtUtc: '2020-01-31T21:00:00Z', recurrence: { frequency: 'monthly', interval: 1, timeZone: 'Europe/Paris' }, desiredPublication: { local: true, google: true, twitch: false } };
    await request('planning', event);
    const id = (await snapshot()).planning[0].id;
    expect(remote.recurrence).toEqual(['RRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=31,-1;BYSETPOS=1']);
    await request('google/sync');
    expect((await snapshot()).planning).toHaveLength(1);
    expect((await snapshot()).planning[0].providers.google.status).toBe('synced');
    await server.stop(); server = await startDashboardServer(options);
    fail = true; await request('planning/' + id, { ...event, title: 'New title' }, 'PUT');
    expect((await snapshot()).planning[0].providers.google.status).toBe('conflict');
    fail = false; await request(`planning/${id}/conflict/google`, { strategy: 'local' });
    expect(remote.summary).toBe('New title');
    await request(`planning/${id}/retry/google`);
    expect(posts).toBe(1);
    expect(writes.filter(w => w.method === 'PATCH').every(w => Boolean((w.headers as Record<string, string>)['If-Match']))).toBe(true);
    await request(`planning/${id}`, { local: true, google: true }, 'DELETE');
    expect(remote).toBeUndefined(); expect((await snapshot()).planning).toHaveLength(0);
  } finally { await server.stop(); await rm(dataDir, { recursive: true, force: true }); }
});
