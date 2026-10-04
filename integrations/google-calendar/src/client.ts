import type { CalendarItem } from '../../../packages/contracts/src/index.js';
import { googleRecurrence } from './recurrence.js';
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
export interface GoogleOAuthAttempt { authorizationUrl: string; state: string; verifier: string; redirectUri: string; expiresAt: number }
export interface GoogleEventInput {
  localId: string;
  title: string;
  description?: string;
  startAtUtc: string;
  endAtUtc: string;
  allDay?: boolean;
  recurrence?: CalendarItem['recurrence'];
  seriesId?: string;
  occurrenceKey?: string;
}
export interface GoogleEvent extends GoogleEventInput {
  id: string;
  etag?: string;
  editable: boolean;
  deleted?: boolean;
  managed: boolean;
  recurrenceLines?: string[];
  recurrenceTimeZone?: string;
}

const base64url = (value: Buffer) => value.toString('base64url');
const allDayUtc = (value: string) => `${value}T00:00:00.000Z`;
const dateOnly = (value: string) => value.slice(0, 10);
const pendingOAuthAttempts = new Map<string, { attempt: GoogleOAuthAttempt }>();

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

function isPendingOAuthAttempt(clientId: string, attempt: GoogleOAuthAttempt) {
  const key = oauthAttemptKey(clientId, attempt.redirectUri);
  const current = pendingOAuthAttempts.get(key);
  if (!current) return false;
  if (current.attempt.expiresAt <= Date.now()) {
    pendingOAuthAttempts.delete(key);
    return false;
  }
  return current.attempt.state === attempt.state && current.attempt.verifier === attempt.verifier;
}

export function createGoogleOAuthAttempt(clientId: string, redirectUri: string): GoogleOAuthAttempt {
  if (!clientId.trim()) throw new Error('Identifiant client Google Calendar manquant.');
  const key = oauthAttemptKey(clientId, redirectUri);
  const now = Date.now();
  const pending = pendingOAuthAttempts.get(key);
  if (pending && pending.attempt.expiresAt > now) return pending.attempt;
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
  const attempt = { authorizationUrl: `${AUTH}?${query}`, state, verifier, redirectUri, expiresAt: now + OAUTH_ATTEMPT_TTL_MS };
  pendingOAuthAttempts.set(key, { attempt });
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
    private clientSecret: string = process.env.GOOGLE_CLIENT_SECRET ?? '',
  ) {}

  setClientSecret(secret: string) { this.clientSecret = secret; }
  get clientSecretConfigured() { return Boolean(this.clientSecret); }

  get connected() { return Boolean(this.tokens?.accessToken || this.tokens?.refreshToken); }

  async exchangeCode(code: string, returnedState: string, attempt: GoogleOAuthAttempt) {
    const generation = this.generation;
    if (!isPendingOAuthAttempt(this.clientId, attempt)) throw new Error('Tentative OAuth Google expirée ou annulée.');
    const actual = Buffer.from(returnedState);
    const expected = Buffer.from(attempt.state);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('État OAuth Google invalide.');
    if (!code.trim()) throw new Error('Code OAuth Google manquant.');

    const requestSecret = this.clientSecret;
    const response = await this.fetchWithTimeout(TOKEN, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: this.clientId,
        ...(requestSecret ? { client_secret: requestSecret } : {}),
        code,
        code_verifier: attempt.verifier,
        redirect_uri: attempt.redirectUri,
        grant_type: 'authorization_code',
      }),
    }, requestSecret);
    const value = await this.json<{ access_token: string; refresh_token?: string; expires_in: number }>(response, requestSecret);
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

  /** Without expansion Google returns series masters and detached exceptions, including
   * cancelled exceptions that have only id/recurringEventId/originalStartTime.
   * Do not filter by dates or private properties: exceptions may omit both.
   */
  private async recurrenceInventory(calendarId: string) {
    const items: Array<Record<string, unknown>> = [];
    let pageToken = '';
    do {
      const query = new URLSearchParams({ showDeleted: 'true', singleEvents: 'false', maxResults: '2500' });
      if (pageToken) query.set('pageToken', pageToken);
      const page = await this.api<{ items?: Array<Record<string, unknown>>; nextPageToken?: string }>(`/calendars/${encodeURIComponent(calendarId)}/events?${query}`);
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken ?? '';
    } while (pageToken);
    return items;
  }

  private assertNoRemoteExceptions(items: Array<Record<string, unknown>>, ids: Set<string>) {
    if (items.some(value => typeof value.recurringEventId === 'string' && (ids.has(value.recurringEventId) || typeof value.id === 'string' && ids.has(value.id))
      || typeof value.id === 'string' && ids.has(value.id) && Array.isArray(value.recurrence)
        && value.recurrence.some(line => typeof line === 'string' && /^(EXDATE|RDATE|EXRULE)[;:]/i.test(line)))) {
      throw Object.assign(new Error('Exceptions Google distantes non représentables : synchronisation et modification refusées pour préserver les occurrences déplacées, renommées ou annulées.'), { code: 'GOOGLE_RECURRENCE_EXCEPTION_UNSUPPORTED', mutationNotStarted: true });
    }
  }

  async events(calendarId: string, options: { timeMin?: string; timeMax?: string; managedLocalId?: string } = {}) {
    const inventory = await this.recurrenceInventory(calendarId);
    const managed = inventory.map(this.toEvent).filter((event): event is GoogleEvent => Boolean(event?.managed));
    if (options.managedLocalId) {
      const matching = managed.filter(event => event.localId === options.managedLocalId);
      // Scope recovery to this identity, but inspect the full inventory because
      // its cancelled exceptions may not carry any private properties or dates.
      this.assertNoRemoteExceptions(inventory, new Set(matching.map(event => event.id)));
      return matching;
    }
    this.assertNoRemoteExceptions(inventory, new Set(managed.map(event => event.id)));

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
    // Expanded managed instances share the local ID: reconcile only their master.
    const masters = new Map<string, GoogleEvent>();
    const events: GoogleEvent[] = [];
    for (const value of items) {
      const event = this.toEvent(value);
      if (!event) continue;
      if (event.managed && typeof value.recurringEventId === 'string') {
        if (!masters.has(value.recurringEventId)) masters.set(value.recurringEventId, managed.find(master => master.id === value.recurringEventId) ?? await this.event(calendarId, value.recurringEventId));
      } else events.push(event);
    }
    return [...events, ...masters.values()];
  }

  async event(calendarId: string, id: string) {
    const value = await this.api<Record<string, unknown>>(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`);
    if (value.recurringEventId !== undefined || value.originalStartTime !== undefined) {
      throw Object.assign(new Error('Exceptions Google distantes : une occurrence ne peut pas remplacer son maître.'), { code: 'GOOGLE_RECURRENCE_EXCEPTION_UNSUPPORTED', mutationNotStarted: true });
    }
    const event = this.toEvent(value);
    if (!event) throw new Error('Réponse Google Calendar invalide.');
    if (event.recurrenceLines?.length || typeof value.recurringEventId === 'string') this.assertNoRemoteExceptions(await this.recurrenceInventory(calendarId), new Set([id]));
    return event;
  }

  async create(calendarId: string, input: GoogleEventInput) {
    googleRecurrence(input);
    // Recovery/idempotence: a previous POST may have succeeded remotely while its
    // response was lost. The private local id lets a retry recover that event.
    const existing = (await this.events(calendarId, { managedLocalId: input.localId }).catch(error => {
      throw Object.assign(error instanceof Error ? error : new Error(String(error)), { mutationNotStarted: true });
    }))
      .find(event => !event.deleted && event.managed && event.localId === input.localId);
    if (existing) {
      if (JSON.stringify(googleRecurrence(input)) !== JSON.stringify(existing.recurrenceLines ?? [])
        || (input.recurrence && !input.allDay && input.recurrence.timeZone !== existing.recurrenceTimeZone)) {
        throw Object.assign(new Error('La série Google retrouvée diffère de la récurrence locale. Réconciliation explicite requise.'), { mutationNotStarted: true });
      }
      return existing;
    }
    return this.mutate('POST', calendarId, '', input);
  }

  async update(calendarId: string, id: string, input: GoogleEventInput, etag?: string) {
    googleRecurrence(input);
    this.assertNoRemoteExceptions(await this.recurrenceInventory(calendarId), new Set([id]));
    return this.mutate('PATCH', calendarId, `/${encodeURIComponent(id)}`, input, etag);
  }

  async delete(calendarId: string, id: string, etag?: string) {
    try { await this.api(`/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: etag ? { 'If-Match': etag } : undefined,
    }); } catch (error) { if (!(error instanceof GoogleCalendarError && [404, 410].includes(error.status))) throw error; }
  }

  private async mutate(method: string, calendarId: string, suffix: string, input: GoogleEventInput, etag?: string) {
    const recurrence = googleRecurrence(input);
    const timeZone = input.recurrence?.timeZone;
    const body = {
      recurrence,
      summary: input.title,
      description: input.description ?? '',
      start: input.allDay ? { date: dateOnly(input.startAtUtc) } : { dateTime: input.startAtUtc, ...(timeZone ? { timeZone } : {}) },
      end: input.allDay ? { date: dateOnly(input.endAtUtc) } : { dateTime: input.endAtUtc, ...(timeZone ? { timeZone } : {}) },
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
    const start = value.start as { dateTime?: string; date?: string; timeZone?: string } | undefined;
    const end = value.end as { dateTime?: string; date?: string } | undefined;
    const privateProperties = (value.extendedProperties as { private?: Record<string, string> } | undefined)?.private;
    const allDay = Boolean(start?.date && end?.date);
    const startAtUtc = start?.dateTime ?? (start?.date ? allDayUtc(start.date) : '');
    const endAtUtc = end?.dateTime ?? (end?.date ? allDayUtc(end.date) : '');
    if (typeof value.id !== 'string' || !startAtUtc || !endAtUtc) return null;
    const managed = privateProperties?.streamDashboardManaged === 'true' || Boolean(privateProperties?.streamDashboardEventId);
    return {
      id: value.id,
      localId: privateProperties?.streamDashboardId ?? privateProperties?.streamDashboardEventId ?? `google:${value.id}`,
      title: typeof value.summary === 'string' ? value.summary : '(sans titre)',
      description: typeof value.description === 'string' ? value.description : undefined,
      startAtUtc,
      endAtUtc,
      allDay,
      etag: typeof value.etag === 'string' ? value.etag : undefined,
      editable: value.locked !== true,
      deleted: value.status === 'cancelled',
      managed,
      recurrenceTimeZone: start?.timeZone,
      recurrenceLines: Array.isArray(value.recurrence) ? value.recurrence as string[] : [],
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
    const requestSecret = this.clientSecret;
    try {
      const response = await this.fetchWithTimeout(TOKEN, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: this.clientId, ...(requestSecret ? { client_secret: requestSecret } : {}), refresh_token: refreshToken, grant_type: 'refresh_token' }),
      }, requestSecret);
      const value = await this.json<{ access_token: string; expires_in: number; refresh_token?: string }>(response, requestSecret);
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

  private async fetchWithTimeout(url: string, init: RequestInit, requestSecret = this.clientSecret) {
    const timeout = AbortSignal.timeout(TIMEOUT_MS);
    const signal = init.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    try {
      return await this.request(url, { ...init, signal });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || /timed?\s*out/i.test(error.message))) {
        throw new Error('Google Calendar ne répond pas dans le délai attendu. Réessayez.');
      }
      throw new Error(this.redactSecret(error instanceof Error ? error.message : String(error), requestSecret));
    }
  }

  private redactSecret(message: string, requestSecret: string) {
    // A credential can be cleared or replaced while the request is in flight.
    for (const secret of new Set([requestSecret, this.clientSecret])) {
      if (secret) message = message.split(secret).join('[REDACTED]');
    }
    return message;
  }

  private async json<T>(response: Response, requestSecret = this.clientSecret): Promise<T> {
    if (response.status === 204) return undefined as T;
    const value = await response.json().catch(() => ({})) as T & { error?: string | { message?: string }; error_description?: string };
    const oauthError = typeof value.error === 'string' ? [value.error, value.error_description].filter(Boolean).join(': ') : value.error?.message;
    if (!response.ok) throw new GoogleCalendarError(response.status, this.redactSecret(oauthError ?? `Google Calendar HTTP ${response.status}`, requestSecret));
    return value;
  }
}

export class GoogleCalendarError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
