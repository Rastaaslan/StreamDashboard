import type express from 'express';
import type { TwitchChatMessage } from '../../../integrations/twitch/src/eventsub.js';

export interface TwitchChatSnapshot {
  identity: { broadcasterId: string; userName: string | null; displayName: string | null };
  accountConnected: boolean;
  chat: { connected: boolean; messages: TwitchChatMessage[] };
  capabilities: { chatRead: boolean; chatWrite: boolean };
}

/** These routes share the application's existing authenticated device boundary. */
export function registerTwitchChatRoutes(options: {
  app: express.Application;
  state(): TwitchChatSnapshot;
  send(message: string, replyParentMessageId?: string): Promise<{ messageId: string }>;
}) {
  options.app.get('/api/v1/twitch/chat/state', (_req, res) => {
    const state = options.state();
    const canRead = state.accountConnected && state.capabilities.chatRead;
    res.setHeader('Cache-Control', 'no-store');
    res.json({
      identity: state.identity,
      accountConnected: state.accountConnected,
      chat: { connected: canRead && state.chat.connected, messages: canRead ? state.chat.messages.filter(message => message.broadcasterId === state.identity.broadcasterId).slice(-200) : [] },
      capabilities: { chatRead: canRead, chatWrite: state.accountConnected && state.capabilities.chatWrite },
    } satisfies TwitchChatSnapshot);
  });

  options.app.post('/api/v1/twitch/chat/messages', async (req, res, next) => {
    try {
      // The new composer binds a send to the identity it actually showed. Older
      // clients keep their existing contract when this optional field is absent.
      if (Object.prototype.hasOwnProperty.call(req.body ?? {}, 'expectedBroadcasterId')) {
        const state = options.state();
        const expected = req.body.expectedBroadcasterId;
        if (typeof expected !== 'string' || !expected || !state.accountConnected || expected !== state.identity.broadcasterId) {
          res.status(409).json({ error: { code: 'TWITCH_CHAT_ACCOUNT_CHANGED', message: 'Le compte Twitch a changé ou a été déconnecté. Actualisez le tchat avant de renvoyer votre message.' } });
          return;
        }
      }
      res.status(201).json(await options.send(String(req.body?.message ?? ''), typeof req.body?.replyParentMessageId === 'string' ? req.body.replyParentMessageId : undefined));
    } catch (error) { next(error); }
  });
}
