import type { CalendarItem, TwitchState } from '../../../packages/contracts/src/index.js';

const API = 'https://api.twitch.tv/helix';
const AUTH = 'https://id.twitch.tv/oauth2';
const REQUIRED_SCOPE = 'channel:manage:schedule';

type Credentials = { clientId: string; accessToken: string; refreshToken: string; broadcasterId: string; userName: string; displayName: string };
type PendingDeviceAuthorization = { deviceCode: string; userCode: string; verificationUri: string; expiresAt: number; interval: number };
type PublicDeviceAuthorization = NonNullable<TwitchState['deviceAuthorization']>;

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

  constructor(private credentials: Credentials, private onTokensChanged: (tokens: Record<string, string> | null) => Promise<void> = async () => undefined) {}

  get state(): TwitchState {
    return {
      connected: Boolean(this.credentials.accessToken && this.credentials.broadcasterId),
      userName: this.credentials.userName || null,
      displayName: this.credentials.displayName || null,
      error: this.error,
      syncing: this.syncing,
      lastSyncedAt: null,
      deviceAuthorization: this.pending ? { userCode: this.pending.userCode, verificationUri: this.pending.verificationUri, expiresAt: new Date(this.pending.expiresAt).toISOString() } : null,
    };
  }

  async startDeviceAuthorization() {
    if (this.pending && Date.now() < this.pending.expiresAt) return this.state.deviceAuthorization!;
    if (this.deviceStartPromise) return this.deviceStartPromise;
    if (!this.credentials.clientId.trim()) throw new Error('Renseignez l’identifiant client public de StreamDashboard.');
    const generation = this.generation;
    this.deviceStartPromise = (async () => {
      const response = await fetch(`${AUTH}/device`, {
        method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.credentials.clientId, scopes: REQUIRED_SCOPE }),
      });
      const authorization = await this.json<{ device_code: string; user_code: string; verification_uri: string; expires_in: number; interval: number }>(response);
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

  private async pollDeviceAuthorization() {
    const generation = this.generation;
    try {
      while (this.pending && Date.now() < this.pending.expiresAt) {
        const pending = this.pending;
        await new Promise<void>(resolve => { this.pollWake = resolve; this.pollTimer = setTimeout(resolve, pending.interval * 1000); });
        this.pollTimer = undefined; this.pollWake = undefined;
        if (generation !== this.generation || this.pending !== pending) throw new Error('Connexion Twitch annulée.');
        if (Date.now() >= pending.expiresAt) { this.pending = undefined; this.error = 'Le code Twitch a expiré. Recommencez la connexion.'; throw new Error(this.error); }
        const response = await fetch(`${AUTH}/token`, {
          method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ client_id: this.credentials.clientId, device_code: pending.deviceCode, scopes: REQUIRED_SCOPE, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }),
        });
        const value = await response.json() as { access_token?: string; refresh_token?: string; message?: string };
        if (!response.ok) {
          const reason = value.message?.toLowerCase().replaceAll(' ', '_');
          if (reason === 'authorization_pending') continue;
          if (reason === 'slow_down') { pending.interval += 5; continue; }
          this.pending = undefined; this.error = value.message ?? `Twitch HTTP ${response.status}`; throw new Error(this.error);
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

  async disconnect() {
    this.generation++;
    this.cancelDeviceAuthorization();
    this.credentials = { clientId: this.credentials.clientId, accessToken: '', refreshToken: '', broadcasterId: '', userName: '', displayName: '' };
    this.error = null;
    await this.onTokensChanged(null);
  }
  cancelDeviceAuthorization() { this.pending = undefined; if (this.pollTimer) clearTimeout(this.pollTimer); this.pollTimer = undefined; this.pollWake?.(); this.pollWake = undefined; }
  exportTokens() { const { clientId: _clientId, ...tokens } = this.credentials; return tokens; }
  publicIdentity() { return { broadcasterId: this.credentials.broadcasterId, userName: this.credentials.userName, displayName: this.credentials.displayName }; }

  async validateSession() {
    const generation = this.generation;
    if (!this.credentials.accessToken) return false;
    let response = await fetch(`${AUTH}/validate`, { headers: { Authorization: `OAuth ${this.credentials.accessToken}` } });
    if (generation !== this.generation) return false;
    if (!response.ok && this.credentials.refreshToken) {
      try {
        await this.refreshSingleFlight();
        if (generation !== this.generation) return false;
        response = await fetch(`${AUTH}/validate`, { headers: { Authorization: `OAuth ${this.credentials.accessToken}` } });
      } catch {
        if (generation === this.generation) { await this.disconnect(); this.error = 'La session Twitch ne peut pas être renouvelée.'; }
        return false;
      }
    }
    if (generation !== this.generation) return false;
    if (!response.ok) { await this.disconnect(); this.error = 'La session Twitch a été révoquée ou a expiré.'; return false; }
    const value = await response.json() as { client_id?: string; user_id?: string; login?: string; scopes?: string[] };
    if (value.client_id !== this.credentials.clientId || (this.credentials.broadcasterId && value.user_id !== this.credentials.broadcasterId)) {
      await this.disconnect(); this.error = 'La session Twitch ne correspond plus à cette application.'; return false;
    }
    if (!Array.isArray(value.scopes) || !value.scopes.includes(REQUIRED_SCOPE)) {
      await this.disconnect(); this.error = 'La connexion Twitch ne possède pas l’autorisation de gérer le planning. Reconnectez le compte.'; return false;
    }
    return generation === this.generation;
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
      const segments: Array<{ id: string; title: string; start_time: string; end_time: string; is_recurring?: boolean }> = [];
      let cursor = '';
      do {
        let remote: { data: { segments: typeof segments }; pagination?: { cursor?: string } };
        try { remote = await this.api(`/schedule?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&first=25${cursor ? `&after=${encodeURIComponent(cursor)}` : ''}`); }
        catch (error) { if (error instanceof TwitchHttpError && error.status === 404) remote = { data: { segments: [] } }; else throw error; }
        if (generation !== this.generation) throw new Error('Synchronisation Twitch annulée.');
        segments.push(...(remote.data.segments ?? [])); cursor = remote.pagination?.cursor ?? '';
      } while (cursor);

      const byId = new Map(items.filter(x => x.twitchSegmentId).map(x => [x.twitchSegmentId, x]));
      const remoteIds = new Set(segments.map(segment => segment.id));
      const merged = items.filter(item => !(item.ownership === 'EXTERNAL' && item.twitchSegmentId && !remoteIds.has(item.twitchSegmentId)));
      const missingLocalIds = new Set<string>();
      for (const item of merged) {
        if (item.ownership === 'LOCAL' && item.twitchSegmentId && !remoteIds.has(item.twitchSegmentId)) {
          missingLocalIds.add(item.id);
          item.syncError = 'Segment absent du planning Twitch. Supprimez puis recréez ce live si vous souhaitez le republier.';
          delete item.twitchSegmentId;
        }
      }
      for (const segment of segments) {
        const existing = byId.get(segment.id);
        const value: CalendarItem = {
          id: existing?.id ?? `twitch:${segment.id}`, twitchSegmentId: segment.id, title: segment.title,
          startAtUtc: segment.start_time, endAtUtc: segment.end_time, category: 'live', source: 'TWITCH', ownership: existing?.ownership ?? 'EXTERNAL', editable: true, kind: 'LIVE',
          twitchRecurring: Boolean(segment.is_recurring), syncedAt: new Date().toISOString(),
        };
        if (existing) { delete existing.syncError; Object.assign(existing, value); }
        else merged.push(value);
      }
      for (const item of merged.filter(x => (x.category === 'live' || x.kind === 'LIVE') && !x.twitchSegmentId && x.ownership !== 'EXTERNAL' && !missingLocalIds.has(x.id) && !x.syncError)) {
        const start = Date.parse(item.startAtUtc), end = Date.parse(item.endAtUtc), duration = Math.ceil((end - start) / 60000);
        if (!item.title.trim() || item.title.length > 140 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || duration < 30 || duration > 1380) throw new Error(`Le live « ${item.title} » doit avoir un titre de 1 à 140 caractères et une durée de 30 à 1380 minutes.`);
        let result: { data: { segments: Array<{ id: string }> } };
        try {
          result = await this.api(`/schedule/segment?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}`, { method: 'POST', body: JSON.stringify({ start_time: item.startAtUtc, timezone: 'UTC', duration, title: item.title }) });
        } catch (error) {
          if (error instanceof TwitchHttpError && error.status === 403) throw new Error('Votre compte Twitch ne permet pas la création de segments de planning via l’API. Le planning local reste disponible.');
          throw error;
        }
        if (generation !== this.generation) throw new Error('Synchronisation Twitch annulée.');
        item.twitchSegmentId = result.data.segments[0]?.id;
        item.source = 'TWITCH'; item.ownership = 'LOCAL'; item.syncedAt = new Date().toISOString(); delete item.syncError;
      }
      if (generation !== this.generation) throw new Error('Synchronisation Twitch annulée.');
      this.error = null;
      return merged;
    } catch (error) {
      if (generation === this.generation) this.error = error instanceof Error ? error.message : String(error);
      throw error;
    } finally { this.syncing = false; }
  }

  async deleteSegment(id: string) {
    if (!this.state.connected) throw new Error('Connectez Twitch avant de modifier son planning.');
    await this.api(`/schedule/segment?broadcaster_id=${encodeURIComponent(this.credentials.broadcasterId)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' });
  }

  private async api<T>(path: string, init?: RequestInit): Promise<T> {
    const generation = this.generation;
    let response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Client-Id': this.credentials.clientId, 'content-type': 'application/json', ...init?.headers } });
    if (generation !== this.generation) throw new Error('Opération Twitch annulée.');
    if (response.status === 401) {
      if (!this.credentials.refreshToken) { await this.disconnect(); throw new Error('Session Twitch expirée. Reconnectez votre compte.'); }
      try { await this.refreshSingleFlight(); }
      catch (error) { if (generation === this.generation) await this.disconnect(); throw error; }
      if (generation !== this.generation) throw new Error('Opération Twitch annulée.');
      response = await fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${this.credentials.accessToken}`, 'Client-Id': this.credentials.clientId, 'content-type': 'application/json', ...init?.headers } });
      if (generation !== this.generation) throw new Error('Opération Twitch annulée.');
      if (response.status === 401) { await this.disconnect(); throw new Error('Session Twitch expirée. Reconnectez votre compte.'); }
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
    const response = await fetch(`${AUTH}/token`, {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken, client_id: this.credentials.clientId }),
    });
    const token = await this.json<{ access_token: string; refresh_token?: string }>(response);
    if (generation !== this.generation) throw new Error('Renouvellement Twitch annulé.');
    const next = { accessToken: token.access_token, refreshToken: token.refresh_token ?? refreshToken };
    await this.onTokensChanged(next);
    if (generation !== this.generation) throw new Error('Renouvellement Twitch annulé.');
    this.credentials.accessToken = next.accessToken; this.credentials.refreshToken = next.refreshToken;
  }

  private async persistTokens(generation = this.generation) {
    if (generation !== this.generation) throw new Error('Connexion Twitch annulée.');
    await this.onTokensChanged({ accessToken: this.credentials.accessToken, refreshToken: this.credentials.refreshToken });
    if (generation !== this.generation) throw new Error('Connexion Twitch annulée.');
  }

  private async json<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    let value: T & { message?: string };
    try { value = await response.json() as T & { message?: string }; }
    catch { throw new TwitchHttpError(response.status, `Twitch HTTP ${response.status}`); }
    if (!response.ok) throw new TwitchHttpError(response.status, value.message ?? `Twitch HTTP ${response.status}`);
    return value;
  }
}

class TwitchHttpError extends Error { constructor(readonly status: number, message: string) { super(message); } }
