import OBSWebSocket from 'obs-websocket-js';
import type { ObsState } from '../../../packages/contracts/src/index.js';

export class ObsClient {
  private client = new OBSWebSocket();
  private reconnects = 0;
  private retry?: NodeJS.Timeout;
  state: ObsState = { connected: false, streaming: false, recording: false, scene: null, scenes: [], inputs: {} };

  constructor(private url = process.env.OBS_URL ?? 'ws://127.0.0.1:4455', private password = process.env.OBS_PASSWORD ?? '') {
    this.client.on('ConnectionClosed', () => { this.state.connected = false; this.schedule(); });
    this.client.on('CurrentProgramSceneChanged', ({ sceneName }) => { this.state.scene = sceneName; });
    this.client.on('StreamStateChanged', ({ outputActive }) => { this.state.streaming = outputActive; });
    this.client.on('RecordStateChanged', ({ outputActive }) => { this.state.recording = outputActive; });
    this.client.on('InputMuteStateChanged', ({ inputName, inputMuted }) => {
      this.state.inputs[inputName] = { ...(this.state.inputs[inputName] ?? { volume: 1 }), muted: inputMuted };
    });
  }

  async connect() { try { await this.client.connect(this.url, this.password); this.state.connected = true; this.reconnects = 0; await this.refresh(); } catch { this.schedule(); } }
  private schedule() { if (this.retry) return; this.reconnects++; this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(this.reconnects, 5))); }
  async refresh() {
    if (!this.state.connected) return;
    const [scene, scenes, stream, record, inputs] = await Promise.all([
      this.client.call('GetCurrentProgramScene'), this.client.call('GetSceneList'), this.client.call('GetStreamStatus'),
      this.client.call('GetRecordStatus'), this.client.call('GetInputList'),
    ]);
    this.state.scene = scene.currentProgramSceneName;
    this.state.scenes = scenes.scenes.map(({ sceneName }) => String(sceneName));
    this.state.streaming = stream.outputActive; this.state.recording = record.outputActive;
    await Promise.all(inputs.inputs.map(async ({ inputName }) => {
      const name = String(inputName);
      try {
        const [mute, volume] = await Promise.all([this.client.call('GetInputMute', { inputName: name }), this.client.call('GetInputVolume', { inputName: name })]);
        this.state.inputs[name] = { muted: mute.inputMuted, volume: volume.inputVolumeMul };
      } catch { /* Inputs without audio capabilities are intentionally omitted. */ }
    }));
  }
  async scene(sceneName: string) { await this.client.call('SetCurrentProgramScene', { sceneName }); }
  async mute(inputName: string, inputMuted: boolean) { await this.client.call('SetInputMute', { inputName, inputMuted }); }
  async volume(inputName: string, inputVolumeMul: number) { await this.client.call('SetInputVolume', { inputName, inputVolumeMul }); }
  async stream(start: boolean) { await this.client.call(start ? 'StartStream' : 'StopStream'); }
  async record(start: boolean) { await this.client.call(start ? 'StartRecord' : 'StopRecord'); }
  get reconnectCount() { return this.reconnects; }
}
