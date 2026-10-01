export interface ProviderDiagnostic {
  code: string;
  configured: boolean;
  connected: boolean;
  requiresReauth: boolean;
  tested: boolean;
  capabilities: string[];
  scopes: string[];
  calendar: string;
  lastSync: string;
  error: string;
}

export interface CapabilityAvailability { available: boolean; reason: string }

export function providerError(code?: string): string;
export function providerDiagnostic(raw?: Record<string, unknown>): ProviderDiagnostic;
export function capabilityAvailability(snapshot: Partial<ProviderDiagnostic>, capability: string): CapabilityAvailability;
export function wizardState(snapshot: Partial<ProviderDiagnostic>, pending?: boolean): {
  step: 'configuration' | 'oauth' | 'test' | 'ready';
  label: string;
  reason: string;
};
export function planningPublicationPermissions(options: {
  mode: string;
  pcState?: {
    twitch?: { connected?: boolean };
    google?: { configured?: boolean; connected?: boolean; targetConfigured?: boolean };
  } | null;
  twitchCapabilities?: { schedule?: boolean } | null;
  phone?: Partial<Record<'twitch' | 'google', Partial<ProviderDiagnostic>>>;
}): Record<'twitch' | 'google', CapabilityAvailability>;
