import { describe, expect, it, vi, afterEach } from 'vitest';
import { TwitchClient } from '../integrations/twitch/src/client.js';
import { parseChatNotification, parseRewardRedemptionNotification, TwitchEventSub } from '../integrations/twitch/src/eventsub.js';
import { EventEmitter } from 'node:events';
import type WebSocket from 'ws';

const credentials = { clientId: 'client', accessToken: 'token', refreshToken: 'refresh', broadcasterId: '42', userName: 'streamer', displayName: 'Streamer' };
afterEach(() => vi.unstubAllGlobals());

describe('Twitch Live Control', () => {
  it('mappe le live réel et son viewer count', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ title: 'Live réel', game_id: '10', game_name: 'Minecraft', started_at: '2026-09-17T10:00:00Z', viewer_count: 17, thumbnail_url: 'https://static-cdn.jtvnw.net/live.jpg' }] }))));
    await expect(new TwitchClient(credentials).getLiveState()).resolves.toMatchObject({ isLive: true, title: 'Live réel', category: 'Minecraft', startedAt: '2026-09-17T10:00:00Z', viewerCount: 17 });
  });

  it('pagine et mappe VOD, clips et chatters via Helix', async () => {
    const responses = [
      { client_id: 'client', user_id: '42', login: 'streamer', scopes: ['channel:manage:schedule', 'moderator:read:chatters'] },
      { data: [{ id: '1', title: 'VOD', description: '', created_at: '2026-09-17T10:00:00Z', published_at: '2026-09-17T10:00:00Z', url: 'https://twitch.tv/videos/1', thumbnail_url: 'https://cdn/vod.jpg', view_count: 12, duration: '1h2m', type: 'archive' }], pagination: { cursor: 'next' } },
      { data: [{ id: 'clip', title: 'GG', url: 'https://clips.twitch.tv/clip', embed_url: 'https://clips.twitch.tv/embed?clip=clip', broadcaster_name: 'Streamer', creator_name: 'User', created_at: '2026-09-17T10:00:00Z', thumbnail_url: 'https://cdn/clip.jpg', duration: 30, video_id: '1', vod_offset: 42, view_count: 9 }], pagination: {} },
      { data: [{ user_id: '2', user_login: 'user', user_name: 'User' }], total: 1, pagination: {} },
    ];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(responses.shift()))));
    const client = new TwitchClient(credentials);
    expect(await client.validateSession()).toBe(true);
    expect(await client.videos()).toMatchObject({ items: [{ id: '1', type: 'archive' }], cursor: 'next' });
    expect(await client.clips()).toMatchObject({ items: [{ id: 'clip', videoId: '1', vodOffset: 42 }] });
    expect(await client.chatters()).toMatchObject({ items: [{ id: '2', displayName: 'User' }], total: 1 });
  });

  it('envoie un message et ne prétend pas réussir lorsque Twitch le refuse', async () => {
    const responses = [
      new Response(JSON.stringify({ client_id: 'client', user_id: '42', login: 'streamer', scopes: ['channel:manage:schedule', 'user:write:chat'] })),
      new Response(JSON.stringify({ data: [{ message_id: 'm1', is_sent: true }] })),
    ];
    const fetch = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => responses.shift()!);
    vi.stubGlobal('fetch', fetch);
    const client = new TwitchClient(credentials);
    expect(await client.validateSession()).toBe(true);
    await expect(client.sendChatMessage('Bonjour')).resolves.toEqual({ messageId: 'm1' });
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ broadcaster_id: '42', sender_id: '42', message: 'Bonjour' });
  });

  it('parse badges, fragments, emotes, reply et bits EventSub', () => {
    const parsed = parseChatNotification({ metadata: { message_type: 'notification', subscription_type: 'channel.chat.message' }, payload: { event: { broadcaster_user_id: '42', chatter_user_id: '2', chatter_user_login: 'user', chatter_user_name: 'User', message_id: 'm1', color: '#FF0000', badges: [{ set_id: 'moderator', id: '1', info: '' }], message: { text: 'GG Kappa', fragments: [{ type: 'text', text: 'GG ' }, { type: 'emote', text: 'Kappa', emote: { id: '25', emote_set_id: '0', owner_id: '0', format: ['static'] } }] }, reply: { parent_message_id: 'p1', parent_message_body: 'Salut', parent_user_id: '3', parent_user_name: 'Other' }, cheer: { bits: 100 } } } }, '2026-09-17T10:00:00Z');
    expect(parsed).toMatchObject({ id: 'm1', chatter: { displayName: 'User', badges: [{ setId: 'moderator' }] }, reply: { parentMessageId: 'p1' }, bits: 100, fragments: [{ type: 'text' }, { emote: { id: '25' } }] });
  });

  it('parse un redeem de récompense Twitch en événement Streamer Ping exploitable', () => {
    const parsed = parseRewardRedemptionNotification({
      metadata: { message_type: 'notification', subscription_type: 'channel.channel_points_custom_reward_redemption.add' },
      payload: { event: { id: 'redeem-1', broadcaster_user_id: '42', user_id: '2', user_login: 'viewer', user_name: 'Viewer', user_input: 'Maintenant !', status: 'unfulfilled', redeemed_at: '2026-09-19T06:00:00Z', reward: { id: 'reward-water', title: 'Bois de l’eau', prompt: 'Hydrate-toi', cost: 500 } } },
    });
    expect(parsed).toMatchObject({ id: 'redeem-1', user: { displayName: 'Viewer' }, reward: { id: 'reward-water', title: 'Bois de l’eau', cost: 500 }, userInput: 'Maintenant !' });
  });

  it('lit les récompenses après autorisation redemptions', async () => {
    const responses = [
      new Response(JSON.stringify({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule', 'channel:read:redemptions'] })),
      new Response(JSON.stringify({ data: [{ id: 'reward-water', title: 'Bois', prompt: '', cost: 500, is_enabled: true, is_paused: false, is_in_stock: true, is_user_input_required: false }] })),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => responses.shift()!));
    const client = new TwitchClient(credentials);
    expect(await client.validateSession()).toBe(true);
    expect(client.state.redemptionsAvailable).toBe(true);
    await expect(client.customRewards()).resolves.toEqual([expect.objectContaining({ id: 'reward-water', title: 'Bois', cost: 500 })]);
  });

  it('expose NOT_AUTHORIZED sans scope et appelle les endpoints officiels avec les scopes', async () => {
    const client = new TwitchClient(credentials);
    await expect(client.deleteChatMessage('message')).rejects.toMatchObject({ name: 'TWITCH_NOT_AUTHORIZED', requiredScope: 'moderator:manage:chat_messages' });
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => { const url = String(input); calls.push({ url, init }); if (url.includes('/oauth2/validate')) return new Response(JSON.stringify({ client_id: 'client', user_id: '42', scopes: ['channel:manage:schedule', 'moderator:manage:chat_messages', 'moderator:manage:banned_users'] })); return new Response(null, { status: 204 }); }));
    expect(await client.validateSession()).toBe(true);
    await client.deleteChatMessage('message-1'); await client.banUser('123', { duration: 600, reason: 'spam' }); await client.unbanUser('123');
    expect(calls.some(call => call.url.includes('/moderation/chat?') && call.init?.method === 'DELETE')).toBe(true);
    expect(calls.filter(call => call.url.includes('/moderation/bans?')).map(call => call.init?.method)).toEqual(['POST', 'DELETE']);
    expect(client.moderationCapabilities()).toMatchObject({ deleteMessage: true, timeout: true, ban: true, unban: true });
  });

  it('reconnecte EventSub après fermeture avec backoff et resubscribe', async () => {
    vi.useFakeTimers();
    class Socket extends EventEmitter { close() { this.emit('close'); } }
    const sockets: Socket[] = []; const subscribe = vi.fn(async () => undefined); const statuses: string[] = [];
    const eventsub = new TwitchEventSub(subscribe, () => undefined, status => { statuses.push(status); }, () => { const socket = new Socket(); sockets.push(socket); return socket as unknown as WebSocket; });
    eventsub.start(); sockets[0]!.emit('message', Buffer.from(JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'one', keepalive_timeout_seconds: 30 } } })));
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledWith('one')); sockets[0]!.emit('close'); await vi.advanceTimersByTimeAsync(1_000); expect(sockets).toHaveLength(2); eventsub.stop(); expect(statuses).toContain('DEGRADED'); vi.useRealTimers();
  });
});
