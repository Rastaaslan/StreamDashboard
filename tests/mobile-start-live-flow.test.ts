import { describe, expect, it, vi } from 'vitest';
import { parseRemoteCommand } from '../apps/server/src/remote-policy.js';
import { DashboardCommandService } from '../apps/server/src/command-service.js';

describe('démarrage live depuis Android appairé', () => {
  it('autorise un bypass explicite de checklist puis démarre OBS une seule fois', async () => {
    const remoteState: any = {
      settings: { chattingScene: null },
      obs: { activeAudioInputs: [], mediaInputs: [] },
    };
    const command = parseRemoteCommand({ type: 'session.start', force: true }, remoteState);
    expect(command).toEqual({ type: 'session.start', force: true });

    const domain: any = {
      mode: 'idle',
      timer: { running: false, remaining: 300, deadline: null },
      checklist: [{ id: 'title', label: 'Titre vérifié', done: false }],
    };
    const stream = vi.fn(async (start: boolean) => { obs.state.streaming = start; });
    const obs: any = {
      state: { connected: true, streaming: false, scene: 'Intro' },
      scene: vi.fn(async (name: string) => { obs.state.scene = name; }),
      mute: vi.fn(), volume: vi.fn(), record: vi.fn(), restartMedia: vi.fn(), refresh: vi.fn(),
      stream,
      waitForScene: vi.fn(async () => undefined),
      waitForStreaming: vi.fn(async () => undefined),
    };
    const commit = vi.fn(async () => ({ obs: { streaming: obs.state.streaming } } as any));
    const service = new DashboardCommandService(domain, obs, commit, {
      settings: { modeScenes: { intro: 'Intro' }, startMode: 'intro', timerBrowserSource: '' },
    });

    const result: any = await service.execute(command);
    expect(stream).toHaveBeenCalledTimes(1);
    expect(stream).toHaveBeenCalledWith(true);
    expect(obs.state.streaming).toBe(true);
    expect(domain.mode).toBe('intro');
    expect(domain.timer.running).toBe(true);
    expect(result.obs.streaming).toBe(true);
  });

  it('conserve le blocage de checklist tant que le téléphone n’a pas confirmé le bypass', async () => {
    const remoteState: any = { settings: { chattingScene: null }, obs: { activeAudioInputs: [], mediaInputs: [] } };
    expect(parseRemoteCommand({ type: 'session.start', force: false }, remoteState)).toEqual({ type: 'session.start', force: false });
  });
});
