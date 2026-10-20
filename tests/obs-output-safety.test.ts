import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const sockets: FakeSocket[] = [];
class FakeSocket extends EventEmitter {
  outputs: any[] = [];
  suiteOutputs = [{ name: 'YouTube Output', type: 'stream', active: false }];
  hotkeys = ['AitumStreamSuiteStartOutputYouTube Output', 'AitumStreamSuiteStopOutputYouTube Output'];
  parameters: Record<string, string> = { Mode: 'Advanced', RecType: 'Standard', RecRB: 'true', RecRBTime: '30' };
  replayActive = false;
  replayError: Error | undefined;
  connect = vi.fn(async () => {});
  disconnect = vi.fn(async () => {});
  call = vi.fn(async (type: string, data: any = {}): Promise<any> => {
    switch (type) {
      case 'GetVersion': return { obsVersion: '32.2.2', obsWebSocketVersion: '5.7.4' };
      case 'GetCurrentProgramScene': return { currentProgramSceneName: 'Live' };
      case 'GetSceneList': return { scenes: [{ sceneName: 'Live' }] };
      case 'GetStreamStatus': return { outputActive: true };
      case 'GetRecordStatus': return { outputActive: false };
      case 'GetInputList': return { inputs: [] };
      case 'GetSceneItemList': return { sceneItems: [] };
      case 'GetOutputList': return { outputs: this.outputs };
      case 'GetOutputStatus': return { outputActive: this.outputs.find(o => o.outputName === data.outputName)?.outputActive ?? false };
      case 'StartOutput': case 'StopOutput': {
        const output = this.outputs.find(o => o.outputName === data.outputName);
        if (output) output.outputActive = type === 'StartOutput';
        return {};
      }
      case 'GetHotkeyList': return { hotkeys: this.hotkeys };
      case 'CallVendorRequest':
        if (data.requestType === 'version') return { responseData: { success: true, version: '1.2.4' } };
        if (data.requestType === 'get_outputs') return { responseData: { success: true, outputs: this.suiteOutputs } };
        return { responseData: { success: true } };
      case 'GetProfileParameter': return { parameterValue: this.parameters[data.parameterName], defaultParameterValue: '' };
      case 'GetRecordDirectory': return { recordDirectory: 'D:/Clips' };
      case 'GetReplayBufferStatus':
        if (this.replayError) throw this.replayError;
        return { outputActive: this.replayActive };
      case 'StartReplayBuffer': this.replayActive = true; return {};
      case 'StopReplayBuffer': this.replayActive = false; return {};
      default: return {};
    }
  });
  constructor() { super(); sockets.push(this); }
}
vi.mock('obs-websocket-js', () => ({ default: FakeSocket }));
const { ObsClient } = await import('../integrations/obs/src/client.js');
let obs: InstanceType<typeof ObsClient>;
const socket = () => sockets.at(-1)!;
const streamOutput = (name: string) => ({ outputName: name, outputKind: 'rtmp_output', outputActive: false, outputFlags: { OBS_OUTPUT_SERVICE: true } });
beforeEach(async () => { sockets.length = 0; obs = new ObsClient(); await obs.connect(); socket().call.mockClear(); });
afterEach(async () => { await obs.close(); });
describe('OBS output destination routing', () => {
  it('rejects duplicate native names before either instance can be started', async () => {
    socket().outputs = [streamOutput('Second output'), streamOutput('Second output')];
    await expect(obs.setOutput('Second output', true)).rejects.toThrow(/ambiguë/);
    expect(socket().call.mock.calls.some(([type]) => type === 'StartOutput')).toBe(false);
  });
  it.each(['replay_buffer', 'mp4_output', 'virtualcam_output'])('refuses a non-streaming %s output as a live destination', async outputKind => {
    socket().outputs = [{ ...streamOutput('Wrong target'), outputKind, outputFlags: { OBS_OUTPUT_SERVICE: false } }];
    await expect(obs.setOutput('Wrong target', true)).rejects.toThrow(/diffusion/);
    expect(socket().call.mock.calls.some(([type]) => type === 'StartOutput')).toBe(false);
  });
  it('preserves a named custom stream and dispatches only that exact destination', async () => {
    socket().outputs = [streamOutput('First'), streamOutput('My custom destination')];
    await obs.setOutput('My custom destination', true);
    expect(socket().call.mock.calls.filter(([type]) => type === 'StartOutput')).toEqual([['StartOutput', { outputName: 'My custom destination' }]]);
    expect(socket().outputs[0].outputActive).toBe(false);
  });
  it('routes a native Aitum alias through the plugin without bypassing its output setup', async () => {
    socket().outputs = [streamOutput('Aitum Stream Suite Output YouTube Output')];
    await obs.setOutput('Aitum Stream Suite Output YouTube Output', true);
    expect(socket().call.mock.calls.some(([type]) => type === 'StartOutput')).toBe(false);
    expect(socket().call.mock.calls.filter(([type, data]) => type === 'CallVendorRequest' && data.requestType === 'start_output')).toEqual([
      ['CallVendorRequest', { vendorName: 'aitum-stream-suite', requestType: 'start_output', requestData: { output: 'YouTube Output' } }],
    ]);
  });
  it('refuses ambiguous Aitum hotkeys even when the displayed output name is unique', async () => {
    socket().hotkeys.push(socket().hotkeys[0]);
    await expect(obs.setStreamSuiteOutput('YouTube Output', true)).rejects.toThrow(/ambigu/);
    expect(socket().call.mock.calls.some(([type, data]) => type === 'CallVendorRequest' && data.requestType === 'start_output')).toBe(false);
  });
  it('never falls back to native StartOutput when an Aitum alias is missing from the plugin', async () => {
    socket().outputs = [streamOutput('Aitum Stream Suite Output Removed destination')];
    await expect(obs.setOutput('Aitum Stream Suite Output Removed destination', true)).rejects.toThrow(/absente/);
    expect(socket().call.mock.calls.some(([type]) => type === 'StartOutput')).toBe(false);
  });
  it.each([true,false])('confirms a lost native output acknowledgement by observation, without a second mutation (%s)', async active => {
    socket().outputs = [{ ...streamOutput('Selected output'), outputActive: !active }];
    const original = socket().call.getMockImplementation()!;
    socket().call.mockImplementation(async(type,data)=>{
      const result = await original(type,data);
      if(type===(active?'StartOutput':'StopOutput'))throw new Error('Reply lost');
      return result;
    });
    await expect(obs.setOutput('Selected output',active)).resolves.toBeUndefined();
    expect(socket().call.mock.calls.filter(([type])=>type===(active?'StartOutput':'StopOutput'))).toHaveLength(1);
  });
  it('reports failed confirmation after a native start as uncertain even for an explicit read error',async()=>{
    socket().outputs = [streamOutput('Selected output')];
    const original = socket().call.getMockImplementation()!;let reads=0;
    socket().call.mockImplementation(async(type,data)=>{
      if(type==='GetOutputStatus'&&++reads>1)throw Object.assign(new Error('Output temporarily unavailable'),{code:600});
      return original(type,data);
    });
    await expect(obs.setOutput('Selected output',true)).rejects.toMatchObject({name:'ACTION_UNCERTAIN'});
    expect(socket().call.mock.calls.filter(([type])=>type==='StartOutput')).toHaveLength(1);
    expect(socket().outputs[0].outputActive).toBe(true);
  });
  it('keeps native preflight and explicit mutation rejections definitive',async()=>{
    socket().outputs = [streamOutput('Selected output')];
    const original = socket().call.getMockImplementation()!;
    socket().call.mockImplementation(async(type,data)=>{
      if(type==='GetOutputStatus')throw new Error('Read failed before dispatch');
      return original(type,data);
    });
    const preflight=await obs.setOutput('Selected output',true).catch(error=>error);
    expect(preflight.name).not.toBe('ACTION_UNCERTAIN');
    expect(socket().call.mock.calls.filter(([type])=>type==='StartOutput')).toHaveLength(0);
    socket().call.mockImplementation(async(type,data)=>{
      if(type==='StartOutput')throw Object.assign(new Error('Rejected by OBS'),{code:600});
      return original(type,data);
    });
    const rejection=await obs.setOutput('Selected output',true).catch(error=>error);
    expect(rejection).toMatchObject({code:600});expect(rejection.name).not.toBe('ACTION_UNCERTAIN');
    expect(socket().call.mock.calls.filter(([type])=>type==='StartOutput')).toHaveLength(1);
  });
  it('refuses malformed native preflight state without attempting to start',async()=>{
    socket().outputs = [streamOutput('Selected output')];
    const original = socket().call.getMockImplementation()!;
    socket().call.mockImplementation(async(type,data)=>type==='GetOutputStatus'?{}:original(type,data));
    await expect(obs.setOutput('Selected output',true)).rejects.toThrow(/État.*indisponible/);
    expect(socket().call.mock.calls.some(([type])=>type==='StartOutput')).toBe(false);
  });
});
describe('replay configuration and runtime availability', () => {
  it('retains Advanced profile settings when the replay output is not instantiated', async () => {
    socket().replayError = Object.assign(new Error('Replay buffer is not available.'), { code: 604 });
    expect(await obs.replayStatus()).toMatchObject({ mode: 'Advanced', enabled: true, available: false, active: false, seconds: 30, directory: 'D:/Clips', error: expect.stringMatching(/indisponible/) });
  });
  it('diagnoses a disabled buffer without requesting unavailable runtime state', async () => {
    socket().parameters.RecRB = 'false';
    socket().replayError = Object.assign(new Error('Replay buffer is not available.'), { code: 604 });
    expect(await obs.replayStatus()).toMatchObject({ mode: 'Advanced', enabled: false, available: false, active: false, seconds: 30, directory: 'D:/Clips', error: expect.stringMatching(/OBS/) });
    expect(socket().call.mock.calls.some(([type]) => type === 'GetReplayBufferStatus')).toBe(false);
    await expect(obs.setReplayBuffer(true)).rejects.toThrow(/OBS/);
    expect(socket().call.mock.calls.some(([type]) => type === 'StartReplayBuffer')).toBe(false);
  });
  it('identifies Advanced custom FFmpeg recording as incompatible with replay', async () => {
    socket().parameters.RecType = 'FFmpeg';
    expect(await obs.replayStatus()).toMatchObject({ mode: 'Advanced', enabled: true, available: false, active: false, error: expect.stringMatching(/FFmpeg/) });
    expect(socket().call.mock.calls.some(([type]) => type === 'GetReplayBufferStatus')).toBe(false);
  });
  it('allows preparing an enabled available buffer and confirms actual state', async () => {
    expect(await obs.replayStatus()).toMatchObject({ mode: 'Advanced', enabled: true, available: true, active: false, error: '' });
    await obs.setReplayBuffer(true);
    expect(await obs.replayStatus()).toMatchObject({ active: true, available: true });
    expect(socket().call.mock.calls.filter(([type]) => type === 'StartReplayBuffer')).toHaveLength(1);
  });
  it('reads Simple profile settings without claiming a network failure means disabled', async () => {
    socket().parameters.Mode = 'Simple';
    expect(await obs.replayStatus()).toMatchObject({ mode: 'Simple', enabled: true, available: true });
    socket().replayError = new Error('Connection closed');
    await expect(obs.replayStatus()).rejects.toThrow(/joindre OBS/);
  });
});
