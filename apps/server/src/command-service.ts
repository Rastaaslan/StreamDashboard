import type { DashboardCommand, DashboardSettings, DashboardState, RunMode } from '../../../packages/contracts/src/index.js';
import { applyDashboardCommand, startNewSessionTimer, type DashboardDomainState } from '../../../packages/core/src/dashboard.js';

export const END_SCENE_VISIBILITY_MS = 1_500;

export interface ObsCommands {
  readonly state: { connected: boolean; streaming: boolean; scene?: string | null };
  scene(name: string): Promise<void>; mute(input: string, muted: boolean): Promise<void>; volume(input: string, volume: number): Promise<void>;
  volumeDb?(input: string, volumeDb: number): Promise<void>; refreshBrowserSource?(input: string): Promise<void>;
  stream(start: boolean): Promise<void>; record(start: boolean): Promise<void>; restartMedia(input: string): Promise<void>; refresh(): Promise<void>;
  waitForStreaming?(expected: boolean, timeoutMs?: number): Promise<void>;
  waitForScene?(expected: string, timeoutMs?: number): Promise<void>;
}
export interface CommandContext { settings: Pick<DashboardSettings, 'modeScenes' | 'timerBrowserSource'>; logger?: Pick<Console, 'info' | 'warn'>; wait?: (milliseconds: number) => Promise<void> }

/** Unique, serialized application command bus shared by every client. */
export class DashboardCommandService {
  private queue: Promise<void> = Promise.resolve();

  constructor(private domain: DashboardDomainState, private obs: ObsCommands, private commit: () => Promise<DashboardState>, private context: CommandContext = { settings: { modeScenes: {} } }) {}

  execute(command: DashboardCommand) {
    const operation = this.queue.then(() => this.executeNow(command));
    this.queue = operation.then(() => undefined, () => undefined);
    return operation;
  }

  private async confirmScene(scene: string) {
    if (this.obs.waitForScene) { await this.obs.waitForScene(scene); return; }
    // Older/mocked ObsCommands do not expose the current scene. Keep compatibility,
    // while real ObsClient always exposes it and therefore gets a hard confirmation.
    if (this.obs.state.scene === undefined) return;
    await this.obs.refresh();
    if (this.obs.state.scene !== scene) throw new Error(`OBS n’a pas confirmé la scène « ${scene} ».`);
  }

  private async setMode(mode: RunMode) {
    if (mode !== 'idle') {
      const scene = this.context.settings.modeScenes[mode];
      if (!scene) throw new Error(`Aucune scène associée au mode ${mode}.`);
      await this.obs.scene(scene);
      await this.confirmScene(scene);
    }
    this.domain.mode = mode;
  }

  private async refreshTimerBrowserSource() {
    const source = this.context.settings.timerBrowserSource?.trim();
    if (!source || !this.obs.refreshBrowserSource) return;
    try { await this.obs.refreshBrowserSource(source); }
    catch (error) { this.context.logger?.warn(`Impossible de rafraîchir la Browser Source timer « ${source} ».`, error); }
  }

  private async applyStreamState(expected: boolean) {
    try { await this.obs.stream(expected); }
    catch (commandError) {
      try { await this.obs.refresh(); } catch { /* keep the original command error */ }
      if (this.obs.state.streaming !== expected) throw commandError;
      return;
    }
    if (!this.obs.waitForStreaming) return;
    try { await this.obs.waitForStreaming(expected); }
    catch (confirmationError) {
      try { await this.obs.refresh(); } catch { /* confirmation error remains authoritative */ }
      if (this.obs.state.streaming !== expected) throw confirmationError;
    }
  }

  private async executeNow(command: DashboardCommand): Promise<DashboardState> {
    if (!command || typeof command.type !== 'string') throw new Error('Commande invalide.');
    this.context.logger?.info(`command ${command.type}`);

    if (command.type === 'obs.stream') return this.executeNow(command.start ? { type: 'session.start' } : { type: 'session.stop' });

    if (command.type === 'session.prepare') {
      await this.obs.refresh();
      if (!this.obs.state.streaming) applyDashboardCommand(this.domain, { type: 'timer.reset' });
      await this.refreshTimerBrowserSource();
      return this.commit();
    }
    if (command.type === 'session.start') {
      if (!this.obs.state.connected) throw new Error('Impossible de démarrer la diffusion : OBS n’est pas connecté.');
      if (this.obs.state.streaming) throw new Error('La diffusion OBS est déjà active.');
      if (!command.force && this.domain.checklist.some(item => !item.done)) { const error = new Error('Certaines vérifications ne sont pas terminées.'); error.name = 'CHECKLIST_INCOMPLETE'; throw error; }
      const liveScene = this.context.settings.modeScenes.live;
      if (liveScene) {
        await this.obs.scene(liveScene);
        await this.confirmScene(liveScene);
      }
      await this.refreshTimerBrowserSource();
      await this.applyStreamState(true);
      this.domain.mode = 'live';
      startNewSessionTimer(this.domain);
      return this.commit();
    }
    if (command.type === 'session.stop') {
      if (!this.obs.state.connected) throw new Error('Impossible d’arrêter la diffusion : OBS n’est pas connecté.');
      if (!this.obs.state.streaming) throw new Error('La diffusion OBS est déjà arrêtée.');
      const endScene = this.context.settings.modeScenes.end;
      if (endScene) {
        try {
          await this.obs.scene(endScene);
          await this.confirmScene(endScene);
          await (this.context.wait ?? (ms => new Promise(resolve => setTimeout(resolve, ms))))(END_SCENE_VISIBILITY_MS);
        } catch (error) {
          this.context.logger?.warn('Impossible d’afficher/confirmer la scène End avant arrêt ; arrêt du stream poursuivi.', error);
        }
      }
      await this.applyStreamState(false);
      applyDashboardCommand(this.domain, { type: 'timer.pause' });
      this.domain.mode = 'end';
      return this.commit();
    }
    if (command.type === 'mode.set') { await this.setMode(command.mode); await this.obs.refresh(); return this.commit(); }
    if (applyDashboardCommand(this.domain, command)) return this.commit();
    switch (command.type) {
      case 'obs.scene': if (!command.scene.trim()) throw new Error('Scène OBS invalide.'); await this.obs.scene(command.scene); await this.confirmScene(command.scene); break;
      case 'obs.mute': if (!command.input.trim()) throw new Error('Source OBS invalide.'); await this.obs.mute(command.input, command.muted); break;
      case 'obs.volume': if (!command.input.trim() || !Number.isFinite(command.volume)) throw new Error('Volume OBS invalide.'); await this.obs.volume(command.input, Math.min(1.5, Math.max(0, command.volume))); break;
      case 'obs.volumeDb': if (!command.input.trim() || !Number.isFinite(command.volumeDb) || !this.obs.volumeDb) throw new Error('Volume OBS en dB indisponible.'); await this.obs.volumeDb(command.input, Math.min(26, Math.max(-100, command.volumeDb))); break;
      case 'obs.browser.refresh': if (!command.input.trim() || !this.obs.refreshBrowserSource) throw new Error('Rafraîchissement Browser Source indisponible.'); await this.obs.refreshBrowserSource(command.input); break;
      case 'obs.record': await this.obs.record(command.start); break;
      case 'obs.media.restart': if (!command.input.trim()) throw new Error('Média OBS invalide.'); await this.obs.restartMedia(command.input); break;
      default: throw new Error(`Commande inconnue : ${(command as { type: string }).type}`);
    }
    if (command.type !== 'obs.media.restart' && command.type !== 'obs.browser.refresh') await this.obs.refresh();
    return this.commit();
  }
}
