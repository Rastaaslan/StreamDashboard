import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';

const empty = { clientId: '', accessToken: '', refreshToken: '', broadcasterId: '', userName: '', displayName: '' };
afterEach(() => vi.unstubAllGlobals());

describe('intégration Twitch générique', () => {
  it('génère une autorisation PKCE sans secret client', () => {
    const url = new URL(new TwitchClient({ ...empty }).startAuthorization('client-public', 'http://127.0.0.1:47832/api/twitch/callback'));
    expect(url.searchParams.get('scope')).toBe('channel:manage:schedule');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.has('client_secret')).toBe(false);
  });

  it('importe les segments et publie les lives locaux', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push(`${init?.method ?? 'GET'} ${url}`);
      if (url.includes('/schedule?')) return new Response(JSON.stringify({ data: { segments: [{ id: 'remote', title: 'Live Twitch', start_time: '2030-01-01T10:00:00Z', end_time: '2030-01-01T11:00:00Z' }] } }));
      return new Response(JSON.stringify({ data: { segments: [{ id: 'created' }] } }));
    }));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: '42' });
    const result = await client.sync([{ id: 'local', title: 'Live local', startAtUtc: '2030-01-02T10:00:00Z', endAtUtc: '2030-01-02T11:00:00Z', category: 'live' }]);
    expect(result.map(x => x.twitchSegmentId).sort()).toEqual(['created', 'remote']);
    expect(calls.some(x => x.startsWith('POST '))).toBe(true);
  });

  it('supprime un segment Twitch avec des paramètres encodés', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: 'user/42' });
    await client.deleteSegment('segment & one');
    expect(String(fetch.mock.calls[0]?.[0])).toContain('broadcaster_id=user%2F42&id=segment%20%26%20one');
  });
});
