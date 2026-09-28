import { afterEach, describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { TwitchEventSub } from '../integrations/twitch/src/eventsub.js';

const credentials = { clientId: 'client', accessToken: 'private-access', refreshToken: 'private-refresh', broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
const json = (value: unknown, status = 200, headers = {}) => new Response(JSON.stringify(value), { status, headers });
const validation = (scopes: string[]) => json({ client_id: 'client', user_id: '42', scopes });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('CB-15 Twitch runtime audit', () => {
  it('guards every protected action without issuing a Helix request', async () => {
    const fetch = vi.fn(async () => validation([])); vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient(credentials); await client.validateSession(); fetch.mockClear();
    const item = { id: 'live', title: 'Live', startAtUtc: '2030-01-01T10:00:00Z', endAtUtc: '2030-01-01T11:00:00Z' };
    const actions = [() => client.deleteVideo('123'), () => client.createClip(), () => client.chatters(), () => client.sendChatMessage('Hi'), () => client.updateChannelMetadata({ title: 'Live', gameId: '1' }), () => client.createSegment(item), () => client.updateSegment('id', item), () => client.deleteSegment('id'), () => client.deleteChatMessage('id'), () => client.banUser('123'), () => client.unbanUser('123'), () => client.customRewards(), () => client.subscribeChat('session'), () => client.subscribeRewardRedemptions('session')];
    for (const action of actions) await expect(action()).rejects.toMatchObject({ name: 'TWITCH_NOT_AUTHORIZED' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('rejects clip creation offline, but allows it during a verified live', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(validation(['clips:edit'])).mockResolvedValueOnce(json({ data: [] })).mockResolvedValueOnce(json({ data: [{ viewer_count: 17 }] })).mockResolvedValueOnce(json({ data: [{ id: 'clip', edit_url: 'https://clips.twitch.tv/clip' }] }));
    vi.stubGlobal('fetch', fetch); const client = new TwitchClient(credentials); await client.validateSession();
    await expect(client.createClip()).rejects.toMatchObject({ status: 409 });
    expect(fetch).toHaveBeenCalledTimes(2);
    await expect(client.createClip()).resolves.toMatchObject({ id: 'clip' });
  });

  it.each([429, 503])('preserves credentials during validation HTTP %s and redacts provider errors', async status => {
    const fetch = vi.fn().mockResolvedValueOnce(validation(['user:write:chat'])).mockResolvedValueOnce(json({ message: 'private-access private-refresh' }, status, { 'retry-after': '30' }));
    vi.stubGlobal('fetch', fetch); const persisted = vi.fn(); const client = new TwitchClient(credentials, persisted); await client.validateSession();
    const error = await client.validateSession().catch(error => error);
    expect(error).toMatchObject({ status, retryAfter: '30' });
    expect(error.message).not.toContain('private-');
    expect(client.state.connected).toBe(true); expect(client.controlCapabilities().chatWrite).toBe(true); expect(persisted).not.toHaveBeenCalled();
  });

  it('invalidates all capabilities when an expired token cannot be refreshed', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(validation(['user:write:chat', 'moderator:read:chatters'])).mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ message: 'private-refresh' }, 400));
    vi.stubGlobal('fetch', fetch); const persisted = vi.fn(); const client = new TwitchClient(credentials, persisted); await client.validateSession();
    await expect(client.sendChatMessage('Hi')).rejects.toMatchObject({ status: 400 });
    expect(client.state.connected).toBe(false); expect(client.controlCapabilities()).toMatchObject({ chatWrite: false, chatters: false }); expect(persisted).toHaveBeenLastCalledWith(null);
    expect(JSON.stringify(client.state)).not.toContain('private-');
  });

  it('replaces scopes immediately after device reauthorization without restart', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(validation(['user:write:chat'])).mockResolvedValueOnce(json({ device_code: 'private-device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 1 })).mockResolvedValueOnce(json({ access_token: 'private-new', refresh_token: 'private-rotated' })).mockResolvedValueOnce(json({ data: [{ id: '42', login: 'streamer', display_name: 'Streamer' }] })).mockResolvedValueOnce(validation(['moderator:read:chatters']));
    vi.stubGlobal('fetch', fetch); const client = new TwitchClient(credentials); await client.validateSession();
    await client.startDeviceAuthorization(); const completed = client.waitForDeviceAuthorization(); await vi.advanceTimersByTimeAsync(1000); await completed;
    expect(client.controlCapabilities()).toMatchObject({ chatWrite: false, chatters: true });
    expect(JSON.stringify({ state: client.state, capabilities: client.controlCapabilities() })).not.toContain('private-');
  });

  it('keeps the active session until the other account is fully validated, then installs its identity, scopes and tokens', async () => {
    vi.useFakeTimers();
    let finishValidation!: (response: Response) => void;
    const pendingValidation = new Promise<Response>(resolve => { finishValidation = resolve; });
    const fetch = vi.fn().mockResolvedValueOnce(validation(['clips:edit']))
      .mockResolvedValueOnce(json({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 1 }))
      .mockResolvedValueOnce(json({ access_token: 'private-new', refresh_token: 'private-new-refresh' }))
      .mockResolvedValueOnce(json({ data: [{ id: '99', login: 'other', display_name: 'Other' }] }))
      .mockReturnValueOnce(pendingValidation);
    vi.stubGlobal('fetch', fetch);
    const persisted = vi.fn(); const client = new TwitchClient({ ...credentials }, persisted);
    await client.validateSession(); const previous = client.exportTokens();
    await client.startDeviceAuthorization(); const completion = client.waitForDeviceAuthorization();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.exportTokens()).toEqual(previous);
    expect(client.publicIdentity()).toMatchObject({ broadcasterId: '42' });
    expect(client.controlCapabilities()).toMatchObject({ createClip: true, deleteVideo: false });
    expect(persisted).not.toHaveBeenCalled();
    finishValidation(json({ client_id: 'client', user_id: '99', scopes: ['channel:manage:videos'] }));
    await completion;
    expect(client.publicIdentity()).toEqual({ broadcasterId: '99', userName: 'other', displayName: 'Other' });
    expect(client.controlCapabilities()).toMatchObject({ createClip: false, deleteVideo: true });
    expect(persisted).toHaveBeenCalledExactlyOnceWith({ accessToken: 'private-new', refreshToken: 'private-new-refresh' });
    expect(client.exportTokens()).toMatchObject({ broadcasterId: '99', accessToken: 'private-new' });
  });

  it('cleans up the installed session if persisting the verified replacement fails', async () => {
    vi.useFakeTimers();
    const fetch = vi.fn().mockResolvedValueOnce(validation(['clips:edit']))
      .mockResolvedValueOnce(json({ device_code: 'device', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate', expires_in: 60, interval: 1 }))
      .mockResolvedValueOnce(json({ access_token: 'private-new', refresh_token: 'private-new-refresh' }))
      .mockResolvedValueOnce(json({ data: [{ id: '99', login: 'other', display_name: 'Other' }] }))
      .mockResolvedValueOnce(json({ client_id: 'client', user_id: '99', scopes: ['channel:manage:videos'] }));
    vi.stubGlobal('fetch', fetch);
    const persisted = vi.fn().mockRejectedValueOnce(new Error('Storage unavailable')).mockResolvedValueOnce(undefined);
    const client = new TwitchClient({ ...credentials }, persisted); await client.validateSession();
    await client.startDeviceAuthorization(); const completion = client.waitForDeviceAuthorization();
    const rejected = expect(completion).rejects.toThrow('Storage unavailable');
    await vi.advanceTimersByTimeAsync(1000); await rejected;
    expect(client.state.connected).toBe(false);
    expect(client.publicIdentity().broadcasterId).toBe('');
    expect(client.controlCapabilities()).toMatchObject({ createClip: false, deleteVideo: false });
    expect(persisted).toHaveBeenLastCalledWith(null);
  });

  it('does not replay a mutation after refresh removes its required scope', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(validation(['user:write:chat'])).mockResolvedValueOnce(json({}, 401)).mockResolvedValueOnce(json({ access_token: 'new', scope: [] }));
    vi.stubGlobal('fetch', fetch); const client = new TwitchClient(credentials); await client.validateSession();
    await expect(client.sendChatMessage('Hi')).rejects.toMatchObject({ requiredScope: 'user:write:chat' });
    expect(fetch).toHaveBeenCalledTimes(3); expect(client.controlCapabilities().chatWrite).toBe(false);
  });

  it('revalidates capabilities after Helix 403 without retrying the mutation', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(validation(['channel:manage:videos'])).mockResolvedValueOnce(json({ message: 'private-access' }, 403)).mockResolvedValueOnce(validation([]));
    vi.stubGlobal('fetch', fetch); const client = new TwitchClient(credentials); await client.validateSession();
    await expect(client.deleteVideo('123')).rejects.toMatchObject({ status: 403 });
    expect(client.controlCapabilities().deleteVideo).toBe(false); expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('accepts the manage-redemptions scope for reward reads', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(validation(['channel:manage:redemptions'])).mockResolvedValueOnce(json({ data: [] }));
    vi.stubGlobal('fetch', fetch); const client = new TwitchClient(credentials); await client.validateSession();
    expect(client.controlCapabilities().redemptions).toBe(true); await expect(client.customRewards()).resolves.toEqual([]);
  });

  it('ignores subscription completion and messages from a stopped EventSub socket', async () => {
    class Socket extends EventEmitter { close() { this.emit('close'); } }
    const socket = new Socket(); let resolve!: () => void; const pending = new Promise<void>(done => { resolve = done; });
    const statuses = vi.fn(); const message = vi.fn();
    const client = new TwitchEventSub(() => pending, message, statuses, () => socket as unknown as WebSocket);
    client.start(); socket.emit('message', Buffer.from(JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'session' } } })));
    client.stop(); resolve(); await pending; await Promise.resolve();
    expect(statuses).toHaveBeenLastCalledWith('DISCONNECTED');
    socket.emit('message', Buffer.from(JSON.stringify({ metadata: { message_type: 'notification', subscription_type: 'channel.chat.message' }, payload: { event: { message_id: 'id', chatter_user_id: '42' } } })));
    expect(message).not.toHaveBeenCalled();
  });
});
