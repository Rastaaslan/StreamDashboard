import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { TwitchClient } from '../integrations/twitch/src/client.js';

const empty = { clientId: '', accessToken: '', refreshToken: '', broadcasterId: '', userName: '', displayName: '' };
const validSession = { client_id: 'id', user_id: '42', login: 'streamer', scopes: ['channel:manage:schedule'] };
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

  it('partage aussi la création concurrente du Device Code', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const fetch = vi.fn(async () => { await gate; return new Response(JSON.stringify({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 600, interval: 1 })); });
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id' });
    const first = client.startDeviceAuthorization(); const second = client.startDeviceAuthorization();
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
    release();
    expect(await first).toEqual(await second);
    expect(fetch).toHaveBeenCalledTimes(1);
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

  it('respecte slow_down et permet l’annulation du poller', async () => {
    vi.useFakeTimers();
    const responses = [
      new Response(JSON.stringify({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 1 })),
      new Response(JSON.stringify({ message: 'slow_down' }), { status: 400 }),
      new Response(JSON.stringify({ access_token: 'access', refresh_token: 'refresh' })),
      new Response(JSON.stringify({ data: [{ id: '42', login: 'streamer', display_name: 'Streamer' }] })),
      new Response(JSON.stringify({ device_code: 'cancel-device', user_code: 'CANCEL', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 1 })),
    ];
    const fetch = vi.fn(async () => responses.shift()!); vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id' }); await client.startDeviceAuthorization();
    const completion = client.waitForDeviceAuthorization(); await vi.advanceTimersByTimeAsync(1_000); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(5_000); expect(fetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_000); await completion; expect(client.state.connected).toBe(true);
    await client.startDeviceAuthorization(); const cancelled = client.waitForDeviceAuthorization(); client.cancelDeviceAuthorization();
    await expect(cancelled).rejects.toThrow(/annulée/);
  });

  it('expire sans échanger un device code périmé', async () => {
    vi.useFakeTimers(); const fetch = vi.fn(async () => new Response(JSON.stringify({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 1, interval: 1 })));
    vi.stubGlobal('fetch', fetch); const client = new TwitchClient({ ...empty, clientId: 'id' }); await client.startDeviceAuthorization();
    const completion = client.waitForDeviceAuthorization(); const rejection = expect(completion).rejects.toThrow(/expiré/); await vi.advanceTimersByTimeAsync(1_000); await rejection;
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('importe les segments et publie les lives locaux explicitement destinés à Twitch', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input); calls.push({ url, init });
      if (url.includes('/schedule?')) return new Response(JSON.stringify({ data: { segments: [{ id: 'remote', title: 'Live Twitch', start_time: '2030-01-01T10:00:00Z', end_time: '2030-01-01T11:00:00Z' }] } }));
      return new Response(JSON.stringify({ data: { segments: [{ id: 'created' }] } }));
    }));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: '42' });
    const result = await client.sync([{ id: 'local', title: 'Live local', startAtUtc: '2030-01-02T10:00:00Z', endAtUtc: '2030-01-02T11:00:00Z', category: 'live', desiredPublication: { local: true, twitch: true, google: false } }]);
    expect(result.map(x => x.twitchSegmentId).sort()).toEqual(['created', 'remote']);
    const publish = calls.find(call => call.init?.method === 'POST');
    expect(publish?.url).toBe('https://api.twitch.tv/helix/schedule/segment?broadcaster_id=42');
    expect(JSON.parse(String(publish?.init?.body))).toEqual({ start_time: '2030-01-02T10:00:00Z', timezone: 'UTC', duration: 60, title: 'Live local' });
  });

  it('traite un premier planning 404 comme vide puis crée le segment explicitement demandé', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => init?.method === 'POST'
      ? new Response(JSON.stringify({ data: { segments: [{ id: 'first' }] } }))
      : new Response(JSON.stringify({ message: 'schedule not found' }), { status: 404 }));
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: '42' });
    const result = await client.sync([{ id: 'local', title: 'Premier live', startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z', category: 'live', desiredPublication: { local: true, twitch: true, google: false } }]);
    expect(result[0]?.twitchSegmentId).toBe('first'); expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('partage une synchronisation concurrente et ne crée pas de doublon', async () => {
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let posts = 0;
    vi.stubGlobal('fetch', vi.fn(async (_input: string | URL | Request, init?: RequestInit) => { if (init?.method === 'POST') { posts++; await gate; return new Response(JSON.stringify({ data: { segments: [{ id: 'once' }] } })); } return new Response(JSON.stringify({ data: { segments: [] } })); }));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: '42' });
    const items = [{ id: 'local', title: 'Live', startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z', category: 'live' as const, desiredPublication: { local: true, twitch: true, google: false } }];
    const first = client.sync(items), second = client.sync(items); await vi.waitFor(() => expect(posts).toBe(1)); release(); expect(await first).toBe(await second); expect(posts).toBe(1);
  });

  it('ne recrée pas immédiatement un segment LOCAL supprimé sur Twitch', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') throw new Error('ne doit pas republier');
      return new Response(JSON.stringify({ data: { segments: [] } }));
    });
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: '42' });
    const result = await client.sync([{ id: 'local', title: 'Live supprimé', startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z', category: 'live', ownership: 'LOCAL', twitchSegmentId: 'gone', desiredPublication: { local: true, twitch: true, google: false } }]);
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty('twitchSegmentId');
    expect(result[0]?.syncError).toMatch(/absent du planning Twitch/i);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('effectue un seul refresh OAuth pour deux réponses Helix 401 simultanées', async () => {
    let tokenPosts = 0, validations = 0;
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('/oauth2/token')) { tokenPosts++; await new Promise(resolve => setTimeout(resolve, 5)); return new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'rotated' })); }
      validations++;
      return validations <= 2 ? new Response('{}', { status: 401 }) : new Response(JSON.stringify(validSession));
    }));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'old', refreshToken: 'refresh', broadcasterId: '42' });
    expect(await Promise.all([client.validateSession(), client.validateSession()])).toEqual([true, true]); expect(tokenPosts).toBe(1);
  });

  it('refuse de publier sans broadcaster id', async () => {
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token' });
    await expect(client.sync([])).rejects.toThrow(/Connectez Twitch/);
  });

  it('supprime un segment Twitch avec des paramètres encodés', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request) => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: 'user/42' });
    await client.deleteSegment('segment & one');
    expect(String(fetch.mock.calls[0]?.[0])).toContain('broadcaster_id=user%2F42&id=segment%20%26%20one');
  });

  it('fait une rotation atomique du refresh token puis rejoue une seule fois', async () => {
    const persisted: Array<Record<string, string> | null> = [];
    const responses = [new Response('{}', { status: 401 }), new Response(JSON.stringify({ access_token: 'new-access', refresh_token: 'new-refresh' })), new Response(JSON.stringify({ data: { segments: [] } }))];
    const fetch = vi.fn(async () => responses.shift()!); vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'old', refreshToken: 'old-refresh', broadcasterId: '42' }, async tokens => { persisted.push(tokens); });
    await client.sync([]);
    expect(persisted).toEqual([{ accessToken: 'new-access', refreshToken: 'new-refresh' }]);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('déconnecte une session révoquée lors de la validation', async () => {
    const persisted: Array<Record<string, string> | null> = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 401 })));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'revoked', broadcasterId: '42' }, async tokens => { persisted.push(tokens); });
    expect(await client.validateSession()).toBe(false);
    expect(client.state.connected).toBe(false);
    expect(persisted).toEqual([null]);
  });

  it('rafraîchit puis revalide une session restaurée expirée', async () => {
    const persisted: Array<Record<string, string> | null> = [];
    const responses = [new Response('{}', { status: 401 }), new Response(JSON.stringify({ access_token: 'fresh-access', refresh_token: 'fresh-refresh' })), new Response(JSON.stringify(validSession))];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'expired', refreshToken: 'old-refresh', broadcasterId: '42' }, async tokens => { persisted.push(tokens); });
    expect(await client.validateSession()).toBe(true);
    expect(persisted).toEqual([{ accessToken: 'fresh-access', refreshToken: 'fresh-refresh' }]);
  });

  it('déconnecte une session qui a perdu le scope de planning', async () => {
    const persisted: Array<Record<string, string> | null> = [];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ client_id: 'id', user_id: '42', login: 'streamer', scopes: [] }))));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'token', broadcasterId: '42' }, async tokens => { persisted.push(tokens); });
    expect(await client.validateSession()).toBe(false);
    expect(client.state.connected).toBe(false);
    expect(persisted).toEqual([null]);
  });

  it('ne réinjecte pas un token si l’utilisateur se déconnecte pendant un refresh', async () => {
    let release!: (response: Response) => void;
    const refreshGate = new Promise<Response>(resolve => { release = resolve; });
    const persisted: Array<Record<string, string> | null> = [];
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++;
      if (calls === 1) return new Response('{}', { status: 401 });
      return refreshGate;
    }));
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'expired', refreshToken: 'old-refresh', broadcasterId: '42' }, async tokens => { persisted.push(tokens); });
    const validation = client.validateSession();
    await vi.waitFor(() => expect(calls).toBe(2));
    await client.disconnect();
    release(new Response(JSON.stringify({ access_token: 'should-not-stick', refresh_token: 'rotated' })));
    expect(await validation).toBe(false);
    expect(client.state.connected).toBe(false);
    expect(persisted.at(-1)).toBeNull();
    expect(persisted.some(value => value?.accessToken === 'should-not-stick')).toBe(false);
  });

  it('déconnecte après un unique refresh si le replay Helix reste en 401', async () => {
    const persisted: Array<Record<string, string> | null> = [];
    const responses = [new Response('{}', { status: 401 }), new Response(JSON.stringify({ access_token: 'fresh', refresh_token: 'rotated' })), new Response('{}', { status: 401 })];
    const fetch = vi.fn(async () => responses.shift()!); vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient({ ...empty, clientId: 'id', accessToken: 'old', refreshToken: 'refresh', broadcasterId: '42' }, async tokens => { persisted.push(tokens); });
    await expect(client.sync([])).rejects.toThrow(/Reconnectez/);
    expect(fetch).toHaveBeenCalledTimes(3); expect(client.state.connected).toBe(false); expect(persisted.at(-1)).toBeNull();
  });
});
