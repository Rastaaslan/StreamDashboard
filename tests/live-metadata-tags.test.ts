import { afterEach, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startDashboardServer } from '../apps/server/src/index.js';
import { TwitchClient } from '../integrations/twitch/src/client.js';

afterEach(() => vi.restoreAllMocks());
it('applies live metadata, normalizes tags, retries rejection and leaves planning untouched', async () => {
  const update = vi.spyOn(TwitchClient.prototype, 'updateChannelMetadata').mockResolvedValue();
  const dir = await mkdtemp(join(tmpdir(), 'live-tags-'));
  const server = await startDashboardServer({ port: 0, dataDir: dir, logger: { info() {}, warn() {}, error() {} } });
  await server.providersReady;
  vi.spyOn(TwitchClient.prototype, 'state', 'get').mockReturnValue({ connected: true } as never);
  const post = async (body: unknown) => {
    const response = await fetch(server.url + '/api/v1/twitch/channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200); return response.json();
  };
  try {
    const created = await fetch(server.url + '/api/v1/planning', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: 'Weekly', startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z', twitchCategoryId: '42', tags: { values: ['Planning'], source: 'manual' }, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'Europe/Paris' } }) });
    expect(created.ok).toBe(true);
    const before = await (await fetch(server.url + '/api/v1/state')).json();
    const tags = ['Français', 'francais', 'bad tag', ...Array.from({ length: 12 }, (_, i) => `Tag${i}`)];
    let state = await post({ title: 'Spooktober', gameId: '42', gameName: 'Minecraft', tags });
    expect(update).toHaveBeenLastCalledWith({ title: 'Spooktober', gameId: '42', tags: ['Français', ...Array.from({ length: 9 }, (_, i) => `Tag${i}`)] });
    expect(state.twitch.tags).toHaveLength(10);
    expect(state.controlHub.live).toMatchObject({ title: 'Spooktober', category: 'Minecraft' });
    state = await post({ tags: ['Manual'] });
    expect(update).toHaveBeenLastCalledWith({ tags: ['Manual'] });
    expect(state.twitch.tags).toEqual(['Manual']);
    update.mockRejectedValueOnce(Error('tags rejected'));
    state = await post({ title: 'New title', gameId: '43', gameName: 'Other', tags: ['Rejected'] });
    expect(update).toHaveBeenLastCalledWith({ title: 'New title', gameId: '43' });
    expect(state.twitch).toMatchObject({ channelTitle: 'New title', gameId: '43', tags: ['Manual'], tagsWarning: expect.stringContaining('Corrige') });
    expect(state.planning).toEqual(before.planning);
    state = await post({ tags: [] });
    expect(state.twitch.tags).toEqual([]);
    expect(state.twitch.tagsWarning).toBeUndefined();
  } finally { await server.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('suggestions use the edited game and seasonal title without writing planning', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'live-tags-'));
  const server = await startDashboardServer({ port: 0, dataDir: dir, logger: { info() {}, warn() {}, error() {} } });
  try {
    const suggest = async (title: string, gameId: string, gameName: string) => {
      const response = await fetch(server.url + '/api/v1/twitch/tags/suggest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title, gameId, gameName }) });
      expect(response.status).toBe(200); return (await response.json()).tags.values;
    };
    const ordinary = await suggest('Live', '42', 'Minecraft');
    const seasonal = await suggest('Spooktober', '43', 'Just Chatting');
    expect(seasonal).toContain('Halloween');
    expect(seasonal).not.toEqual(ordinary);
    expect(ordinary).not.toContain('Halloween');
  } finally { await server.stop(); await rm(dir, { recursive: true, force: true }); }
});

it('edits tags independently when channel title and category are empty', async () => {
  const update = vi.spyOn(TwitchClient.prototype, 'updateChannelMetadata').mockResolvedValue();
  const dir = await mkdtemp(join(tmpdir(), 'live-tags-'));
  const server = await startDashboardServer({ port: 0, dataDir: dir, logger: { info() {}, warn() {}, error() {} } });
  await server.providersReady;
  vi.spyOn(TwitchClient.prototype, 'state', 'get').mockReturnValue({ connected: true } as never);
  const post = async (body: unknown) => {
    const response = await fetch(server.url + '/api/v1/twitch/channel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    expect(response.status).toBe(200); return response.json();
  };
  try {
    const before = await (await fetch(server.url + '/api/v1/state')).json();
    expect(before.twitch.gameId).toBeNull();
    let state = await post({ tags: ['New'] });
    expect(update).toHaveBeenLastCalledWith({ tags: ['New'] });
    expect(state.twitch.tags).toEqual(['New']);
    expect(state.twitch.gameId).toBeNull();
    expect(state.controlHub.live).toEqual(before.controlHub.live);
    // The browser also submits unchanged empty metadata alongside edited tags.
    state = await post({ title: '', gameId: '', gameName: '', tags: ['Edited'] });
    expect(update).toHaveBeenLastCalledWith({ tags: ['Edited'] });
    expect(state.twitch.tags).toEqual(['Edited']);
    update.mockClear().mockRejectedValueOnce(Error('tags rejected'));
    state = await post({ tags: ['Rejected'] });
    expect(update).toHaveBeenCalledExactlyOnceWith({ tags: ['Rejected'] });
    expect(state.twitch.tags).toEqual(['Edited']);
    expect(state.twitch.tagsWarning).toContain('Corrige');
    expect(state.twitch.tagsWarning).not.toContain('appliqués');
    expect(state.controlHub.live).toEqual(before.controlHub.live);
  } finally { await server.stop(); await rm(dir, { recursive: true, force: true }); }
});
