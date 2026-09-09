import { createHash, randomBytes } from 'node:crypto';
import type { CalendarItem, TwitchState } from '../../../packages/contracts/src/index.js';

const API = 'https://api.twitch.tv/helix';
const AUTH = 'https://id.twitch.tv/oauth2';

type Credentials = { clientId: string; accessToken: string; refreshToken: string; broadcasterId: string; userName: string; displayName: string };
type PendingAuth = { state: string; verifier: string; clientId: string; redirectUri: string; expiresAt: number };

export class TwitchClient {
  private pending?: PendingAuth;
  private syncing = false;
  private error: string | null = null;
  constructor(private credentials: Credentials) {}

  get state(): TwitchState {
    return { connected: Boolean(this.credentials.accessToken && this.credentials.broadcasterId), userName: this.credentials.userName || null,
      displayName: this.credentials.displayName || null, error: this.error, syncing: this.syncing, lastSyncedAt: null };
  }

  startAuthorization(clientId: string, redirectUri: string) {
    if (!clientId.trim()) throw new Error('Renseignez l’identifiant client de votre application Twitch.');
    const verifier = randomBytes(48).toString('base64url');
    const state = randomBytes(24).toString('base64url');
    this.pending = { state, verifier, clientId: clientId.trim(), redirectUri, expiresAt: Date.now() + 10 * 60_000 };
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const query = new URLSearchParams({ client_id: clientId.trim(), redirect_uri: redirectUri, response_type: 'code',
      scope: 'channel:manage:schedule', state, code_challenge: challenge, code_challenge_method: 'S256' });
    return `${AUTH}/authorize?${query}`;
  }

  async finishAuthorization(code: string, state: string) {
    const pending = this.pending;
    this.pending = undefined;
    if (!pending || pending.expiresAt < Date.now() || state !== pending.state) throw new Error('Connexion Twitch expirée ou invalide. Recommencez.');
    const response = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({
      client_id: pending.clientId, code, grant_type: 'authorization_code', redirect_uri: pending.redirectUri, code_verifier: pending.verifier,
    }) });
    const token = await this.json<{ access_token: string; refresh_token?: string }>(response);
    this.credentials = { ...this.credentials, clientId: pending.clientId, accessToken: token.access_token, refreshToken: token.refresh_token ?? '' };
    const users = await this.api<{ data: Array<{ id: string; login: string; display_name: string }> }>('/users');
    const user = users.data[0];
    if (!user) throw new Error('Twitch n’a renvoyé aucun compte.');
    Object.assign(this.credentials, { broadcasterId: user.id, userName: user.login, displayName: user.display_name });
    this.error = null;
    return this.credentials;
  }

  disconnect() { this.credentials = { clientId: this.credentials.clientId, accessToken: '', refreshToken: '', broadcasterId: '', userName: '', displayName: '' }; this.error = null; }
  exportCredentials() { return { ...this.credentials }; }

  async sync(items: CalendarItem[]) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de synchroniser le planning.');
    this.syncing = true;
    try {
      const remote = await this.api<{ data: { segments: Array<{ id: string; title: string; start_time: string; end_time: string }> } }>(`/schedule?broadcaster_id=${this.credentials.broadcasterId}&first=25`);
      const byId = new Map(items.filter(x => x.twitchSegmentId).map(x => [x.twitchSegmentId, x]));
      const merged = [...items];
      for (const segment of remote.data.segments ?? []) {
        const existing = byId.get(segment.id);
        const value: CalendarItem = { id: existing?.id ?? `twitch:${segment.id}`, twitchSegmentId: segment.id, title: segment.title,
          startAtUtc: segment.start_time, endAtUtc: segment.end_time, category: 'live', source: 'TWITCH', ownership: existing?.ownership ?? 'EXTERNAL', editable: true, kind: 'LIVE', syncedAt: new Date().toISOString() };
        if (existing) Object.assign(existing, value); else merged.push(value);
      }
      for (const item of merged.filter(x => (x.category === 'live' || x.kind === 'LIVE') && !x.twitchSegmentId && x.ownership !== 'EXTERNAL')) {
        const duration = Math.min(1380, Math.max(30, Math.ceil((Date.parse(item.endAtUtc) - Date.parse(item.startAtUtc)) / 60000)));
        const result = await this.api<{ data: { segments: Array<{ id: string }> } }>('/schedule/segment', { method: 'POST', body: JSON.stringify({ start_time: item.startAtUtc, timezone: 'UTC', duration, title: item.title }) });
        item.twitchSegmentId = result.data.segments[0]?.id;
        item.source = 'TWITCH'; item.ownership = 'LOCAL'; item.syncedAt = new Date().toISOString();
      }
      this.error = null;
      return merged;
    } catch (error) { this.error = error instanceof Error ? error.message : String(error); throw error; }
    finally { this.syncing = false; }
  }

  async deleteSegment(id: string) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de modifier son planning.');
    await this.api(`/schedule/segment?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  private async api<T>(path: string, init?: RequestInit, mayRefresh = true): Promise<T> {
    const response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Client-Id': this.credentials.clientId, 'content-type': 'application/json', ...init?.headers } });
    if (response.status === 401 && mayRefresh && this.credentials.refreshToken) { await this.refresh(); return this.api(path, init, false); }
    return this.json<T>(response);
  }
  private async refresh() {
    const response = await fetch(`${AUTH}/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: this.credentials.refreshToken, client_id: this.credentials.clientId }) });
    const token = await this.json<{ access_token: string; refresh_token?: string }>(response);
    this.credentials.accessToken = token.access_token; this.credentials.refreshToken = token.refresh_token ?? this.credentials.refreshToken;
  }
  private async json<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const value = await response.json() as T & { message?: string };
    if (!response.ok) throw new Error(value.message ?? `Twitch HTTP ${response.status}`);
    return value;
  }
}
