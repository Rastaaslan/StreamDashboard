import OBSWebSocket from 'obs-websocket-js';
import type { ObsState } from '../../../packages/contracts/src/index.js';

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/authentication|required|identified/i.test(message)) return 'Mot de passe OBS incorrect ou manquant.';
  if (/ECONNREFUSED|connect|closed|not connected/i.test(message)) return 'Impossible de joindre OBS WebSocket. Vérifiez qu’OBS est lancé et que le serveur WebSocket est activé.';
  return message || 'Connexion OBS impossible.';
}

interface ObsClientOptions { logger?: Pick<Console, 'warn' | 'error'> }

export class ObsClient {
  private client = new OBSWebSocket();
  private reconnects = 0;
  private retry?: NodeJS.Timeout;
  private suppressReconnect = false;
  state: ObsState = { connected: false, streaming: false, recording: false, scene: null, scenes: [], inputs: {}, activeAudioInputs: [], mediaInputs: [], error: null, obsVersion: null, websocketVersion: null };
  private listeners = new Set<() => void>();
  private refreshTimer?: NodeJS.Timeout;
  private refreshPromise?: Promise<void>;
  private refreshRequested = false;

  constructor(private url = process.env.OBS_URL ?? 'ws://127.0.0.1:4455', private password = process.env.OBS_PASSWORD ?? '', private options: ObsClientOptions = {}) {
    this.client.on('ConnectionClosed', () => {
      this.clearLiveState('Connexion OBS interrompue.');
      if (!this.suppressReconnect) this.schedule();
    });
    this.client.on('CurrentProgramSceneChanged', ({ sceneName }) => { this.state.scene = sceneName; this.scheduleRefresh(); });
    this.client.on('StreamStateChanged', ({ outputActive }) => { this.state.streaming = outputActive; this.notify(); });
    this.client.on('RecordStateChanged', ({ outputActive }) => { this.state.recording = outputActive; this.notify(); });
    this.client.on('InputMuteStateChanged', ({ inputName, inputMuted }) => {
      this.state.inputs[inputName] = { ...(this.state.inputs[inputName] ?? { volume: 1 }), muted: inputMuted };
      this.notify();
    });
    this.client.on('InputVolumeChanged', ({ inputName, inputVolumeMul }) => {
      this.state.inputs[inputName] = { ...(this.state.inputs[inputName] ?? { muted: false }), volume: inputVolumeMul };
      this.notify();
    });
    for (const event of ['SceneCreated', 'SceneRemoved', 'SceneNameChanged', 'InputCreated', 'InputRemoved', 'InputNameChanged', 'SceneItemCreated', 'SceneItemRemoved', 'SceneItemEnableStateChanged'] as const) {
      this.client.on(event, () => this.scheduleRefresh());
    }
  }

  private clearLiveState(error: string | null) {
    this.state.connected = false;
    this.state.streaming = false;
    this.state.recording = false;
    this.state.scene = null;
    this.state.scenes = [];
    this.state.inputs = {};
    this.state.activeAudioInputs = [];
    this.state.mediaInputs = [];
    this.state.error = error;
    this.notify();
  }

  async connect() {
    try {
      await this.client.connect(this.url, this.password);
      this.state.connected = true;
      this.state.error = null;
      this.reconnects = 0;
      await this.refresh();
      this.notify();
    } catch (error) {
      try { await this.client.disconnect(); } catch { /* already disconnected */ }
      this.clearLiveState(friendlyError(error));
      this.schedule();
    }
  }

  private schedule() {
    if (this.retry || this.suppressReconnect) return;
    this.reconnects++;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(this.reconnects, 5)));
  }

  async configure(url: string, password: string) {
    if (this.retry) { clearTimeout(this.retry); this.retry = undefined; }
    if (this.refreshTimer) { clearTimeout(this.refreshTimer); this.refreshTimer = undefined; }
    this.refreshRequested = false;
    this.suppressReconnect = true;
    try { await this.client.disconnect(); } catch { /* already disconnected */ }
    this.suppressReconnect = false;
    this.url = url;
    this.password = password;
    this.clearLiveState(null);
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

  private scheduleRefresh() {
    this.refreshRequested = true;
    if (this.refreshTimer || this.refreshPromise || !this.state.connected) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh().catch(error => {
        this.state.error = friendlyError(error);
        void Promise.resolve(this.options.logger?.warn('OBS refresh failed', error)).catch(() => undefined);
        this.notify();
      });
    }, 100);
  }

  async refresh() {
    if (this.refreshPromise) { this.refreshRequested = true; return this.refreshPromise; }
    this.refreshRequested = false;
    const operation = this.doRefresh();
    this.refreshPromise = operation;
    try { await operation; }
    finally {
      this.refreshPromise = undefined;
      if (this.refreshRequested && this.state.connected) this.scheduleRefresh();
    }
  }

  private async doRefresh() {
    if (!this.state.connected) return;
    const [version, scene, scenes, stream] = await Promise.all([
      this.client.call('GetVersion'),
      this.client.call('GetCurrentProgramScene'),
      this.client.call('GetSceneList'),
      this.client.call('GetStreamStatus'),
    ]);
    const [recordResult, inputsResult, specialResult] = await Promise.allSettled([
      this.client.call('GetRecordStatus'), this.client.call('GetInputList'), this.client.call('GetSpecialInputs'),
    ]);
    this.state.obsVersion = String(version.obsVersion ?? '');
    this.state.websocketVersion = String(version.obsWebSocketVersion ?? '');
    this.state.scene = scene.currentProgramSceneName;
    this.state.scenes = scenes.scenes.map(({ sceneName }) => String(sceneName));
    this.state.streaming = stream.outputActive;
    if (recordResult.status === 'fulfilled') this.state.recording = recordResult.value.outputActive;
    if (inputsResult.status !== 'fulfilled') {
      this.state.inputs = {};
      this.state.activeAudioInputs = [];
      this.state.mediaInputs = [];
      this.state.error = null;
      this.notify();
      return;
    }
    const inputs = inputsResult.value;
    const specialInputs = specialResult.status === 'fulfilled' ? specialResult.value : {};
    this.state.inputs = {};
    this.state.mediaInputs = inputs.inputs
      .filter(({ inputKind }) => ['ffmpeg_source', 'vlc_source', 'slideshow', 'slideshow_v2'].includes(String(inputKind)))
      .map(({ inputName }) => String(inputName));
    await Promise.all(inputs.inputs.map(async ({ inputName }) => {
      const name = String(inputName);
      try {
        const [mute, volume] = await Promise.all([
          this.client.call('GetInputMute', { inputName: name }), this.client.call('GetInputVolume', { inputName: name }),
        ]);
        this.state.inputs[name] = { muted: mute.inputMuted, volume: volume.inputVolumeMul };
      } catch { /* Inputs without audio capabilities are intentionally omitted. */ }
    }));
    const active = await this.sceneSources(String(scene.currentProgramSceneName)).catch(() => new Set<string>());
    for (const value of Object.values(specialInputs)) if (typeof value === 'string') active.add(value);
    this.state.activeAudioInputs = Object.keys(this.state.inputs).filter(name => active.has(name));
    this.state.error = null;
    this.notify();
  }

  onStateChanged(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }

  async waitForStreaming(expected: boolean, timeoutMs = 10_000) {
    if (this.state.streaming === expected) return;
    await new Promise<void>((resolve, reject) => {
      let off: () => void = () => undefined;
      const timeout = setTimeout(() => { off(); reject(new Error(`OBS n’a pas confirmé ${expected ? 'le démarrage' : 'l’arrêt'} de la diffusion.`)); }, timeoutMs);
      off = this.onStateChanged(() => {
        if (this.state.streaming === expected) { clearTimeout(timeout); off(); resolve(); }
        else if (!this.state.connected) { clearTimeout(timeout); off(); reject(new Error('OBS s’est déconnecté pendant le changement d’état de diffusion.')); }
      });
    });
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

  private requireConnected() { if (!this.state.connected) throw new Error('OBS n’est pas connecté.'); }
  async scene(sceneName: string) { this.requireConnected(); await this.client.call('SetCurrentProgramScene', { sceneName }); }
  async mute(inputName: string, inputMuted: boolean) { this.requireConnected(); await this.client.call('SetInputMute', { inputName, inputMuted }); }
  async volume(inputName: string, inputVolumeMul: number) { this.requireConnected(); await this.client.call('SetInputVolume', { inputName, inputVolumeMul }); }
  async stream(start: boolean) { this.requireConnected(); await this.client.call(start ? 'StartStream' : 'StopStream'); }
  async record(start: boolean) { this.requireConnected(); await this.client.call(start ? 'StartRecord' : 'StopRecord'); }
  async restartMedia(inputName: string) { this.requireConnected(); await this.client.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' }); }

  async close() {
    if (this.retry) clearTimeout(this.retry);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.retry = undefined; this.refreshTimer = undefined; this.refreshRequested = false;
    this.suppressReconnect = true;
    try { await this.client.disconnect(); } catch { /* already closed */ }
    this.clearLiveState(null);
  }
  get reconnectCount() { return this.reconnects; }
}
