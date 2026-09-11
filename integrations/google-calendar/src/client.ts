import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const API = 'https://www.googleapis.com/calendar/v3';
const SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;
const TIMEOUT_MS = 15_000;
const OAUTH_ATTEMPT_TTL_MS = 10 * 60_000;

export interface GoogleTokens { accessToken: string; refreshToken: string; expiresAt: number }
export interface GoogleOAuthAttempt { authorizationUrl: string; state: string; verifier: string; redirectUri: string }
export interface GoogleEventInput {
  localId: string;
  title: string;
  description?: string;
  startAtUtc: string;
  endAtUtc: string;
  allDay?: boolean;
}
export interface GoogleEvent extends GoogleEventInput {
  id: string;
  etag?: string;
  editable: boolean;
  deleted?: boolean;
  managed: boolean;
}

const base64url = (value: Buffer) => value.toString('base64url');
const allDayUtc = (value: string) => `${value}T00:00:00.000Z`;
const dateOnly = (value: string) => value.slice(0, 10);
const pendingOAuthAttempts = new Map<string, { attempt: GoogleOAuthAttempt; expiresAt: number }>();

function oauthAttemptKey(clientId: string, redirectUri: string) {
  return `${clientId}\n${redirectUri}`;
}

function clearPendingOAuthAttempt(clientId: string, redirectUri?: string, expectedState?: string) {
  if (!redirectUri) {
    for (const key of pendingOAuthAttempts.keys()) if (key.startsWith(`${clientId}\n`)) pendingOAuthAttempts.delete(key);
    return;
  }
  const key = oauthAttemptKey(clientId, redirectUri);
  const current = pendingOAuthAttempts.get(key);
  if (!current || (expectedState && current.attempt.state !== expectedState)) return;
  pendingOAuthAttempts.delete(key);
}

export function createGoogleOAuthAttempt(clientId: string, redirectUri: string): GoogleOAuthAttempt {
  if (!clientId.trim()) throw new Error('Identifiant client Google Calendar manquant.');
  const key = oauthAttemptKey(clientId, redirectUri);
  const now = Date.now();
  const pending = pendingOAuthAttempts.get(key);
  if (pending && pending.expiresAt > now) return pending.attempt;
  if (pending) pendingOAuthAttempts.delete(key);

  const state = base64url(randomBytes(32));
  const verifier = base64url(randomBytes(48));
  const challenge = base64url(createHash('sha256').update(verifier).digest());
  const query = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });
  const attempt = { authorizationUrl: `${AUTH}?${query}`, state, verifier, redirectUri };
  pendingOAuthAttempts.set(key, { attempt, expiresAt: now + OAUTH_ATTEMPT_TTL_MS });
  return attempt;
}

export class GoogleCalendarClient {
  private generation = 0;
  private refreshFlight?: Promise<void>;

  constructor(
    private readonly clientId: string,
    private tokens: GoogleTokens | null,
    private readonly persist: (tokens: GoogleTokens | null) => Promise<void>,
    private readonly request: typeof fetch = fetch,
  ) {}

  get connected() { return Boolean(this.tokens?.accessToken || this.tokens?.refreshToken); }

  async exchangeCode(code: string, returnedState: string, attempt: GoogleOAuthAttempt) {
    const generation = this.generation;
    const actual = Buffer.from(returnedState);
    const expected = Buffer.from(attempt.state);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('État OAuth Google invalide.');
    if (!code.trim()) throw new Error('Code OAuth Google manquant.');

    const response = await this.fetchWithTimeout(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        code,
        code_verifier: attempt.verifier,
        redirect_uri: attempt.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const value = await this.json<{ access_token: string; refresh_token?: string; expires_in: number }>(response);
    const next = {
      accessToken: value.access_token,
      refreshToken: value.refresh_token ?? this.tokens?.refreshToken ?? '',
      expiresAt: Date.now() + value.expires_in * 1000,
    };
    await this.commitTokens(generation, next, 'Connexion Google annulée.');
    clearPendingOAuthAttempt(this.clientId, attempt.redirectUri, attempt.state);
  }

  async disconnect() {
    this.generation++;
    this.tokens = null;
    clearPendingOAuthAttempt(this.clientId);
    await this.persist(null);
  }

  async calendars() {
    const items: Array<{ id: string; summary: string; accessRole: string; deleted?: boolean }> = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ maxResults: '250' });
      if (pageToken) query.set('pageToken', pageToken);
      const value = await this.api<{ items?: typeof items; nextPageToken?: string }>(`/users/me/calendarList?${query}`);
      items.push(...(value.items ?? []));
      pageToken = value.nextPageToken ?? '';
    } while (pageToken);
    return items
      .filter(item => !item.deleted)
      .map(item => ({ id: item.id, summary: item.summary, writable: ['owner', 'writer'].includes(item.accessRole) }));
  }

  async events(calendarId: string, options: { timeMin?: string; timeMax?: string; managedLocalId?: string } = {}) {
    const items: Array<Record<string, unknown>> = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ showDeleted: 'true', singleEvents: 'true', maxResults: '2500' });
      if (options.timeMin) query.set('timeMin', options.timeMin);
      if (options.timeMax) query.set('timeMax', options.timeMax);
      if (options.managedLocalId) query.set('privateExtendedProperty', `streamDashboardId=${options.managedLocalId}`);
      if (pageToken) query.set('pageToken', pageToken);
      const value = await this.api<{ items?: Array<Record<string, unknown>>; nextPageToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
      items.push(...(value.items ?? []));
      pageToken = value.nextPageToken ?? '';
    } while (pageToken);
    return items.map(this.toEvent).filter((item): item is GoogleEvent => Boolean(item));
  }

  async event(calendarId: string, id: string) {
    const value = await this.api<Record<string, unknown>>(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`);
    const event = this.toEvent(value);
    if (!event) throw new Error('Réponse Google Calendar invalide.');
    return event;
  }

  async create(calendarId: string, input: GoogleEventInput) {
    // Recovery/idempotence: a previous POST may have succeeded remotely while its
    // response was lost. The private local id lets a retry recover that event.
    const existing = (await this.events(calendarId, { managedLocalId: input.localId }))
      .find(event => !event.deleted && event.managed && event.localId === input.localId);
    if (existing) return existing;
    return this.mutate('POST', calendarId, '', input);
  }

  async update(calendarId: string, id: string, input: GoogleEventInput, etag?: string) {
    return this.mutate('PATCH', calendarId, `/${encodeURIComponent(id)}`, input, etag);
  }

  async delete(calendarId: string, id: string, etag?: string) {
    await this.api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: etag ? { 'If-Match': etag } : undefined,
    });
  }

  private async mutate(method: string, calendarId: string, suffix: string, input: GoogleEventInput, etag?: string) {
    const body = {
      summary: input.title,
      description: input.description ?? '',
      start: input.allDay ? { date: dateOnly(input.startAtUtc) } : { dateTime: input.startAtUtc },
      end: input.allDay ? { date: dateOnly(input.endAtUtc) } : { dateTime: input.endAtUtc },
      extendedProperties: { private: { streamDashboardManaged: 'true', streamDashboardId: input.localId } },
    };
    const value = await this.api<Record<string, unknown>>(`/calendars/${encodeURIComponent(calendarId)}/events${suffix}`, {
      method,
      headers: etag ? { 'If-Match': etag } : undefined,
      body: JSON.stringify(body),
    });
    const event = this.toEvent(value);
    if (!event) throw new Error('Réponse Google Calendar invalide.');
    return event;
  }

  private toEvent = (value: Record<string, unknown>): GoogleEvent | null => {
    const start = value.start as { dateTime?: string; date?: string } | undefined;
    const end = value.end as { dateTime?: string; date?: string } | undefined;
    const privateProperties = (value.extendedProperties as { private?: Record<string, string> } | undefined)?.private;
    const allDay = Boolean(start?.date && end?.date);
    const startAtUtc = start?.dateTime ?? (start?.date ? allDayUtc(start.date) : '');
    const endAtUtc = end?.dateTime ?? (end?.date ? allDayUtc(end.date) : '');
    if (typeof value.id !== 'string' || !startAtUtc || !endAtUtc) return null;
    const managed = privateProperties?.streamDashboardManaged === 'true';
    return {
      id: value.id,
      localId: privateProperties?.streamDashboardId ?? `google:${value.id}`,
      title: typeof value.summary === 'string' ? value.summary : '(sans titre)',
      description: typeof value.description === 'string' ? value.description : undefined,
      startAtUtc,
      endAtUtc,
      allDay,
      etag: typeof value.etag === 'string' ? value.etag : undefined,
      editable: value.locked !== true,
      deleted: value.status === 'cancelled',
      managed,
    };
  };

  private async api<T>(path: string, init: RequestInit = {}): Promise<T> {
    const generation = this.generation;
    if (!this.tokens) throw new Error('Google Calendar non connecté.');
    if (this.tokens.expiresAt <= Date.now() + 30_000) await this.refresh();
    if (generation !== this.generation || !this.tokens) throw new Error('Opération Google annulée.');

    let response = await this.fetchWithTimeout(`${API}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.tokens.accessToken}`, 'content-type': 'application/json', ...init.headers },
    });
    if (generation !== this.generation) throw new Error('Opération Google annulée.');

    if (response.status === 401) {
      await this.refresh();
      if (generation !== this.generation || !this.tokens) throw new Error('Opération Google annulée.');
      response = await this.fetchWithTimeout(`${API}${path}`, {
        ...init,
        headers: { Authorization: `Bearer ${this.tokens.accessToken}`, 'content-type': 'application/json', ...init.headers },
      });
      if (generation !== this.generation) throw new Error('Opération Google annulée.');
      if (response.status === 401) {
        await this.invalidateSession();
        throw new Error('Session Google expirée ou révoquée. Reconnectez Google Calendar.');
      }
    }
    return this.json<T>(response);
  }

  private refresh() {
    return this.refreshFlight ??= this.refreshNow().finally(() => { this.refreshFlight = undefined; });
  }

  private async refreshNow() {
    const generation = this.generation;
    const refreshToken = this.tokens?.refreshToken;
    if (!refreshToken) {
      await this.invalidateSession();
      throw new Error('Reconnectez Google Calendar.');
    }
    try {
      const response = await this.fetchWithTimeout(TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, refresh_token: refreshToken, grant_type: 'refresh_token' }),
      });
      const value = await this.json<{ access_token: string; expires_in: number; refresh_token?: string }>(response);
      const next = {
        accessToken: value.access_token,
        refreshToken: value.refresh_token ?? refreshToken,
        expiresAt: Date.now() + value.expires_in * 1000,
      };
      await this.commitTokens(generation, next, 'Renouvellement Google annulé.');
    } catch (error) {
      if (error instanceof GoogleCalendarError && [400, 401].includes(error.status) && generation === this.generation) {
        await this.invalidateSession();
        throw new Error('Session Google expirée ou révoquée. Reconnectez Google Calendar.');
      }
      throw error;
    }
  }

  private async commitTokens(generation: number, next: GoogleTokens, cancelledMessage: string) {
    if (generation !== this.generation) throw new Error(cancelledMessage);
    await this.persist(next);
    if (generation !== this.generation) {
      // A concurrent disconnect may have persisted null before the slower credential
      // write completed. Persist null again so a stale async completion cannot resurrect it.
      await this.persist(null);
      throw new Error(cancelledMessage);
    }
    this.tokens = next;
  }

  private async invalidateSession() {
    this.generation++;
    this.tokens = null;
    clearPendingOAuthAttempt(this.clientId);
    await this.persist(null);
  }

  private async fetchWithTimeout(url: string, init: RequestInit) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      return await this.request(url, { ...init, signal });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || /timed?\s*out/i.test(error.message))) {
        throw new Error('Google Calendar ne répond pas dans le délai attendu. Réessayez.');
      }
      throw error;
    }
  }

  private async json<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const value = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
    if (!response.ok) throw new GoogleCalendarError(response.status, value.error?.message ?? `Google Calendar HTTP ${response.status}`);
    return value;
  }
}

export class GoogleCalendarError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
