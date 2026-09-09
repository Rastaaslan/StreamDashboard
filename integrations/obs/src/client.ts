import OBSWebSocket from 'obs-websocket-js';
import type { ObsState } from '../../../packages/contracts/src/index.js';

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication|required|identified/i.test(message)) return 'Mot de passe OBS incorrect ou manquant.';
  if (/ECONNREFUSED|connect|closed/i.test(message)) return 'Impossible de joindre OBS WebSocket. Vérifiez qu’OBS est lancé et que le serveur WebSocket est activé.';
  return message || 'Connexion OBS impossible.';
}

export class ObsClient {
  private client = new OBSWebSocket();
  private reconnects = 0;
  private retry?: NodeJS.Timeout;
  private suppressReconnect = false;
  state: ObsState = { connected: false, streaming: false, recording: false, scene: null, scenes: [], inputs: {}, activeAudioInputs: [], mediaInputs: [], error: null, obsVersion: null, websocketVersion: null };

  constructor(private url = process.env.OBS_URL ?? 'ws://127.0.0.1:4455', private password = process.env.OBS_PASSWORD ?? '') {
    this.client.on('ConnectionClosed', () => {
      this.state.connected = false;
      if (!this.suppressReconnect) this.schedule();
    });
    this.client.on('CurrentProgramSceneChanged', ({ sceneName }) => { this.state.scene = sceneName; void this.refresh().catch(() => undefined); });
    this.client.on('StreamStateChanged', ({ outputActive }) => { this.state.streaming = outputActive; });
    this.client.on('RecordStateChanged', ({ outputActive }) => { this.state.recording = outputActive; });
    this.client.on('InputMuteStateChanged', ({ inputName, inputMuted }) => {
      this.state.inputs[inputName] = { ...(this.state.inputs[inputName] ?? { volume: 1 }), muted: inputMuted };
    });
  }

  async connect() {
    try {
      await this.client.connect(this.url, this.password);
      this.state.connected = true;
      this.state.error = null;
      this.reconnects = 0;
      await this.refresh();
    } catch (error) {
      this.state.connected = false;
      this.state.error = friendlyError(error);
      this.schedule();
    }
  }

  private schedule() {
    if (this.retry) return;
    this.reconnects++;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(this.reconnects, 5)));
  }

  async configure(url: string, password: string) {
    if (this.retry) { clearTimeout(this.retry); this.retry = undefined; }
    this.suppressReconnect = true;
    try { await this.client.disconnect(); } catch { /* already disconnected */ }
    this.suppressReconnect = false;
    this.url = url;
    this.password = password;
    this.state.connected = false;
    this.state.error = null;
    await this.connect();
    return this.state;
  }

  async test(url: string, password: string) {
    const probe = new OBSWebSocket();
    try {
      await probe.connect(url, password);
      const version = await probe.call('GetVersion');
      await probe.disconnect();
      return { ok: true, obsVersion: String(version.obsVersion ?? ''), websocketVersion: String(version.obsWebSocketVersion ?? '') };
    } catch (error) {
      try { await probe.disconnect(); } catch { /* noop */ }
      throw new Error(friendlyError(error));
    }
  }

  async refresh() {
    if (!this.state.connected) return;
    const [version, scene, scenes, stream, record, inputs, specialInputs] = await Promise.all([
      this.client.call('GetVersion'), this.client.call('GetCurrentProgramScene'), this.client.call('GetSceneList'), this.client.call('GetStreamStatus'),
      this.client.call('GetRecordStatus'), this.client.call('GetInputList'), this.client.call('GetSpecialInputs'),
    ]);
    this.state.obsVersion = String(version.obsVersion ?? '');
    this.state.websocketVersion = String(version.obsWebSocketVersion ?? '');
    this.state.scene = scene.currentProgramSceneName;
    this.state.scenes = scenes.scenes.map(({ sceneName }) => String(sceneName));
    this.state.streaming = stream.outputActive;
    this.state.recording = record.outputActive;
    this.state.inputs = {};
    this.state.mediaInputs = inputs.inputs
      .filter(({ inputKind }) => ['ffmpeg_source', 'vlc_source', 'slideshow', 'slideshow_v2'].includes(String(inputKind)))
      .map(({ inputName }) => String(inputName));
    await Promise.all(inputs.inputs.map(async ({ inputName }) => {
      const name = String(inputName);
      try {
        const [mute, volume] = await Promise.all([this.client.call('GetInputMute', { inputName: name }), this.client.call('GetInputVolume', { inputName: name })]);
        this.state.inputs[name] = { muted: mute.inputMuted, volume: volume.inputVolumeMul };
      } catch { /* Inputs without audio capabilities are intentionally omitted. */ }
    }));
    const active = await this.sceneSources(String(scene.currentProgramSceneName));
    for (const value of Object.values(specialInputs)) if (typeof value === 'string') active.add(value);
    this.state.activeAudioInputs = Object.keys(this.state.inputs).filter(name => active.has(name));
  }
  private async sceneSources(sceneName: string, visited = new Set<string>()): Promise<Set<string>> {
    if (visited.has(sceneName)) return new Set();
    visited.add(sceneName);
    const names = new Set<string>();
    const result = await this.client.call('GetSceneItemList', { sceneName });
    const collect = async (items: typeof result.sceneItems) => Promise.all(items.filter(item => item.sceneItemEnabled).map(async item => {
      const name = String(item.sourceName); names.add(name);
      try {
        if (item.isGroup) {
          const group = await this.client.call('GetGroupSceneItemList', { sceneName: name });
          await collect(group.sceneItems);
        } else if (String(item.sourceType) === 'OBS_SOURCE_TYPE_SCENE') {
          const nested = await this.sceneSources(name, visited);
          for (const child of nested) names.add(child);
        }
      } catch { /* A removed nested source must not make the complete mixer unavailable. */ }
    }));
    await collect(result.sceneItems);
    return names;
  }
  async scene(sceneName: string) { await this.client.call('SetCurrentProgramScene', { sceneName }); }
  async mute(inputName: string, inputMuted: boolean) { await this.client.call('SetInputMute', { inputName, inputMuted }); }
  async volume(inputName: string, inputVolumeMul: number) { await this.client.call('SetInputVolume', { inputName, inputVolumeMul }); }
  async stream(start: boolean) { await this.client.call(start ? 'StartStream' : 'StopStream'); }
  async record(start: boolean) { await this.client.call(start ? 'StartRecord' : 'StopRecord'); }
  async restartMedia(inputName: string) { await this.client.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' }); }
  get reconnectCount() { return this.reconnects; }
}
