import { integrationState, transitionIntegration } from '../../../packages/core/src/integrations.js';
import type { IntegrationState } from '../../../packages/contracts/src/index.js';
import type { Support } from '../../../packages/core/src/live-control-domains.js';

export interface SupportProvider { readonly id: string; state(): IntegrationState; connect(): Promise<void>; disconnect(): Promise<void> }
export interface StreamlabsTransport { connect(token: string, onTip: (value: unknown) => void, onDisconnect: (error?: Error) => void): Promise<() => Promise<void>> }

export class StreamlabsAdapter implements SupportProvider {
  readonly id = 'streamlabs';
  private lifecycle = integrationState('NOT_CONFIGURED');
  private close?: () => Promise<void>;

  constructor(private token: string, private readonly onSupport: (support: Support) => Promise<void>, private readonly transport?: StreamlabsTransport) {
    this.lifecycle = integrationState(transport ? (token.trim() ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED');
  }
  state() { return structuredClone(this.lifecycle); }
  configure(token: string) { this.token = token.trim(); this.lifecycle = integrationState(this.transport ? (this.token ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }

  async connect() {
    if (!this.transport) { this.lifecycle = integrationState('NOT_SUPPORTED'); return; }
    if (!this.token) { this.lifecycle = integrationState('NOT_CONFIGURED'); return; }
    this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTING');
    try {
      this.close = await this.transport.connect(this.token, value => { void this.receive(value); }, error => { this.lifecycle = transitionIntegration(this.lifecycle, 'DEGRADED', { error: { code: 'STREAMLABS_DISCONNECTED', message: error?.message ?? 'Connexion Streamlabs interrompue.', retryable: true, details: null } }); });
      this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTED');
    } catch (error) { this.lifecycle = transitionIntegration(this.lifecycle, 'ERROR', { error: { code: 'STREAMLABS_CONNECT_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true, details: null } }); }
  }
  async disconnect() { await this.close?.(); this.close = undefined; this.lifecycle = integrationState(this.transport ? (this.token ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }

  private async receive(value: unknown) {
    const support = normalizeStreamlabsTip(value);
    await this.onSupport(support);
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
