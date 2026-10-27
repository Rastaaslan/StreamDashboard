import { createHash } from 'node:crypto';
import path from 'node:path';
import { AtomicJsonStore, type SecretStore } from './storage.js';
import { STREAMLABS_HISTORY_LIMIT } from './streamlabs-feed.js';
import { isStreamlabsActivityType, type StreamlabsEvent } from '../../../integrations/streamlabs/src/events.js';
import { mergeStreamlabsHistory, normalizeStreamlabsHistory } from '../../../integrations/streamlabs/src/history.js';

export interface StreamlabsHistoryState {
  status: 'NOT_CONFIGURED' | 'SYNCING' | 'SYNCED' | 'ERROR';
  configured: boolean;
  lastSyncAt: string | null;
  lastAttemptAt: string | null;
  count: number;
  lastError: string | null;
}
interface HistoryCache { items: StreamlabsEvent[]; lastSyncAt: string | null }
interface HistoryOptions {
  directory: string;
  secrets: SecretStore;
  fetchApi?: typeof fetch;
  signal?: AbortSignal;
  now?: () => number;
  connectionStamp?: () => string | null;
}
class HistoryReadError extends Error {}
const EMPTY: StreamlabsHistoryState = { status: 'NOT_CONFIGURED', configured: false, lastSyncAt: null, lastAttemptAt: null, count: 0, lastError: null };
const TOKEN = /^[A-Za-z0-9_-]{20,256}$/;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

/** Extract only a credential. The supplied URL is never fetched or persisted. */
export function parseStreamlabsWidgetToken(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4_000) throw new Error('URL de widget Streamlabs invalide.');
  const input = value.trim();
  if (TOKEN.test(input)) return input;
  let url: URL;
  try { url = new URL(input); } catch { throw new Error('Collez une URL de widget Streamlabs complète.'); }
  if (url.protocol !== 'https:' || !['streamlabs.com', 'www.streamlabs.com'].includes(url.hostname) || url.port || url.username || url.password) throw new Error('Utilisez une URL HTTPS de widget streamlabs.com.');
  const queryTokens = url.searchParams.getAll('token');
  const pathTokens = url.pathname.split('/').filter(segment => TOKEN.test(segment));
  const candidates = [...new Set([...queryTokens, ...pathTokens])];
  if (queryTokens.length > 1 || candidates.length !== 1 || !TOKEN.test(candidates[0])) throw new Error('Cette URL ne contient pas un jeton de widget Streamlabs unique.');
  return candidates[0];
}

function cachedEvent(value: unknown): value is StreamlabsEvent {
  if (!value || typeof value !== 'object') return false;
  const row = value as StreamlabsEvent;
  return typeof row.id === 'string' && /^[a-f0-9]{64}$/.test(row.id) && isStreamlabsActivityType(row.type)
    && ['twitch', 'youtube', 'streamlabs'].includes(row.platform) && typeof row.displayName === 'string'
    && typeof row.message === 'string' && typeof row.receivedAt === 'string' && Number.isFinite(Date.parse(row.receivedAt));
}

/** Cloud history is read-only: it never enters the donation/automation pipeline.
 * Cache files are isolated by widget account; credentials stay in SecretStore. */
export class StreamlabsHistory {
  private state: StreamlabsHistoryState = { ...EMPTY };
  private items: StreamlabsEvent[] = [];
  private token = '';
  private generation = 0;
  private store?: AtomicJsonStore<HistoryCache>;
  private flight?: Promise<void>;
  private controller?: AbortController;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  private nextAttemptAt = 0;
  private lastConnection: string | null = null;
  private readonly now: () => number;
  private readonly fetchApi: typeof fetch;
  private readonly onAbort = () => { this.controller?.abort(); };

  constructor(private readonly options: HistoryOptions) {
    this.now = options.now ?? Date.now;
    this.fetchApi = options.fetchApi ?? fetch;
    options.signal?.addEventListener('abort', this.onAbort, { once: true });
  }

  snapshot() { return structuredClone(this.state); }
  list() { return structuredClone(this.items); }

  async start() {
    if (!this.timer && !this.stopped) {
      this.lastConnection = this.options.connectionStamp?.() ?? null;
      this.timer = setInterval(() => {
        const stamp = this.options.connectionStamp?.() ?? null;
        const reconnected = Boolean(stamp && stamp !== this.lastConnection);
        this.lastConnection = stamp;
        void this.refresh(reconnected).catch(() => undefined);
      }, 5_000);
      this.timer.unref();
    }
    return this.refresh(true);
  }

  private async selectAccount(token: string) {
    if (token === this.token && (this.store || !token)) return;
    this.generation++;
    const generation = this.generation;
    this.controller?.abort(); this.controller = undefined; this.flight = undefined;
    this.token = token; this.items = []; this.store = undefined; this.nextAttemptAt = 0;
    this.state = { ...EMPTY, configured: Boolean(token), status: token ? 'SYNCING' : 'NOT_CONFIGURED' };
    if (!token) return;
    const key = createHash('sha256').update(token).digest('hex');
    const store = new AtomicJsonStore<HistoryCache>(path.join(this.options.directory, `${key}.json`));
    const cache = await store.read({ items: [], lastSyncAt: null });
    if (generation !== this.generation || this.stopped) return;
    this.store = store;
    this.items = mergeStreamlabsHistory([], Array.isArray(cache.items) ? cache.items.filter(cachedEvent) : [], STREAMLABS_HISTORY_LIMIT);
    const lastSyncAt = typeof cache.lastSyncAt === 'string' && Number.isFinite(Date.parse(cache.lastSyncAt)) ? cache.lastSyncAt : null;
    this.state = { ...this.state, count: this.items.length, lastSyncAt };
  }

  async refresh(force = false): Promise<StreamlabsHistoryState> {
    if (this.stopped || this.options.signal?.aborted) return this.snapshot();
    const beforeRead = this.generation;
    let token: string;
    try { token = (await this.options.secrets.getStreamlabsWidgetToken?.() ?? '').trim(); }
    catch { this.state = { ...this.state, status: 'ERROR', lastError: 'Le stockage sécurisé Streamlabs est indisponible.' }; return this.snapshot(); }
    if (beforeRead !== this.generation || this.stopped) return this.snapshot();
    try { await this.selectAccount(token); }
    catch { this.state = { ...this.state, status: 'ERROR', lastError: 'Le cache de l’historique Streamlabs est inaccessible.' }; return this.snapshot(); }
    if (!token || token !== this.token || this.stopped || !this.store) return this.snapshot();
    if (this.flight) { await this.flight; return this.snapshot(); }
    const at = this.now();
    const lastAttempt = this.state.lastAttemptAt ? Date.parse(this.state.lastAttemptAt) : -Infinity;
    if (at < this.nextAttemptAt || at - lastAttempt < (force ? 10_000 : 60_000)) return this.snapshot();
    const generation = this.generation;
    const store = this.store;
    this.state = { ...this.state, status: 'SYNCING', lastAttemptAt: new Date(at).toISOString(), lastError: null };
    const operation = this.fetchHistory(token, generation, store);
    this.flight = operation;
    try { await operation; } finally { if (this.flight === operation) this.flight = undefined; }
    return this.snapshot();
  }

  private async fetchHistory(token: string, generation: number, store: AtomicJsonStore<HistoryCache>) {
    const controller = new AbortController(); this.controller = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000); timeout.unref();
    const current = () => !this.stopped && !this.options.signal?.aborted && generation === this.generation && token === this.token;
    try {
      const response = await this.fetchApi(`https://streamlabs.com/api/v5/slobs/recentevents/${encodeURIComponent(token)}`, {
        method: 'GET', headers: { accept: 'application/json' }, redirect: 'error', cache: 'no-store', credentials: 'omit', signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get('retry-after')?.trim() ?? '';
          const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1_000 : Date.parse(retryAfter) - this.now();
          if (current()) this.nextAttemptAt = this.now() + (Number.isFinite(delay) && delay > 0 ? Math.min(delay, 3_600_000) : 60_000);
          throw new HistoryReadError('Streamlabs limite les requêtes. La synchronisation reprendra automatiquement.');
        }
        if (response.status === 401 || response.status === 403) throw new HistoryReadError('Streamlabs refuse l’accès à cet historique. Vérifiez l’URL du widget enregistrée.');
        throw new HistoryReadError('L’historique Streamlabs est temporairement indisponible.');
      }
      if (!response.headers.get('content-type')?.toLowerCase().includes('application/json')) throw new HistoryReadError('Streamlabs n’a pas renvoyé un historique valide.');
      const reader = response.body?.getReader();
      if (!reader) throw new HistoryReadError('L’historique Streamlabs est vide ou illisible.');
      const chunks: Uint8Array[] = []; let bytes = 0;
      try {
        for (;;) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.byteLength;
          if (bytes > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new HistoryReadError('L’historique Streamlabs dépasse la taille acceptée.'); }
          chunks.push(part.value);
        }
      } finally { reader.releaseLock(); }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
      if (!payload?.data || typeof payload.data !== 'object' || Array.isArray(payload.data)) throw new HistoryReadError('Streamlabs n’a pas renvoyé un historique valide.');
      const groups = payload.data as Record<string, unknown>;
      if (!['donations', 'subscriptions', 'follows', 'raids', 'bits'].some(key => Array.isArray(groups[key]))) throw new HistoryReadError('Streamlabs n’a pas renvoyé un historique valide.');
      const imported = normalizeStreamlabsHistory(payload, new Date(this.now()));
      if (!current() || (await this.options.secrets.getStreamlabsWidgetToken?.() ?? '').trim() !== token) return;
      const items = mergeStreamlabsHistory(this.items, imported, STREAMLABS_HISTORY_LIMIT);
      const lastSyncAt = new Date(this.now()).toISOString();
      await store.write({ items, lastSyncAt });
      if (!current() || (await this.options.secrets.getStreamlabsWidgetToken?.() ?? '').trim() !== token) return;
      this.items = items;
      this.state = { ...this.state, status: 'SYNCED', configured: true, lastSyncAt, count: items.length, lastError: null };
    } catch (error) {
      if (!current()) return;
      // Provider/transport errors may contain the URL credential. Only our fixed
      // messages are exposed; raw payloads, URLs and Error stacks are never logged.
      const message = error instanceof HistoryReadError ? error.message : 'Impossible de synchroniser Streamlabs. L’historique déjà récupéré reste disponible.';
      this.state = { ...this.state, status: 'ERROR', lastError: message };
    } finally {
      clearTimeout(timeout);
      if (this.controller === controller) this.controller = undefined;
    }
  }

  async configure(value: unknown) {
    const token = parseStreamlabsWidgetToken(value);
    if (!this.options.secrets.setStreamlabsWidgetToken) throw new Error('Le stockage sécurisé de cet appareil ne prend pas en charge l’historique Streamlabs.');
    await this.options.secrets.setStreamlabsWidgetToken(token);
    await this.selectAccount(token);
    return this.refresh(true);
  }

  async clear() {
    if (!this.options.secrets.clearStreamlabsWidgetToken) throw new Error('Le stockage sécurisé Streamlabs est indisponible.');
    await this.options.secrets.clearStreamlabsWidgetToken();
    await this.selectAccount('');
    return this.snapshot();
  }

  async stop() {
    this.stopped = true; this.generation++;
    if (this.timer) clearInterval(this.timer);
    this.options.signal?.removeEventListener('abort', this.onAbort);
    this.controller?.abort();
    await this.flight?.catch(() => undefined);
  }
}
