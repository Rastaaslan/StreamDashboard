import type { IntegrationState } from '../../../packages/contracts/src/index.js';
import { integrationState, transitionIntegration } from '../../../packages/core/src/integrations.js';

export interface WizeBotConfiguration { apiBaseUrl: string; token: string }
export interface WizeBotTransport { status(configuration: WizeBotConfiguration): Promise<{ name: string; connected: boolean; data?: Record<string, unknown> }> }
export class WizeBotAdapter {
  private lifecycle = integrationState('NOT_CONFIGURED');
  private profile: { name: string; connected: boolean } | null = null;
  constructor(private configuration: WizeBotConfiguration | null, private readonly transport?: WizeBotTransport, private readonly logger?: Pick<Console, 'info' | 'warn'>) { this.lifecycle = integrationState(transport ? (configuration ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }
  state(): IntegrationState & { profile?: { name: string; connected: boolean } } { return { ...structuredClone(this.lifecycle), ...(this.profile ? { profile: { ...this.profile } } : {}) }; }
  configure(configuration: WizeBotConfiguration | null) { this.configuration = configuration; this.lifecycle = integrationState(this.transport ? (configuration ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }
  async refresh() { if (!this.transport) return this.lifecycle = integrationState('NOT_SUPPORTED'); if (!this.configuration) return this.lifecycle = integrationState('NOT_CONFIGURED'); this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTING'); try { const status = await this.transport.status(this.configuration); this.profile = { name: status.name, connected: status.connected }; this.lifecycle = transitionIntegration(this.lifecycle, status.connected ? 'CONNECTED' : 'DEGRADED', status.connected ? {} : { error: { code: 'WIZEBOT_DISCONNECTED', message: 'WizeBot indique un état déconnecté.', retryable: true, details: null } }); if (status.connected) this.logger?.info('WizeBot connected'); } catch (error) { this.profile = null; this.logger?.warn('WizeBot refresh failed'); this.lifecycle = transitionIntegration(this.lifecycle, 'ERROR', { error: { code: /authentification/i.test(error instanceof Error ? error.message : '') ? 'WIZEBOT_AUTH_REFUSED' : 'WIZEBOT_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true, details: null } }); } return this.state(); }
}
