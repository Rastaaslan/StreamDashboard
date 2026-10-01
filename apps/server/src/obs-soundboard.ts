import type { AudioOutput } from '../../../packages/contracts/src/index.js';
import type { AudioPlayback, PlaybackSession } from './soundboard-runtime.js';

export const OBS_SOUNDBOARD_INPUT = 'StreamDashboard • Soundboard';

export interface ObsSoundboardClient {
  state: { connected: boolean; scenes?: string[] };
  setInputSettings(inputName: string, settings: Record<string, unknown>): Promise<void>;
  volume(inputName: string, volume: number): Promise<void>;
  restartMedia(inputName: string): Promise<void>;
  stopMedia(inputName: string): Promise<void>;
  setMonitorType(inputName: string, type: 'OBS_MONITORING_TYPE_NONE' | 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'): Promise<void>;
  verifySoundboardPlayback?(inputName: string): Promise<void>;
  onStateChanged?(listener: () => void): () => void;
  onMediaEnded(listener: (inputName: string) => void): () => void;
}
export interface ObsSoundboardSetupClient extends ObsSoundboardClient {
  sceneSourceEnabled?(sceneName: string, sourceName: string): Promise<boolean>;
  inputAudioReadiness?(inputName: string): Promise<{ active: boolean; audible: boolean }>;
  inputKind(inputName: string): Promise<string | null>;
  sceneExists(sceneName: string): boolean;
  sceneHasSource(sceneName: string, sourceName: string): Promise<boolean>;
  createMediaInput(sceneName: string, inputName: string): Promise<void>;
  addInputToScene(sceneName: string, sourceName: string): Promise<void>;
}
export interface ObsSoundboardSetupStatus {
  connected: boolean; inputName: string; inputExists: boolean; inputKind: string | null; wrongInputKind: boolean;
  inactiveScenes?: string[]; active?: boolean; audible?: boolean; diagnostic?: string;
  targetScenes: string[]; attachedScenes: string[]; missingScenes: string[]; ready: boolean;
}

/** OBS is the live mix: this backend never falls back silently to desktop audio. */
export class ObsSoundboardPlayback implements AudioPlayback {
  readonly available = true;
  readonly supportedFormats = ['wav', 'mp3', 'ogg', 'aac', 'm4a', 'flac'];
  readonly supportsVolume = true;
  readonly supportsStop = true;
  readonly supportsExplicitOutputSelection = false;
  private finish?: () => void;
  constructor(private readonly obs: ObsSoundboardClient, private readonly inputName = OBS_SOUNDBOARD_INPUT) {}
  async outputs(): Promise<AudioOutput[]> {
    if (!this.obs.state.connected) throw obsUnavailable();
    return [{ id: 'obs', name: 'Mix OBS', isDefault: true, selectable: true }];
  }
  async play(input: { file: string; volume: number; outputId: string; monitoringMode?: 'stream' | 'monitor' }): Promise<PlaybackSession> {
    if (!this.obs.state.connected) throw obsUnavailable();
    await this.stop();
    await this.obs.setInputSettings(this.inputName, { local_file: input.file, is_local_file: true, close_when_inactive: false });
    await this.obs.volume(this.inputName, input.volume);
    await this.obs.setMonitorType(this.inputName, input.monitoringMode === 'monitor' ? 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT' : 'OBS_MONITORING_TYPE_NONE');
    if (!this.obs.verifySoundboardPlayback) throw new Error('Vérification audio OBS indisponible.');
    await this.obs.verifySoundboardPlayback(this.inputName);
    let remove: () => void = () => undefined;
    let removeState: () => void = () => undefined;
    const finished = new Promise<void>(resolve => {
      this.finish = () => { remove(); removeState(); this.finish = undefined; resolve(); };
      removeState = this.obs.onStateChanged?.(() => { if (!this.obs.state.connected) this.finish?.(); }) ?? (() => undefined);
      remove = this.obs.onMediaEnded(name => { if (name === this.inputName) this.finish?.(); });
    });
    try { await this.obs.restartMedia(this.inputName); }
    catch (error) { remove(); removeState(); this.finish = undefined; throw error; }
    return { finished };
  }
  async stop() {
    if (!this.obs.state.connected) { this.finish?.(); return; }
    await this.obs.stopMedia(this.inputName);
    this.finish?.();
  }
  async setVolume(volume: number) {
    if (!this.obs.state.connected) throw obsUnavailable();
    await this.obs.volume(this.inputName, volume);
  }
}

export class ObsSoundboardSetup {
  constructor(private readonly obs: ObsSoundboardSetupClient, private readonly inputName = OBS_SOUNDBOARD_INPUT) {}
  async status(targetScenes: string[]): Promise<ObsSoundboardSetupStatus> {
    const uniqueTargets = [...new Set(targetScenes.map(value => value.trim()).filter(Boolean))];
    if (!this.obs.state.connected) return { connected:false,inputName:this.inputName,inputExists:false,inputKind:null,wrongInputKind:false,targetScenes:uniqueTargets,attachedScenes:[],missingScenes:uniqueTargets,ready:false };
    const presentScenes = uniqueTargets.filter(scene => this.obs.sceneExists(scene));
    const missingScenes = uniqueTargets.filter(scene => !this.obs.sceneExists(scene));
    const inputKind = await this.obs.inputKind(this.inputName);
    const inputExists = inputKind !== null;
    const attachedScenes: string[] = [];
    if (inputExists) for (const scene of presentScenes) if (await this.obs.sceneHasSource(scene, this.inputName)) attachedScenes.push(scene);
    const wrongInputKind = inputExists && inputKind !== 'ffmpeg_source';
    const inactiveScenes: string[] = [];
    for (const scene of attachedScenes) if (!this.obs.sceneSourceEnabled || !await this.obs.sceneSourceEnabled(scene, this.inputName)) inactiveScenes.push(scene);
    let audio = { active: false, audible: false }, diagnostic = '';
    if (inputExists && !wrongInputKind) {
      try { if (this.obs.inputAudioReadiness) audio = await this.obs.inputAudioReadiness(this.inputName); else diagnostic = 'Vérification audio OBS indisponible.'; }
      catch { diagnostic = 'Impossible de vérifier les pistes et le volume OBS.'; }
    }
    if (!diagnostic && (!audio.active || !audio.audible || inactiveScenes.length)) diagnostic = 'Vérifier activation, scène courante, mute, volume et pistes de la Soundboard.';
    return { connected:true,inputName:this.inputName,inputExists,inputKind,wrongInputKind,targetScenes:uniqueTargets,attachedScenes,missingScenes,inactiveScenes,...audio,diagnostic,ready:!wrongInputKind&&inputExists&&uniqueTargets.length>0&&missingScenes.length===0&&attachedScenes.length===presentScenes.length&&!inactiveScenes.length&&audio.active&&audio.audible };

  }
  async ensure(targetScenes: string[]) {
    if (!this.obs.state.connected) throw obsUnavailable();
    const before = await this.status(targetScenes);
    if (before.wrongInputKind) {
      const error = new Error(`Une source « ${this.inputName} » existe déjà dans OBS mais n’est pas une Media Source.`);
      error.name = 'OBS_SOUNDBOARD_INPUT_KIND_MISMATCH'; Object.assign(error,{retryable:false}); throw error;
    }
    const present = before.targetScenes.filter(scene => !before.missingScenes.includes(scene));
    if (!present.length) {
      const error = new Error('Aucune scène OBS configurée pour recevoir la Soundboard.');
      error.name = 'OBS_SOUNDBOARD_NO_TARGET_SCENE'; Object.assign(error,{retryable:false}); throw error;
    }
    if (!before.inputExists) await this.obs.createMediaInput(present[0], this.inputName);
    const afterCreate = await this.status(targetScenes);
    for (const scene of present) if (!afterCreate.attachedScenes.includes(scene)) await this.obs.addInputToScene(scene, this.inputName);
    return this.status(targetScenes);
  }
}

function obsUnavailable() {
  const error = new Error('OBS WebSocket est indisponible. Ouvrez OBS puis vérifiez la connexion.');
  error.name = 'OBS_UNAVAILABLE'; Object.assign(error,{retryable:true}); return error;
}
