import { ObsClient } from '../integrations/obs/src/client.js';
import { expect, it, vi } from 'vitest';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../apps/server/src/index.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';

it('returns before rolling I/O, serves the renderer during maintenance and coalesces overlapping Sync requests', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cb121-startup-'));
  let server: DashboardServerHandle | undefined;
  let release!: () => void;
  let gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0, creates = 0;
  const remote = new Map<string, any>();
  const googleFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/calendarList')) return Response.json({ items: [] });
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body)); const event = { ...body, etag: 'v1' };
      creates++; remote.set(event.id, event); return Response.json(event);
    }
    reads++; await gate;
    return Response.json({ items: [...remote.values()] });
  };
  const secrets = new MemorySecretStore();
  const options = { port: 0, dataDir: folder, secretStore: secrets, googleClientId: 'client', googleFetch, logger: { info() {}, warn() {}, error() {} } };
  try {
    server = await startDashboardServer(options); await server.stop();
    const file = join(folder, 'dashboard.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    const start = Date.now() + 3600000;
    saved.google.targetCalendarId = 'private-calendar';
    saved.planning = [{ id: 's', localId: 's', title: 'Private event', ownership: 'LOCAL',
      startAtUtc: new Date(start).toISOString(), endAtUtc: new Date(start + 3600000).toISOString(),
      desiredPublication: { local: true, google: true, twitch: false },
      recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC', exceptions: { 's:2099-01-01T12:00:00': { cancelled: true } } } }];
    await writeFile(file, JSON.stringify(saved));
    await secrets.setGoogleTokens({ accessToken: 'private-token', refreshToken: '', expiresAt: String(Date.now() + 3600000) });
    server = await startDashboardServer(options);
    // If startup awaited rolling, this would deadlock on the controlled inventory gate.
    await vi.waitFor(() => expect(reads).toBe(1));
    expect(creates).toBe(0);
    const diagnostics = await fetch(server.url + '/api/v1/providers/diagnostics');
    expect(diagnostics.ok).toBe(true);
    expect(await diagnostics.text()).not.toMatch(/private-|Private event/);
    release(); await server.providersReady;
    expect(creates).toBe(7);

    reads = 0;
    gate = new Promise<void>(resolve => { release = resolve; });
    const sync = () => fetch(server!.url + '/api/v1/google/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    const first = sync(), second = sync();
    await vi.waitFor(() => expect(reads).toBe(1));
    release();
    expect((await first).ok).toBe(true); expect((await second).ok).toBe(true);
    expect(reads).toBe(2); // One master inventory + one expanded listing, shared by both callers.
    expect(creates).toBe(7);
  } finally { release(); await server?.stop(); await rm(folder, { recursive: true, force: true }); }
});

it('serves the window with connected providers while Twitch validation and Google calendar listing are blocked', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cb121-connected-startup-'));
  const secrets = new MemorySecretStore();
  let server: DashboardServerHandle | undefined;
  let releaseTwitch!: () => void, releaseGoogle!: () => void;
  const twitchGate = new Promise<void>(resolve => { releaseTwitch = resolve; });
  const googleGate = new Promise<void>(resolve => { releaseGoogle = resolve; });
  let validations = 0, calendarLists = 0, channels = 0;
  const nativeFetch = globalThis.fetch;
  const options = { port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', googleClientId: 'client',
    googleFetch: (async () => { calendarLists++; await googleGate; return Response.json({ items: [{ id: 'calendar', summary: 'Calendar', accessRole: 'owner' }] }); }) as typeof fetch,
    logger: { info() {}, warn() {}, error() {} } };
  try {
    server = await startDashboardServer(options); await server.stop();
    const file = join(folder, 'dashboard.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    saved.twitch = { broadcasterId: '42', userName: 'user', displayName: 'User' };
    await writeFile(file, JSON.stringify(saved));
    await secrets.setTwitchTokens({ accessToken: 'twitch-token', refreshToken: '' });
    await secrets.setGoogleTokens({ accessToken: 'google-token', refreshToken: '', expiresAt: String(Date.now() + 3600000) });
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.protocol !== 'https:') return nativeFetch(input, init);
      if (url.pathname.endsWith('/validate')) {
        validations++; await twitchGate;
        return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule'] });
      }
      if (url.pathname.endsWith('/channels')) channels++;
      return Response.json({ data: [] });
    });
    server = await startDashboardServer(options);
    await vi.waitFor(() => { expect(validations).toBe(1); expect(calendarLists).toBe(1); });
    // Both requests remain unresolved, but startup returned and the renderer can load.
    expect((await nativeFetch(server.url + '/')).ok).toBe(true);
    expect((await nativeFetch(server.url + '/api/v1/providers/diagnostics')).ok).toBe(true);
    expect(channels).toBe(0);
    let twitchActionFinished = false;
    const twitchAction = nativeFetch(server.url + '/api/v1/twitch/moderation/capabilities').then(response => { twitchActionFinished = true; return response.json(); });
    const googleAction = nativeFetch(server.url + '/api/v1/google/target', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ calendarId: 'calendar' }) });
    releaseGoogle();
    expect((await googleAction).ok).toBe(true);
    expect(twitchActionFinished).toBe(false);
    expect(channels).toBe(0);
    releaseTwitch();
    expect(await twitchAction).toMatchObject({ schedule: true });
    await server.providersReady;
    expect(validations).toBe(1);
    // Target selection may explicitly refresh after startup listing has settled.
    expect(calendarLists).toBeLessThanOrEqual(2);
    expect(channels).toBe(1);
  } finally {
    releaseTwitch(); releaseGoogle();
    await server?.stop(); vi.unstubAllGlobals(); await rm(folder, { recursive: true, force: true });
  }
});

it('cancels deferred initialization on shutdown without clearing saved Google credentials', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'cb121-stop-startup-'));
  const secrets = new MemorySecretStore();
  const tokens = { accessToken: 'saved-token', refreshToken: 'saved-refresh', expiresAt: String(Date.now() + 3600000) };
  await secrets.setGoogleTokens(tokens);
  let server: DashboardServerHandle | undefined;
  let requests = 0, cancelled = false;
  try {
    server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, googleClientId: 'client',
      googleFetch: async (_url, init) => {
        requests++;
        return new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener('abort', () => { cancelled = true; reject(init!.signal!.reason); }, { once: true });
        });
      }, logger: { info() {}, warn() {}, error() {} } });
    await vi.waitFor(() => expect(requests).toBe(1));
    await server.stop();
    await server.providersReady;
    expect(cancelled).toBe(true); expect(requests).toBe(1);
    expect(await secrets.getGoogleTokens()).toEqual(tokens);
  } finally { await server?.stop(); await rm(folder, { recursive: true, force: true }); }
});

it.each(['/api/v1/commands', '/api/commands'])('waits for shared Twitch startup before session.prepare through %s', async route => {
  vi.spyOn(ObsClient.prototype, 'configure').mockImplementation(async function (this: ObsClient) { this.state.connected = true; this.state.streamingKnown = true; return this.state; });
  vi.spyOn(ObsClient.prototype, 'refresh').mockResolvedValue(undefined);
  const folder = await mkdtemp(join(tmpdir(), 'cb121-prepare-startup-'));
  const secrets = new MemorySecretStore();
  await secrets.setTwitchTokens({ accessToken: 'saved-token', refreshToken: '' });
  const start = Date.now() + 60000;
  await writeFile(join(folder, 'dashboard.json'), JSON.stringify({
    twitch: { broadcasterId: '42', userName: 'user', displayName: 'User' },
    planning: [{ id: 'next-live', title: 'New title', category: 'live', ownership: 'LOCAL',
      startAtUtc: new Date(start).toISOString(), endAtUtc: new Date(start + 3600000).toISOString(),
      twitchCategoryId: 'new-game', twitchCategoryName: 'New game',
      desiredPublication: { local: true, twitch: false, google: false } }],
  }));
  let release!: () => void;
  const validation = new Promise<void>(resolve => { release = resolve; });
  const nativeFetch = globalThis.fetch;
  let server: DashboardServerHandle | undefined;
  let validations = 0;
  const patches: unknown[] = [];
  try {
    vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input));
      if (url.protocol !== 'https:') return nativeFetch(input, init);
      if (url.pathname.endsWith('/validate')) {
        validations++; await validation;
        return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:broadcast'] });
      }
      if (url.pathname.endsWith('/channels')) {
        if (init?.method === 'PATCH') { patches.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
        return Response.json({ data: [{ title: 'Old title', game_id: 'old-game', tags: [] }] });
      }
      return Response.json({ data: [] });
    });
    server = await startDashboardServer({ port: 0, dataDir: folder, secretStore: secrets, twitchClientId: 'client', logger: { info() {}, warn() {}, error() {} } });
    await vi.waitFor(() => expect(validations).toBe(1));
    let finished = false;
    const preparation = nativeFetch(server.url + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'session.prepare' }) })
      .then(async response => { finished = true; return { ok: response.ok, body: await response.json() }; });
    // Observe the command entering preflight, not merely an HTTP request queued
    // in the client, while validation is still held behind the gate.
    await vi.waitFor(() => expect(server!.state().preflight?.status).toBe('preparing'));
    expect(finished).toBe(false); expect(patches).toEqual([]);
    expect((await nativeFetch(server.url + '/api/v1/providers/diagnostics')).ok).toBe(true);
    release();
    const response = await preparation;
    expect(response.ok, JSON.stringify(response.body)).toBe(true);
    const state = route === '/api/v1/commands' ? response.body.state : response.body;
    expect(state.preflight).toMatchObject({ eventId: 'next-live', status: 'ready', error: null, title: 'New title', gameId: 'new-game' });
    expect(patches).toEqual([expect.objectContaining({ title: 'New title', game_id: 'new-game' })]);
    expect(validations).toBe(1);
    await server.providersReady;
  } finally {
    release(); await server?.stop(); vi.unstubAllGlobals(); vi.restoreAllMocks(); await rm(folder, { recursive: true, force: true });
  }
});
