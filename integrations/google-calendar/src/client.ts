import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPE = 'https://www.googleapis.com/auth/calendar';
const TIMEOUT = 15_000;

export interface GoogleTokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface GoogleOAuthAttempt { authorizationUrl: string; state: string; verifier: string; redirectUri: string }
export interface GoogleEventInput { localId: string; title: string; description?: string; startAtUtc: string; endAtUtc: string }
export interface GoogleEvent extends GoogleEventInput { id: string; etag?: string; editable: boolean; deleted?: boolean; managed: boolean }

const base64url = (value: Buffer) => value.toString('base64url');
const allDayUtc = (value: string) => `${value}T00:00:00.000Z`;
export function createGoogleOAuthAttempt(clientId: string, redirectUri: string): GoogleOAuthAttempt {
  if (!clientId.trim()) throw new Error('Identifiant client Google Calendar manquant.');
  const state = base64url(randomBytes(32)), verifier = base64url(randomBytes(48)), challenge = base64url(createHash('sha256').update(verifier).digest());
  const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return { authorizationUrl: `${AUTH}?${query}`, state, verifier, redirectUri };
}

export class GoogleCalendarClient {
  private generation = 0;
  private refreshFlight?: Promise<void>;
  constructor(private readonly clientId: string, private tokens: GoogleTokens | null, private readonly persist: (tokens: GoogleTokens | null) => Promise<void>, private readonly request: typeof fetch = fetch) {}
  get connected() { return Boolean(this.tokens?.accessToken || this.tokens?.refreshToken); }
  async exchangeCode(code: string, returnedState: string, attempt: GoogleOAuthAttempt) {
    const generation = this.generation, actual = Buffer.from(returnedState), expected = Buffer.from(attempt.state);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('État OAuth Google invalide.');
    if (!code.trim()) throw new Error('Code OAuth Google manquant.');
    const response = await this.fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId, code, code_verifier: attempt.verifier, redirect_uri: attempt.redirectUri, grant_type: 'authorization_code' }) });
    const value = await this.json<{ access_token: string; refresh_token?: string; expires_in: number }>(response);
    if (generation !== this.generation) throw new Error('Connexion Google annulée.');
    const next = { accessToken: value.access_token, refreshToken: value.refresh_token ?? this.tokens?.refreshToken ?? '', expiresAt: Date.now() + value.expires_in * 1000 };
    this.tokens = next; await this.persist(next); if (generation !== this.generation) throw new Error('Connexion Google annulée.');
  }
  async disconnect() { this.generation++; this.tokens = null; await this.persist(null); }
  async calendars() {
    const items: Array<{ id: string; summary: string; accessRole: string; deleted?: boolean }> = []; let pageToken = '';
    do { const q = new URLSearchParams({ maxResults: '250' }); if (pageToken) q.set('pageToken', pageToken); const value = await this.api<{ items?: typeof items; nextPageToken?: string }>(`/users/me/calendarList?${q}`); items.push(...(value.items ?? [])); pageToken = value.nextPageToken ?? ''; } while (pageToken);
    return items.filter(x => !x.deleted).map(x => ({ id: x.id, summary: x.summary, writable: ['owner', 'writer'].includes(x.accessRole) }));
  }
  async events(calendarId: string, options: { timeMin?: string; timeMax?: string; managedLocalId?: string } = {}) {
    const items: Array<Record<string, unknown>> = []; let pageToken = '';
    do {
      const q = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true', maxResults: '2500' });
      if (options.timeMin) q.set('timeMin', options.timeMin); if (options.timeMax) q.set('timeMax', options.timeMax); if (options.managedLocalId) q.set('privateExtendedProperty', `streamDashboardId=${options.managedLocalId}`); if (pageToken) q.set('pageToken', pageToken);
      const value = await this.api<{ items?: Array<Record<string, unknown>>; nextPageToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?${q}`);
      items.push(...(value.items ?? [])); pageToken = value.nextPageToken ?? '';
    } while (pageToken);
    return items.map(this.toEvent).filter((x): x is GoogleEvent => Boolean(x));
  }
  async create(calendarId: string, input: GoogleEventInput) {
    // Recovery/idempotence: a previous POST may have succeeded remotely while its
    // response was lost. The private local id lets a retry recover that event.
    const existing = (await this.events(calendarId, { managedLocalId: input.localId })).find(event => !event.deleted && event.managed && event.localId === input.localId);
    if (existing) return existing;
    return this.mutate('POST', calendarId, '', input);
  }
  async update(calendarId: string, id: string, input: GoogleEventInput, etag?: string) { return this.mutate('PATCH', calendarId, `/${encodeURIComponent(id)}`, input, etag); }
  async delete(calendarId: string, id: string, etag?: string) { await this.api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, { method: 'DELETE', headers: etag ? { 'If-Match': etag } : undefined }); }
  private async mutate(method: string, calendarId: string, suffix: string, input: GoogleEventInput, etag?: string) {
    const body = { summary: input.title, description: input.description ?? '', start: { dateTime: input.startAtUtc }, end: { dateTime: input.endAtUtc }, extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: input.localId } } };
    const value = await this.api<Record<string, unknown>>(`/calendars/${encodeURIComponent(calendarId)}/events${suffix}`, { method, headers: etag ? { 'If-Match': etag } : undefined, body: JSON.stringify(body) });
    const event = this.toEvent(value); if (!event) throw new Error('Réponse Google Calendar invalide.'); return event;
  }
  private toEvent = (x: Record<string, unknown>): GoogleEvent | null => {
    const start = x.start as { dateTime?: string; date?: string } | undefined, end = x.end as { dateTime?: string; date?: string } | undefined, ext = (x.extendedProperties as { private?: Record<string, string> } | undefined)?.private;
    const startAtUtc = start?.dateTime ?? (start?.date ? allDayUtc(start.date) : ''), endAtUtc = end?.dateTime ?? (end?.date ? allDayUtc(end.date) : '');
    if (typeof x.id !== 'string' || !startAtUtc || !endAtUtc) return null;
    const managed = ext?.streamDashboardManaged === 'true';
    return { id: x.id, localId: ext?.streamDashboardId ?? `google:${x.id}`, title: typeof x.summary === 'string' ? x.summary : '(sans titre)', description: typeof x.description === 'string' ? x.description : undefined, startAtUtc, endAtUtc, etag: typeof x.etag === 'string' ? x.etag : undefined, editable: x.locked !== true, deleted: x.status === 'cancelled', managed };
  };
  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const generation = this.generation; if (!this.tokens) throw new Error('Google Calendar non connecté.');
    if (this.tokens.expiresAt <= Date.now() + 30_000) await this.refresh();
    if (generation !== this.generation || !this.tokens) throw new Error('Opération Google annulée.');
    let response = await this.fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${this.tokens.accessToken}`, 'content-type': 'application/json', ...init.headers } });
    if (generation !== this.generation) throw new Error('Opération Google annulée.');
    if (response.status === 401) { await this.refresh(); if (generation !== this.generation || !this.tokens) throw new Error('Opération Google annulée.'); response = await this.fetch(`${API}${path}`, { ...init, headers: { Authorization: `Bearer ${this.tokens.accessToken}`, 'content-type': 'application/json', ...init.headers } }); if (generation !== this.generation) throw new Error('Opération Google annulée.'); }
    return this.json<T>(response);
  }
  private refresh() { return this.refreshFlight ??= this.refreshNow().finally(() => { this.refreshFlight = undefined; }); }
  private async refreshNow() { const generation = this.generation, refreshToken = this.tokens?.refreshToken; if (!refreshToken) throw new Error('Reconnectez Google Calendar.'); const response = await this.fetch(TOKEN, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: this.clientId, refresh_token: refreshToken, grant_type: 'refresh_token' }) }); const value = await this.json<{ access_token: string; expires_in: number; refresh_token?: string }>(response); if (generation !== this.generation) throw new Error('Renouvellement Google annulé.'); const next = { accessToken: value.access_token, refreshToken: value.refresh_token ?? refreshToken, expiresAt: Date.now() + value.expires_in * 1000 }; this.tokens = next; await this.persist(next); if (generation !== this.generation) throw new Error('Renouvellement Google annulé.'); }
  private fetch(url: string, init: RequestInit) { const timeout = AbortSignal.timeout(TIMEOUT), signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout; return this.request(url, { ...init, signal }); }
  private async json<T>(response: Response): Promise<T> { if (response.status === 204) return undefined as T; const value = await response.json().catch(() => ({})) as T & { error?: { message?: string } }; if (!response.ok) throw new GoogleCalendarError(response.status, value.error?.message ?? `Google Calendar HTTP ${response.status}`); return value; }
}
export class GoogleCalendarError extends Error { constructor(readonly status: number, message: string) { super(message); } }
