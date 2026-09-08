import OBSWebSocket from 'obs-websocket-js';
import type { ObsGateway } from '../types.js';

/** Safety net only: normal completion is driven by SceneTransitionEnded. */
export const TRANSITION_FALLBACK_MS = 5_000;

type TransitionEvents = {
  on(event: 'SceneTransitionEnded' | 'ConnectionClosed', listener: () => void): unknown;
  off(event: 'SceneTransitionEnded' | 'ConnectionClosed', listener: () => void): unknown;
};

export type TransitionWaitResult = 'ended' | 'disconnected' | 'timeout' | 'cancelled';

export function waitForTransitionEvent(
  events: TransitionEvents,
  timeoutMs = TRANSITION_FALLBACK_MS,
  signal?: AbortSignal,
): Promise<TransitionWaitResult> {
  return new Promise(resolve => {
    let timeout: NodeJS.Timeout;
    const finish = (reason: TransitionWaitResult) => {
      clearTimeout(timeout);
      events.off('SceneTransitionEnded', ended);
      events.off('ConnectionClosed', disconnected);
      signal?.removeEventListener('abort', cancelled);
      resolve(reason);
    };
    const ended = () => finish('ended');
    const disconnected = () => finish('disconnected');
    const cancelled = () => finish('cancelled');
    events.on('SceneTransitionEnded', ended);
    events.on('ConnectionClosed', disconnected);
    signal?.addEventListener('abort', cancelled, { once: true });
    timeout = setTimeout(() => finish('timeout'), timeoutMs);
  });
}

export class ObsClient implements ObsGateway {
  connected = false; currentScene: string | null = null; streaming = false;
  private client = new OBSWebSocket(); private retry?: NodeJS.Timeout;
  constructor(private url: string, private password: string) {
    this.client.on('ConnectionClosed', () => { this.connected = false; this.scheduleReconnect(); });
    this.client.on('CurrentProgramSceneChanged', e => { this.currentScene = e.sceneName; });
    this.client.on('StreamStateChanged', e => { this.streaming = e.outputActive; });
  }
  async connect() { clearTimeout(this.retry); try { await this.client.connect(this.url, this.password || undefined); this.connected = true; await this.refresh(); console.log('[obs] connected'); } catch (error) { this.connected = false; console.warn(`[obs] connection unavailable: ${error instanceof Error ? error.message : error}`); this.scheduleReconnect(); } }
  private scheduleReconnect() { clearTimeout(this.retry); this.retry = setTimeout(() => void this.connect(), 5000); this.retry.unref(); }
  private ensure() { if (!this.connected) throw new Error('OBS WebSocket is unavailable'); }
  async refresh() { this.ensure(); const [scene, stream] = await Promise.all([this.client.call('GetCurrentProgramScene'), this.client.call('GetStreamStatus')]); this.currentScene = scene.currentProgramSceneName; this.streaming = stream.outputActive; }
  async setScene(name: string) { this.ensure(); await this.client.call('SetCurrentProgramScene', { sceneName: name }); this.currentScene = name; console.log(`[obs] scene -> ${name}`); }
  async setSceneAndWait(name: string) {
    this.ensure();
    if (this.currentScene === name) return;
    // Subscribe before the request so even a very short Cut cannot race the listener.
    const controller = new AbortController();
    const transition = waitForTransitionEvent(this.client, TRANSITION_FALLBACK_MS, controller.signal);
    try {
      await this.setScene(name);
    } catch (error) {
      // Remove listeners immediately if OBS rejects the scene request.
      controller.abort();
      await transition;
      throw error;
    }
    const result = await transition;
    if (result !== 'ended') console.warn(`[obs] transition wait completed via safety fallback (${result})`);
  }
  async getCurrentScene() { this.ensure(); const r = await this.client.call('GetCurrentProgramScene'); return this.currentScene = r.currentProgramSceneName; }
  async startStreaming() { this.ensure(); if (!this.streaming) await this.client.call('StartStream'); this.streaming = true; }
  async stopStreaming() { this.ensure(); if (this.streaming) await this.client.call('StopStream'); this.streaming = false; }
}
