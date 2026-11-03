import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const replayFileGate = vi.hoisted(() => ({ wait: null as Promise<void> | null, entered: false }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>();
  return { ...real, lstat: async (...args: Parameters<typeof real.lstat>) => {
    if (replayFileGate.wait) { replayFileGate.entered = true; await replayFileGate.wait; }
    return real.lstat(...args);
  } };
});

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
const { attestWindowsObsReplaySource } = await import('../apps/server/src/streamcockpit-clipforge-windows-replay-grant.js');
let obs: InstanceType<typeof ObsClient>;
const socket = () => sockets.at(-1)!;
beforeEach(() => { vi.useFakeTimers(); replayFileGate.wait = null; replayFileGate.entered = false; sockets.length = 0; available = true; obs = new ObsClient(); });
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


describe('confirmed replay saves',()=>{
 it.skipIf(process.platform!=='win32')('offers a bounded HMAC-bound replay source ONLY to the host for read-only F04 attestation',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sc3-f04-obs-host-'));
  const file=join(root,'obs_replay_clip.mkv');
  try {
    await writeFile(file,'fixture not real OBS output');
    const observed=vi.fn();obs.onReplaySaved(observed);
    await obs.connect();await obs.stream(true);
    socket().emit('ReplayBufferSaved',{savedReplayPath:file});
    await vi.waitFor(()=>expect(observed).toHaveBeenCalledTimes(1));
    const event=observed.mock.calls[0][0];
    expect(JSON.stringify(event)).not.toContain(file);
    const captured=await obs.withSavedReplayForHost(event.sourceEventId,
      (trustedPath,witness,verifyObsEventId)=>attestWindowsObsReplaySource({
        sourceRoot:root,savedReplayPath:trustedPath,witness,verifyObsEventId,
        snapshot:()=>({connected:obs.state.connected,streamingKnown:obs.state.streamingKnown===true,
          streaming:obs.state.streaming,connectionGeneration:obs.connectionGeneration,
          streamEpoch:obs.streamTransitionEpoch}),
        hostEligible:async()=>true,
      }));
    expect(captured?.status).toBe('VERIFIED_HOST_ONLY');
    expect(JSON.stringify(captured)).not.toContain(root);
    expect(await obs.withSavedReplayForHost('obs_replay_'+'0'.repeat(64),async()=>true)).toBeUndefined();
    await obs.stream(false);
    expect(await obs.withSavedReplayForHost(event.sourceEventId,async()=>true)).toBeUndefined();
  } finally {await rm(root,{recursive:true,force:true});}
 });
 it('publishes only a witnessed, non-empty local replay file while streaming, never its path',async()=>{
  const folder = await mkdtemp(join(tmpdir(), 'sc3-private-replay-'));
  const file = join(folder, 'private-live-clip.mkv');
  try {
    await writeFile(file, 'a genuine local replay fixture');
    const observed=vi.fn(); const off=obs.onReplaySaved(observed);
    await obs.connect();
    socket().emit('ReplayBufferSaved',{savedReplayPath:file});
    expect(observed).not.toHaveBeenCalled();
    await obs.stream(true);
    socket().emit('ReplayBufferSaved',{savedReplayPath:''});
    expect(observed).not.toHaveBeenCalled();
    socket().emit('ReplayBufferSaved',{savedReplayPath:file});
    await vi.waitFor(()=>expect(observed).toHaveBeenCalledTimes(1));
    const payload=observed.mock.calls[0][0];
    expect(payload.sourceEventId).toMatch(/^obs_replay_[a-f0-9]{64}$/);
    expect(JSON.stringify(payload)).not.toContain('private');
    expect(JSON.stringify(payload)).not.toContain(folder);
    expect(payload.connectionGeneration).toBe(obs.connectionGeneration);
    expect(payload.streamEpoch).toBe(obs.streamTransitionEpoch);
    socket().emit('ReplayBufferSaved',{savedReplayPath:file});
    await vi.waitFor(()=>expect(observed).toHaveBeenCalledTimes(2));
    expect(observed.mock.calls[1][0].sourceEventId).toBe(payload.sourceEventId);
    await obs.stream(false);
    socket().emit('ReplayBufferSaved',{savedReplayPath:file});
    expect(observed).toHaveBeenCalledTimes(2);
    off();
  } finally { await rm(folder, { recursive: true, force: true }); }
 });
 it('refuses missing, empty, relative and directory replay paths without ever publishing a marker', async()=>{
  const folder = await mkdtemp(join(tmpdir(), 'sc3-invalid-replay-'));
  try {
    const empty = join(folder, 'empty.mkv');
    await writeFile(empty, '');
    const observed = vi.fn(); const off = obs.onReplaySaved(observed);
    await obs.connect(); await obs.stream(true);
    for (const savedReplayPath of [empty, join(folder, 'missing.mkv'), folder, 'relative.mkv']) {
      socket().emit('ReplayBufferSaved', { savedReplayPath });
    }
    // Let the real asynchronous NTFS metadata checks settle under fake timers.
    await vi.advanceTimersByTimeAsync(150);
    expect(observed).not.toHaveBeenCalled();
    off();
  } finally { await rm(folder, { recursive: true, force: true }); }
 });
 it('drops a delayed filesystem observation if OBS stops or disconnects before metadata resolves', async()=>{
  const folder = await mkdtemp(join(tmpdir(), 'sc3-delayed-replay-'));
  const file = join(folder, 'private-delayed.mkv');
  try {
    await writeFile(file, 'video fixture');
    const observed = vi.fn(); obs.onReplaySaved(observed);
    await obs.connect(); await obs.stream(true);
    let release!: () => void;
    replayFileGate.wait = new Promise<void>(r => { release = r; });
    socket().emit('ReplayBufferSaved', { savedReplayPath: file });
    await vi.waitFor(() => expect(replayFileGate.entered).toBe(true));
    await obs.stream(false);
    release(); replayFileGate.wait = null;
    await vi.advanceTimersByTimeAsync(150);
    expect(observed).not.toHaveBeenCalled();
    await obs.stream(true);
    replayFileGate.wait = new Promise<void>(r => { release = r; }); replayFileGate.entered = false;
    socket().emit('ReplayBufferSaved', { savedReplayPath: file });
    await vi.waitFor(() => expect(replayFileGate.entered).toBe(true));
    // Same WebSocket generation, but a DIFFERENT live after a stop/start:
    // the old replay event must never be attached to that new session.
    const oldGeneration = obs.connectionGeneration;
    await obs.stream(false); await obs.stream(true);
    expect(obs.connectionGeneration).toBe(oldGeneration);
    release(); replayFileGate.wait = null;
    await vi.advanceTimersByTimeAsync(150);
    expect(observed).not.toHaveBeenCalled();
    replayFileGate.wait = new Promise<void>(r => { release = r; }); replayFileGate.entered = false;
    socket().emit('ReplayBufferSaved', { savedReplayPath: file });
    await vi.waitFor(() => expect(replayFileGate.entered).toBe(true));
    socket().emit('ConnectionClosed');
    release(); replayFileGate.wait = null;
    await vi.advanceTimersByTimeAsync(150);
    expect(observed).not.toHaveBeenCalled();
  } finally { replayFileGate.wait = null; await rm(folder, { recursive: true, force: true }); }
 });
 it('refuses an inactive buffer without saving or silently starting it',async()=>{
  await obs.connect();const original=socket().call.getMockImplementation()!;
  socket().call.mockImplementation(async(type,args)=>type==='GetReplayBufferStatus'?{outputActive:false}:original(type,args));
  await expect(obs.saveReplay()).rejects.toThrow('Tampon arrêté');expect(socket().call.mock.calls.some(([type])=>['SaveReplayBuffer','StartReplayBuffer'].includes(type))).toBe(false);
 });
 it('subscribes before saving, accepts the completion event and removes its listener',async()=>{
  await obs.connect();const original=socket().call.getMockImplementation()!;
  socket().call.mockImplementation(async(type,args)=>{if(type==='GetReplayBufferStatus')return {outputActive:true};if(type==='GetLastReplayBufferReplay')return {savedReplayPath:'old.mkv'};if(type==='SaveReplayBuffer'){socket().emit('ReplayBufferSaved',{savedReplayPath:'new.mkv'});return {};}return original(type,args);});
  expect(await obs.saveReplay()).toBe('new.mkv');expect(socket().listenerCount('ReplayBufferSaved')).toBe(1); // Only the persistent read-only OBS observer remains.
 });
 it('never mistakes an old file or an acknowledgement for a new clip',async()=>{
  await obs.connect();const original=socket().call.getMockImplementation()!;
  socket().call.mockImplementation(async(type,args)=>type==='GetReplayBufferStatus'?{outputActive:true}:type==='GetLastReplayBufferReplay'?{savedReplayPath:'old.mkv'}:original(type,args));
  const promise=obs.saveReplay();const check=expect(promise).rejects.toMatchObject({name:'ACTION_UNCERTAIN'});await vi.advanceTimersByTimeAsync(11000);await check;
  expect(socket().call.mock.calls.filter(([type])=>type==='SaveReplayBuffer')).toHaveLength(1);expect(socket().listenerCount('ReplayBufferSaved')).toBe(1);
 });
 it('rejects a concurrent save and rejects a connection change after dispatch as uncertain',async()=>{
  await obs.connect();const original=socket().call.getMockImplementation()!;let dispatched=false;
  socket().call.mockImplementation(async(type,args)=>{if(type==='GetReplayBufferStatus')return {outputActive:true};if(type==='GetLastReplayBufferReplay')return {savedReplayPath:'old.mkv'};if(type==='SaveReplayBuffer'){dispatched=true;socket().emit('ConnectionClosed');return {};}return original(type,args);});
  const first=obs.saveReplay();await expect(obs.saveReplay()).rejects.toThrow('déjà en cours');await expect(first).rejects.toMatchObject({name:'ACTION_UNCERTAIN'});expect(dispatched).toBe(true);
 });
});
