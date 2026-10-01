import type { IntegrationState, IntegrationStatus, StructuredError } from '../../contracts/src/index.js';

export function integrationState(status: IntegrationStatus = 'DISCONNECTED'): IntegrationState {
  return { status, lastConnectedAt: null, lastEventAt: null, lastError: null, retryState: { attempt: 0, nextRetryAt: null } };
}

export function transitionIntegration(current: IntegrationState, status: IntegrationStatus, options: { at?: string; error?: StructuredError; nextRetryAt?: string | null } = {}): IntegrationState {
  const at = new Date(options.at ?? Date.now()).toISOString();
  if (!Number.isFinite(Date.parse(at))) throw new Error('Date de transition invalide.');
  const failed = status === 'DEGRADED' || status === 'ERROR';
  return {
    status,
    lastConnectedAt: status === 'CONNECTED' ? at : current.lastConnectedAt,
    lastEventAt: current.lastEventAt,
    lastError: failed ? (options.error ? { code: options.error.code, message: options.error.message, retryable: options.error.retryable } : current.lastError) : null,
    retryState: {
      attempt: failed ? current.retryState.attempt + 1 : 0,
      nextRetryAt: failed ? (options.nextRetryAt ?? null) : null,
    },
  };
}
