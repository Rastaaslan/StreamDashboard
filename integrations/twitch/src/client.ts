import type { CalendarItem, TwitchState } from '../../../packages/contracts/src/index.js';

const API = 'https://api.twitch.tv/helix';
const AUTH = 'https://id.twitch.tv/oauth2';
const SCHEDULE_SCOPE = 'channel:manage:schedule';
const BROADCAST_SCOPE = 'channel:manage:broadcast';
const CHAT_READ_SCOPE = 'user:read:chat';
const CHAT_WRITE_SCOPE = 'user:write:chat';
const CHATTERS_SCOPE = 'moderator:read:chatters';
const CLIPS_SCOPE = 'clips:edit';
const VIDEOS_SCOPE = 'channel:manage:videos';
const DELETE_CHAT_SCOPE = 'moderator:manage:chat_messages';
const BANS_SCOPE = 'moderator:manage:banned_users';
const REDEMPTIONS_SCOPE = 'channel:read:redemptions';
const REQUESTED_SCOPES = [SCHEDULE_SCOPE, BROADCAST_SCOPE, CHAT_READ_SCOPE, CHAT_WRITE_SCOPE, CHATTERS_SCOPE, CLIPS_SCOPE, VIDEOS_SCOPE, DELETE_CHAT_SCOPE, BANS_SCOPE, REDEMPTIONS_SCOPE] as const;
const REQUEST_TIMEOUT_MS = 15_000;

type Credentials = {
  clientId: string;
  accessToken: string;
  refreshToken: string;
  broadcasterId: string;
  userName: string;
  displayName: string;
};
type PendingDeviceAuthorization = {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
};
type PublicDeviceAuthorization = NonNullable<TwitchState['deviceAuthorization']>;
type ScheduleSegment = {
  id: string;
  title: string;
  start_time: string;
  end_time: string;
  is_recurring?: boolean;
  category?: { id?: string; name?: string } | null;
};

export interface TwitchLiveState { isLive: boolean; title: string | null; category: string | null; categoryId: string | null; startedAt: string | null; viewerCount: number | null; thumbnailUrl: string | null }
export interface TwitchVideo { id: string; title: string; description: string; createdAt: string; publishedAt: string; url: string; thumbnailUrl: string; viewCount: number; duration: string; type: 'archive' | 'highlight' | 'upload' }
export interface TwitchClip { id: string; title: string; url: string; embedUrl: string; broadcasterName: string; creatorName: string; createdAt: string; thumbnailUrl: string; duration: number; videoId: string | null; vodOffset: number | null; viewCount: number }
export interface TwitchChatter { id: string; login: string; displayName: string }

export class TwitchClient {
  private pending?: PendingDeviceAuthorization;
  private pollTimer?: ReturnType<typeof setTimeout>;
  private pollWake?: () => void;
  private syncing = false;
  private syncPromise?: Promise<CalendarItem[]>;
  private refreshPromise?: Promise<void>;
  private pollingPromise?: Promise<Credentials>;
  private deviceStartPromise?: Promise<PublicDeviceAuthorization>;
  private generation = 0;
  private error: string | null = null;
  private networkAbort = new AbortController();
  private grantedScopes = new Set<string>();

  constructor(
    private credentials: Credentials,
    private onTokensChanged: (tokens: Record<string, string> | null) => Promise<void> = async () => undefined,
  ) {}

  get state(): TwitchState {
    return {
      connected: Boolean(this.credentials.accessToken && this.credentials.broadcasterId),
      userName: this.credentials.userName || null,
      displayName: this.credentials.displayName || null,
      error: this.error,
      syncing: this.syncing,
      lastSyncedAt: null,
      redemptionsAvailable: this.grantedScopes.has(REDEMPTIONS_SCOPE),
      deviceAuthorization: this.pending ? {
        userCode: this.pending.userCode,
        verificationUri: this.pending.verificationUri,
        expiresAt: new Date(this.pending.expiresAt).toISOString(),
      } : null,
    };
  }

  async startDeviceAuthorization() {
    if (this.pending && Date.now() < this.pending.expiresAt) return this.state.deviceAuthorization!;
    if (this.deviceStartPromise) return this.deviceStartPromise;
    if (!this.credentials.clientId.trim()) throw new Error('Renseignez l’identifiant client public de StreamDashboard.');

    const generation = this.generation;
    this.deviceStartPromise = (async () => {
      const response = await this.request(`${AUTH}/device`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.credentials.clientId, scopes: REQUESTED_SCOPES.join(' ') }),
      });
      const authorization = await this.json<{
        device_code: string;
        user_code: string;
        verification_uri: string;
        expires_in: number;
        interval: number;
      }>(response);
      if (generation !== this.generation) throw new Error('Connexion Twitch annulée.');
      this.pending = {
        deviceCode: authorization.device_code,
        userCode: authorization.user_code,
        verificationUri: authorization.verification_uri,
        expiresAt: Date.now() + authorization.expires_in * 1000,
        interval: Math.max(1, authorization.interval),
      };
      this.error = null;
      return this.state.deviceAuthorization!;
    })().finally(() => { this.deviceStartPromise = undefined; });
    return this.deviceStartPromise;
  }

  async waitForDeviceAuthorization() {
    if (this.pollingPromise) return this.pollingPromise;
    this.pollingPromise = this.pollDeviceAuthorization().finally(() => { this.pollingPromise = undefined; });
    return this.pollingPromise;
  }

  async disconnect() {
    this.generation++;
    this.networkAbort.abort();
    this.networkAbort = new AbortController();
    this.cancelDeviceAuthorization();
    this.credentials = {
      clientId: this.credentials.clientId,
      accessToken: '',
      refreshToken: '',
      broadcasterId: '',
      userName: '',
      displayName: '',
    };
    this.grantedScopes.clear();
    this.error = null;
    await this.onTokensChanged(null);
  }

  close() {
    this.generation++;
    this.networkAbort.abort();
    this.cancelDeviceAuthorization();
  }

  cancelDeviceAuthorization() {
    this.pending = undefined;
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = undefined;
    this.pollWake?.();
    this.pollWake = undefined;
  }

  exportTokens() {
    const { clientId: _clientId, ...tokens } = this.credentials;
    return tokens;
  }

  publicIdentity() {
    return {
      broadcasterId: this.credentials.broadcasterId,
      userName: this.credentials.userName,
      displayName: this.credentials.displayName,
    };
  }

  async getLiveState(): Promise<TwitchLiveState> {
    this.requireConnected();
    const value = await this.api<{ data: Array<{ title: string; game_id: string; game_name: string; started_at: string; viewer_count: number; thumbnail_url: string }> }>(`/streams?user_id=${encodeURIComponent(this.credentials.broadcasterId)}&first=1`);
    const stream = value.data[0];
    if (!stream) return { isLive: false, title: null, category: null, categoryId: null, startedAt: null, viewerCount: null, thumbnailUrl: null };
    return { isLive: true, title: stream.title, category: stream.game_name, categoryId: stream.game_id, startedAt: stream.started_at, viewerCount: stream.viewer_count, thumbnailUrl: stream.thumbnail_url };
  }

  async videos(after = '', first = 20) {
    this.requireConnected();
    const query = `/videos?user_id=${encodeURIComponent(this.credentials.broadcasterId)}&first=${Math.min(50, Math.max(1, first))}${after ? `&after=${encodeURIComponent(after)}` : ''}`;
    const value = await this.api<{ data: Array<{ id: string; title: string; description: string; created_at: string; published_at: string; url: string; thumbnail_url: string; view_count: number; duration: string; type: TwitchVideo['type'] }>; pagination?: { cursor?: string } }>(query);
    return { items: value.data.map(video => ({ id: video.id, title: video.title, description: video.description, createdAt: video.created_at, publishedAt: video.published_at, url: video.url, thumbnailUrl: video.thumbnail_url, viewCount: video.view_count, duration: video.duration, type: video.type })), cursor: value.pagination?.cursor ?? null };
  }

  async deleteVideo(id: string) {
    if (!/^\d{1,30}$/.test(id)) throw new Error('Identifiant VOD invalide.');
    await this.api(`/videos?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async clips(after = '', first = 20) {
    this.requireConnected();
    const value = await this.api<{ data: Array<{ id: string; title: string; url: string; embed_url: string; broadcaster_name: string; creator_name: string; created_at: string; thumbnail_url: string; duration: number; video_id: string; vod_offset: number | null; view_count: number }>; pagination?: { cursor?: string } }>(`/clips?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&first=${Math.min(50, Math.max(1, first))}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    return { items: value.data.map(clip => ({ id: clip.id, title: clip.title, url: clip.url, embedUrl: clip.embed_url, broadcasterName: clip.broadcaster_name, creatorName: clip.creator_name, createdAt: clip.created_at, thumbnailUrl: clip.thumbnail_url, duration: clip.duration, videoId: clip.video_id || null, vodOffset: clip.vod_offset, viewCount: clip.view_count })), cursor: value.pagination?.cursor ?? null };
  }

  async createClip() {
    this.requireConnected();
    this.requireScope(CLIPS_SCOPE);
    const value = await this.api<{ data: Array<{ id: string; edit_url: string }> }>(`/clips?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}`, { method: 'POST' });
    const clip = value.data[0];
    if (!clip) throw new Error('Twitch n’a renvoyé aucun clip.');
    return { id: clip.id, editUrl: clip.edit_url };
  }

  async chatters(after = '', first = 100) {
    this.requireConnected();
    this.requireScope(CHATTERS_SCOPE);
    const value = await this.api<{ data: Array<{ user_id: string; user_login: string; user_name: string }>; pagination?: { cursor?: string }; total?: number }>(`/chat/chatters?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&moderator_id=${encodeURIComponent(this.credentials.broadcasterId)}&first=${Math.min(1_000, Math.max(1, first))}${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    return { items: value.data.map(user => ({ id: user.user_id, login: user.user_login, displayName: user.user_name })), total: value.total ?? value.data.length, cursor: value.pagination?.cursor ?? null };
  }

  async sendChatMessage(message: string, replyParentMessageId?: string) {
    this.requireConnected();
    this.requireScope(CHAT_WRITE_SCOPE);
    const normalized = message.trim();
    if (!normalized || normalized.length > 500) throw new Error('Le message Twitch doit contenir entre 1 et 500 caractères.');
    const value = await this.api<{ data: Array<{ message_id: string; is_sent: boolean; drop_reason?: { code: string; message: string } }> }>('/chat/messages', { method: 'POST', body: JSON.stringify({ broadcaster_id: this.credentials.broadcasterId, sender_id: this.credentials.broadcasterId, message: normalized, ...(replyParentMessageId ? { reply_parent_message_id: replyParentMessageId } : {}) }) });
    const result = value.data[0];
    if (!result?.is_sent) throw new Error(result?.drop_reason?.message ?? 'Twitch a refusé le message.');
    return { messageId: result.message_id };
  }

  controlCapabilities() {
    return {
      chatRead: this.grantedScopes.has(CHAT_READ_SCOPE),
      chatWrite: this.grantedScopes.has(CHAT_WRITE_SCOPE),
      chatters: this.grantedScopes.has(CHATTERS_SCOPE),
      createClip: this.grantedScopes.has(CLIPS_SCOPE),
      deleteVideo: this.grantedScopes.has(VIDEOS_SCOPE),
      updateChannel: this.grantedScopes.has(BROADCAST_SCOPE),
      schedule: this.grantedScopes.has(SCHEDULE_SCOPE),
      redemptions: this.grantedScopes.has(REDEMPTIONS_SCOPE),
      deleteMessage: this.grantedScopes.has(DELETE_CHAT_SCOPE),
      timeout: this.grantedScopes.has(BANS_SCOPE),
      ban: this.grantedScopes.has(BANS_SCOPE),
      unban: this.grantedScopes.has(BANS_SCOPE),
      requiredScopes: {
        chatRead: CHAT_READ_SCOPE,
        chatWrite: CHAT_WRITE_SCOPE,
        chatters: CHATTERS_SCOPE,
        createClip: CLIPS_SCOPE,
        deleteVideo: VIDEOS_SCOPE,
        updateChannel: BROADCAST_SCOPE,
        schedule: SCHEDULE_SCOPE,
        redemptions: REDEMPTIONS_SCOPE,
        deleteMessage: DELETE_CHAT_SCOPE,
        timeout: BANS_SCOPE,
        ban: BANS_SCOPE,
        unban: BANS_SCOPE,
      },
    };
  }

  moderationCapabilities() {
    const capabilities = this.controlCapabilities();
    return {
      deleteMessage: capabilities.deleteMessage,
      timeout: capabilities.timeout,
      ban: capabilities.ban,
      unban: capabilities.unban,
      requiredScopes: {
        deleteMessage: DELETE_CHAT_SCOPE,
        timeout: BANS_SCOPE,
        ban: BANS_SCOPE,
        unban: BANS_SCOPE,
      },
    };
  }

  async deleteChatMessage(messageId: string) {
    this.requireScope(DELETE_CHAT_SCOPE);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(messageId)) throw new Error('Identifiant de message invalide.');
    await this.api(`/moderation/chat?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&moderator_id=${encodeURIComponent(this.credentials.broadcasterId)}&message_id=${encodeURIComponent(messageId)}`, { method: 'DELETE' });
  }

  async banUser(userId: string, options: { duration?: number; reason?: string } = {}) {
    this.requireScope(BANS_SCOPE);
    if (!/^\d{1,30}$/.test(userId)) throw new Error('Utilisateur Twitch invalide.');
    if (options.duration !== undefined && (!Number.isInteger(options.duration) || options.duration < 1 || options.duration > 1_209_600)) throw new Error('Durée de timeout invalide.');
    const reason = options.reason?.trim(); if (reason && reason.length > 500) throw new Error('Raison de modération trop longue.');
    await this.api(`/moderation/bans?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&moderator_id=${encodeURIComponent(this.credentials.broadcasterId)}`, { method: 'POST', body: JSON.stringify({ data: { user_id: userId, ...(options.duration ? { duration: options.duration } : {}), ...(reason ? { reason } : {}) } }) });
  }

  async unbanUser(userId: string) {
    this.requireScope(BANS_SCOPE);
    if (!/^\d{1,30}$/.test(userId)) throw new Error('Utilisateur Twitch invalide.');
    await this.api(`/moderation/bans?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&moderator_id=${encodeURIComponent(this.credentials.broadcasterId)}&user_id=${encodeURIComponent(userId)}`, { method: 'DELETE' });
  }

  async subscribeChat(sessionId: string) {
    this.requireScope(CHAT_READ_SCOPE);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) throw new Error('Session EventSub invalide.');
    return this.api('/eventsub/subscriptions', { method: 'POST', body: JSON.stringify({ type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: this.credentials.broadcasterId, user_id: this.credentials.broadcasterId }, transport: { method: 'websocket', session_id: sessionId } }) });
  }

  async subscribeRewardRedemptions(sessionId: string) {
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(sessionId)) throw new Error('Session EventSub invalide.');
    this.requireScope(REDEMPTIONS_SCOPE);
    return this.api('/eventsub/subscriptions', { method: 'POST', body: JSON.stringify({ type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: this.credentials.broadcasterId }, transport: { method: 'websocket', session_id: sessionId } }) });
  }

  async subscribeEventSub(sessionId: string) {
    await this.subscribeChat(sessionId);
    if (this.grantedScopes.has(REDEMPTIONS_SCOPE)) await this.subscribeRewardRedemptions(sessionId);
  }

  async customRewards() {
    this.requireScope(REDEMPTIONS_SCOPE);
    const value = await this.api<{ data: Array<{ id: string; title: string; prompt: string; cost: number; is_enabled: boolean; is_paused: boolean; is_in_stock: boolean; is_user_input_required: boolean }> }>(`/channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}`);
    return (value.data ?? []).map(reward => ({ id: reward.id, title: reward.title, prompt: reward.prompt, cost: reward.cost, enabled: reward.is_enabled, paused: reward.is_paused, inStock: reward.is_in_stock, userInputRequired: reward.is_user_input_required }));
  }

  async validateSession() {
    const generation = this.generation;
    if (!this.credentials.accessToken) return false;

    let response = await this.request(`${AUTH}/validate`, {
      headers: { Authorization: `OAuth ${this.credentials.accessToken}` },
    });
    if (generation !== this.generation) return false;

    if (!response.ok && this.credentials.refreshToken) {
      try {
        await this.refreshSingleFlight();
        if (generation !== this.generation) return false;
        response = await this.request(`${AUTH}/validate`, {
          headers: { Authorization: `OAuth ${this.credentials.accessToken}` },
        });
      } catch {
        if (generation === this.generation) {
          await this.disconnect();
          this.error = 'La session Twitch ne peut pas être renouvelée.';
        }
        return false;
      }
    }

    if (generation !== this.generation) return false;
    if (!response.ok) {
      await this.disconnect();
      this.error = 'La session Twitch a été révoquée ou a expiré.';
      return false;
    }

    const value = await response.json() as { client_id?: string; user_id?: string; login?: string; scopes?: string[] };
    if (value.client_id !== this.credentials.clientId || (this.credentials.broadcasterId && value.user_id !== this.credentials.broadcasterId)) {
      await this.disconnect();
      this.error = 'La session Twitch ne correspond plus à cette application.';
      return false;
    }
    // Existing schedule-only credentials remain useful for planning. The preflight
    // itself gives a targeted reconnect message when broadcast scope is missing.
    if (!Array.isArray(value.scopes) || !value.scopes.includes(SCHEDULE_SCOPE)) {
      await this.disconnect();
      this.error = 'La connexion Twitch ne possède pas l’autorisation de gérer le planning. Reconnectez le compte.';
      return false;
    }
    this.grantedScopes = new Set(value.scopes);
    return generation === this.generation;
  }

  async getChannelMetadata() {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de préparer le live.');
    const value = await this.api<{ data: Array<{ title: string; game_id: string; game_name?: string }> }>(`/channels?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}`);
    const channel = value.data[0];
    if (!channel) throw new Error('Twitch n’a renvoyé aucune information de chaîne.');
    return { title: channel.title, gameId: channel.game_id, gameName: channel.game_name ?? '' };
  }

  async searchGames(query: string) {
    const value = await this.api<{ data: Array<{ id: string; name: string; box_art_url?: string }> }>(`/search/categories?query=${encodeURIComponent(query)}&first=20`);
    return value.data ?? [];
  }

  async updateChannelMetadata(value: { title: string; gameId: string }) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de préparer le live.');
    this.requireScope(BROADCAST_SCOPE);
    try {
      await this.api(`/channels?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}`, {
        method: 'PATCH',
        body: JSON.stringify({ title: value.title, game_id: value.gameId }),
      });
    } catch (error) {
      if (error instanceof TwitchHttpError && (error.status === 401 || error.status === 403)) {
        throw new Error(`Préparation Twitch refusée. Reconnectez Twitch pour accorder ${BROADCAST_SCOPE}.`);
      }
      throw error;
    }
  }

  async createSegment(item: CalendarItem) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de modifier son planning.');
    this.validateScheduleItem(item);
    const exact = (await this.scheduleSegments()).filter(segment => this.sameIdentity(item, segment) && this.sameCategory(item, segment));
    if (exact.length > 1) throw new Error('Plusieurs segments Twitch identiques existent déjà. Synchronisez puis choisissez explicitement celui à conserver.');
    if (exact.length === 1) return { id: exact[0]!.id };
    return this.createSegmentUnchecked(item);
  }

  async updateSegment(id: string, item: CalendarItem) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de modifier son planning.');
    const duration = this.validateScheduleItem(item);
    await this.api(`/schedule/segment?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&id=${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        start_time: item.startAtUtc,
        timezone: 'UTC',
        duration,
        title: item.title,
        ...(item.twitchCategoryId ? { category_id: item.twitchCategoryId } : {}),
      }),
    });
  }

  async deleteSegment(id: string) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de modifier son planning.');
    await this.api(`/schedule/segment?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  async sync(items: CalendarItem[]) {
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.performSync(items).finally(() => { this.syncPromise = undefined; });
    return this.syncPromise;
  }

  private async performSync(items: CalendarItem[]) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de synchroniser le planning.');
    const generation = this.generation;
    this.syncing = true;
    try {
      const segments = await this.scheduleSegments();
      if (generation !== this.generation) throw new Error('Synchronisation Twitch annulée.');

      const linkedByRemoteId = new Map<string, CalendarItem>();
      for (const item of items) {
        const remoteId = item.providers?.twitch?.remoteId ?? item.twitchSegmentId;
        if (remoteId) linkedByRemoteId.set(remoteId, item);
      }
      const remoteIds = new Set(segments.map(segment => segment.id));
      const merged = items.filter(item => {
        const remoteId = item.providers?.twitch?.remoteId ?? item.twitchSegmentId;
        return !(item.ownership === 'EXTERNAL' && remoteId && !remoteIds.has(remoteId));
      });
      const missingLocalIds = new Set<string>();

      for (const item of merged) {
        const remoteId = item.providers?.twitch?.remoteId ?? item.twitchSegmentId;
        if (item.ownership !== 'LOCAL' || !remoteId || remoteIds.has(remoteId)) continue;
        missingLocalIds.add(item.id);
        item.syncError = 'Segment absent du planning Twitch. Utilisez le retry explicite pour le republier.';
        item.providers ??= {};
        const link = item.providers.twitch ??= { status: 'error' };
        link.status = 'error';
        link.deletedRemotely = true;
        link.lastError = item.syncError;
        delete link.remoteId;
        delete link.remoteRevision;
        delete item.twitchSegmentId;
      }

      for (const segment of segments) {
        const existingById = linkedByRemoteId.get(segment.id);
        const recoveredLocal = existingById ?? merged.find(item =>
          item.ownership !== 'EXTERNAL'
          && item.desiredPublication?.twitch === true
          && !item.providers?.twitch?.remoteId
          && !item.twitchSegmentId
          && !item.syncError
          && this.sameIdentity(item, segment)
          && this.sameCategory(item, segment));
        const syncedAt = new Date().toISOString();

        if (existingById?.ownership === 'LOCAL' && !this.sameContent(existingById, segment)) {
          existingById.providers ??= {};
          existingById.providers.twitch = {
            ...(existingById.providers.twitch ?? {}),
            status: 'conflict',
            remoteId: segment.id,
            lastError: 'Conflit avec une modification Twitch distante.',
            lastSyncedAt: syncedAt,
          };
          existingById.conflict = {
            provider: 'twitch',
            detectedAt: syncedAt,
            remote: {
              title: segment.title,
              startAtUtc: segment.start_time,
              endAtUtc: segment.end_time,
              twitchCategoryId: segment.category?.id,
              twitchCategoryName: segment.category?.name,
            },
          };
          continue;
        }

        const value: CalendarItem = {
          id: recoveredLocal?.id ?? `twitch:${segment.id}`,
          localId: recoveredLocal?.localId ?? recoveredLocal?.id ?? `twitch:${segment.id}`,
          twitchSegmentId: segment.id,
          title: segment.title,
          startAtUtc: segment.start_time,
          endAtUtc: segment.end_time,
          category: 'live',
          source: 'TWITCH',
          ownership: recoveredLocal ? 'LOCAL' : 'EXTERNAL',
          editable: true,
          kind: 'LIVE',
          external: !recoveredLocal,
          twitchRecurring: Boolean(segment.is_recurring),
          twitchCategoryId: segment.category?.id ?? recoveredLocal?.twitchCategoryId,
          twitchCategoryName: segment.category?.name ?? recoveredLocal?.twitchCategoryName,
          syncedAt,
          desiredPublication: recoveredLocal?.desiredPublication ?? { local: true, twitch: true, google: false },
          providers: {
            ...(recoveredLocal?.providers ?? {}),
            twitch: { status: 'synced', remoteId: segment.id, lastSyncedAt: syncedAt, deletedRemotely: false },
          },
        };
        if (recoveredLocal) {
          delete recoveredLocal.syncError;
          delete recoveredLocal.conflict;
          Object.assign(recoveredLocal, value);
        } else {
          merged.push(value);
        }
      }

      for (const item of merged.filter(item =>
        (item.category === 'live' || item.kind === 'LIVE')
        && item.desiredPublication?.twitch === true
        && !item.twitchSegmentId
        && !item.providers?.twitch?.remoteId
        && item.ownership !== 'EXTERNAL'
        && !missingLocalIds.has(item.id)
        && !item.syncError)) {
        const created = await this.createSegmentUnchecked(item);
        if (generation !== this.generation) throw new Error('Synchronisation Twitch annulée.');
        const syncedAt = new Date().toISOString();
        item.twitchSegmentId = created.id;
        item.source = 'TWITCH';
        item.ownership = 'LOCAL';
        item.syncedAt = syncedAt;
        delete item.syncError;
        item.providers ??= {};
        item.providers.twitch = { status: 'synced', remoteId: created.id, lastSyncedAt: syncedAt, deletedRemotely: false };
      }

      if (generation !== this.generation) throw new Error('Synchronisation Twitch annulée.');
      this.error = null;
      return merged;
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally {
      this.syncing = false;
    }
  }

  private async pollDeviceAuthorization() {
    const generation = this.generation;
    try {
      while (this.pending && Date.now() < this.pending.expiresAt) {
        const pending = this.pending;
        await new Promise<void>(resolve => {
          this.pollWake = resolve;
          this.pollTimer = setTimeout(resolve, pending.interval * 1000);
        });
        this.pollTimer = undefined;
        this.pollWake = undefined;
        if (generation !== this.generation || this.pending !== pending) throw new Error('Connexion Twitch annulée.');
        if (Date.now() >= pending.expiresAt) {
          this.pending = undefined;
          this.error = 'Le code Twitch a expiré. Recommencez la connexion.';
          throw new Error(this.error);
        }

        const response = await this.request(`${AUTH}/token`, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({
            client_id: this.credentials.clientId,
            device_code: pending.deviceCode,
            scopes: REQUESTED_SCOPES.join(' '),
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });
        const value = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; message?: string };
        if (!response.ok) {
          const reason = value.message?.toLowerCase().replaceAll(' ', '_');
          if (reason === 'authorization_pending') continue;
          if (reason === 'slow_down') { pending.interval += 5; continue; }
          this.pending = undefined;
          this.error = value.message ?? `Twitch HTTP ${response.status}`;
          throw new Error(this.error);
        }
        if (!value.access_token) throw new Error('Twitch n’a renvoyé aucun jeton utilisateur.');
        if (generation !== this.generation) throw new Error('Connexion Twitch annulée.');

        this.pending = undefined;
        this.credentials = { ...this.credentials, accessToken: value.access_token, refreshToken: value.refresh_token ?? '' };
        await this.loadUser();
        if (generation !== this.generation) throw new Error('Connexion Twitch annulée.');
        await this.persistTokens(generation);
        return this.credentials;
      }
      this.pending = undefined;
      this.error = 'Le code Twitch a expiré. Recommencez la connexion.';
      throw new Error(this.error);
    } catch (error) {
      if (generation === this.generation) {
        this.pending = undefined;
        this.error = error instanceof Error ? error.message : String(error);
      }
      throw error;
    }
  }

  private async loadUser() {
    const users = await this.api<{ data: Array<{ id: string; login: string; display_name: string }> }>('/users');
    const user = users.data[0];
    if (!user) throw new Error('Twitch n’a renvoyé aucun compte.');
    Object.assign(this.credentials, { broadcasterId: user.id, userName: user.login, displayName: user.display_name });
    this.error = null;
  }

  private validateScheduleItem(item: CalendarItem) {
    const start = Date.parse(item.startAtUtc);
    const end = Date.parse(item.endAtUtc);
    const duration = Math.ceil((end - start) / 60_000);
    if (!item.title.trim() || item.title.length > 140 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || duration < 30 || duration > 1380) {
      throw new Error(`Le live « ${item.title} » doit avoir un titre de 1 à 140 caractères et une durée de 30 à 1380 minutes.`);
    }
    return duration;
  }

  private requireConnected() {
    if (!this.state.connected) throw new Error('Connectez Twitch avant cette action.');
  }
  private requireScope(scope: string) { this.requireConnected(); if (!this.grantedScopes.has(scope)) { const error = new Error(`Autorisation Twitch requise : ${scope}. Reconnectez le compte.`); error.name = 'TWITCH_NOT_AUTHORIZED'; Object.assign(error, { requiredScope: scope }); throw error; } }

  private sameIdentity(item: CalendarItem, segment: ScheduleSegment) {
    return item.title === segment.title
      && Date.parse(item.startAtUtc) === Date.parse(segment.start_time)
      && Date.parse(item.endAtUtc) === Date.parse(segment.end_time);
  }

  private sameCategory(item: CalendarItem, segment: ScheduleSegment) {
    return !item.twitchCategoryId || item.twitchCategoryId === segment.category?.id;
  }

  private sameContent(item: CalendarItem, segment: ScheduleSegment) {
    return this.sameIdentity(item, segment) && this.sameCategory(item, segment);
  }

  private async scheduleSegments() {
    const segments: ScheduleSegment[] = [];
    let cursor = '';
    do {
      let remote: { data: { segments: ScheduleSegment[] }; pagination?: { cursor?: string } };
      try {
        remote = await this.api(`/schedule?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&first=25${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`);
      } catch (error) {
        if (error instanceof TwitchHttpError && error.status === 404) remote = { data: { segments: [] } };
        else throw error;
      }
      segments.push(...(remote.data.segments ?? []));
      cursor = remote.pagination?.cursor ?? '';
    } while (cursor);
    return segments;
  }

  private async createSegmentUnchecked(item: CalendarItem) {
    const duration = this.validateScheduleItem(item);
    try {
      const result = await this.api<{ data: { segments: Array<{ id: string }> } }>(`/schedule/segment?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}`, {
        method: 'POST',
        body: JSON.stringify({
          start_time: item.startAtUtc,
          timezone: 'UTC',
          duration,
          title: item.title,
          ...(item.twitchCategoryId ? { category_id: item.twitchCategoryId } : {}),
        }),
      });
      const id = result.data.segments[0]?.id;
      if (!id) throw new Error('Twitch a accepté la création mais n’a renvoyé aucun identifiant de segment.');
      return { id };
    } catch (error) {
      if (error instanceof TwitchHttpError && error.status === 403) {
        throw new Error('Votre compte Twitch ne permet pas la création de segments de planning via l’API. Le planning local reste disponible.');
      }
      throw error;
    }
  }

  private async request(url: string, init: RequestInit = {}) {
    const signal = init.signal ?? AbortSignal.any([this.networkAbort.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
    try {
      return await fetch(url, { ...init, signal });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || /timed?\s*out/i.test(error.message))) {
        throw new Error('Twitch ne répond pas dans le délai attendu. Réessayez.');
      }
      if (this.networkAbort.signal.aborted) throw new Error('Opération Twitch annulée.');
      throw error;
    }
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const generation = this.generation;
    let response = await this.request(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.credentials.accessToken}`,
        'Client-Id': this.credentials.clientId,
        'content-type': 'application/json',
        ...init?.headers,
      },
    });
    if (generation !== this.generation) throw new Error('Opération Twitch annulée.');

    if (response.status === 401) {
      if (!this.credentials.refreshToken) {
        await this.disconnect();
        throw new Error('Session Twitch expirée. Reconnectez votre compte.');
      }
      try {
        await this.refreshSingleFlight();
      } catch (error) {
        if (generation === this.generation) await this.disconnect();
        throw error;
      }
      if (generation !== this.generation) throw new Error('Opération Twitch annulée.');
      response = await this.request(`${API}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.credentials.accessToken}`,
          'Client-Id': this.credentials.clientId,
          'content-type': 'application/json',
          ...init?.headers,
        },
      });
      if (generation !== this.generation) throw new Error('Opération Twitch annulée.');
      if (response.status === 401) {
        await this.disconnect();
        throw new Error('Session Twitch expirée. Reconnectez votre compte.');
      }
    }
    return this.json<T>(response);
  }

  private async refreshSingleFlight() {
    if (!this.refreshPromise) this.refreshPromise = this.refresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  private async refresh() {
    const generation = this.generation;
    const refreshToken = this.credentials.refreshToken;
    if (!refreshToken) throw new Error('Aucun refresh token Twitch disponible.');
    const response = await this.request(`${AUTH}/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.credentials.clientId }),
    });
    const token = await this.json<{ access_token: string; refresh_token?: string }>(response);
    if (generation !== this.generation) throw new Error('Renouvellement Twitch annulé.');
    const next = { accessToken: token.access_token, refreshToken: token.refresh_token ?? refreshToken };
    await this.onTokensChanged(next);
    if (generation !== this.generation) throw new Error('Renouvellement Twitch annulé.');
    this.credentials.accessToken = next.accessToken;
    this.credentials.refreshToken = next.refreshToken;
  }

  private async persistTokens(generation = this.generation) {
    if (generation !== this.generation) throw new Error('Connexion Twitch annulée.');
    await this.onTokensChanged({ accessToken: this.credentials.accessToken, refreshToken: this.credentials.refreshToken });
    if (generation !== this.generation) throw new Error('Connexion Twitch annulée.');
  }

  private async json<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    let value: T & { message?: string };
    try {
      value = await response.json() as T & { message?: string };
    } catch {
      throw new TwitchHttpError(response.status, `Twitch HTTP ${response.status}`);
    }
    if (!response.ok) throw new TwitchHttpError(response.status, value.message ?? `Twitch HTTP ${response.status}`);
    return value;
  }
}

class TwitchHttpError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
