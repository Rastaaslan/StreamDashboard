import { describe, expect, it, vi } from 'vitest';
import { ObsSoundboardPlayback, OBS_SOUNDBOARD_INPUT, type ObsSoundboardClient } from '../apps/server/src/obs-soundboard.js';

function mockObs(connected = true) {
  let ended: ((name: string) => void) | undefined;
  const obs: ObsSoundboardClient = {
    state: { connected },
    setInputSettings: vi.fn(async () => undefined), volume: vi.fn(async () => undefined),
    restartMedia: vi.fn(async () => undefined), stopMedia: vi.fn(async () => undefined),
    setMonitorType: vi.fn(async () => undefined), onMediaEnded: vi.fn(listener => { ended = listener; return () => { ended = undefined; }; }),
  };
  return { obs, end: () => ended?.(OBS_SOUNDBOARD_INPUT) };
}

describe('ObsSoundboardPlayback', () => {
  it('configure le fichier, le volume, le monitoring et confirme le démarrage OBS', async () => {
    const { obs, end } = mockObs(); const backend = new ObsSoundboardPlayback(obs);
    const session = await backend.play({ file: '/library/bonk.mp3', volume: .42, outputId: 'obs', monitoringMode: 'monitor' });
    expect(obs.setInputSettings).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT, expect.objectContaining({ local_file: '/library/bonk.mp3' }));
    expect(obs.volume).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT, .42);
    expect(obs.setMonitorType).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT, 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT');
    expect(obs.restartMedia).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT);
    end(); await expect(session.finished).resolves.toBeUndefined();
  });
  it('arrête via OBS et ne bascule jamais sur Windows', async () => {
    const { obs } = mockObs(); const backend = new ObsSoundboardPlayback(obs); await backend.stop();
    expect(obs.stopMedia).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT);
    const offline = new ObsSoundboardPlayback(mockObs(false).obs);
    await expect(offline.play({ file: '/x.wav', volume: 1, outputId: 'obs' })).rejects.toMatchObject({ name: 'OBS_UNAVAILABLE' });
  });
});
