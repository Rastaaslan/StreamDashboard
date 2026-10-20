import express from 'express';
import { createServer, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerTwitchChatRoutes, type TwitchChatSnapshot } from '../apps/server/src/twitch-chat-routes.js';

describe('authenticated Twitch chat routes', () => {
  let server: Server, origin: string, state: TwitchChatSnapshot;
  const send = vi.fn(async (_message: string, _reply?: string) => ({ messageId: 'message-confirmed' }));
  beforeEach(async () => {
    send.mockReset();send.mockResolvedValue({ messageId: 'message-confirmed' });
    state = {
      identity: { broadcasterId: '123', userName: 'creator', displayName: 'Creator' },
      accountConnected: true,
      capabilities: { chatRead: true, chatWrite: true },
      chat: { connected: true, messages: [{ id: 'one', broadcasterId: '123', chatter: { id: '456', login: 'viewer', displayName: 'Viewer', color: null, badges: [] }, text: 'Bonjour', fragments: [], reply: null, bits: null, receivedAt: new Date().toISOString() }] },
    };
    const app = express();app.use(express.json());
    registerTwitchChatRoutes({ app, state: () => state, send });
    app.use((error: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => { res.status(409).json({ error: { code: error.name, message: error.message } }); });
    server = createServer(app);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  });
  afterEach(async () => { server.closeAllConnections();await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  const post = (body: unknown) => fetch(origin + '/api/v1/twitch/chat/messages', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

  it('exposes the current identity and authorized feed without caching it', async () => {
    state.chat.messages.push({ ...state.chat.messages[0], id: 'old-account', broadcasterId: '999' });
    const response = await fetch(origin + '/api/v1/twitch/chat/state');
    const body = await response.json();
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(body.identity).toEqual(state.identity);
    expect(body.chat.messages.map((message: { id: string }) => message.id)).toEqual(['one']);
    expect(body.capabilities).toEqual({ chatRead: true, chatWrite: true });
  });

  it('does not expose buffered messages after disconnect or lost read permission', async () => {
    state.accountConnected = false;
    let body = await (await fetch(origin + '/api/v1/twitch/chat/state')).json();
    expect(body.chat).toEqual({ connected: false, messages: [] });
    expect(body.capabilities).toEqual({ chatRead: false, chatWrite: false });
    state.accountConnected = true;state.capabilities.chatRead = false;
    body = await (await fetch(origin + '/api/v1/twitch/chat/state')).json();
    expect(body.chat).toEqual({ connected: false, messages: [] });
    expect(body.capabilities.chatWrite).toBe(true);
  });

  it.each(['999', '', null, 123])('refuses an obsolete or invalid identity %s before sending', async expectedBroadcasterId => {
    const response = await post({ message: 'Bonjour', expectedBroadcasterId });
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe('TWITCH_CHAT_ACCOUNT_CHANGED');
    expect(send).not.toHaveBeenCalled();
  });

  it('refuses a disconnected account even if its stored ID still matches', async () => {
    state.accountConnected = false;
    expect((await post({ message: 'Bonjour', expectedBroadcasterId: '123' })).status).toBe(409);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends once for the displayed identity and returns the confirmed message ID', async () => {
    const response = await post({ message: 'Bonjour', replyParentMessageId: 'parent', expectedBroadcasterId: '123' });
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ messageId: 'message-confirmed' });
    expect(send).toHaveBeenCalledExactlyOnceWith('Bonjour', 'parent');
  });

  it('retains the legacy send contract without silently retrying an uncertain result', async () => {
    send.mockRejectedValueOnce(Object.assign(new Error('Envoi non confirmé'), { name: 'ACTION_UNCERTAIN' }));
    const response = await post({ message: 'Bonjour' });
    expect((await response.json()).error.code).toBe('ACTION_UNCERTAIN');
    expect(send).toHaveBeenCalledExactlyOnceWith('Bonjour', undefined);
  });
});
