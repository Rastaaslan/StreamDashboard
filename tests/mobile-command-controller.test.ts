import { describe, expect, it, vi } from 'vitest';
import { acceptsSnapshot, createCommandController, primaryMicCommand } from '../apps/mobile/command-controller.js';

describe('mobile HTTP command controller', () => {
  it('sends commands without requiring a realtime channel', async () => {
    const send = vi.fn().mockResolvedValue({ state: { obs: { streaming: true } } });
    const applyState = vi.fn();
    const controller = createCommandController({ send, readState: vi.fn(), applyState });

    const result = await controller.execute({ type: 'session.start' }, { resource: 'stream' });

    expect(result.accepted).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
    expect(applyState).toHaveBeenCalledOnce();
  });

  it('locks only the affected resource', async () => {
    let release!: (value: unknown) => void;
    const send = vi.fn().mockImplementation((value: { type: string }) => value.type === 'session.start'
      ? new Promise(resolve => { release = resolve; })
      : Promise.resolve({ state: { obs: { streaming: false } } }));
    const controller = createCommandController({ send, readState: vi.fn(), applyState: vi.fn() });

    const stream = controller.execute({ type: 'session.start' }, { resource: 'stream' });
    const duplicate = await controller.execute({ type: 'session.start' }, { resource: 'stream' });
    const mic = await controller.execute({ type: 'obs.mute' }, { resource: 'audio:mic' });
    release({ state: { obs: { streaming: true } } });
    await stream;

    expect(duplicate).toEqual({ accepted: false, reason: 'busy' });
    expect(mic.accepted).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('reconciles a timed-out critical command from authoritative REST state', async () => {
    const send = vi.fn().mockRejectedValue(new Error('timeout'));
    const readState = vi.fn().mockResolvedValue({ obs: { connected: true, streamingKnown: true, streaming: true } });
    const controller = createCommandController({ send, readState, applyState: vi.fn() });

    const result = await controller.execute({ type: 'session.start' }, {
      resource: 'stream',
      timeoutMs: 30_000,
      reconcile: (state: { obs: { streaming: boolean } }) => state.obs.streaming === true,
    });

    expect(result.accepted).toBe(true);
    expect(result.reconciled).toBe(true);
    expect(readState).toHaveBeenCalledOnce();
  });

  it('always releases a resource lock after an error', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ state: {} });
    const controller = createCommandController({ send, readState: vi.fn(), applyState: vi.fn() });
    await expect(controller.execute({ type: 'mode.set' }, { resource: 'scene' })).rejects.toThrow('offline');
    await expect(controller.execute({ type: 'mode.set' }, { resource: 'scene' })).resolves.toMatchObject({ accepted: true });
  });

  it('reports both the command and reconciliation failures', async () => {
    const controller = createCommandController({
      send: vi.fn().mockRejectedValue(new Error('command timeout')),
      readState: vi.fn().mockRejectedValue(new Error('REST down')),
      applyState: vi.fn(),
    });
    await expect(controller.execute({ type: 'session.start' }, {
      resource: 'stream', reconcile: () => false,
    })).rejects.toThrow('La réconciliation de l’état a également échoué');
  });
});

describe('explicit primary microphone', () => {
  it('never falls back to the first active audio source', () => {
    const state = {
      settings: { primaryMicInput: 'DJI Mic' },
      obs: { inputs: { 'Game Audio': { muted: false }, Discord: { muted: false }, 'DJI Mic': { muted: true } } },
    };
    expect(primaryMicCommand(state)).toEqual({ type: 'obs.mute', input: 'DJI Mic', muted: false });
  });

  it('fails closed when the configured microphone was removed or renamed', () => {
    expect(() => primaryMicCommand({ settings: { primaryMicInput: 'Old Mic' }, obs: { inputs: { 'New Mic': { muted: false } } } }))
      .toThrow('Micro principal introuvable');
  });

  it('fails closed when no primary microphone is configured', () => {
    expect(() => primaryMicCommand({ settings: {}, obs: { inputs: { Discord: { muted: false } } } }))
      .toThrow('Micro principal non configuré');
  });
});

describe('monotonic mobile snapshots', () => {
  it('accepts a fresh PC instance after Desktop restart', () => {
    expect(acceptsSnapshot({ stateRevision: 999, serverInstanceId: 'before' }, { stateRevision: 0, serverInstanceId: 'after' })).toBe(true);
    expect(acceptsSnapshot({ stateRevision: 999, serverInstanceId: 'same' }, { stateRevision: 0, serverInstanceId: 'same' })).toBe(false);
  });
  it('ignores a stale revision after a newer HTTP or realtime snapshot', () => {
    expect(acceptsSnapshot({ stateRevision: 42 }, { stateRevision: 41 })).toBe(false);
    expect(acceptsSnapshot({ stateRevision: 42 }, { stateRevision: 43 })).toBe(true);
    expect(acceptsSnapshot({ stateRevision: 42 }, {})).toBe(true);
  });
});

describe('command connection ownership', () => {
  it('discards old success without releasing a new generation resource lock', async () => {
    let generation = 0;
    const pending: ((value: { state: {} }) => void)[] = [];
    const applyState = vi.fn();
    const controller = createCommandController<{}>({ getGeneration: () => generation, send: () => new Promise(resolve => pending.push(resolve)), readState: vi.fn(), applyState });
    const old = controller.execute({ type: 'session.stop' });
    generation++;
    expect(controller.isLocked('session.stop')).toBe(false);
    const current = controller.execute({ type: 'session.stop' });
    pending[0]({ state: {} });
    expect(await old).toEqual({ accepted: false, reason: 'stale' });
    expect(controller.isLocked('session.stop')).toBe(true);
    expect(applyState).not.toHaveBeenCalled();
    pending[1]({ state: {} });
    expect((await current).accepted).toBe(true);
    expect(applyState).toHaveBeenCalledOnce();
  });

  it('does not reconcile a failure from a retired connection', async () => {
    let generation = 0;
    let reject!: (error: Error) => void;
    const readState = vi.fn();
    const controller = createCommandController({ getGeneration: () => generation, send: () => new Promise((_resolve, fail) => { reject = fail; }), readState, applyState: vi.fn() });
    const result = controller.execute({ type: 'session.stop' }, { reconcile: () => true });
    generation++;
    reject(new Error('old timeout'));
    expect(await result).toEqual({ accepted: false, reason: 'stale' });
    expect(readState).not.toHaveBeenCalled();
  });

  it('discards an in-flight reconciliation after reconnect or forget', async () => {
    let generation = 0;
    let resolve!: (state: {}) => void;
    const readState = vi.fn(() => new Promise<{}>(done => { resolve = done; }));
    const applyState = vi.fn();
    const reconcile = vi.fn(() => true);
    const onMessage = vi.fn();
    const controller = createCommandController({ getGeneration: () => generation, send: vi.fn().mockRejectedValue(new Error('timeout')), readState, applyState, onMessage });
    const result = controller.execute({ type: 'session.stop' }, { reconcile });
    await Promise.resolve();
    expect(readState).toHaveBeenCalledOnce();
    generation++;
    resolve({});
    expect(await result).toEqual({ accepted: false, reason: 'stale' });
    expect(applyState).not.toHaveBeenCalled();
    expect(reconcile).not.toHaveBeenCalled();
    expect(onMessage).not.toHaveBeenCalled();
  });
});
