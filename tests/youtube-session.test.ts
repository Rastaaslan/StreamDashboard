import { describe, expect, it, vi } from 'vitest';
import { YouTubeClient } from '../integrations/youtube/src/client.js';
import type { SecretStore } from '../apps/server/src/storage.js';

const selection = { clientId: 'test-client', channelId: 'test-channel', broadcastId: 'test-broadcast' };
const json = (value: unknown) => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });
const catalog = (nextPageToken?: string) => json({ items: [], ...(nextPageToken ? { nextPageToken } : {}) });
const tokenResponse = (name: string, expires = 3600) => json({ access_token: `access-${name}`, refresh_token: `refresh-${name}`, expires_in: expires });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function fixture(respond: (url: URL, init: RequestInit) => Promise<Response> | Response, expired = true) {
  let value: Record<string, string> | null = { clientId: selection.clientId, accessToken: 'access-old', refreshToken: 'refresh-old', expiresAt: String(Date.now() + (expired ? -1 : 3_600_000)) };
  const secrets = {
    getYouTubeTokens: vi.fn(async () => value && { ...value }),
    setYouTubeTokens: vi.fn(async (next: Record<string, string>) => { value = { ...next }; }),
    clearYouTubeTokens: vi.fn(async () => { value = null; }),
    getGoogleClientSecret: vi.fn(async () => 'test-client-secret'),
  };
  const request = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => respond(new URL(String(input)), init));
  const client = new YouTubeClient(secrets as unknown as SecretStore, () => ({ ...selection }), request as typeof fetch);
  const authorize = () => new URL(client.authorize('http://127.0.0.1:48133/callback').url).searchParams.get('state')!;
  return { client, secrets, request, authorize, stored: () => value };
}

describe('YouTube authentication session boundaries', () => {
  it('does not restore tokens or call the API after disconnecting during refresh', async () => {
    const response = deferred<Response>();
    const f = fixture(() => response.promise);
    const pending = f.client.broadcasts().catch(error => error);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    await f.client.disconnect();
    response.resolve(tokenResponse('late'));
    expect(await pending).toBeInstanceOf(Error);
    expect(f.stored()).toBeNull();
    expect(f.secrets.setYouTubeTokens).not.toHaveBeenCalled();
    expect(f.request).toHaveBeenCalledTimes(1);
  });

  it('does not reinstall credentials from an OAuth callback cancelled while Google responds', async () => {
    const response = deferred<Response>();
    const f = fixture(() => response.promise);
    const pending = f.client.exchange('test-code', f.authorize()).catch(error => error);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    await f.client.disconnect();
    response.resolve(tokenResponse('cancelled'));
    expect(await pending).toBeInstanceOf(Error);
    expect(f.stored()).toBeNull();
    expect(f.secrets.setYouTubeTokens).not.toHaveBeenCalled();
  });

  it('keeps the newer authorization when an older OAuth exchange returns last', async () => {
    const oldResponse = deferred<Response>();
    const f = fixture((_url, init) => String(init.body).includes('code=old-code') ? oldResponse.promise : tokenResponse('new'));
    const old = f.client.exchange('old-code', f.authorize()).catch(error => error);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    await f.client.exchange('new-code', f.authorize());
    oldResponse.resolve(tokenResponse('old'));
    expect(await old).toBeInstanceOf(Error);
    expect(f.stored()).toMatchObject({ accessToken: 'access-new', refreshToken: 'refresh-new' });
    expect(f.secrets.setYouTubeTokens).toHaveBeenCalledTimes(1);
  });

  it('waits for an already-started credential write before completing disconnect', async () => {
    const disk = deferred<void>();
    const f = fixture(url => url.hostname === 'oauth2.googleapis.com' ? tokenResponse('refreshed') : catalog());
    const write = f.secrets.setYouTubeTokens.getMockImplementation()!;
    f.secrets.setYouTubeTokens.mockImplementation(async next => { await disk.promise; await write(next); });
    const pending = f.client.broadcasts().catch(error => error);
    await vi.waitFor(() => expect(f.secrets.setYouTubeTokens).toHaveBeenCalledTimes(1));
    let disconnected = false;
    const stopping = f.client.disconnect().then(() => { disconnected = true; });
    await Promise.resolve();
    expect(disconnected).toBe(false);
    disk.resolve();
    await stopping;
    expect(await pending).toBeInstanceOf(Error);
    expect(f.stored()).toBeNull();
    expect(f.request.mock.calls.filter(([url]) => String(url).includes('/youtube/v3/'))).toHaveLength(0);
  });

  it('rejects a late catalog page from a disconnected session before fetching its next page', async () => {
    const oldPage = deferred<Response>();
    const f = fixture(url => url.hostname === 'oauth2.googleapis.com' ? tokenResponse('new') : oldPage.promise, false);
    const pending = f.client.broadcasts().catch(error => error);
    await vi.waitFor(() => expect(f.request).toHaveBeenCalledTimes(1));
    await f.client.disconnect();
    await f.client.exchange('new-code', f.authorize());
    oldPage.resolve(catalog('old-account-next-page'));
    expect(await pending).toBeInstanceOf(Error);
    expect(f.request.mock.calls.filter(([url]) => String(url).includes('/youtube/v3/'))).toHaveLength(1);
    expect(f.stored()).toMatchObject({ accessToken: 'access-new' });
  });

  it('does not clear a newer refresh flight when the previous session finishes late', async () => {
    const oldResponse = deferred<Response>(), newResponse = deferred<Response>();
    let refreshes = 0;
    const f = fixture((url, init) => {
      if (url.hostname !== 'oauth2.googleapis.com') return catalog();
      const body = new URLSearchParams(String(init.body));
      if (body.get('grant_type') === 'authorization_code') return tokenResponse('new', 1);
      return ++refreshes === 1 ? oldResponse.promise : newResponse.promise;
    });
    const old = f.client.broadcasts().catch(error => error);
    await vi.waitFor(() => expect(refreshes).toBe(1));
    await f.client.disconnect();
    await f.client.exchange('new-code', f.authorize());
    const firstNew = f.client.broadcasts();
    await vi.waitFor(() => expect(refreshes).toBe(2));
    oldResponse.resolve(tokenResponse('stale'));
    expect(await old).toBeInstanceOf(Error);
    const secondNew = f.client.broadcasts();
    await vi.waitFor(() => expect(f.secrets.getYouTubeTokens.mock.calls.length).toBeGreaterThanOrEqual(3));
    newResponse.resolve(tokenResponse('new-refreshed'));
    await expect(Promise.all([firstNew, secondNew])).resolves.toEqual([[], []]);
    expect(refreshes).toBe(2);
    expect(f.stored()).toMatchObject({ accessToken: 'access-new-refreshed', refreshToken: 'refresh-new-refreshed' });
  });
});
