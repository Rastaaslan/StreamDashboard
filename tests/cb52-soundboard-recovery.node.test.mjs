import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { ObsSoundboardPlayback, ObsSoundboardSetup } from '../dist/apps/server/src/obs-soundboard.js';

// Execute the shipped renderer handlers against the real compiled backend.
// OBS is in memory: no claim about physical audio output.
test('renderer/backend recovers from zero volume and still refuses inactive, muted or unrouted audio', async () => {
  let volume = 1, active = true, muted = false, routed = true, restarts = 0;
  const obs = {
    state: { connected: true },
    inputKind: async () => 'ffmpeg_source', sceneExists: () => true,
    sceneHasSource: async () => true, sceneSourceEnabled: async () => active,
    inputAudioReadiness: async () => ({ active, audible: volume > 0 && !muted && routed }),
    setInputSettings: async () => {}, volume: async (_name, value) => { volume = value; },
    setMonitorType: async () => {}, stopMedia: async () => {},
    restartMedia: async () => { restarts++; }, onMediaEnded: () => () => {},
    verifySoundboardPlayback: async () => {
      const readiness = await obs.inputAudioReadiness();
      if (!readiness.active || !readiness.audible) throw new Error('Audio inactive, muted, unrouted or zero volume');
    },
  };
  const playback = new ObsSoundboardPlayback(obs), setup = new ObsSoundboardSetup(obs);
  const notices = [], requests = [];
  const state = { runtime: true, soundMasterVolume: 0, sounds: [{ id: 'sound', volume: 1 }], dashboard: { obs: { scene: 'Live' } } };
  const context = vm.createContext({ state, record() {}, uid: () => 'command', toast: message => notices.push(message), refreshRuntime: async () => {},
    request: async (url, options) => {
      if (url.endsWith('/status')) return setup.status(['Live']);
      assert.equal(url, '/api/v1/soundboard/play');
      const input = JSON.parse(options.body); requests.push(input);
      try { await playback.play({ file: 'test.wav', volume: input.volume, outputId: 'obs' }); return { status: 'succeeded' }; }
      catch (error) { return { status: 'failed', message: error.message }; }
    },
  });
  const renderer = await readFile('apps/web/preview/preview.js', 'utf8');
  vm.runInContext(renderer.slice(renderer.indexOf('async function ensureObsSoundboardForPlayback'), renderer.indexOf('async function toggleLive')), context);
  await context.playSound('sound');
  assert.equal(volume, 0); assert.equal(restarts, 0);
  assert.equal((await setup.status(['Live'])).ready, false);
  // The general slider changes the next play volume; there is no active session.
  state.soundMasterVolume = 0.6;
  await context.playSound('sound');
  assert.equal(volume, 0.6); assert.equal(restarts, 1);
  assert.equal(notices.at(-1), 'Son envoyé à OBS');
  assert.equal((await setup.status(['Live'])).ready, true);
  for (const restriction of ['inactive', 'muted', 'unrouted']) {
    active = restriction !== 'inactive'; muted = restriction === 'muted'; routed = restriction !== 'unrouted';
    await context.playSound('sound');
    assert.equal(restarts, 1, restriction);
    assert.match(notices.at(-1), /Audio inactive/);
  }
  assert.equal(requests.length, 5);
  await playback.stop();
});
