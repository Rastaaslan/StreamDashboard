import { describe, expect, it, vi } from 'vitest';
import { DashboardCommandService, type ObsCommands } from '../apps/server/src/command-service.js';

function setup() {
  const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [] };
  const obs: ObsCommands = {
    state: { connected: true, streaming: false },
    scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
  };
  const commit = vi.fn(async () => ({ ok: true }) as never);
  return { service: new DashboardCommandService(domain, obs, commit), obs, commit };
}

describe('service de commandes', () => {
  it('sélectionne la scène live avant StartStream et recrée le timer', async () => {
    const domain = { mode: 'end' as const, timer: { running: false, duration: 300, remaining: 17, deadline: null }, checklist: [] };
    const order: string[] = [];
    const obs: ObsCommands = { state: { connected: true, streaming: false }, scene: vi.fn(async () => { order.push('scene'); }), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(async () => { order.push('stream'); }), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(), waitForStreaming: vi.fn(async () => { order.push('confirmed'); }) };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never), { settings: { modeScenes: { live: 'Live' } } });
    await service.execute({ type: 'session.start' });
    expect(order).toEqual(['scene', 'stream', 'confirmed']);
    expect(domain.timer).toMatchObject({ running: true, remaining: 300 });
  });

  it('ne démarre pas le stream si le changement de scène échoue', async () => {
    const { service, obs, commit } = setup();
    const configured = new DashboardCommandService((service as never)['domain'], obs, commit, { settings: { modeScenes: { live: 'Missing' } } });
    vi.mocked(obs.scene).mockRejectedValueOnce(new Error('scene missing'));
    await expect(configured.execute({ type: 'session.start' })).rejects.toThrow(/scene missing/);
    expect(obs.stream).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  it('ne publie aucun faux état live si StartStream échoue', async () => {
    const { service, obs, commit } = setup(); vi.mocked(obs.stream).mockRejectedValueOnce(new Error('start failed'));
    await expect(service.execute({ type: 'session.start' })).rejects.toThrow(/start failed/);
    expect(commit).not.toHaveBeenCalled();
  });
  it('borne le volume avant de déléguer à OBS', async () => {
    const { service, obs, commit } = setup();
    await service.execute({ type: 'obs.volume', input: 'Micro', volume: 9 });
    expect(obs.volume).toHaveBeenCalledWith('Micro', 1.5);
    expect(obs.refresh).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledOnce();
  });

  it('rejette une commande inconnue reçue par HTTP', async () => {
    const { service, commit } = setup();
    await expect(service.execute({ type: 'inconnue' } as never)).rejects.toThrow(/inconnue/);
    expect(commit).not.toHaveBeenCalled();
  });

  it('ne passe en direct qu’après confirmation OBS et impose un override explicite', async () => {
    const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [{ id: 'obs', label: 'OBS', done: false }] };
    const obs: ObsCommands = { state: { connected: true, streaming: false }, scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(), waitForStreaming: vi.fn(async expected => { obs.state.streaming = expected; }) };
    const commit = vi.fn(async () => ({ ok: true }) as never); const service = new DashboardCommandService(domain, obs, commit);
    await expect(service.execute({ type: 'session.start' })).rejects.toMatchObject({ name: 'CHECKLIST_INCOMPLETE' });
    expect(obs.stream).not.toHaveBeenCalled();
    await service.execute({ type: 'session.start', force: true });
    expect(obs.stream).toHaveBeenCalledWith(true); expect(obs.waitForStreaming).toHaveBeenCalledWith(true); expect(domain.mode).toBe('live'); expect(domain.timer.running).toBe(true);
  });
});
