import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyLegacyTwitchMetadata } from '../apps/server/src/twitch-metadata-route.js';
import { TwitchClient, TwitchHttpError, isTwitchTagsRejection } from '../integrations/twitch/src/client.js';

afterEach(() => vi.unstubAllGlobals());
const previous = { title: 'Original', gameId: '42', gameName: 'Minecraft', tags: ['OriginalTag'] };
const failures = [
  ['lost acknowledgement', new Error('Connection closed after sending')],
  ['server failure', new TwitchHttpError(503, 'Twitch HTTP 503')],
  ['invalid category', new TwitchHttpError(400, 'Twitch HTTP 400')],
] as const;

describe('legacy Twitch metadata patches', () => {
  it('normalizes a tags-only patch while retaining untouched metadata and the previous value', async () => {
    const update = vi.fn(async () => {});
    const result = await applyLegacyTwitchMetadata({ title: '', gameId: '', tags: [' Français ', 'francais', 'bad tag', ...Array.from({ length: 12 }, (_, i) => `Tag${i}`)] }, previous, update);
    const tags = ['Français', ...Array.from({ length: 9 }, (_, i) => `Tag${i}`)];
    expect(update).toHaveBeenCalledExactlyOnceWith({ tags });
    expect(result).toEqual({ ...previous, tags });
    expect(previous.tags).toEqual(['OriginalTag']);
  });

  it('falls back only after a certain tags rejection and does not claim the refused tags were applied', async () => {
    const update = vi.fn().mockRejectedValueOnce(new TwitchHttpError(400, 'Twitch HTTP 400', null, true)).mockResolvedValue(undefined);
    const result = await applyLegacyTwitchMetadata({ title: ' New title ', gameId: '43', gameName: 'New game', tags: ['Rejected'] }, previous, update);
    expect(update.mock.calls).toEqual([[{ title: 'New title', gameId: '43', tags: ['Rejected'] }], [{ title: 'New title', gameId: '43' }]]);
    expect(result).toMatchObject({ title: 'New title', gameId: '43', gameName: 'New game', tags: ['OriginalTag'], tagsWarning: expect.stringContaining('Corrige') });
    expect(previous).toEqual({ title: 'Original', gameId: '42', gameName: 'Minecraft', tags: ['OriginalTag'] });
  });

  it('reports a refused tags-only patch without an empty second write', async () => {
    const update = vi.fn().mockRejectedValue(new TwitchHttpError(400, 'Twitch HTTP 400', null, true));
    const result = await applyLegacyTwitchMetadata({ tags: ['Rejected'] }, previous, update);
    expect(update).toHaveBeenCalledExactlyOnceWith({ tags: ['Rejected'] });
    expect(result).toMatchObject({ ...previous, tagsWarning: expect.stringContaining('Corrige') });
    expect(result.tagsWarning).not.toContain('appliqués');
  });

  it.each(failures)('does not resend or fabricate local success after %s', async (_name, failure) => {
    const update = vi.fn().mockRejectedValue(failure);
    const old = structuredClone(previous);
    await expect(applyLegacyTwitchMetadata({ title: 'New', tags: ['New'] }, old, update)).rejects.toBe(failure);
    expect(update).toHaveBeenCalledExactlyOnceWith({ title: 'New', tags: ['New'] });
    expect(old).toEqual(previous);
  });

  it('clears a previous warning only after successful tags update and drops a stale category name', async () => {
    const update = vi.fn(async () => {});
    const withWarning = { ...previous, tagsWarning: 'Tags refusés' };
    const changed = await applyLegacyTwitchMetadata({ gameId: '43' }, withWarning, update);
    expect(changed).toMatchObject({ gameId: '43', gameName: '', tagsWarning: 'Tags refusés' });
    expect(await applyLegacyTwitchMetadata({ tags: [] }, changed, update)).toEqual({ ...previous, gameId: '43', gameName: '', tags: [] });
  });
});

describe('Twitch distinguishes a provider tags rejection from other errors', () => {
  it.each([
    [400, { message: 'The tags list may contain up to 10 tags. token=private-token' }, true],
    [400, { message: 'The game_id is not valid.' }, false],
    [400, null, false],
    [500, { message: 'Could not apply tags.' }, false],
  ])('classifies HTTP %s with body %j without exposing provider text', async (status, body, rejected) => {
    const request = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ client_id: 'client', user_id: '42', scopes: ['channel:manage:broadcast'] }))).mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', request);
    const client = new TwitchClient({ clientId: 'client', accessToken: 'private-token', refreshToken: 'refresh', broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' });
    await client.validateSession();
    let caught: unknown;
    try { await client.updateChannelMetadata({ title: 'New', tags: ['New'] }); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(TwitchHttpError);
    expect(isTwitchTagsRejection(caught)).toBe(rejected);
    expect((caught as Error).message).toBe(`Twitch HTTP ${status}`);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
