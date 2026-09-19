import { describe, expect, it, vi } from 'vitest';
import { ObsSoundboardPlayback, ObsSoundboardSetup, OBS_SOUNDBOARD_INPUT, type ObsSoundboardClient, type ObsSoundboardSetupClient } from '../apps/server/src/obs-soundboard.js';

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
function setupObs() {
  let kind: string | null = null; const attached = new Set<string>(); const scenes = ['Intro','Gameplay','Chatting','Pause','Fin'];
  const obs: ObsSoundboardSetupClient = {
    state: { connected: true, scenes },
    setInputSettings: vi.fn(async()=>undefined), volume: vi.fn(async()=>undefined), restartMedia: vi.fn(async()=>undefined), stopMedia: vi.fn(async()=>undefined),
    setMonitorType: vi.fn(async()=>undefined), onMediaEnded: vi.fn(()=>()=>undefined),
    inputKind: vi.fn(async()=>kind), sceneExists: vi.fn(scene=>scenes.includes(scene)),
    sceneHasSource: vi.fn(async scene=>attached.has(scene)),
    createMediaInput: vi.fn(async scene=>{kind='ffmpeg_source';attached.add(scene)}),
    addInputToScene: vi.fn(async scene=>{attached.add(scene)}),
  };
  return { obs, setKind: (value:string|null)=>{kind=value} };
}
describe('ObsSoundboardPlayback', () => {
  it('configure le fichier, le volume, le monitoring et confirme le démarrage OBS', async () => {
    const { obs, end } = mockObs(); const backend = new ObsSoundboardPlayback(obs);
    const session = await backend.play({ file: '/library/bonk.mp3', volume: .42, outputId: 'obs', monitoringMode: 'monitor' });
    expect(obs.setInputSettings).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT, expect.objectContaining({ local_file: '/library/bonk.mp3' }));
    expect(obs.volume).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT, .42);
    expect(obs.setMonitorType).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT, 'OBS_MONITORING_TYPE_MONITOR_AND_OUTPUT');
    expect(obs.restartMedia).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT); end(); await expect(session.finished).resolves.toBeUndefined();
  });
  it('arrête via OBS et ne bascule jamais sur Windows', async () => {
    const { obs } = mockObs(); const backend = new ObsSoundboardPlayback(obs); await backend.stop();
    expect(obs.stopMedia).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT);
    await expect(new ObsSoundboardPlayback(mockObs(false).obs).play({ file: '/x.wav', volume: 1, outputId: 'obs' })).rejects.toMatchObject({ name: 'OBS_UNAVAILABLE' });
  });
  it('ajuste le volume de la Media Source Soundboard en direct', async () => {
    const { obs } = mockObs(); const backend = new ObsSoundboardPlayback(obs);
    await backend.setVolume(.25);
    expect(obs.volume).toHaveBeenCalledWith(OBS_SOUNDBOARD_INPUT, .25);
  });
});
describe('ObsSoundboardSetup', () => {
  it('crée une seule Media Source puis la rattache idempotemment aux cinq scènes', async () => {
    const { obs }=setupObs(); const setup=new ObsSoundboardSetup(obs); const targets=['Intro','Gameplay','Chatting','Pause','Fin'];
    expect(await setup.ensure(targets)).toMatchObject({ready:true,inputExists:true,attachedScenes:targets,missingScenes:[]});
    expect(obs.createMediaInput).toHaveBeenCalledTimes(1); expect(obs.addInputToScene).toHaveBeenCalledTimes(4);
    expect((await setup.ensure(targets)).ready).toBe(true);
    expect(obs.createMediaInput).toHaveBeenCalledTimes(1); expect(obs.addInputToScene).toHaveBeenCalledTimes(4);
  });
  it('signale les scènes manquantes sans les inventer', async () => {
    const { obs }=setupObs(); const result=await new ObsSoundboardSetup(obs).ensure(['Intro','Gameplay','Scène absente']);
    expect(result.ready).toBe(false); expect(result.missingScenes).toEqual(['Scène absente']);
  });
  it('refuse de remplacer une source homonyme de mauvais type', async () => {
    const { obs,setKind }=setupObs(); setKind('browser_source');
    await expect(new ObsSoundboardSetup(obs).ensure(['Gameplay'])).rejects.toMatchObject({name:'OBS_SOUNDBOARD_INPUT_KIND_MISMATCH'});
  });
});
