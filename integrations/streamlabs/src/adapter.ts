import { integrationState, transitionIntegration } from '../../../packages/core/src/integrations.js';
import type { IntegrationState } from '../../../packages/contracts/src/index.js';
import type { Support } from '../../../packages/core/src/live-control-domains.js';

export interface SupportProvider { readonly id: string; state(): IntegrationState; connect(): Promise<void>; disconnect(): Promise<void> }
export interface StreamlabsTransport { connect(token: string, onTip: (value: unknown) => void, onDisconnect: (error?: Error) => void): Promise<() => Promise<void>> }

export class StreamlabsAdapter implements SupportProvider {
  readonly id = 'streamlabs';
  private lifecycle = integrationState('NOT_CONFIGURED');
  private close?: () => Promise<void>;
  private reconnect?: NodeJS.Timeout;
  private generation = 0;
  private pending?: Promise<void>;
  private attempts = 0;

  constructor(private token: string, private readonly onSupport: (support: Support) => Promise<void>, private readonly transport?: StreamlabsTransport, private readonly logger?: Pick<Console, 'info' | 'warn'>) {
    this.lifecycle = integrationState(transport ? (token.trim() ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED');
  }
  state() { return structuredClone(this.lifecycle); }
  configure(token: string) { this.generation++; this.pending = undefined; const close = this.close; this.close = undefined; void close?.().catch(() => undefined); this.attempts = 0; if (this.reconnect) clearTimeout(this.reconnect); this.reconnect = undefined; this.token = token.trim(); this.lifecycle = integrationState(this.transport ? (this.token ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }

  connect(): Promise<void> {
    if (this.pending) return this.pending;
    if (this.close) return Promise.resolve();
    const operation = this.connectNow();
    this.pending = operation;
    void operation.finally(() => { if (this.pending === operation) this.pending = undefined; }).catch(() => undefined);
    return operation;
  }

  private schedule(generation: number) {
    if (generation !== this.generation || this.reconnect) return;
    this.reconnect = setTimeout(() => { this.reconnect = undefined; void this.connect(); }, Math.min(30_000, 1_000 * 2 ** Math.min(++this.attempts, 5)));
    this.reconnect.unref();
  }

  private async connectNow() {
    if (!this.transport) { this.lifecycle = integrationState('NOT_SUPPORTED'); return; }
    if (!this.token) { this.lifecycle = integrationState('NOT_CONFIGURED'); return; }
    this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTING');
    const generation = ++this.generation;
    let disconnected = false;
    try {
      const close = await this.transport.connect(this.token, value => { if (generation !== this.generation) return; void this.receive(value).catch(() => { if (generation !== this.generation) return; this.lifecycle = transitionIntegration(this.lifecycle, 'DEGRADED', { error: { code: 'STREAMLABS_EVENT_INVALID', message: 'Événement Streamlabs invalide.', retryable: false, details: null } }); }); }, error => { if (generation !== this.generation) return; disconnected = true; this.close = undefined; this.lifecycle = transitionIntegration(this.lifecycle, 'DEGRADED', { error: { code: 'STREAMLABS_DISCONNECTED', message: error?.message ?? 'Connexion Streamlabs interrompue.', retryable: true, details: null } }); this.logger?.warn('Streamlabs reconnecting'); this.schedule(generation); });
      if (generation !== this.generation || disconnected) { await close(); return; }
      this.close = close;
      this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTED');
    } catch (error) { if (generation !== this.generation) return; this.schedule(generation); this.lifecycle = transitionIntegration(this.lifecycle, 'ERROR', { error: { code: 'STREAMLABS_CONNECT_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true, details: null } }); }
  }
  async disconnect() { this.generation++; this.pending = undefined; this.attempts = 0; if (this.reconnect) clearTimeout(this.reconnect); this.reconnect = undefined; await this.close?.(); this.close = undefined; this.lifecycle = integrationState(this.transport ? (this.token ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }

  private async receive(value: unknown) {
    const support = normalizeStreamlabsTip(value);
    await this.onSupport(support);
    this.logger?.info('Streamlabs support received');
    this.lifecycle = { ...this.lifecycle, lastEventAt: support.receivedAt };
  }
}

export function normalizeStreamlabsTip(value: unknown): Support {
  if (!value || typeof value !== 'object') throw new Error('Événement Streamlabs invalide.'); const row = value as Record<string, unknown>;
  const amountMinor = Number(row.amountMinor); const externalId = String(row.id ?? row.externalId ?? ''); const currency = String(row.currency ?? '').toUpperCase();
  if (!externalId || externalId.length > 200 || !Number.isSafeInteger(amountMinor) || amountMinor < 0 || !/^[A-Z]{3}$/.test(currency)) throw new Error('Tip Streamlabs invalide.');
  const receivedAt = row.receivedAt === undefined ? new Date() : new Date(typeof row.receivedAt === 'number' ? row.receivedAt : String(row.receivedAt));
  if (!Number.isFinite(receivedAt.getTime())) throw new Error('Date Streamlabs invalide.');
  return { id: `streamlabs:${externalId}`, provider: 'streamlabs', externalId, displayName: String(row.name ?? row.displayName ?? 'Anonyme').slice(0, 100), amountMinor, currency, message: String(row.message ?? '').slice(0, 2_000), receivedAt: receivedAt.toISOString() };
}
