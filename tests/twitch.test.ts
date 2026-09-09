import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TwitchClient } from '../integrations/twitch/src/client.js';

const empty = { clientId: '', accessToken: '', refreshToken: '', broadcasterId: '', userName: '', displayName: '' };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('intégration Twitch générique', () => {
  it('ne conserve aucune route callback ni configuration de redirection', () => {
    const server = readFileSync(new URL('../apps/server/src/index.ts', import.meta.url), 'utf8');
    const environment = readFileSync(new URL('../.env.example', import.meta.url), 'utf8');
    expect(server).not.toContain('/api/twitch/callback');
    expect(server).not.toContain('redirectUri');
    expect(environment).not.toContain('TWITCH_REDIRECT_URI');
  });

  it('démarre un Device Code Grant sans secret ni redirect URI', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response(JSON.stringify({ device_code: 'device-secret', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate', expires_in: 600, interval: 1 })));
    vi.stubGlobal('fetch', fetch);
    const result = await new TwitchClient({ ...empty, clientId: 'client-public' }).startDeviceAuthorization();
    expect(result).toMatchObject({ userCode: 'ABCD-EFGH', verificationUri: 'https://www.twitch.tv/activate' });
    const request = fetch.mock.calls[0];
    expect(String(request?.[0])).toBe('https://id.twitch.tv/oauth2/device');
    const body = String(request?.[1]?.body);
    expect(body).toContain('client_id=client-public');
    expect(body).not.toMatch(/client_secret|redirect_uri|code_challenge/);
    expect(JSON.stringify(result)).not.toContain('device-secret');
  });

  it('attend la validation puis charge le compte utilisateur', async () => {
    vi.useFakeTimers();
    const responses = [
      new Response(JSON.stringify({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 1 })),
      new Response(JSON.stringify({ message: 'authorization_pending' }), { status: 400 }),
      new Response(JSON.stringify({ access_token: 'user-token', refresh_token: 'refresh-token' })),
      new Response(JSON.stringify({ data: [{ id: '42', login: 'streamer', display_name: 'Streamer' }] })),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const client = new TwitchClient({ ...empty, clientId: 'public-id' });
    await client.startDeviceAuthorization();
    const completion = client.waitForDeviceAuthorization();
    await vi.advanceTimersByTimeAsync(2_000);
    await completion;
    expect(client.state).toMatchObject({ connected: true, displayName: 'Streamer', deviceAuthorization: null });
    expect(client.exportTokens()).not.toHaveProperty('clientId');
    vi.useRealTimers();
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
