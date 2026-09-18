import { describe, expect, it, vi } from 'vitest';
import { createMobileCommandController, CRITICAL_COMMAND_TIMEOUT_MS, shouldApplyState } from '../apps/mobile/command-controller.js';

describe('contrôleur de commandes mobile', () => {
  it('commande par HTTP quand le WebSocket est absent', async () => {
    const command = vi.fn().mockResolvedValue({ state: { stateRevision: 2, obs: { streaming: false } } }); const applyState = vi.fn();
    const controller = createMobileCommandController({ transport: { command, state: vi.fn() }, getCredential: () => 'paired', applyState, notify: vi.fn(), makeId: () => 'command-0001' });
    await controller.execute({ type: 'timer.pause' });
    expect(command).toHaveBeenCalledOnce(); expect(command).toHaveBeenCalledWith({ type: 'timer.pause' }, { commandId: 'command-0001', timeoutMs: 15_000 }); expect(applyState).toHaveBeenCalledOnce();
  });

  it('une commande lente ne bloque pas une ressource indépendante', async () => {
    let release!: () => void; const slow = new Promise(resolve => { release = () => resolve({ state: {} }); });
    const command = vi.fn().mockImplementation(value => value.type === 'session.start' ? slow : Promise.resolve({ state: {} }));
    const controller = createMobileCommandController({ transport: { command, state: vi.fn() }, getCredential: () => 'paired', applyState: vi.fn(), notify: vi.fn(), makeId: () => crypto.randomUUID() });
    const start = controller.execute({ type: 'session.start' }); await controller.execute({ type: 'obs.mute', input: 'Mic', muted: true });
    expect(command).toHaveBeenCalledTimes(2); release(); await start;
  });

  it('déduplique un double clic sur la même ressource', async () => {
    let release!: () => void; const command = vi.fn().mockImplementation(() => new Promise(resolve => { release = () => resolve({ state: {} }); }));
    const controller = createMobileCommandController({ transport: { command, state: vi.fn() }, getCredential: () => 'paired', applyState: vi.fn(), notify: vi.fn(), makeId: () => 'command-0002' });
    const first = controller.execute({ type: 'session.start' }); expect(await controller.execute({ type: 'session.start' })).toMatchObject({ skipped: true }); expect(command).toHaveBeenCalledOnce(); release(); await first;
  });

  it('réconcilie un timeout Start par GET state sans annoncer un faux échec', async () => {
    const timeout = Object.assign(new Error('timeout'), { name: 'RequestTimeoutError' }); const applyState = vi.fn();
    const transport = { command: vi.fn().mockRejectedValue(timeout), state: vi.fn().mockResolvedValue({ stateRevision: 4, obs: { streaming: true } }) };
    const controller = createMobileCommandController({ transport, getCredential: () => 'paired', applyState, notify: vi.fn(), makeId: () => 'command-0003' });
    expect(await controller.execute({ type: 'session.start' })).toMatchObject({ reconciled: true });
    expect(transport.command).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ timeoutMs: CRITICAL_COMMAND_TIMEOUT_MS })); expect(transport.state).toHaveBeenCalledOnce();
  });

  it('ignore un snapshot temps réel obsolète', () => {
    expect(shouldApplyState({ stateRevision: 9 }, { stateRevision: 8 })).toBe(false);
    expect(shouldApplyState({ stateRevision: 9 }, { stateRevision: 10 })).toBe(true);
  });
});
