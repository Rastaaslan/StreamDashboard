import WebSocket from 'ws';

const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30';

export interface TwitchRewardRedemption {
  id: string;
  broadcasterId: string;
  user: { id: string; login: string; displayName: string };
  reward: { id: string; title: string; prompt: string; cost: number };
  userInput: string;
  status: string;
  redeemedAt: string;
}

export interface TwitchChatMessage {
  id: string;
  broadcasterId: string;
  chatter: { id: string; login: string; displayName: string; color: string | null; badges: Array<{ setId: string; id: string; info: string }> };
  text: string;
  fragments: Array<{ type: string; text: string; emote?: { id: string; setId: string; ownerId: string; format: string[] } }>;
  reply: { parentMessageId: string; parentMessageBody: string; parentUserId: string; parentUserName: string } | null;
  bits: number | null;
  receivedAt: string;
}

export function parseRewardRedemptionNotification(value: unknown): TwitchRewardRedemption | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Record<string, any>;
  if (envelope.metadata?.message_type !== 'notification' || envelope.metadata?.subscription_type !== 'channel.channel_points_custom_reward_redemption.add') return null;
  const event = envelope.payload?.event;
  if (!event || typeof event.id !== 'string' || typeof event.user_id !== 'string' || typeof event.reward?.id !== 'string') return null;
  const redeemedAt = String(event.redeemed_at ?? '');
  if (!Number.isFinite(Date.parse(redeemedAt))) return null;
  return {
    id: event.id,
    broadcasterId: String(event.broadcaster_user_id ?? ''),
    user: { id: event.user_id, login: String(event.user_login ?? ''), displayName: String(event.user_name ?? event.user_login ?? '') },
    reward: { id: event.reward.id, title: String(event.reward.title ?? ''), prompt: String(event.reward.prompt ?? ''), cost: Number.isInteger(event.reward.cost) ? event.reward.cost : 0 },
    userInput: String(event.user_input ?? ''),
    status: String(event.status ?? 'unknown'),
    redeemedAt,
  };
}

export function parseChatNotification(value: unknown, receivedAt = new Date().toISOString()): TwitchChatMessage | null {
  if (!value || typeof value !== 'object') return null;
  const envelope = value as Record<string, any>;
  if (envelope.metadata?.message_type !== 'notification' || envelope.metadata?.subscription_type !== 'channel.chat.message') return null;
  const event = envelope.payload?.event;
  if (!event || typeof event.message_id !== 'string' || typeof event.chatter_user_id !== 'string') return null;
  return {
    id: event.message_id,
    broadcasterId: String(event.broadcaster_user_id ?? ''),
    chatter: {
      id: event.chatter_user_id,
      login: String(event.chatter_user_login ?? ''),
      displayName: String(event.chatter_user_name ?? event.chatter_user_login ?? ''),
      color: typeof event.color === 'string' && event.color ? event.color : null,
      badges: Array.isArray(event.badges) ? event.badges.map((badge: any) => ({ setId: String(badge.set_id ?? ''), id: String(badge.id ?? ''), info: String(badge.info ?? '') })) : [],
    },
    text: String(event.message?.text ?? ''),
    fragments: Array.isArray(event.message?.fragments) ? event.message.fragments.map((fragment: any) => ({ type: String(fragment.type ?? 'text'), text: String(fragment.text ?? ''), ...(fragment.emote ? { emote: { id: String(fragment.emote.id ?? ''), setId: String(fragment.emote.emote_set_id ?? ''), ownerId: String(fragment.emote.owner_id ?? ''), format: Array.isArray(fragment.emote.format) ? fragment.emote.format.map(String) : [] } } : {}) })) : [],
    reply: event.reply ? { parentMessageId: String(event.reply.parent_message_id ?? ''), parentMessageBody: String(event.reply.parent_message_body ?? ''), parentUserId: String(event.reply.parent_user_id ?? ''), parentUserName: String(event.reply.parent_user_name ?? '') } : null,
    bits: Number.isInteger(event.cheer?.bits) ? event.cheer.bits : null,
    receivedAt,
  };
}

export class TwitchEventSub {
  private socket?: WebSocket;
  private reconnectTimer?: NodeJS.Timeout;
  private watchdog?: NodeJS.Timeout;
  private reconnectAttempt = 0;
  private stopped = true;

  constructor(
    private readonly subscribe: (sessionId: string) => Promise<unknown>,
    private readonly onMessage: (message: TwitchChatMessage) => void,
    private readonly onStatus: (status: 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED', error?: string) => void,
    private readonly createSocket = (url: string) => new WebSocket(url),
    private readonly onRewardRedemption: (redemption: TwitchRewardRedemption) => void = () => undefined,
  ) {}

  start() { if (!this.stopped) return; this.stopped = false; this.connect(EVENTSUB_URL, true); }
  stop() { this.stopped = true; if (this.reconnectTimer) clearTimeout(this.reconnectTimer); if (this.watchdog) clearTimeout(this.watchdog); this.socket?.close(); this.socket = undefined; this.onStatus('DISCONNECTED'); }

  private connect(url: string, shouldSubscribe: boolean) {
    if (this.stopped) return;
    this.onStatus('CONNECTING');
    const socket = this.createSocket(url);
    this.socket = socket;
    socket.on('message', raw => {
      let value: any;
      try { value = JSON.parse(raw.toString()); } catch { return; }
      const type = value.metadata?.message_type;
      this.armWatchdog(socket, Number(value.payload?.session?.keepalive_timeout_seconds) || 30);
      if (type === 'session_welcome') {
        const sessionId = value.payload?.session?.id;
        if (shouldSubscribe && typeof sessionId === 'string') void this.subscribe(sessionId).then(() => { this.reconnectAttempt = 0; this.onStatus('CONNECTED'); }).catch(error => { this.onStatus('DEGRADED', error instanceof Error ? error.message : String(error)); socket.close(); });
        else { this.reconnectAttempt = 0; this.onStatus('CONNECTED'); }
        return;
      }
      if (type === 'session_reconnect' && typeof value.payload?.session?.reconnect_url === 'string') {
        this.connect(value.payload.session.reconnect_url, false);
        socket.close();
        return;
      }
      const message = parseChatNotification(value);
      if (message) this.onMessage(message);
      const redemption = parseRewardRedemptionNotification(value);
      if (redemption) this.onRewardRedemption(redemption);
    });
    socket.on('error', error => this.onStatus('DEGRADED', error.message));
    socket.on('close', () => {
      if (this.socket === socket) this.socket = undefined;
      if (this.watchdog) clearTimeout(this.watchdog);
      if (this.stopped || this.socket) return;
      this.onStatus('DEGRADED', 'Connexion Twitch EventSub interrompue.');
      const delay = Math.min(30_000, 1_000 * 2 ** this.reconnectAttempt++);
      this.reconnectTimer = setTimeout(() => this.connect(EVENTSUB_URL, true), delay);
      this.reconnectTimer.unref();
    });
  }

  private armWatchdog(socket: WebSocket, timeoutSeconds: number) { if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = setTimeout(() => { if (this.socket === socket) { this.onStatus('DEGRADED', 'Twitch EventSub keepalive expiré.'); socket.close(); } }, Math.max(10, timeoutSeconds + 10) * 1_000); this.watchdog.unref(); }
}
