import OBSWebSocket, { EventSubscription } from 'obs-websocket-js';
import { createHmac, randomBytes } from 'node:crypto';
import { lstat } from 'node:fs/promises';
import { isAbsolute, win32 } from 'node:path';
import { MicHealthWatch } from './mic-health.js';
import { AitumSuiteOutputs } from './aitum-suite.js';
import { isObsRequestRejection, uncertainOutput } from './output-result.js';
import type { ObsState } from '../../../packages/contracts/src/index.js';

// ReplayBufferSaved paths originate in OBS websocket payloads. Do not touch
// UNC/device/ADS locations (nor trigger network authentication) before the
// host-only F04 source attestation can establish authority and provenance.
function localReplayFilePath(file: unknown): file is string {
  if (typeof file !== 'string' || file.length > 32767 || file.includes(String.fromCharCode(0))) return false;
  if (process.platform !== 'win32') return isAbsolute(file);
  if (!/^[A-Za-z]:[\\/]/.test(file) || !win32.isAbsolute(file)) return false;
  return file.slice(3).split(/[\\/]/).every(part => part.length > 0 &&
    part !== '.' && part !== '..' && !/[<>:"|?*]/.test(part) && !/[. ]$/.test(part) &&
    !Array.from(part).some(char => char.charCodeAt(0) < 32));
}

/** Never inspect a replay through an NTFS junction/symlink ancestor. Checking
 * the leaf alone follows parent reparse points (including redirected folders).
 * This is fail-closed metadata evidence, not a race-free descriptor grant. */
async function localReplayFileStat(file: unknown) {
  if (!localReplayFilePath(file)) return undefined;
  if (process.platform === 'win32') {
    const root = win32.parse(file).root;
    let parent = root;
    for (const part of file.slice(root.length).split(/[\\/]/).slice(0, -1)) {
      parent = win32.join(parent, part);
      const metadata = await lstat(parent);
      if (!metadata.isDirectory() || metadata.isSymbolicLink()) return undefined;
    }
  }
  const metadata = await lstat(file);
  return metadata.isFile() && !metadata.isSymbolicLink() && metadata.size > 0 ? metadata : undefined;
}

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

export type ObsAudioTracks = Record<'1'|'2'|'3'|'4'|'5'|'6',boolean>;
export type ObsAudioMonitor = 'OBS_MONITORING_TYPE_NONE'|'OBS_MONITORING_TYPE_MONITOR_ONLY'|'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT';
export const validObsAudioTracks=(value:unknown):value is ObsAudioTracks=>Boolean(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join(',')==='1,2,3,4,5,6'&&Object.values(value).every(v=>typeof v==='boolean'));
export const validObsAudioMonitor=(value:unknown):value is ObsAudioMonitor=>typeof value==='string'&&['OBS_MONITORING_TYPE_NONE','OBS_MONITORING_TYPE_MONITOR_ONLY','OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'].includes(value);
export interface ObsAudioSource {
  sourceId: string; inputUuid: string; generation: number;
  gain: number; mute: boolean; observedAt: number;
  tracks?: ObsAudioTracks; monitorType?: ObsAudioMonitor;
}
export type ObsAudioChange = { sourceId: string; gain: number } | { sourceId: string; mute: boolean } | {sourceId:string;tracks:ObsAudioTracks} | {sourceId:string;monitorType:ObsAudioMonitor};

export class ObsClient {
  // Per-runtime secret prevents clients from guessing local replay filenames
  // from the opaque journal event identifier; never exported or persisted.
  private readonly replayEventSalt = randomBytes(32);
  // Only the trusted local OBS adapter retains raw replay paths. Never serialize.
  private readonly replayHostSources = new Map<string, {path:string;event:{sourceEventId:string;connectionGeneration:number;streamEpoch:number;observedAt:number}}>();
  // A stop -> start on the SAME websocket generation must not reassign a late
  // replay file metadata result to a different live session.
  private replayStreamEpoch = 0;
  private replaySaving = false;
  private replayChanging = false;
  async replayStatus() {
    this.requireConnected();
    const generation = this.generation;
    const parameter = async (parameterCategory: string, parameterName: string) => {
      const result = await this.call('GetProfileParameter', { parameterCategory, parameterName });
      return result.parameterValue || result.defaultParameterValue;
    };
    // OBS rejects GetReplayBufferStatus with 604 when no replay output exists.
    // Read the profile first so its useful configuration is not discarded.
    const modeValue = await parameter('Output', 'Mode');
    if (!['Advanced', 'Simple'].includes(modeValue)) throw new Error('Mode de sortie OBS indisponible.');
    const mode: 'Advanced' | 'Simple' = modeValue === 'Advanced' ? 'Advanced' : 'Simple';
    const parameterCategory = mode === 'Advanced' ? 'AdvOut' : 'SimpleOutput';
    const [duration, enabledValue, directory, recordingType] = await Promise.all([
      parameter(parameterCategory, 'RecRBTime'), parameter(parameterCategory, 'RecRB'),
      this.call('GetRecordDirectory'), mode === 'Advanced' ? parameter('AdvOut', 'RecType') : Promise.resolve(''),
    ]);
    this.requireConnected();
    if (generation !== this.generation) throw new Error('Connexion OBS remplacée.');
    if (!['true', 'false', '1', '0'].includes(enabledValue)) throw new Error('Réglage du tampon de replay OBS indisponible.');
    const enabled = ['true', '1'].includes(enabledValue);
    const seconds = Number(duration);
    if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('Durée du tampon de replay OBS indisponible.');
    const configuration = { mode, enabled, seconds, directory: directory.recordDirectory };
    if (!enabled) return { ...configuration, active: false, available: false, error: 'Activez le tampon de replay dans OBS → Paramètres → Sortie → Tampon de relecture, puis cliquez sur Appliquer.' };
    if (mode === 'Advanced' && recordingType.toLowerCase() === 'ffmpeg') return { ...configuration, active: false, available: false, error: 'Le tampon de replay est indisponible avec la sortie personnalisée FFmpeg. Dans OBS → Paramètres → Sortie → Enregistrement, choisissez le type Standard.' };
    try {
      const state = await this.call('GetReplayBufferStatus');
      this.requireConnected();
      if (generation !== this.generation) throw new Error('Connexion OBS remplacée.');
      return { ...configuration, active: state.outputActive, available: true, error: '' };
    } catch (error) {
      if (generation !== this.generation || (error as { code?: number }).code !== 604) throw error;
      return { ...configuration, active: false, available: false, error: 'Le tampon est activé dans le profil mais reste indisponible dans OBS. Vérifiez Paramètres → Sortie → Tampon de relecture et appliquez les réglages lorsque les sorties sont arrêtées.' };
    }
  }
  async setReplayBuffer(active: boolean) {
    const assertCurrent = this.outputConnectionGuard();
    if (this.replaySaving) throw new Error('Sauvegarde du clip en cours.');
    if (this.replayChanging) throw new Error('Changement du tampon de replay déjà en cours.');
    this.replayChanging = true;
    try {
      const state = await this.replayStatus();
      assertCurrent();
      if (state.active === active) return;
      if (active && (!state.enabled || !state.available)) throw new Error(state.error || 'Tampon de replay OBS indisponible.');
      try { await this.call(active ? 'StartReplayBuffer' : 'StopReplayBuffer'); }
      catch (error) { if (isObsRequestRejection(error)) throw error; }
      // A lost acknowledgement is not a refusal. Observe the original OBS
      // connection only; never resend a replay start/stop after reconnecting.
      try {
        for (let n = 0; n < 15; n++) {
          assertCurrent();
          const observed = await this.call('GetReplayBufferStatus');
          assertCurrent();
          if (observed.outputActive === active) return;
          if (typeof observed.outputActive !== 'boolean') break;
          if (n < 14) await new Promise(resolve => setTimeout(resolve, 100));
        }
      } catch { /* No observation can prove that the dispatched command failed. */ }
      throw uncertainOutput('Commande du tampon de replay envoyée ; état non confirmé. Vérifiez le tampon dans OBS avant de réessayer.');
    } finally { this.replayChanging = false; }
  }
  async saveReplay() {
    this.requireConnected();
    if (this.replaySaving) throw new Error('Sauvegarde du clip déjà en cours.');
    if (this.replayChanging) throw new Error('Changement du tampon de replay en cours. Attendez sa confirmation avant de sauvegarder un clip.');
    this.replaySaving = true;
    const client = this.client, generation = this.generation;
    let savedPath = '', dispatched = false;
    const saved = ({ savedReplayPath }: { savedReplayPath: string }) => { if (generation === this.generation) savedPath = savedReplayPath; };
    try {
      if (!(await this.call('GetReplayBufferStatus')).outputActive) throw new Error('Tampon arrêté : activez « Préparer les clips » avant le moment à conserver.');
      const previous = await this.call('GetLastReplayBufferReplay').then(value => value.savedReplayPath, () => '');
      this.requireConnected();
      if (generation !== this.generation) throw new Error('Connexion OBS remplacée.');
      client.on('ReplayBufferSaved', saved);
      dispatched = true;
      try { await this.call('SaveReplayBuffer'); }
      catch (error) {
        // An explicit OBS request rejection proves that no clip was saved by
        // this request; a transport failure remains an uncertain dispatch.
        if (isObsRequestRejection(error)) dispatched = false;
        throw error;
      }
      // An OBS event or a changed GetLastReplayBufferReplay path is only a
      // notification, not proof of a usable clip on FIXE. A missing/empty,
      // relative, directory or symlink path must never be reported as success.
      // Keep polling within the existing bound: never issue SaveReplayBuffer twice.
      const verifiedFile = async (candidate: string): Promise<boolean> => {
        try { return Boolean(await localReplayFileStat(candidate)); }
        catch { return false; }
      };
      for (let n = 0; n < 40; n++) {
        if (generation !== this.generation) throw new Error('Connexion OBS interrompue pendant la sauvegarde.');
        if (savedPath) {
          const verified = await verifiedFile(savedPath);
          this.requireConnected();
          if (generation !== this.generation) throw new Error('Connexion OBS interrompue pendant la sauvegarde.');
          if (verified) return savedPath;
        }
        const current = await this.call('GetLastReplayBufferReplay').then(value => value.savedReplayPath, () => '');
        this.requireConnected();
        if (generation !== this.generation) throw new Error('Connexion OBS interrompue pendant la sauvegarde.');
        if (current && current !== previous) {
          const verified = await verifiedFile(current);
          this.requireConnected();
          if (generation !== this.generation) throw new Error('Connexion OBS interrompue pendant la sauvegarde.');
          if (verified) return current;
        }
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('OBS n’a pas confirmé de nouveau fichier. Vérifiez le dossier de clips avant de réessayer.');
    } catch (error) {
      if (dispatched) throw Object.assign(new Error(error instanceof Error ? error.message : 'Sauvegarde non confirmée.'), { name: 'ACTION_UNCERTAIN' });
      throw error;
    } finally { client.off('ReplayBufferSaved', saved); this.replaySaving = false; }
  }
  private suite = new AitumSuiteOutputs(async (requestType, requestData) => {
    const result = await this.call('CallVendorRequest', { vendorName: 'aitum-stream-suite', requestType, requestData });
    return result.responseData;
  }, async () => (await this.call('GetHotkeyList')).hotkeys);
  async streamSuiteOutputs() { this.requireConnected(); return this.suite.inspect(); }
  private outputConnectionGuard() {
    this.requireConnected();
    const generation = this.generation;
    return () => {
      this.requireConnected();
      if (generation !== this.generation) throw new Error('Connexion OBS remplacée. Relancez la détection des sorties.');
    };
  }
  async setStreamSuiteOutput(name: string, active: boolean) { await this.suite.set(name, active, this.outputConnectionGuard()); }
  async outputs() { this.requireConnected(); return (await this.call('GetOutputList')).outputs; }
  async setOutput(name: string, active: boolean) {
    const assertCurrent = this.outputConnectionGuard();
    if (!name.trim() || name.length > 200 || /[\u0000-\u001f\u007f]/.test(name)) throw new Error('Nom de sortie OBS invalide ou non sélectionné.');
    const matches = (await this.outputs()).filter(output => output.outputName === name);
    assertCurrent();
    if (matches.length !== 1) throw new Error('Sortie OBS absente ou ambiguë. Relancez la détection des sorties.');
    // Keep existing named-output associations, but let Aitum initialize its own
    // output and encoders instead of starting a possibly stale native instance.
    const suitePrefix = 'Aitum Stream Suite Output ';
    if (name.startsWith(suitePrefix)) return this.suite.set(name.slice(suitePrefix.length), active, assertCurrent);
    const flags = matches[0].outputFlags as Record<string, unknown> | undefined;
    if (flags?.OBS_OUTPUT_SERVICE !== true) throw new Error('Choisissez une sortie de diffusion OBS, pas un enregistrement, un tampon ou une caméra virtuelle.');
    const state = await this.call('GetOutputStatus', { outputName: name });
    assertCurrent();
    if (typeof state.outputActive !== 'boolean') throw new Error('État de la sortie OBS indisponible.');
    if (state.outputActive === active) return;
    try { await this.call(active ? 'StartOutput' : 'StopOutput', { outputName: name }); }
    catch (error) { if (isObsRequestRejection(error)) throw error; }
    // Read after both an acknowledgement and a transport failure: the command
    // may already have run. Never retry it or confirm against a new connection.
    try {
      assertCurrent();
      const confirmed = await this.call('GetOutputStatus', { outputName: name });
      assertCurrent();
      if (confirmed.outputActive === active) return;
    } catch { /* An observation failure cannot prove the dispatch failed. */ }
    throw uncertainOutput('Commande OBS envoyée ; état de la sortie non confirmé. Vérifiez avant de réessayer.');
  }
  private client = new OBSWebSocket();
  private reconnects = 0;
  // Every loss/configuration change invalidates pending replies and queued commands.
  private generation = 0;
  private revision = 0;
  private connecting?: Promise<void>;
  private readonly micHealthWatch = new MicHealthWatch();
  private volumeSubscribed = false;
  private micChangeAt = 0;
  micHealth(inputName: string) {
    const input = this.state.inputs[inputName];
    return this.micHealthWatch.state(inputName, {
      connected: this.state.connected, streaming: Boolean(this.state.streaming && this.state.streamingKnown),
      exists: Boolean(input), muted: input?.muted,
    });
  }
  /** OBS meter evidence already received by the master websocket; no new
   * poll, second clock or DSP estimate. Never expose pre-live/stale samples. */
  mixerAudioMeters(now=Date.now()) {
    const meters:Record<string,{value:number;observedAt:number}>={};
    if(!this.ready||!this.state.connected||!this.state.streamingKnown||!this.state.streaming)return meters;
    for(const name of Object.keys(this.state.inputs)){
      const evidence=this.micHealthWatch.meterEvidence(name,now);
      if(evidence)meters[name]=evidence;
    }
    return meters;
  }
  private async updateMicSubscription() {
    const want = Boolean(this.ready && this.state.connected && this.state.streamingKnown && this.state.streaming);
    if (this.volumeSubscribed === want || !this.ready) return;
    const current = this.client;
    this.volumeSubscribed = want;
    try { await current.reidentify({ eventSubscriptions: EventSubscription.All | (want ? EventSubscription.InputVolumeMeters : 0) }); }
    catch { if (current === this.client) this.volumeSubscribed = false; }
  }
  private ready = false;
  private streamPending = false;
  private heartbeat?: NodeJS.Timeout;
  get connectionGeneration() { return this.generation; }
  /** Monotonic within this OBS client: changes on every witnessed stream transition. */
  get streamTransitionEpoch() { return this.replayStreamEpoch; }

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
      const code = (error as { code?: unknown } | null)?.code;
      throw Object.assign(new Error(friendlyError(error)), typeof code === 'number' ? { code } : {});
    }
  };

  private invalidate(error: string | null) {
    this.generation++;
    this.replayHostSources.clear();
    this.connecting = undefined;
    this.ready = false;
    this.volumeSubscribed = false;
    this.micHealthWatch.updateStream(false);
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
    on('StreamStateChanged', ({ outputActive }) => {
      if (!this.ready) return;
      // Duplicate OBS notifications are not a new live; keep replay grants and
      // dedup receipts bound to the same authoritative stream epoch.
      if (!this.state.streamingKnown || this.state.streaming !== outputActive) {
        this.replayStreamEpoch++;
        this.replayHostSources.clear();
      }
      this.state.streaming = outputActive;
      this.state.streamingKnown = true;
      this.micHealthWatch.updateStream(outputActive);
      void this.updateMicSubscription();
      this.notify();
    });
    // InputVolumeMeters is a high-volume event. Do not increment the client's
    // revision or trigger a full OBS refresh for each meter frame.
    client.on('InputVolumeMeters', payload => {
      if (!this.ready || this.client !== client || !this.state.streaming) return;
      if (!this.micHealthWatch.observe((payload.inputs ?? []) as unknown as Array<{inputName:string;inputLevelsMul:number[][]}>)) return;
      const now = Date.now();
      if (now - this.micChangeAt > 2_500) { this.micChangeAt = now; this.notify(); }
    });
    on('RecordStateChanged', ({ outputActive }) => { if (!this.ready) return; this.state.recording = outputActive; this.notify(); });
    // A genuine OBS replay-save event, not a request acknowledgement. Do not
    // claim an existing clip solely from a WebSocket path: check a regular,
    // non-empty file on the FIXE first. This is point-in-time metadata evidence,
    // not an immutable file grant or an atomic OBS/filesystem transaction.
    // Never publish the local filename to remote clients or the moments journal.
    on('ReplayBufferSaved', ({ savedReplayPath }) => {
      if (!this.ready || !this.state.connected || !this.state.streamingKnown || !this.state.streaming ||
          !localReplayFilePath(savedReplayPath)) return;
      const connectionGeneration = this.generation, streamEpoch = this.replayStreamEpoch, observedAt = Date.now();
      void (async () => {
        if (!await localReplayFileStat(savedReplayPath)) return;
        // A disconnect, stop or reconnect while NTFS/network metadata was read
        // invalidates the event. No retry or backfill of a missed observation.
        if (!this.ready || !this.state.connected || !this.state.streamingKnown || !this.state.streaming ||
            (connectionGeneration !== this.generation || streamEpoch !== this.replayStreamEpoch)) return;
        const event = { sourceEventId: 'obs_replay_' + createHmac('sha256', this.replayEventSalt).update(savedReplayPath).digest('hex'),
          connectionGeneration, streamEpoch, observedAt };
        this.replayHostSources.set(event.sourceEventId, {path:savedReplayPath,event});
        if (this.replayHostSources.size > 64) this.replayHostSources.delete(this.replayHostSources.keys().next().value!);
        for (const listener of this.replaySavedListeners) {
          try { listener(event); } catch { /* An observer must never disrupt OBS. */ }
        }
      })().catch(() => { /* Missing/inaccessible file means no verified observation; never leak the path. */ });
    });
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
  private replaySavedListeners = new Set<(event: { sourceEventId: string; connectionGeneration: number; streamEpoch: number; observedAt: number }) => void>();
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
        this.micHealthWatch.updateStream(this.state.streaming);
        this.state.connectionStatus = 'connected';
        this.reconnects = 0;
        this.heartbeat = setInterval(() => { void this.refresh().catch(() => undefined); }, 10_000);
        this.heartbeat.unref();
        this.notify();
        void this.updateMicSubscription();
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
    const active = await this.sceneSources(String(scene.currentProgramSceneName));
    const special = await this.call('GetSpecialInputs').catch(() => ({}));
    for (const name of Object.values(special)) if (typeof name === 'string') active.add(name);
    snapshot.activeAudioInputs = Object.keys(snapshot.inputs).filter(name => active.has(name));
    snapshot.error = null;
    if (revision !== this.revision) this.refreshRequested = true;
    if (generation === this.generation && revision === this.revision) { Object.assign(this.state, snapshot); this.micHealthWatch.updateStream(snapshot.streaming); if (this.ready) { void this.updateMicSubscription(); this.notify(); } }
  }

  onStateChanged(listener: () => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onReplaySaved(listener: (event: { sourceEventId: string; connectionGeneration: number; streamEpoch: number; observedAt: number }) => void) {
    this.replaySavedListeners.add(listener);
    return () => this.replaySavedListeners.delete(listener);
  }

  /** Host-only read-only handoff for future F04 admission. Never use as a public
   * API route or as permission to encode. The private OBS HMAC salt and saved
   * file path are never returned; the callback must only verify an attestation.
   */
  async withSavedReplayForHost<T>(sourceEventId:string, inspect:(file:string,
    witness:{sourceEventId:string;connectionGeneration:number;streamEpoch:number;observedAt:number},
    verifyObsEventId:(path:string,id:string)=>boolean)=>Promise<T>):Promise<T|undefined>{
    const entry=this.replayHostSources.get(sourceEventId);
    const valid=()=>Boolean(entry&&this.ready&&this.state.connected&&this.state.streamingKnown&&this.state.streaming&&
      entry.event.connectionGeneration===this.generation&&entry.event.streamEpoch===this.replayStreamEpoch&&
      this.replayHostSources.get(sourceEventId)===entry);
    if(!valid()||!entry)return undefined;
    const verifyObsEventId=(file:string,id:string)=>id==='obs_replay_'+createHmac('sha256',this.replayEventSalt).update(file).digest('hex');
    const result=await inspect(entry.path,{...entry.event},verifyObsEventId);
    return valid()?result:undefined;
  }
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
      visited);
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
  /** Actual host observation, addressed by OBS UUID. A name is never a durable identity. */
  async readMixerSource(sourceId: string, routing = false): Promise<ObsAudioSource> {
    this.requireConnected();
    if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 200) throw new Error('Invalid audio source');
    const generation = this.generation;
    const entries = (await this.call('GetInputList')).inputs.filter(input => input.inputName === sourceId);
    const inputUuid = entries.length === 1 ? entries[0]!.inputUuid : undefined;
    if (typeof inputUuid !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(inputUuid)) throw new Error('OBS audio UUID unavailable');
    // obs-websocket-js 5.0 typings predate the UUID selector in current OBS.
    const selector = { inputUuid };
    const [volume, mute] = await Promise.all([this.call('GetInputVolume', selector as never), this.call('GetInputMute', selector as never)]);
    let route:Pick<ObsAudioSource,'tracks'|'monitorType'>={};
    if(routing){
      const [tracks,monitor]=await Promise.all([this.call('GetInputAudioTracks',selector as never),this.call('GetInputAudioMonitorType',selector as never)]);
      if(!validObsAudioTracks(tracks.inputAudioTracks)||!validObsAudioMonitor(monitor.monitorType))throw new Error('OBS audio routing unavailable');
      route={tracks:structuredClone(tracks.inputAudioTracks),monitorType:monitor.monitorType};
    }
    const current = (await this.call('GetInputList')).inputs.filter(input => input.inputName === sourceId);
    this.requireConnected();
    if (generation !== this.generation || current.length !== 1 || current[0]!.inputUuid !== inputUuid ||
      !Number.isFinite(volume.inputVolumeMul) || volume.inputVolumeMul < 0 || volume.inputVolumeMul > 20 || typeof mute.inputMuted !== 'boolean') throw new Error('OBS audio source changed');
    return { sourceId, inputUuid, generation, gain: volume.inputVolumeMul, mute: mute.inputMuted, ...route, observedAt: Date.now() };
  }
  /** Explicit, read-only OBS audio track and monitor inspection. It does not
   * identify Twitch's VOD output track, a physical PC-game device or audibility.
   * Both lists must agree on the same OBS UUID and connection generation.
   */
  async readMixerRouting(sourceId: string) {
    this.requireConnected();
    if (typeof sourceId !== 'string' || !sourceId.trim() || sourceId.length > 200) throw new Error('Invalid audio source');
    const generation = this.generation;
    const first = (await this.call('GetInputList')).inputs.filter(input => input.inputName === sourceId);
    const inputUuid = first.length === 1 ? first[0]!.inputUuid : undefined;
    if (typeof inputUuid !== 'string' || !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(inputUuid))
      throw new Error('OBS audio UUID unavailable');
    const selector = { inputUuid };
    const [tracks, monitor] = await Promise.all([
      this.call('GetInputAudioTracks', selector as never),
      this.call('GetInputAudioMonitorType', selector as never),
    ]);
    const raw: unknown = tracks.inputAudioTracks;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('OBS audio tracks unavailable');
    const entries = Object.entries(raw);
    if (entries.length !== 6 || entries.some(([number, enabled]) => !/^[1-6]$/.test(number) || typeof enabled !== 'boolean'))
      throw new Error('OBS audio tracks invalid');
    const allowedMonitor = ['OBS_MONITORING_TYPE_NONE', 'OBS_MONITORING_TYPE_MONITOR_ONLY', 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT'];
    if (typeof monitor.monitorType !== 'string' || !allowedMonitor.includes(monitor.monitorType))
      throw new Error('OBS monitor type unavailable');
    const last = (await this.call('GetInputList')).inputs.filter(input => input.inputName === sourceId);
    this.requireConnected();
    if (this.generation !== generation || last.length !== 1 || last[0]!.inputUuid !== inputUuid)
      throw new Error('OBS source or authority changed');
    return {
      schemaVersion: 1 as const, kind: 'streamcockpit-obs-audio-routing' as const,
      sourceId, generation, observedAt: Date.now(),
      tracks: entries.map(([number, enabled]) => ({ number: Number(number), enabled: enabled as boolean }))
        .sort((a, b) => a.number - b.number),
      monitorType: monitor.monitorType,
      vodTrack: 'unverified' as const, // OBS track 2 is NOT necessarily the Twitch VOD track.
    };
  }
  /** Called only within the master's serialized bus after consent and intent persistence. */
  async writeMixerSource(expected: ObsAudioSource, change: ObsAudioChange): Promise<void> {
    this.requireConnected();
    if (expected.generation !== this.generation || expected.sourceId !== change.sourceId ||
      !/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(expected.inputUuid)) throw new Error('OBS audio authority changed');
    const selector = { inputUuid: expected.inputUuid };
    if ('gain' in change) {
      if (!Number.isFinite(change.gain) || change.gain < 0 || change.gain > 20) throw new Error('Invalid audio gain');
      await this.call('SetInputVolume', { ...selector, inputVolumeMul: change.gain } as never);
    } else if ('mute' in change) {
      if (typeof change.mute !== 'boolean') throw new Error('Invalid audio mute');
      await this.call('SetInputMute', { ...selector, inputMuted: change.mute } as never);
    } else if ('tracks' in change) {
      if(!validObsAudioTracks(change.tracks)||!validObsAudioTracks(expected.tracks))throw new Error('Invalid audio tracks');
      await this.call('SetInputAudioTracks',{...selector,inputAudioTracks:change.tracks} as never);
    } else {
      if(!validObsAudioMonitor(change.monitorType)||!validObsAudioMonitor(expected.monitorType))throw new Error('Invalid audio monitor');
      await this.call('SetInputAudioMonitorType',{...selector,monitorType:change.monitorType} as never);
    }
  }

  async mute(inputName: string, inputMuted: boolean) { await this.requireInput(inputName, true); await this.call('SetInputMute', { inputName, inputMuted }); }
  async volume(inputName: string, inputVolumeMul: number) { if (!Number.isFinite(inputVolumeMul) || inputVolumeMul < 0 || inputVolumeMul > 20) throw new Error('Volume OBS invalide.'); await this.requireInput(inputName, true); await this.call('SetInputVolume', { inputName, inputVolumeMul }); }
  async volumeDb(inputName: string, inputVolumeDb: number) { if (!Number.isFinite(inputVolumeDb) || inputVolumeDb < -100 || inputVolumeDb > 26) throw new Error('Volume OBS invalide.'); await this.requireInput(inputName, true); await this.call('SetInputVolume', { inputName, inputVolumeDb }); }
  async stream(start: boolean) {
    const assertCurrent = this.outputConnectionGuard();
    if (this.streamPending) throw new Error('Changement de diffusion OBS déjà en cours.');
    this.streamPending = true;
    try {
      const status = await this.call('GetStreamStatus');
      assertCurrent();
      if (typeof status.outputActive !== 'boolean') throw new Error('État de la sortie principale OBS indisponible.');
      if (status.outputActive !== start) {
        try { await this.call(start ? 'StartStream' : 'StopStream'); }
        catch (error) {
          if (isObsRequestRejection(error)) throw error;
          throw uncertainOutput('Commande de diffusion OBS envoyée ; accusé non reçu. Vérifiez l’état avant de réessayer.');
        }
      }
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
  async sceneSourceEnabled(sceneName: string, sourceName: string) { return (await this.sceneSources(sceneName)).has(sourceName); }
  async inputAudioReadiness(inputName: string) {
    this.requireConnected();
    const [mute, volume, tracks, monitor, scene] = await Promise.all([
      this.call('GetInputMute', { inputName }), this.call('GetInputVolume', { inputName }),
      this.call('GetInputAudioTracks', { inputName }), this.call('GetInputAudioMonitorType', { inputName }),
      this.call('GetCurrentProgramScene'),
    ]);
    return { audible: !mute.inputMuted && volume.inputVolumeMul > 0 && Object.values(tracks.inputAudioTracks).some(Boolean) && monitor.monitorType !== 'OBS_MONITORING_TYPE_MONITOR_ONLY',
      active: await this.sceneSourceEnabled(scene.currentProgramSceneName, inputName) };
  }
  async verifySoundboardPlayback(inputName: string) {
    const result = await this.inputAudioReadiness(inputName);
    if (!result.active || !result.audible) throw new Error('Soundboard OBS inactive ou inaudible : vérifier scène, activation, mute, volume et pistes audio.');
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
  /** Reconnect only an existing StreamDashboard timer, without replacing another overlay. */
  async reconnectTimerBrowserSource(inputName: string, endpoint: string) {
    this.requireConnected();
    if (await this.inputKind(inputName) !== 'browser_source') throw new Error('Source navigateur minuteur introuvable.');
    const { inputSettings } = await this.call('GetInputSettings', { inputName });
    let current: URL;
    try { current = new URL(String(inputSettings.url || '')); } catch { throw new Error('Renseignez manuellement l’URL du minuteur dans OBS.'); }
    if (inputSettings.is_local_file || current.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(current.hostname)
      || !['48132','48133'].includes(current.port) || current.pathname.replace(/\/$/,'') !== '/overlay/timer')
      throw new Error('Cette source utilise un autre overlay. Son URL doit être modifiée manuellement dans OBS.');
    await this.setInputSettings(inputName, { url: endpoint });
    await this.refreshBrowserSource(inputName);
  }

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
