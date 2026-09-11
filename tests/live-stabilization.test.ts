import { describe, expect, it, vi } from 'vitest';
import { DashboardCommandService, type ObsCommands } from '../apps/server/src/command-service.js';
import { parseCommand } from '../packages/contracts/src/index.js';

describe('stabilisation workflow live réel', () => {
  it('confirme la scène Live et rafraîchit le timer avant StartStream', async () => {
    const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [] };
    const order: string[] = [];
    const obs: ObsCommands = {
      state: { connected: true, streaming: false, scene: 'Intro' },
      scene: vi.fn(async name => { order.push(`scene:${name}`); }),
      waitForScene: vi.fn(async name => { order.push(`scene-confirmed:${name}`); obs.state.scene = name; }),
      refreshBrowserSource: vi.fn(async name => { order.push(`browser:${name}`); }),
      mute: vi.fn(), volume: vi.fn(), volumeDb: vi.fn(),
      stream: vi.fn(async () => { order.push('stream'); }), waitForStreaming: vi.fn(async expected => { order.push('stream-confirmed'); obs.state.streaming = expected; }),
      record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
    };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never), { settings: { modeScenes: { live: 'Gameplay' }, timerBrowserSource: 'Timer Browser' } });
    await service.execute({ type: 'session.start' });
    expect(order).toEqual(['scene:Gameplay', 'scene-confirmed:Gameplay', 'browser:Timer Browser', 'stream', 'stream-confirmed']);
    expect(domain.mode).toBe('live'); expect(domain.timer).toMatchObject({ running: true, remaining: 300 });
  });

  it('une erreur de refresh Browser Source ne bloque pas le démarrage du live', async () => {
    const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [] };
    const warnings: unknown[][] = [];
    const obs: ObsCommands = {
      state: { connected: true, streaming: false }, scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
      refreshBrowserSource: vi.fn(async () => { throw new Error('browser cache fail'); }), waitForStreaming: vi.fn(async expected => { obs.state.streaming = expected; }),
    };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never), { settings: { modeScenes: {}, timerBrowserSource: 'Timer' }, logger: { info() {}, warn(...args) { warnings.push(args); } } });
    await service.execute({ type: 'session.start' });
    expect(obs.stream).toHaveBeenCalledWith(true); expect(warnings).toHaveLength(1); expect(domain.mode).toBe('live');
  });

  it('délègue le volume dB sans repasser par le multiplicateur linéaire', async () => {
    const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [] };
    const obs: ObsCommands = { state: { connected: true, streaming: false }, scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), volumeDb: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn() };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never));
    await service.execute({ type: 'obs.volumeDb', input: 'Micro', volumeDb: -12 });
    expect(obs.volumeDb).toHaveBeenCalledWith('Micro', -12); expect(obs.volume).not.toHaveBeenCalled();
  });

  it('valide strictement les nouvelles commandes publiques', () => {
    expect(parseCommand({ type: 'obs.browser.refresh', input: 'Timer' })).toEqual({ type: 'obs.browser.refresh', input: 'Timer' });
    expect(parseCommand({ type: 'obs.volumeDb', input: 'Micro', volumeDb: -12 })).toEqual({ type: 'obs.volumeDb', input: 'Micro', volumeDb: -12 });
    expect(() => parseCommand({ type: 'obs.volumeDb', input: 'Micro', volumeDb: 999 })).toThrow(/volumeDb/);
  });
});
