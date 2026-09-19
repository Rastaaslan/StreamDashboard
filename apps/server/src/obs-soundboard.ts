import type { AudioOutput } from '../../../packages/contracts/src/index.js';
import type { AudioPlayback, PlaybackSession } from './soundboard-runtime.js';

export const OBS_SOUNDBOARD_INPUT = 'StreamDashboard • Soundboard';

export interface ObsSoundboardClient {
  state: { connected: boolean };
  setInputSettings(inputName: string, settings: Record<string, unknown>): Promise<void>;
  volume(inputName: string, volume: number): Promise<void>;
  restartMedia(inputName: string): Promise<void>;
  stopMedia(inputName: string): Promise<void>;
  setMonitorType(inputName: string, type: 'OBS_MONITORING_TYPE_NONE' | 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'): Promise<void>;
  onMediaEnded(listener: (inputName: string) => void): () => void;
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
    let remove: () => void = () => undefined;
    const finished = new Promise<void>(resolve => {
      this.finish = () => { remove(); this.finish = undefined; resolve(); };
      remove = this.obs.onMediaEnded(name => { if (name === this.inputName) this.finish?.(); });
    });
    try { await this.obs.restartMedia(this.inputName); }
    catch (error) { remove(); this.finish = undefined; throw error; }
    return { finished };
  }

  async stop() {
    if (!this.obs.state.connected) { this.finish?.(); return; }
    await this.obs.stopMedia(this.inputName);
    this.finish?.();
  }
}

function obsUnavailable() {
  const error = new Error('OBS WebSocket est indisponible. Ouvrez OBS puis vérifiez la connexion.');
  error.name = 'OBS_UNAVAILABLE';
  Object.assign(error, { retryable: true });
  return error;
}
