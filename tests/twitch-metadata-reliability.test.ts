import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { sameTwitchTags } from '../integrations/twitch/src/metadata.js';

afterEach(() => vi.unstubAllGlobals());

describe('Twitch metadata confirmation', () => {
  it('accepts reordered exact tags without changing either input', () => {
    const requested = ['Horror', 'Action', 'gaming'];
    const observed = ['gaming', 'Horror', 'Action'];
    expect(sameTwitchTags(observed, requested)).toBe(true);
    expect(requested).toEqual(['Horror', 'Action', 'gaming']);
    expect(observed).toEqual(['gaming', 'Horror', 'Action']);
    expect(sameTwitchTags(undefined, [])).toBe(true);
  });
  it('rejects missing, extra, changed or duplicate-count-mismatched tags', () => {
    expect(sameTwitchTags(['Action'], ['Action', 'Horror'])).toBe(false);
    expect(sameTwitchTags(['Action', 'Horror'], ['Action'])).toBe(false);
    expect(sameTwitchTags(['action'], ['Action'])).toBe(false);
    expect(sameTwitchTags(['Action', 'Action'], ['Action', 'Horror'])).toBe(false);
    expect(sameTwitchTags(undefined, ['Action'])).toBe(false);
  });
});

describe('Twitch saved category lookup', () => {
  const credentials = { clientId: 'client', accessToken: 'token', refreshToken: 'refresh', broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
  it('resolves the exact stored ID through the official games endpoint', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ data: [{ id: '460637', name: 'Dead Island 2', box_art_url: 'https://static-cdn.jtvnw.net/test.jpg', extra: 'ignored' }] })));
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient(credentials);
    await expect(client.getGameById('460637')).resolves.toEqual({ id: '460637', name: 'Dead Island 2', box_art_url: 'https://static-cdn.jtvnw.net/test.jpg' });
    expect(String(fetch.mock.calls[0]?.[0])).toBe('https://api.twitch.tv/helix/games?id=460637');
  });
  it('refuses malformed IDs before sending and does not accept another category', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: '999', name: 'Wrong game' }] })));
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient(credentials);
    await expect(client.getGameById('460637&name=other')).rejects.toThrow('Identifiant');
    expect(fetch).not.toHaveBeenCalled();
    await expect(client.getGameById('460637')).resolves.toBeNull();
  });
});
