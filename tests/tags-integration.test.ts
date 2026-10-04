import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { runInNewContext } from 'node:vm';
import { resolveTags, normalizeTags } from '../packages/core/src/tags.js';
import { TwitchPreflight } from '../integrations/twitch/src/preflight.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { startDashboardServer } from '../apps/server/src/index.js';

const tags = { values: ['Français', 'Gaming'], source: 'generated' as const, generatedAt: '2026-10-04T10:00:00Z' };
const event = { title: 'Mon live', twitchCategoryId: '42', tags };
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe('tags integration', () => {
  it('uses the injected engine and bounds/validates its output', async () => {
    const generate = vi.fn(async () => ['Français', 'Gaming', 'Gaming', 'bad tag']);
    expect(await resolveTags({ title: event.title }, { generate })).toMatchObject({ tags: { values: tags.values, source: 'generated' } });
    expect(generate.mock.calls).toHaveLength(1);
    expect(normalizeTags(Array.from({ length: 15 }, (_, i) => `Tag${i}`))).toHaveLength(10);
    expect(await resolveTags(event, { generate })).toEqual({ tags });
    await resolveTags(event, { generate }, true);
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('keeps existing tags on absent, failing, invalid and hung engines', async () => {
    expect(await resolveTags(event, undefined, true)).toMatchObject({ tags, warning: expect.any(String) });
    for (const generate of [async () => { throw Error('offline'); }, async () => [], () => new Promise<string[]>(() => {})]) {
      expect(await resolveTags(event, { generate }, true, 5)).toMatchObject({ tags, warning: expect.any(String) });
    }
    expect(await resolveTags({ title: 'Live' })).toMatchObject({ tags: undefined, warning: expect.any(String) });
  });
  it('applies title/category/tags together and repairs tag-only drift', async () => {
    const api = { getChannel: vi.fn(async () => ({ title: event.title, gameId: '42', tags: ['Other'] })), searchGame: vi.fn(), updateChannel: vi.fn(async () => {}) };
    const preflight = new TwitchPreflight(api);
    expect(await preflight.prepare({ eventId: '1', title: event.title, categoryId: '42', tags: tags.values })).toMatchObject({ status: 'ready', unchanged: false });
    expect(api.updateChannel).toHaveBeenCalledWith({ title: event.title, gameId: '42', tags: tags.values });
    api.getChannel.mockResolvedValue({ title: event.title, gameId: '42', tags: [...tags.values].reverse() });
    expect(await preflight.prepare({ eventId: '1', title: event.title, categoryId: '42', tags: tags.values })).toMatchObject({ unchanged: true });
    expect(api.updateChannel).toHaveBeenCalledTimes(1);
  });
  it('retries without tags after rejection and stays ready', async () => {
    const updateChannel = vi.fn().mockRejectedValueOnce(Error('tags rejected')).mockResolvedValue(undefined);
    const preflight = new TwitchPreflight({ getChannel: async () => ({ title: '', gameId: '' }), searchGame: vi.fn(), updateChannel });
    expect(await preflight.prepare({ eventId: '1', title: event.title, categoryId: '42', tags: tags.values })).toMatchObject({ status: 'ready', tagsWarning: expect.any(String) });
    expect(updateChannel).toHaveBeenLastCalledWith({ title: event.title, gameId: '42' });
    const fallback = await resolveTags({ title: event.title }, { generate: async () => { throw Error(); } });
    expect(await preflight.prepare({ eventId: '1', title: event.title, categoryId: '42', tags: fallback.tags?.values })).toMatchObject({ status: 'ready' });
  });
  it('sends tags through Helix Modify Channel Information', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'client', user_id: '42', scopes: ['channel:manage:broadcast'] }))).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new TwitchClient({ clientId: 'client', accessToken: 'token', refreshToken: 'refresh', broadcasterId: '42', userName: 'user', displayName: 'User' });
    await client.validateSession();
    await client.updateChannelMetadata({ title: event.title, gameId: '42', tags: tags.values });
    expect(fetchMock.mock.calls[1][0]).toContain('/channels?broadcaster_id=42');
    expect(fetchMock.mock.calls[1][1]).toMatchObject({ method: 'PATCH', body: JSON.stringify({ title: event.title, game_id: '42', tags: tags.values }) });
  });
  it('regenerates via API and persists tags/preferences across create, edit and restart', async () => {
    const dataDir = await mkdtemp(resolve('.tags-test-'));
    let server = await startDashboardServer({ port: 0, dataDir, tagEngine: { generate: async () => tags.values }, logger: { info() {}, warn() {}, error() {} } });
    const request = async (path: string, method: string, body: unknown) => {
      const response = await fetch(server.url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.ok).toBe(true); return response.json();
    };
    try {
      const generated = await request('/api/v1/planning/tags/regenerate', 'POST', { title: event.title });
      expect(generated.tags.values).toEqual(tags.values);
      const created = await request('/api/v1/planning', 'POST', { ...event, startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z', tagPreferences: { automatic: false, language: 'fr' } });
      const item = created.planning.find((value: any) => value.title === event.title);
      expect(item.tags).toEqual(tags);
      const edited = await request(`/api/v1/planning/${item.id}`, 'PUT', { title: 'Updated' });
      expect(edited.planning.find((value: any) => value.id === item.id).tags).toEqual(tags);
      await server.stop();
      server = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
      const state = await fetch(server.url + '/api/v1/state').then(r => r.json());
      expect(state.planning.find((value: any) => value.id === item.id)).toMatchObject({ tags, tagPreferences: { automatic: false, language: 'fr' } });
    } finally { await server.stop(); await rm(dataDir, { recursive: true, force: true }); }
  });
  it('uses the production engine cache and learns persisted game/series choices without occurrence pollution', async () => {
    const observe = vi.spyOn(TwitchClient.prototype, 'getStreamsForGame').mockResolvedValue([{ tags: ['Zombie', 'Coop'], viewer_count: 20, language: 'fr' }]);
    const dataDir = await mkdtemp(resolve('.tags-test-'));
    let server = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
    const request = async (path: string, body: unknown, method = 'POST') => {
      const response = await fetch(server.url + path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      expect(response.ok).toBe(true); return response.json();
    };
    try {
      const base = { title: 'Weekly', twitchCategoryId: '42', twitchCategoryName: 'Dead Island 2' };
      const first = await request('/api/v1/planning/tags/regenerate', { ...base, refreshTwitch: true });
      expect(first.tags.values).toContain('Zombie');
      await request('/api/v1/planning/tags/regenerate', base);
      expect(observe).toHaveBeenCalledTimes(1);
      const state = await request('/api/v1/planning', { ...base, startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z', tags: { values: ['GameChoice'], source: 'manual' }, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' } });
      const series = state.planning.find((item: any) => item.title === 'Weekly');
      await request(`/api/v1/planning/${series.id}/occurrence`, { occurrenceKey: `${series.localId || series.id}:2030-01-01T11:00:00`, patch: { tags: { values: ['Birthday'], source: 'manual' } } }, 'PUT');
      await server.stop();
      server = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
      const learned = await request('/api/v1/planning/tags/regenerate', base);
      expect(learned.tags.values).toContain('GameChoice');
      expect(learned.tags.values).not.toContain('Birthday');
      const seriesLearned = await request('/api/v1/planning/tags/regenerate', { title: 'Another game', twitchCategoryId: '99', seriesId: series.id });
      expect(seriesLearned.tags.values).toContain('GameChoice');
      expect(seriesLearned.tags.values).not.toContain('Birthday');
      await request('/api/v1/settings', { tagPreferences: { preferredTags: ['Community'], language: 'fr' } }, 'PUT');
      const channel = await request('/api/v1/planning/tags/regenerate', { title: 'Live' });
      expect(channel.tags.values).toEqual(expect.arrayContaining(['Community', 'French']));
    } finally { await server.stop(); await rm(dataDir, { recursive: true, force: true }); }
  });
  it('returns API suggestions while the Twitch observation remains unresolved', async () => {
    vi.spyOn(TwitchClient.prototype, 'getStreamsForGame').mockImplementation(() => new Promise(() => {}));
    const dataDir = await mkdtemp(resolve('.tags-test-'));
    const server = await startDashboardServer({ port: 0, dataDir, logger: { info() {}, warn() {}, error() {} } });
    try {
      const start = performance.now();
      const response = await fetch(server.url + '/api/v1/planning/tags/regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Spooktober', twitchCategoryId: '42', twitchCategoryName: 'Dead Island 2' }) });
      expect((await response.json()).tags.values).toContain('DeadIsland2');
      expect(performance.now() - start).toBeLessThan(500);
      const refreshStart = performance.now();
      const refreshed = await fetch(server.url + '/api/v1/planning/tags/regenerate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Spooktober', twitchCategoryId: '42', refreshTwitch: true }) });
      expect((await refreshed.json()).tags.values).toContain('Horror');
      expect(performance.now() - refreshStart).toBeLessThan(1300);
    } finally { await server.stop(); await rm(dataDir, { recursive: true, force: true }); }
  });
  it('Planning duplication preserves independent tag metadata and preferences', async () => {
    const source = await readFile('apps/web/preview/preview.js', 'utf8');
    const handler = source.slice(source.indexOf("document.querySelector('#event-duplicate').onclick="), source.indexOf("document.querySelector('#event-delete').onclick="));
    const nodes = new Map();
    const document = { querySelector(selector: string) { if (!nodes.has(selector)) nodes.set(selector, {}); return nodes.get(selector); } };
    const populateEventForm = vi.fn();
    const item = { ...event, id: 'original', tagPreferences: { automatic: false, language: 'fr' } };
    runInNewContext(handler, { document, state: { eventEdit: { occurrence: item } }, eventCanonical: (value: unknown) => value, populateEventForm, structuredClone, toast() {} });
    document.querySelector('#event-duplicate').onclick();
    const copy = populateEventForm.mock.calls[0][0];
    expect(copy).toMatchObject({ tags, tagPreferences: item.tagPreferences, desiredPublication: { twitch: false, google: false } });
    expect(copy.id).toBeUndefined();
    copy.tags.values.push('New'); expect(item.tags.values).not.toContain('New');
  });
});
