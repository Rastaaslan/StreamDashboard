import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
const { instances, control } = vi.hoisted(() => ({ instances: [] as any[], control: { holdConnect: false, finish: undefined as undefined | (() => void) } }));
vi.mock('obs-websocket-js', () => ({ default: class extends EventEmitter {
  constructor() { super(); instances.push(this); }
  connect = vi.fn(async () => { if (control.holdConnect) await new Promise<void>(resolve => { control.finish = resolve; }); });
  disconnect = vi.fn(async () => {});
  call = vi.fn(async (type: string) => {
    switch (type) {
      case 'GetVersion': return { obsVersion: '30', obsWebSocketVersion: '5' };
      case 'GetCurrentProgramScene': return { currentProgramSceneName: 'Live' };
      case 'GetSceneList': return { scenes: [] };
      case 'GetStreamStatus': return { outputActive: true };
      case 'GetInputList': return { inputs: [] };
      case 'GetSceneItemList': return { sceneItems: [] };
      default: return {};
    }
  });
} }));
import { ObsClient } from '../integrations/obs/src/client.js';
afterEach(() => { vi.useRealTimers(); instances.length = 0; control.holdConnect = false; control.finish = undefined; });
describe('OBS recovery', () => {
  it('coalesces simultaneous connects and cannot resurrect after close', async () => {
    vi.useFakeTimers(); const client = new ObsClient(); control.holdConnect = true;
    const first = client.connect(); const second = client.connect(); const socket = instances.at(-1);
    await Promise.resolve(); expect(socket.connect).toHaveBeenCalledOnce();
    const closing = client.close(); control.finish!(); await Promise.all([first, second, closing]);
    expect(client.state.connected).toBe(false); expect(vi.getTimerCount()).toBe(0);
  });

  it('discards telemetry completing after close', async () => {
    vi.useFakeTimers(); const client = new ObsClient();
    await client.connect(); const socket = instances.at(-1);
    let finish!: (value: unknown) => void;
    const original = socket.call.getMockImplementation();
    socket.call.mockImplementation((type: string) => type === 'GetStreamStatus' ? new Promise(resolve => { finish = resolve; }) : original(type));
    const refresh = client.refresh().catch(() => undefined); const closing = client.close(); finish({ outputActive: true }); await Promise.all([refresh, closing]);
    expect(client.state).toMatchObject({ connected: false, streamingKnown: false, scene: null });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('bounds a lost OBS command response without repeating the command', async () => {
    vi.useFakeTimers(); const client = new ObsClient();
    await client.connect(); const socket = instances.at(-1); const original = socket.call.getMockImplementation();
    socket.call.mockImplementation((type: string) => type === 'StopStream' ? new Promise(() => {}) : original(type));
    const command = expect(client.stream(false)).rejects.toThrow(/délai/i);
    await vi.advanceTimersByTimeAsync(5_000); await command;
    expect(socket.call.mock.calls.filter(([type]: [string]) => type === 'StopStream')).toHaveLength(1);
    expect(client.state.connected).toBe(false);
    await client.close(); expect(vi.getTimerCount()).toBe(0);
  });

  it('does not confirm stale stream state while disconnected', async () => {
    const client = new ObsClient(); client.state.streaming = true;
    await expect(client.waitForStreaming(true)).rejects.toThrow(/connecté/);
    await client.close();
  });
});
