import { describe, expect, it, vi } from 'vitest';
import { createCommandController } from '../apps/mobile/command-controller.js';

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
    const readState = vi.fn().mockResolvedValue({ obs: { streaming: true } });
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
});
