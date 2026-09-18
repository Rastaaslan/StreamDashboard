import type { IntegrationState } from '../../../packages/contracts/src/index.js';
import { integrationState, transitionIntegration } from '../../../packages/core/src/integrations.js';

export interface WizeBotConfiguration { apiBaseUrl: string; token: string }
export interface WizeBotTransport { status(configuration: WizeBotConfiguration): Promise<{ name: string; connected: boolean; data?: Record<string, unknown> }> }
export class WizeBotAdapter {
  private lifecycle = integrationState('NOT_CONFIGURED');
  constructor(private configuration: WizeBotConfiguration | null, private readonly transport?: WizeBotTransport) { this.lifecycle = integrationState(transport ? (configuration ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }
  state(): IntegrationState { return structuredClone(this.lifecycle); }
  configure(configuration: WizeBotConfiguration | null) { this.configuration = configuration; this.lifecycle = integrationState(this.transport ? (configuration ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }
  async refresh() { if (!this.transport) return this.lifecycle = integrationState('NOT_SUPPORTED'); if (!this.configuration) return this.lifecycle = integrationState('NOT_CONFIGURED'); this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTING'); try { const status = await this.transport.status(this.configuration); this.lifecycle = transitionIntegration(this.lifecycle, status.connected ? 'CONNECTED' : 'DEGRADED', status.connected ? {} : { error: { code: 'WIZEBOT_DISCONNECTED', message: 'WizeBot indique un état déconnecté.', retryable: true, details: null } }); } catch (error) { this.lifecycle = transitionIntegration(this.lifecycle, 'ERROR', { error: { code: 'WIZEBOT_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true, details: null } }); } return this.state(); }
}
