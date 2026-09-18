import type { IntegrationState } from '../../../packages/contracts/src/index.js';
import { integrationState, transitionIntegration } from '../../../packages/core/src/integrations.js';

export interface DiscordSoundboardTransport { list(): Promise<Array<{ id: string; name: string; emoji: string | null }>>; play(soundId: string): Promise<void> }
export class DiscordSoundboardProvider {
  private lifecycle = integrationState('NOT_CONFIGURED');
  constructor(private configured: boolean, private readonly transport?: DiscordSoundboardTransport) { this.lifecycle = integrationState(transport ? (configured ? 'DISCONNECTED' : 'NOT_CONFIGURED') : 'NOT_SUPPORTED'); }
  state(): IntegrationState { return structuredClone(this.lifecycle); }
  async sounds() { if (!this.transport) { this.lifecycle = integrationState('NOT_SUPPORTED'); throw named('DISCORD_SOUNDBOARD_NOT_SUPPORTED', 'Cette distribution ne possède pas de transport vocal Discord Soundboard vérifié.'); } if (!this.configured) { this.lifecycle = integrationState('NOT_CONFIGURED'); throw named('DISCORD_SOUNDBOARD_NOT_CONFIGURED', 'Discord Soundboard n’est pas configuré.'); } try { const sounds = await this.transport.list(); this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTED'); return sounds; } catch (error) { this.fail(error); throw error; } }
  async play(soundId: string) { if (!/^[A-Za-z0-9_-]{1,100}$/.test(soundId)) throw named('DISCORD_SOUND_INVALID', 'Son Discord invalide.'); if (!this.configured || !this.transport) return this.sounds().then(() => undefined); try { await this.transport.play(soundId); this.lifecycle = transitionIntegration(this.lifecycle, 'CONNECTED'); } catch (error) { this.fail(error); throw error; } }
  private fail(error: unknown) { this.lifecycle = transitionIntegration(this.lifecycle, 'ERROR', { error: { code: 'DISCORD_SOUNDBOARD_FAILED', message: error instanceof Error ? error.message : String(error), retryable: true, details: null } }); }
}
function named(name: string, message: string) { const error = new Error(message); error.name = name; return error; }
