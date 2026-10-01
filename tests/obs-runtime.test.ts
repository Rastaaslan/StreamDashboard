import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sockets: FakeSocket[] = [];
let available = true;
class FakeSocket extends EventEmitter {
  connected = false;
  streaming = false;
  inputs = [{ inputName: 'Mic', inputKind: 'wasapi_input_capture' }, { inputName: 'Timer', inputKind: 'browser_source' }, { inputName: 'Media', inputKind: 'ffmpeg_source' }];
  connect = vi.fn(async () => { if (!available) throw new Error('ECONNREFUSED password-secret'); this.connected = true; });
  disconnect = vi.fn(async () => { this.connected = false; });
  call = vi.fn(async (type: string, _args?: unknown): Promise<any> => {
    if (!this.connected) throw new Error('not connected');
    switch (type) {
      case 'GetVersion': return { obsVersion: '31', obsWebSocketVersion: '5' };
      case 'GetCurrentProgramScene': return { currentProgramSceneName: 'Live' };
      case 'GetSceneList': return { scenes: [{ sceneName: 'Live' }] };
      case 'GetStreamStatus': return { outputActive: this.streaming };
      case 'GetRecordStatus': return { outputActive: false };
      case 'GetInputList': return { inputs: this.inputs };
      case 'GetInputMute': return { inputMuted: false };
      case 'GetInputVolume': return { inputVolumeMul: 1, inputVolumeDb: 0 };
      case 'GetSceneItemList': return { sceneItems: [{ sourceName: 'Mic', sceneItemEnabled: true }] };
      case 'StartStream': this.streaming = true; this.emit('StreamStateChanged', { outputActive: true }); return {};
      case 'StopStream': this.streaming = false; this.emit('StreamStateChanged', { outputActive: false }); return {};
      default: return {};
    }
  });
  constructor() { super(); sockets.push(this); }
}
vi.mock('obs-websocket-js', () => ({ default: FakeSocket }));
const { ObsClient } = await import('../integrations/obs/src/client.js');
let obs: InstanceType<typeof ObsClient>;
const socket = () => sockets.at(-1)!;
beforeEach(() => { vi.useFakeTimers(); sockets.length = 0; available = true; obs = new ObsClient(); });
afterEach(async () => { await obs.close(); vi.useRealTimers(); });

describe('OBS runtime resilience', () => {
  it('recovers when OBS appears after startup, without exposing secrets', async () => {
    available = false;
    await obs.connect();
    expect(obs.state.connected).toBe(false);
    expect(obs.state.error).not.toContain('password-secret');
    available = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(obs.state).toMatchObject({ connected: true, streamingKnown: true, scene: 'Live' });
  });
  it('invalidates live telemetry immediately and reconnects after crash', async () => {
    const changed = vi.fn(); obs.onStateChanged(changed);
    await obs.connect(); await obs.stream(true);
    socket().emit('ConnectionClosed');
    expect(obs.state).toMatchObject({ connected: false, streaming: true, streamingKnown: false, scene: null, inputs: {}, scenes: [] });
    await expect(obs.waitForStreaming(true)).rejects.toThrow();
    await expect(obs.scene('Live')).rejects.toThrow();
    expect(changed).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2000);
    expect(obs.state).toMatchObject({ connected: true, streaming: false, streamingKnown: true });
  });
  it('discards a late snapshot after disconnect', async () => {
    await obs.connect();
    const old = socket();
    let resolve!: (value: unknown) => void;
    old.call.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
    const refresh = obs.refresh().catch(() => undefined);
    old.emit('ConnectionClosed');
    resolve({ obsVersion: 'stale' });
    await refresh;
    expect(obs.state).toMatchObject({ connected: false, scene: null, inputs: {}, streamingKnown: false });
  });
  it('bounds a hanging request, cancels retries on close and never replays a mutation', async () => {
    await obs.connect();
    const old = socket();
    old.call.mockImplementationOnce(() => new Promise(() => {}));
    const pending = obs.stream(true);
    const rejected = expect(pending).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(5000); await rejected;
    expect(obs.state.connected).toBe(false);
    expect(old.call.mock.calls.filter(([type]) => type === 'StartStream')).toHaveLength(0);
    await obs.close(); const count = sockets.length;
    await vi.advanceTimersByTimeAsync(60000);
    expect(sockets).toHaveLength(count);
  });
  it('guards missing/renamed mic, scene, media and browser sources', async () => {
    await obs.connect();
    socket().inputs = socket().inputs.filter(input => input.inputName !== 'Mic');
    await expect(obs.mute('Mic', true)).rejects.toThrow();
    await expect(obs.volume('Mic', .5)).rejects.toThrow();
    await expect(obs.scene('Missing')).rejects.toThrow();
    await expect(obs.restartMedia('Timer')).rejects.toThrow();
    await expect(obs.refreshBrowserSource('Media')).rejects.toThrow();
    await obs.refresh();
    expect(obs.state.inputs.Mic).toBeUndefined();
    await obs.restartMedia('Media'); await obs.refreshBrowserSource('Timer');
  });
  it('coalesces connects and treats confirmed stream state idempotently', async () => {
    await Promise.all([obs.connect(), obs.connect()]);
    expect(socket().connect).toHaveBeenCalledTimes(1);
    await obs.stream(true); await obs.stream(true);
    expect(socket().call.mock.calls.filter(([type]) => type === 'StartStream')).toHaveLength(1);
  });
  it('ignores old socket events after configuration changes', async () => {
    await obs.connect(); const old = socket();
    await obs.configure('ws://localhost:4455', 'new-secret');
    old.emit('StreamStateChanged', { outputActive: true });
    old.emit('ConnectionClosed');
    expect(obs.state).toMatchObject({ connected: true, streaming: false });
  });
});

it('preserves newer stream events when an older refresh is completing', async () => {
  await obs.connect();
  let resolve!: (value: unknown) => void;
  socket().call.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const refresh = obs.refresh();
  socket().streaming = true;
  socket().emit('StreamStateChanged', { outputActive: true });
  resolve({ obsVersion: '31' });
  await refresh;
  expect(obs.state.streaming).toBe(true);
});

it('reports authentication failure without server secrets and retries with bounded backoff', async () => {
  await obs.connect();
  socket().emit('ConnectionClosed', { code: 4009, message: 'password-secret' });
  expect(obs.state.error).toBe('Mot de passe OBS incorrect ou manquant.');
  available = false;
  await vi.advanceTimersByTimeAsync(2000);
  const count = sockets.length;
  await vi.advanceTimersByTimeAsync(3999);
  expect(sockets).toHaveLength(count);
  available = true;
  await vi.advanceTimersByTimeAsync(1);
  expect(obs.state.connected).toBe(true);
});

it('rejects concurrent stream mutations without sending twice', async () => {
  await obs.connect();
  const first = obs.stream(true);
  await expect(obs.stream(true)).rejects.toThrow('déjà en cours');
  await first;
  expect(socket().call.mock.calls.filter(([type]) => type === 'StartStream')).toHaveLength(1);
});

it('guards all mutation families while offline', async () => {
  for (const action of [
    () => obs.stream(true), () => obs.stream(false), () => obs.record(true),
    () => obs.scene('Live'), () => obs.mute('Mic', true), () => obs.mute('Mic', false),
    () => obs.volume('Mic', 1), () => obs.volumeDb('Mic', -10),
    () => obs.restartMedia('Media'), () => obs.stopMedia('Media'),
    () => obs.refreshBrowserSource('Timer'), () => obs.setInputSettings('Timer', {}),
  ]) await expect(action()).rejects.toThrow();
  expect(socket().call).not.toHaveBeenCalled();
});

it('includes global OBS audio devices even outside scene items', async () => {
  await obs.connect();
  const original = socket().call.getMockImplementation()!;
  socket().call.mockImplementation(async (type, args) => {
    if (type === 'GetSceneItemList') return { sceneItems: [] };
    if (type === 'GetSpecialInputs') return { mic1: 'Mic' };
    return original(type, args);
  });
  await obs.refresh();
  expect(obs.state.activeAudioInputs).toContain('Mic');
});
