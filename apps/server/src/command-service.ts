import type { DashboardCommand, DashboardState } from '../../../packages/contracts/src/index.js';
import { applyDashboardCommand, type DashboardDomainState } from '../../../packages/core/src/dashboard.js';

export interface ObsCommands {
  scene(name: string): Promise<void>;
  mute(input: string, muted: boolean): Promise<void>;
  volume(input: string, volume: number): Promise<void>;
  stream(start: boolean): Promise<void>;
  record(start: boolean): Promise<void>;
  restartMedia(input: string): Promise<void>;
  refresh(): Promise<void>;
}

/** Application service: validates and dispatches commands, then persists one canonical snapshot. */
export class DashboardCommandService {
  constructor(private domain: DashboardDomainState, private obs: ObsCommands, private commit: () => Promise<DashboardState>) {}

  async execute(command: DashboardCommand) {
    if (!command || typeof command.type !== 'string') throw new Error('Commande invalide.');
    if (applyDashboardCommand(this.domain, command)) return this.commit();

    switch (command.type) {
      case 'obs.scene': if (!command.scene.trim()) throw new Error('Scène OBS invalide.'); await this.obs.scene(command.scene); break;
      case 'obs.mute': if (!command.input.trim()) throw new Error('Source OBS invalide.'); await this.obs.mute(command.input, command.muted); break;
      case 'obs.volume': {
        if (!command.input.trim() || !Number.isFinite(command.volume)) throw new Error('Volume OBS invalide.');
        await this.obs.volume(command.input, Math.min(1.5, Math.max(0, command.volume))); break;
      }
      case 'obs.stream': await this.obs.stream(command.start); break;
      case 'obs.record': await this.obs.record(command.start); break;
      case 'obs.media.restart': if (!command.input.trim()) throw new Error('Média OBS invalide.'); await this.obs.restartMedia(command.input); break;
      default: throw new Error(`Commande inconnue : ${(command as { type: string }).type}`);
    }
    if (command.type !== 'obs.media.restart') await this.obs.refresh();
    return this.commit();
  }
}
