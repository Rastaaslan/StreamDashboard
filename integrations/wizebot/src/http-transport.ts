import type { WizeBotConfiguration, WizeBotTransport } from './adapter.js';

export class WizeBotHttpTransport implements WizeBotTransport {
  constructor(private readonly request: typeof fetch = fetch, private readonly timeoutMs = 10_000) {}
  async status(configuration: WizeBotConfiguration) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      // apiBaseUrl is the complete status resource supplied by WizeBot, so no
      // undocumented endpoint is appended here.
      const response = await this.request(configuration.apiBaseUrl, {
        headers: { authorization: `Bearer ${configuration.token}`, accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) throw new Error('Authentification WizeBot refusée.');
      if (!response.ok) throw new Error(`WizeBot indisponible (HTTP ${response.status}).`);
      const value = await response.json() as Record<string, unknown>;
      const connected = value.connected === true || value.online === true || value.status === 'online' || value.status === 'connected';
      const name = String(value.name ?? value.displayName ?? value.account ?? 'WizeBot').slice(0, 100);
      return { name, connected, data: { status: value.status ?? (connected ? 'connected' : 'disconnected') } };
    } finally { clearTimeout(timeout); }
  }
}
