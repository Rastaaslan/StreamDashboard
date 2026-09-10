import type { DashboardCommand, DashboardSettings, DashboardState, ObsState, RunMode } from '../../../packages/contracts/src/index.js';
import { applyDashboardCommand, startNewSessionTimer, type DashboardDomainState } from '../../../packages/core/src/dashboard.js';

export const END_SCENE_VISIBILITY_MS = 1_500;

export interface ObsCommands {
  readonly state: Pick<ObsState, 'connected' | 'streaming'>;
  scene(name: string): Promise<void>; mute(input: string, muted: boolean): Promise<void>; volume(input: string, volume: number): Promise<void>;
  stream(start: boolean): Promise<void>; record(start: boolean): Promise<void>; restartMedia(input: string): Promise<void>; refresh(): Promise<void>;
  waitForStreaming?(expected: boolean, timeoutMs?: number): Promise<void>;
}
export interface CommandContext { settings: Pick<DashboardSettings, 'modeScenes'>; logger?: Pick<Console, 'info'>; wait?: (milliseconds: number) => Promise<void> }

/** Unique application command bus shared by the desktop UI and future remote clients. */
export class DashboardCommandService {
  constructor(private domain: DashboardDomainState, private obs: ObsCommands, private commit: () => Promise<DashboardState>, private context: CommandContext = { settings: { modeScenes: {} } }) {}

  private async setMode(mode: RunMode) {
    if (mode !== 'idle') {
      const scene = this.context.settings.modeScenes[mode];
      if (!scene) throw new Error(`Aucune scène associée au mode ${mode}.`);
      await this.obs.scene(scene);
    }
    this.domain.mode = mode;
  }

  async execute(command: DashboardCommand) {
    if (!command || typeof command.type !== 'string') throw new Error('Commande invalide.');
    this.context.logger?.info(`command ${command.type}`);
    if (command.type === 'session.prepare') { await this.obs.refresh(); return this.commit(); }
    if (command.type === 'session.start') {
      if (!this.obs.state.connected) throw new Error('Impossible de démarrer la diffusion : OBS n’est pas connecté.');
      if (!command.force && this.domain.checklist.some(item => !item.done)) { const error = new Error('Certaines vérifications ne sont pas terminées.'); error.name = 'CHECKLIST_INCOMPLETE'; throw error; }
      const liveScene = this.context.settings.modeScenes.live;
      if (liveScene) await this.obs.scene(liveScene);
      await this.obs.stream(true); await this.obs.waitForStreaming?.(true);
      this.domain.mode = 'live'; startNewSessionTimer(this.domain); return this.commit();
    }
    if (command.type === 'session.stop') {
      if (!this.obs.state.connected) throw new Error('Impossible d’arrêter la diffusion : OBS n’est pas connecté.');
      const endScene = this.context.settings.modeScenes.end;
      if (endScene) { await this.obs.scene(endScene); await (this.context.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(END_SCENE_VISIBILITY_MS); }
      await this.obs.stream(false); await this.obs.waitForStreaming?.(false);
      applyDashboardCommand(this.domain, { type: 'timer.pause' }); this.domain.mode = 'end'; return this.commit();
    }
    if (command.type === 'mode.set') { await this.setMode(command.mode); await this.obs.refresh(); return this.commit(); }
    if (applyDashboardCommand(this.domain, command)) return this.commit();
    switch (command.type) {
      case 'obs.scene': if (!command.scene.trim()) throw new Error('Scène OBS invalide.'); await this.obs.scene(command.scene); break;
      case 'obs.mute': if (!command.input.trim()) throw new Error('Source OBS invalide.'); await this.obs.mute(command.input, command.muted); break;
      case 'obs.volume': if (!command.input.trim() || !Number.isFinite(command.volume)) throw new Error('Volume OBS invalide.'); await this.obs.volume(command.input, Math.min(1.5, Math.max(0, command.volume))); break;
      case 'obs.stream': await this.obs.stream(command.start); break;
      case 'obs.record': await this.obs.record(command.start); break;
      case 'obs.media.restart': if (!command.input.trim()) throw new Error('Média OBS invalide.'); await this.obs.restartMedia(command.input); break;
      default: throw new Error(`Commande inconnue : ${(command as { type: string }).type}`);
    }
    if (command.type !== 'obs.media.restart') await this.obs.refresh();
    return this.commit();
  }
}
