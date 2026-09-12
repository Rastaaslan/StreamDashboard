import { describe, expect, it, vi } from 'vitest';
import { DashboardCommandService, END_SCENE_VISIBILITY_MS, type ObsCommands } from '../apps/server/src/command-service.js';

function setup() {
  const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [] };
  const obs: ObsCommands = {
    state: { connected: true, streaming: false },
    scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
  };
  const commit = vi.fn(async () => ({ ok: true }) as never);
  return { domain, service: new DashboardCommandService(domain, obs, commit), obs, commit };
}

describe('service de commandes', () => {
  it('confirme une scène via waitForScene en un seul mode.set', async () => {
    const { domain, obs, commit } = setup();
    obs.waitForScene = vi.fn(async scene => { obs.state.scene = scene; });
    const service = new DashboardCommandService(domain, obs, commit, { settings: { modeScenes: { intro: 'Intro' } } });
    await service.execute({ type: 'mode.set', mode: 'intro' });
    expect(obs.waitForScene).toHaveBeenCalledWith('Intro'); expect(domain.mode).toBe('intro'); expect(commit).toHaveBeenCalledOnce();
  });

  it('accepte le refresh de secours quand l’événement de scène est perdu', async () => {
    const { domain, obs, commit } = setup();
    obs.waitForScene = vi.fn(async () => { throw new Error('event missed'); });
    vi.mocked(obs.refresh).mockImplementation(async () => { obs.state.scene = 'Pause'; });
    const service = new DashboardCommandService(domain, obs, commit, { settings: { modeScenes: { pause: 'Pause' } } });
    await service.execute({ type: 'mode.set', mode: 'pause' });
    expect(domain.mode).toBe('pause'); expect(obs.refresh).toHaveBeenCalled();
  });

  it('conserve l’erreur si le refresh de secours révèle une autre scène', async () => {
    const { domain, obs, commit } = setup();
    obs.waitForScene = vi.fn(async () => { throw new Error('OBS n’a pas confirmé la scène'); });
    vi.mocked(obs.refresh).mockImplementation(async () => { obs.state.scene = 'Autre'; });
    const service = new DashboardCommandService(domain, obs, commit, { settings: { modeScenes: { pause: 'Pause' } } });
    await expect(service.execute({ type: 'mode.set', mode: 'pause' })).rejects.toThrow(/confirmé/);
    expect(domain.mode).toBe('idle'); expect(commit).not.toHaveBeenCalled();
  });
  it('réinitialise le timer lors de la préparation d’un nouveau live hors diffusion', async () => {
    const { domain, service, obs, commit } = setup();
    domain.timer.running = false; domain.timer.remaining = 17; domain.timer.duration = 300; domain.timer.deadline = null;
    await service.execute({ type: 'session.prepare' });
    expect(obs.refresh).toHaveBeenCalledOnce();
    expect(domain.timer).toMatchObject({ running: false, duration: 300, remaining: 300, deadline: null });
    expect(commit).toHaveBeenCalledOnce();
  });

  it('ne réinitialise pas le timer si Préparer est ouvert pendant un live actif', async () => {
    const domain = { mode: 'live' as const, timer: { running: true, duration: 300, remaining: 200, deadline: Date.now() + 200_000 }, checklist: [] };
    const obs: ObsCommands = { state: { connected: true, streaming: true }, scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn() };
    const before = { ...domain.timer };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never));
    await service.execute({ type: 'session.prepare' });
    expect(domain.timer).toEqual(before);
  });

  it('sélectionne la scène live avant StartStream et recrée le timer', async () => {
    const domain = { mode: 'end' as const, timer: { running: false, duration: 300, remaining: 17, deadline: null }, checklist: [] };
    const order: string[] = [];
    const obs: ObsCommands = { state: { connected: true, streaming: false }, scene: vi.fn(async () => { order.push('scene'); }), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(async () => { order.push('stream'); }), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(), waitForStreaming: vi.fn(async expected => { order.push('confirmed'); obs.state.streaming = expected; }) };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never), { settings: { modeScenes: { live: 'Live' } } });
    await service.execute({ type: 'session.start' });
    expect(order).toEqual(['scene', 'stream', 'confirmed']);
    expect(domain.timer).toMatchObject({ running: true, remaining: 300 });
  });

  it('ne démarre pas le stream si le changement de scène échoue', async () => {
    const { domain, obs, commit } = setup();
    const configured = new DashboardCommandService(domain, obs, commit, { settings: { modeScenes: { live: 'Missing' } } });
    vi.mocked(obs.scene).mockRejectedValueOnce(new Error('scene missing'));
    await expect(configured.execute({ type: 'session.start' })).rejects.toThrow(/scene missing/);
    expect(obs.stream).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
  });

  it('ne publie aucun faux état live si StartStream échoue', async () => {
    const { service, obs, commit } = setup(); vi.mocked(obs.stream).mockRejectedValueOnce(new Error('start failed'));
    await expect(service.execute({ type: 'session.start' })).rejects.toThrow(/start failed/);
    expect(commit).not.toHaveBeenCalled();
  });

  it('affiche la scène de fin avant StopStream puis ne change le domaine qu’après confirmation', async () => {
    const domain = { mode: 'live' as const, timer: { running: true, duration: 300, remaining: 200, deadline: Date.now() + 200_000 }, checklist: [] };
    const order: string[] = [];
    const obs: ObsCommands = {
      state: { connected: true, streaming: true },
      scene: vi.fn(async () => { order.push('scene'); }), mute: vi.fn(), volume: vi.fn(),
      stream: vi.fn(async () => { order.push('stream'); }), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
      waitForStreaming: vi.fn(async expected => { order.push('confirmed'); obs.state.streaming = expected; }),
    };
    const wait = vi.fn(async milliseconds => { expect(milliseconds).toBe(END_SCENE_VISIBILITY_MS); order.push('wait'); });
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never), { settings: { modeScenes: { end: 'Outro' } }, wait });
    await service.execute({ type: 'session.stop' });
    expect(order).toEqual(['scene', 'wait', 'stream', 'confirmed']);
    expect(obs.scene).toHaveBeenCalledWith('Outro'); expect(obs.stream).toHaveBeenCalledWith(false);
    expect(domain.mode).toBe('end'); expect(domain.timer.running).toBe(false);
  });

  it('arrête quand même le live si la scène End est absente', async () => {
    const domain = { mode: 'live' as const, timer: { running: true, duration: 300, remaining: 200, deadline: Date.now() + 200_000 }, checklist: [] };
    const warnings: unknown[][] = [];
    const obs: ObsCommands = {
      state: { connected: true, streaming: true },
      scene: vi.fn(async () => { throw new Error('end scene missing'); }), mute: vi.fn(), volume: vi.fn(),
      stream: vi.fn(async () => undefined), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
      waitForStreaming: vi.fn(async expected => { obs.state.streaming = expected; }),
    };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never), { settings: { modeScenes: { end: 'Missing' } }, logger: { info() {}, warn(...args) { warnings.push(args); } } });
    await service.execute({ type: 'session.stop' });
    expect(obs.stream).toHaveBeenCalledWith(false);
    expect(domain.mode).toBe('end'); expect(domain.timer.running).toBe(false);
    expect(warnings).toHaveLength(1);
  });

  it('retombe sur un refresh si l’événement de confirmation OBS est perdu', async () => {
    const domain = { mode: 'live' as const, timer: { running: true, duration: 300, remaining: 200, deadline: Date.now() + 200_000 }, checklist: [] };
    const obs: ObsCommands = {
      state: { connected: true, streaming: true }, scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(),
      waitForStreaming: vi.fn(async () => { throw new Error('event missed'); }),
      refresh: vi.fn(async () => { obs.state.streaming = false; }),
    };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never));
    await service.execute({ type: 'session.stop' });
    expect(obs.refresh).toHaveBeenCalledOnce();
    expect(domain.mode).toBe('end'); expect(domain.timer.running).toBe(false);
  });

  it('ne prétend pas être arrêté si StopStream échoue', async () => {
    const domain = { mode: 'live' as const, timer: { running: true, duration: 300, remaining: 200, deadline: Date.now() + 200_000 }, checklist: [] };
    const obs: ObsCommands = { state: { connected: true, streaming: true }, scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(async () => { throw new Error('stop failed'); }), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn() };
    const commit = vi.fn(async () => ({}) as never);
    const service = new DashboardCommandService(domain, obs, commit, { settings: { modeScenes: {} } });
    await expect(service.execute({ type: 'session.stop' })).rejects.toThrow(/stop failed/);
    expect(domain.mode).toBe('live'); expect(domain.timer.running).toBe(true); expect(commit).not.toHaveBeenCalled();
  });

  it('sérialise les effets OBS de commandes concurrentes', async () => {
    const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [] };
    let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
    const order: string[] = [];
    const obs: ObsCommands = {
      state: { connected: true, streaming: false },
      scene: vi.fn(async name => { order.push(`scene:${name}`); if (name === 'Live') await gate; }), mute: vi.fn(), volume: vi.fn(),
      stream: vi.fn(async () => { order.push('stream'); }), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(async () => { order.push('refresh'); }),
      waitForStreaming: vi.fn(async expected => { obs.state.streaming = expected; order.push('confirmed'); }),
    };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never), { settings: { modeScenes: { live: 'Live', pause: 'Pause' } } });
    const start = service.execute({ type: 'session.start' });
    await vi.waitFor(() => expect(obs.scene).toHaveBeenCalledWith('Live'));
    const pause = service.execute({ type: 'mode.set', mode: 'pause' });
    expect(obs.scene).not.toHaveBeenCalledWith('Pause');
    release(); await Promise.all([start, pause]);
    expect(order).toEqual(['scene:Live', 'stream', 'confirmed', 'scene:Pause', 'refresh']);
    expect(domain.mode).toBe('pause');
  });

  it('borne le volume avant de déléguer à OBS', async () => {
    const { service, obs, commit } = setup();
    await service.execute({ type: 'obs.volume', input: 'Micro', volume: 1.5 });
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

  it('ne permet pas à obs.stream de contourner le workflow session', async () => {
    const domain = { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [{ id: 'obs', label: 'OBS', done: false }] };
    const obs: ObsCommands = { state: { connected: true, streaming: false }, scene: vi.fn(), mute: vi.fn(), volume: vi.fn(), stream: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn() };
    const service = new DashboardCommandService(domain, obs, vi.fn(async () => ({}) as never));
    await expect(service.execute({ type: 'obs.stream', start: true })).rejects.toMatchObject({ name: 'CHECKLIST_INCOMPLETE' });
    expect(obs.stream).not.toHaveBeenCalled();
  });
});
