import type { IntegrationState } from '../../../packages/contracts/src/index.js';
import { integrationState, transitionIntegration } from '../../../packages/core/src/integrations.js';

export interface WizeBotConfiguration { apiBaseUrl: string; token: string }
export interface WizeBotTransport { status(configuration: WizeBotConfiguration): Promise<{ name: string; connected: boolean; data?: Record<string, unknown> }> }
export class WizeBotAdapter {
  private lifecycle = integrationState('NOT_CONFIGURED');
  constructor(private configuration: WizeBotConfiguration | null, private readonly transport?: WizeBotTransport) {}
  state(): IntegrationState { return structuredClone(this.lifecycle); }
  configure(configuration: WizeBotConfiguration | null) { this.configuration = configuration; this.lifecycle = integrationState(configuration ? 'DISCONNECTED' : 'NOT_CONFIGURED'); }
  async refresh() { if (!this.configuration) return this.lifecycle = integrationState('NOT_CONFIGURED'); this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTING'); if (!this.transport) return this.lifecycle = transitionIntegration(this.lifecycle, 'ERROR', { error: { code: 'WIZEBOT_TRANSPORT_UNAVAILABLE', message: 'Aucun contrat API WizeBot vérifié n’est configuré.', retryable: false, details: null } }); try { const status = await this.transport.status(this.configuration); this.lifecycle = transitionIntegration(this.lifecycle, status.connected ? 'CONNECTED' : 'DEGRADED', status.connected ? {} : { error: { code: 'WIZEBOT_DISCONNECTED', message: 'WizeBot indique un état déconnecté.', retryable: true, details: null } }); } catch (error) { this.lifecycle = transitionIntegration(this.lifecycle, 'ERROR', { error: { code: 'WIZEBOT_REQUEST_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true, details: null } }); } return this.state(); }
}
