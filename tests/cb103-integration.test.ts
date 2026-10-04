import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startDashboardServer } from '../apps/server/src/index.js';
import { ObsClient } from '../integrations/obs/src/client.js';
import { MemorySecretStore } from '../apps/server/src/storage.js';
import { assertTwitchRecurrence } from '../integrations/twitch/src/recurrence.js';
import { normalizeTags } from '../packages/core/src/tags.js';
import { drainCompanionProviders } from '../apps/server/src/companion-providers.js';
import { emptyCompanionState, reconcileCompanionBatch } from '../apps/server/src/companion-sync.js';
import { createCompanionStore } from '../apps/mobile/companion-store.js';
import type { CalendarItem } from '../packages/contracts/src/index.js';

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it.each([
  { until: '2030-12-01T00:00:00Z' },
  { exceptions: { skipped: { cancelled: true } } },
  { timeZone: 'Invalid/Zone' },
])('rejects lossy weekly Twitch rules: %j', patch => {
  expect(() => assertTwitchRecurrence({ recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC', ...patch } })).toThrow(/récurrence/);
});

it('hands companion weekly series to Twitch with durable identity and fingerprint', async () => {
  const item: CalendarItem = { id: 'weekly', title: 'Live', startAtUtc: '2030-01-01T19:00:00Z', endAtUtc: '2030-01-01T20:00:00Z', recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } };
  const state = emptyCompanionState();
  state.providerWork['weekly:twitch'] = { item, provider: 'twitch', action: 'publish', status: 'queued' };
  const create = vi.fn(async () => ({ id: 'master', fingerprint: 'revision' }));
  await drainCompanionProviders([item], state, { twitch: { create, update: vi.fn(), delete: vi.fn() } }, async () => {});
  expect(create).toHaveBeenCalledOnce();
  expect(item).toMatchObject({ twitchRecurring: true, twitchSegmentId: 'master', providers: { twitch: { status: 'synced', fingerprint: 'revision' } } });
  expect(state.providerWork).toEqual({});
});

it('deduplicates manual tags across case, accents and Unicode composition', () => {
  expect(normalizeTags(['Été', 'ete', 'E\u0301te\u0301', 'Gaming', 'gaming'])).toEqual(['Été', 'Gaming']);
});

it('preserves daily companion series and normalizes tags in events and exceptions', () => {
  const values = new Map<string, string>();
  const store = createCompanionStore({ getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } } as Storage);
  const tags = { values: ['Été', 'ete'], source: 'manual' };
  store.createEvent({ id: 'daily', title: 'Daily', startAtUtc: '2030-01-01T19:00:00Z', endAtUtc: '2030-01-01T20:00:00Z', tags,
    recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC', exceptions: { 'daily:2030-01-02T19:00:00': { patch: { tags } } } } });
  const before = structuredClone(store.snapshot().pending);
  const result = reconcileCompanionBatch([], [], emptyCompanionState(), before);
  expect(result.planning[0]).toMatchObject({ tags: { values: ['Été'] }, recurrence: { frequency: 'daily', exceptions: { 'daily:2030-01-02T19:00:00': { patch: { tags: { values: ['Été'] } } } } } });
  expect(store.snapshot().pending).toEqual(before);
});

it.each(['ordinary', 'Spooktober'])('uses the dynamic production engine through regeneration and auto-tag preflight: %s', async scenario => {
  vi.spyOn(ObsClient.prototype, 'configure').mockImplementation(async function (this: ObsClient) { this.state.connected = true; this.state.streamingKnown = true; return this.state; });
  vi.spyOn(ObsClient.prototype, 'refresh').mockResolvedValue(undefined);
  const dataDir = await mkdtemp(path.join(os.tmpdir(), 'cb103-tags-'));
  await writeFile(path.join(dataDir, 'dashboard.json'), JSON.stringify({ twitch: { broadcasterId: '42', userName: 'tester', displayName: 'Tester' } }));
  const secretStore = new MemorySecretStore();
  await secretStore.setTwitchTokens({ accessToken: 'token' });
  const nativeFetch = globalThis.fetch;
  const patches: unknown[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith('http://127.0.0.1:')) return nativeFetch(input, init);
    if (url.endsWith('/validate')) return Response.json({ client_id: 'client', user_id: '42', scopes: ['channel:manage:broadcast'] });
    if (url.includes('/streams?game_id=')) {
      expect(url).toContain('game_id=1&first=100');
      return Response.json({ data: [{ tags: ['Zombie', 'Coop', 'Halloween'], viewer_count: 20, language: 'fr' }, { tags: ['Zombie', 'Horror', 'Action'], viewer_count: 10, language: 'fr' }] });
    }
    if (url.includes('/channels?')) {
      if (init?.method === 'PATCH') { patches.push(JSON.parse(String(init.body))); return new Response(null, { status: 204 }); }
      return Response.json({ data: [{ title: 'Old', game_id: 'old', tags: [] }] });
    }
    return Response.json({ data: [] });
  }));
  const server = await startDashboardServer({ port: 0, dataDir, secretStore, twitchClientId: 'client', logger: { info() {}, warn() {}, error() {} } });
  const request = async (route: string, body: unknown) => {
    const response = await nativeFetch(server.url + '/api/v1/' + route, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.ok, await response.clone().text()).toBe(true);
    return response.json();
  };
  try {
    const input = { title: scenario === 'Spooktober' ? 'Spooktober' : 'Live ordinaire', twitchCategoryName: 'Dead Island 2', twitchCategoryId: '1', tagPreferences: { automatic: true, language: 'fr' } };
    const generated = await request('planning/tags/regenerate', { ...input, refreshTwitch: true });
    const expected = generated.tags.values;
    expect(expected).toEqual(expect.arrayContaining(['DeadIsland2', 'Zombie', 'Horror', 'Action', 'Coop']));
    expect(expected.includes('Halloween')).toBe(scenario === 'Spooktober');
    expect(generated.tags).toMatchObject({ values: expected, source: 'generated' });
    expect(generated.warning).toBeUndefined();
    await request('planning', { ...input, category: 'live', startAtUtc: new Date(Date.now() + 60000).toISOString(), endAtUtc: new Date(Date.now() + 3660000).toISOString(), desiredPublication: { local: true, google: false, twitch: false } });
    await request('commands', { type: 'session.prepare' });
    expect(patches).toEqual([{ title: input.title, game_id: '1', tags: expected }]);
    const state = await nativeFetch(server.url + '/api/v1/state').then(r => r.json());
    expect(state.preflight).toMatchObject({ status: 'ready', tags: expected });
  } finally { await server.stop(); await rm(dataDir, { recursive: true, force: true }); }
});
