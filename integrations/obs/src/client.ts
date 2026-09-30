import OBSWebSocket from 'obs-websocket-js';
import type { ObsState } from '../../../packages/contracts/src/index.js';

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if ((error as { code?: number } | null)?.code === 4009 || /authentication|required|identified/i.test(message)) return 'Mot de passe OBS incorrect ou manquant.';
  if (/timeout/i.test(message)) return 'OBS ne répond pas dans le délai de 5 secondes.';
  if (/ECONNREFUSED|connect|closed|not connected/i.test(message)) return 'Impossible de joindre OBS WebSocket. Vérifiez qu’OBS est lancé et que le serveur WebSocket est activé.';
  return 'Requête OBS impossible. Vérifiez la configuration et les sources OBS.';
}

interface ObsClientOptions { logger?: Pick<Console, 'warn' | 'error'> }
interface SceneNode { sourceName: unknown; sceneItemEnabled: boolean; isGroup?: boolean; sourceType?: unknown }
export async function collectActiveSceneSources(sceneName: string, sceneItems: (name: string) => Promise<SceneNode[]>, groupItems: (name: string) => Promise<SceneNode[]>, visited = new Set<string>()): Promise<Set<string>> {
  if (visited.has(sceneName)) return new Set(); visited.add(sceneName);
  const names = new Set<string>();
  const collect = async (items: SceneNode[]) => Promise.all(items.filter(item => item.sceneItemEnabled).map(async item => {
    const name = String(item.sourceName); names.add(name);
    if (item.isGroup) await collect(await groupItems(name));
    else if (String(item.sourceType) === 'OBS_SOURCE_TYPE_SCENE') for (const child of await collectActiveSceneSources(name, sceneItems, groupItems, visited)) names.add(child);
  }));
  await collect(await sceneItems(sceneName)); return names;
}

export class ObsClient {
  private client = new OBSWebSocket();
  private reconnects = 0;
  // Every loss/configuration change invalidates pending replies and queued commands.
  private generation = 0;
  private revision = 0;
  private connecting?: Promise<void>;
  private ready = false;
  private streamPending = false;
  private heartbeat?: NodeJS.Timeout;
  get connectionGeneration() { return this.generation; }

  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('OBS request timeout')), 5_000);
      })]);
    } finally { clearTimeout(timer); }
  }

  private call: OBSWebSocket['call'] = async (type, ...args) => {
    const generation = this.generation;
    try {
      const result = await this.bounded(this.client.call(type, ...args));
      if (generation !== this.generation) throw new Error('Connexion OBS remplacée.');
      return result;
    } catch (error) {
      if (generation === this.generation && /timeout/i.test(String(error))) {
        this.invalidate('OBS ne répond plus (timeout).');
        this.schedule();
      }
      throw new Error(friendlyError(error));
    }
  };

  private invalidate(error: string | null) {
    this.generation++;
    this.connecting = undefined;
    this.ready = false;
    clearInterval(this.heartbeat);
    clearTimeout(this.refreshTimer);
    this.refreshTimer = undefined;
    this.refreshPromise = undefined;
    this.refreshRequested = false;
    const previous = this.client;
    previous.removeAllListeners();
    void previous.disconnect().catch(() => undefined);
    this.clearLiveState(error);
  }

  private bindEvents() {
    const client = this.client;
    const on: OBSWebSocket['on'] = (event, listener) => client.on(event, ((...args: unknown[]) => {
      if (this.client === client && !this.suppressReconnect) {
        this.revision++;
        (listener as (...args: unknown[]) => void)(...args);
      }
    }) as typeof listener);

    on('ConnectionClosed', error => {
      this.invalidate(error?.code === 4009 ? friendlyError(error) : 'Connexion OBS interrompue.');
      if (!this.suppressReconnect) this.schedule();
    });
    on('CurrentProgramSceneChanged', ({ sceneName }) => { if (!this.ready) return; this.state.scene = sceneName; this.notify(); this.scheduleRefresh(); });
    on('StreamStateChanged', ({ outputActive }) => { if (!this.ready) return; this.state.streaming = outputActive; this.state.streamingKnown = true; this.notify(); });
    on('RecordStateChanged', ({ outputActive }) => { if (!this.ready) return; this.state.recording = outputActive; this.notify(); });
    on('InputMuteStateChanged', ({ inputName, inputMuted }) => {
      if (!this.ready) return;
      this.state.inputs[inputName] = { ...(this.state.inputs[inputName] ?? { volume: 1, volumeDb: 0 }), muted: inputMuted };
      this.notify();
    });
    on('InputVolumeChanged', ({ inputName, inputVolumeMul, inputVolumeDb }) => {
      if (!this.ready) return;
      this.state.inputs[inputName] = { ...(this.state.inputs[inputName] ?? { muted: false }), volume: inputVolumeMul, volumeDb: inputVolumeDb };
      this.notify();
    });
    for (const event of ['SceneCreated', 'SceneRemoved', 'SceneNameChanged', 'InputCreated', 'InputRemoved', 'InputNameChanged', 'SceneItemCreated', 'SceneItemRemoved', 'SceneItemEnableStateChanged'] as const) {
      on(event, () => this.scheduleRefresh());
    }
    on('MediaInputPlaybackEnded', ({ inputName }) => {
      if (!this.ready) return;
      for (const listener of this.mediaEndedListeners) listener(String(inputName));
    });
  }
  private retry?: NodeJS.Timeout;
  private suppressReconnect = false;
  state: ObsState = { connectionStatus: 'offline', connected: false, streaming: false, streamingKnown: false, recording: false, scene: null, scenes: [], inputs: {}, activeAudioInputs: [], mediaInputs: [], browserInputs: [], error: null, obsVersion: null, websocketVersion: null };
  private listeners = new Set<() => void>();
  private mediaEndedListeners = new Set<(inputName: string) => void>();
  private refreshTimer?: NodeJS.Timeout;
  private refreshPromise?: Promise<void>;
  private refreshRequested = false;

  constructor(private url = process.env.OBS_URL ?? 'ws://127.0.0.1:4455', private password = process.env.OBS_PASSWORD ?? '', private options: ObsClientOptions = {}) {
    this.bindEvents();
  }

  private clearLiveState(error: string | null) {
    this.state.connectionStatus = error ? 'error' : 'offline';
    this.state.connected = false;
    // Preserve the last confirmed value: telemetry loss makes it unknown, not stopped.
    this.state.streamingKnown = false;
    this.state.obsVersion = null;
    this.state.websocketVersion = null;
    this.state.recording = false;
    this.state.scene = null;
    this.state.scenes = [];
    this.state.inputs = {};
    this.state.activeAudioInputs = [];
    this.state.mediaInputs = [];
    this.state.browserInputs = [];
    this.state.error = error;
    this.notify();
  }

  connect(): Promise<void> {
    if (this.suppressReconnect || this.ready) return Promise.resolve();
    if (this.connecting) return this.connecting;
    clearTimeout(this.retry); this.retry = undefined;
    this.client = new OBSWebSocket();
    this.bindEvents();
    const generation = this.generation;
    const client = this.client;
    this.state.connectionStatus = 'connecting';
    this.state.error = 'Connexion à OBS en cours…';
    this.notify();
    const operation = (async () => {
      try {
        await this.bounded(client.connect(this.url, this.password));
        if (generation !== this.generation) {
          await this.bounded(client.disconnect()).catch(() => undefined);
          return;
        }
        for (let attempt = 0; attempt < 3; attempt++) {
          await this.doRefresh();
          if (generation !== this.generation) return;
          if (this.state.streamingKnown) break;
        }
        if (!this.state.streamingKnown) throw new Error('OBS state unavailable');
        if (generation !== this.generation) return;
        this.ready = true;
        this.state.connected = true;
        this.state.connectionStatus = 'connected';
        this.reconnects = 0;
        this.heartbeat = setInterval(() => { void this.refresh().catch(() => undefined); }, 10_000);
        this.heartbeat.unref();
        this.notify();
        if (this.refreshRequested) this.scheduleRefresh();
      } catch (error) {
        if (generation !== this.generation) return;
        this.invalidate(friendlyError(error));
        this.schedule();
      } finally {
        if (this.client === client) this.connecting = undefined;
      }
    })();
    this.connecting = operation;
    return operation;
  }

  private schedule() {
    if (this.retry || this.suppressReconnect) return;
    this.reconnects++;
    this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, Math.min(30_000, 1000 * 2 ** Math.min(this.reconnects, 5)));
    this.retry.unref();
  }

  async configure(url: string, password: string) {
    this.suppressReconnect = true;
    this.invalidate(null);
    this.connecting = undefined;
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
      await this.bounded(probe.connect(url, password));
      const version = await this.bounded(probe.call('GetVersion'));
      await this.bounded(probe.disconnect());
      return { ok: true, obsVersion: String(version.obsVersion ?? ''), websocketVersion: String(version.obsWebSocketVersion ?? '') };
    } catch (error) {
      try { await this.bounded(probe.disconnect()); } catch { /* noop */ }
      throw new Error(friendlyError(error));
    }
  }

  private scheduleRefresh() {
    this.refreshRequested = true;
    if (this.refreshTimer || this.refreshPromise || !this.state.connected) return;
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined;
      void this.refresh().catch(error => {
        void Promise.resolve(this.options.logger?.warn('OBS refresh failed', friendlyError(error))).catch(() => undefined);
      });
    }, 100);
  }

  async refresh() {
    if (!this.ready) return;
    if (this.refreshPromise) { this.refreshRequested = true; return this.refreshPromise; }
    this.refreshRequested = false;
    const operation = this.doRefresh();
    this.refreshPromise = operation;
    try { await operation; }
    catch (error) {
      if (this.refreshPromise === operation) { this.invalidate(friendlyError(error)); this.schedule(); }
      throw error;
    }
    finally {
      if (this.refreshPromise === operation) this.refreshPromise = undefined;
      if (this.refreshRequested && this.state.connected) this.scheduleRefresh();
    }
  }

  private async doRefresh() {
    const generation = this.generation;
    const revision = this.revision;
    // Publish a complete snapshot only if no newer event or connection superseded it.
    const snapshot = { ...this.state, inputs: {} as ObsState['inputs'] };
    const [version, scene, scenes, stream] = await Promise.all([
      this.call('GetVersion'),
      this.call('GetCurrentProgramScene'),
      this.call('GetSceneList'),
      this.call('GetStreamStatus'),
    ]);
    const [recordResult, inputsResult] = await Promise.allSettled([
      this.call('GetRecordStatus'), this.call('GetInputList'),
    ]);
    snapshot.obsVersion = String(version.obsVersion ?? '');
    snapshot.websocketVersion = String(version.obsWebSocketVersion ?? '');
    snapshot.scene = scene.currentProgramSceneName;
    snapshot.scenes = scenes.scenes.map(({ sceneName }) => String(sceneName));
    snapshot.streaming = stream.outputActive;
    snapshot.streamingKnown = true;
    if (recordResult.status !== 'fulfilled') throw recordResult.reason;
    snapshot.recording = recordResult.value.outputActive;
    if (inputsResult.status !== 'fulfilled') throw inputsResult.reason;
    const inputs = inputsResult.value;
    snapshot.inputs = {};
    snapshot.mediaInputs = inputs.inputs
      .filter(({ inputKind }) => ['ffmpeg_source', 'vlc_source', 'slideshow', 'slideshow_v2'].includes(String(inputKind)))
      .map(({ inputName }) => String(inputName));
    snapshot.browserInputs = inputs.inputs.filter(({ inputKind }) => String(inputKind) === 'browser_source').map(({ inputName }) => String(inputName));
    await Promise.all(inputs.inputs.map(async ({ inputName }) => {
      const name = String(inputName);
      try {
        const [mute, volume] = await Promise.all([
          this.call('GetInputMute', { inputName: name }), this.call('GetInputVolume', { inputName: name }),
        ]);
        snapshot.inputs[name] = { muted: mute.inputMuted, volume: volume.inputVolumeMul, volumeDb: volume.inputVolumeDb };
      } catch { /* Inputs without audio capabilities are intentionally omitted. */ }
    }));
    const active = await this.sceneSources(String(scene.currentProgramSceneName)).catch(() => new Set<string>());
    const special = await this.call('GetSpecialInputs').catch(() => ({}));
    for (const name of Object.values(special)) if (typeof name === 'string') active.add(name);
    snapshot.activeAudioInputs = Object.keys(snapshot.inputs).filter(name => active.has(name));
    snapshot.error = null;
    if (revision !== this.revision) this.refreshRequested = true;
    if (generation === this.generation && revision === this.revision) { Object.assign(this.state, snapshot); if (this.ready) this.notify(); }
  }

  onStateChanged(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private notify() { for (const listener of this.listeners) listener(); }

  async waitForStreaming(expected: boolean, timeoutMs = 10_000) {
    this.requireConnected();
    if (this.state.streamingKnown && this.state.streaming === expected) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let off: () => void = () => undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        off();
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (this.state.connected && this.state.streamingKnown && this.state.streaming === expected) finish();
        else if (!this.state.connected) finish(new Error('OBS s’est déconnecté pendant le changement d’état de diffusion.'));
      };
      const timeout = setTimeout(() => finish(new Error(`OBS n’a pas confirmé ${expected ? 'le démarrage' : 'l’arrêt'} de la diffusion.`)), timeoutMs);
      off = this.onStateChanged(check);
      // Close the gap between the initial fast-path and listener registration.
      check();
    });
  }

  async waitForScene(expected: string, timeoutMs = 5_000) {
    this.requireConnected();
    if (this.state.scene === expected) return;
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let off: () => void = () => undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        off();
        if (error) reject(error); else resolve();
      };
      const check = () => {
        if (this.state.scene === expected) finish();
        else if (!this.state.connected) finish(new Error('OBS s’est déconnecté pendant le changement de scène.'));
      };
      const timeout = setTimeout(() => finish(new Error(`OBS n’a pas confirmé la scène « ${expected} ».`)), timeoutMs);
      off = this.onStateChanged(check);
      check();
    });
  }

  private async sceneSources(sceneName: string, visited = new Set<string>()): Promise<Set<string>> {
    return collectActiveSceneSources(sceneName,
      async name => (await this.call('GetSceneItemList', { sceneName: name })).sceneItems as unknown as SceneNode[],
      async name => (await this.call('GetGroupSceneItemList', { sceneName: name })).sceneItems as unknown as SceneNode[],
      visited).catch(() => new Set());
  }

  private requireConnected() { if (!this.state.connected || !this.ready) throw new Error('OBS n’est pas connecté.'); }
  async scene(sceneName: string) { this.requireConnected(); if (!this.state.scenes.includes(sceneName)) throw new Error('Scène OBS indisponible.'); await this.call('SetCurrentProgramScene', { sceneName }); }
  private async requireInput(inputName: string, audio = false, media = false) {
    this.requireConnected();
    const kind = await this.inputKind(inputName);
    if (!kind || (media && !['ffmpeg_source', 'vlc_source', 'slideshow', 'slideshow_v2'].includes(kind))) throw new Error('Source OBS indisponible.');
    if (audio) await this.call('GetInputMute', { inputName });
    this.requireConnected();
  }
  async mute(inputName: string, inputMuted: boolean) { await this.requireInput(inputName, true); await this.call('SetInputMute', { inputName, inputMuted }); }
  async volume(inputName: string, inputVolumeMul: number) { if (!Number.isFinite(inputVolumeMul) || inputVolumeMul < 0 || inputVolumeMul > 20) throw new Error('Volume OBS invalide.'); await this.requireInput(inputName, true); await this.call('SetInputVolume', { inputName, inputVolumeMul }); }
  async volumeDb(inputName: string, inputVolumeDb: number) { if (!Number.isFinite(inputVolumeDb) || inputVolumeDb < -100 || inputVolumeDb > 26) throw new Error('Volume OBS invalide.'); await this.requireInput(inputName, true); await this.call('SetInputVolume', { inputName, inputVolumeDb }); }
  async stream(start: boolean) {
    this.requireConnected();
    if (this.streamPending) throw new Error('Changement de diffusion OBS déjà en cours.');
    this.streamPending = true;
    try {
      const status = await this.call('GetStreamStatus');
      if (status.outputActive !== start) await this.call(start ? 'StartStream' : 'StopStream');
    } finally { this.streamPending = false; }
  }
  async record(start: boolean) { this.requireConnected(); const status = await this.call('GetRecordStatus'); if (status.outputActive === start) return; await this.call(start ? 'StartRecord' : 'StopRecord'); }
  async restartMedia(inputName: string) { await this.requireInput(inputName, false, true); await this.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART' }); }
  async stopMedia(inputName: string) { await this.requireInput(inputName, false, true); await this.call('TriggerMediaInputAction', { inputName, mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_STOP' }); }
  async setInputSettings(inputName: string, inputSettings: Record<string, unknown>) { await this.requireInput(inputName, false, false); await this.call('SetInputSettings', { inputName, inputSettings: inputSettings as never, overlay: true }); }
  async setMonitorType(inputName: string, monitorType: 'OBS_MONITORING_TYPE_NONE' | 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT') { await this.requireInput(inputName, true); await this.call('SetInputAudioMonitorType', { inputName, monitorType }); }
  async inputKind(inputName: string): Promise<string | null> {
    this.requireConnected();
    const result = await this.call('GetInputList');
    const input = result.inputs.find(value => String(value.inputName) === inputName);
    return input ? String(input.inputKind) : null;
  }
  sceneExists(sceneName: string) { return this.state.scenes.includes(sceneName); }
  async sceneHasSource(sceneName: string, sourceName: string) {
    this.requireConnected();
    const result = await this.call('GetSceneItemList', { sceneName });
    return result.sceneItems.some(item => String((item as { sourceName?: unknown }).sourceName) === sourceName);
  }
  async createMediaInput(sceneName: string, inputName: string) {
    this.requireConnected();
    await this.call('CreateInput', {
      sceneName, inputName, inputKind: 'ffmpeg_source',
      inputSettings: { is_local_file: true, local_file: '', looping: false, restart_on_activate: false, close_when_inactive: false },
      sceneItemEnabled: true,
    } as never);
    this.scheduleRefresh();
  }
  async addInputToScene(sceneName: string, sourceName: string) {
    this.requireConnected();
    await this.call('CreateSceneItem', { sceneName, sourceName, sceneItemEnabled: true } as never);
    this.scheduleRefresh();
  }
  onMediaEnded(listener: (inputName: string) => void) { this.mediaEndedListeners.add(listener); return () => this.mediaEndedListeners.delete(listener); }
  async verifyTimerBrowserSource(inputName: string, endpoint: string) {
    this.requireConnected();
    const generation = this.generation;
    if (await this.inputKind(inputName) !== 'browser_source') throw new Error('Browser Source timer absente.');
    const scene = await this.call('GetCurrentProgramScene');
    if (!(await this.sceneSources(scene.currentProgramSceneName)).has(inputName)) throw new Error('Le timer doit être attaché et activé dans la scène courante.');
    const { inputSettings } = await this.call('GetInputSettings', { inputName });
    const configured = new URL(String(inputSettings.url || ''));
    const expected = new URL(endpoint);
    if (inputSettings.is_local_file || !['127.0.0.1', 'localhost'].includes(configured.hostname)
      || configured.protocol !== expected.protocol || configured.port !== expected.port
      || configured.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, '')) {
      throw new Error(`URL timer attendue : ${endpoint}`);
    }
    const response = await fetch(endpoint, { signal: AbortSignal.timeout(3000), redirect: 'error' });
    await response.body?.cancel();
    if (!response.ok) throw new Error(`Endpoint timer indisponible (HTTP ${response.status}).`);
    this.requireConnected();
    if (generation !== this.generation) throw new Error('Connexion OBS modifiée pendant la vérification du timer.');
  }

  async refreshBrowserSource(inputName: string) {
    this.requireConnected();
    if (await this.inputKind(inputName) !== 'browser_source') throw new Error(`La source « ${inputName} » n’est pas une Browser Source OBS détectée.`);
    await this.call('PressInputPropertiesButton', { inputName, propertyName: 'refreshnocache' });
  }

  async close() {
    const client = this.client;
    const pending = [this.connecting, this.refreshPromise];
    ++this.generation;
    if (this.retry) clearTimeout(this.retry);
    if (this.refreshTimer) clearTimeout(this.refreshTimer);
    this.retry = undefined;
    this.refreshTimer = undefined;
    this.refreshRequested = false;
    this.suppressReconnect = true;
    this.invalidate(null);
    this.connecting = undefined;
    // Drain bounded work, then close any handshake that completed during shutdown.
    await Promise.allSettled(pending);
    await this.bounded(client.disconnect()).catch(() => undefined);
  }

  get reconnectCount() { return this.reconnects; }
}
