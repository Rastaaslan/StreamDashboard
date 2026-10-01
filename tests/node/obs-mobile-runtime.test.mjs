import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { acceptsSnapshot, confirmsObsStreaming, createCommandController, obsRuntimeView } from '../../apps/mobile/command-controller.js';

const source = shell => readFileSync(new URL('../../apps/mobile/' + shell + '.js', import.meta.url), 'utf8');
const snapshot = (streaming = true, connected = true, streamingKnown = true, connectionStatus = 'connected', twitchLive = false) => ({
  obs: { connected, streaming, streamingKnown, connectionStatus, inputs: {}, scenes: [], activeAudioInputs: [], mediaInputs: [] },
  settings: {}, planning: [], twitch: {}, controlHub: { live: { isLive: twitchLive } }, timer: {},
});
const noop = () => {};
function harness(shell) {
  const nodes = new Map();
  const $ = id => {
    if (!nodes.has(id)) {
      const classes = new Set();
      const node = { textContent: '', dataset: {}, disabled: false, value: '',
        classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name), contains: name => classes.has(name) },
        contains: () => false, setAttribute: noop, replaceChildren: noop, append: noop, querySelector: () => null,
      };
      node.parentElement = node;
      nodes.set(id, node);
    }
    return nodes.get(id);
  };
  const context = {
    $, credential: null, window: { dispatchEvent: noop }, Event: class {}, state: null, acceptsSnapshot, confirmsObsStreaming, obsRuntimeView,
    document: { activeElement: null, querySelectorAll: () => [], querySelector: $ },
    CompanionMode: { ONLINE_PC: 'pc' }, companionMode: 'pc', lastProfileSyncAt: Date.now(),
    moderationCapabilities: null, twitchCapabilitiesFlight: null, twitchEditorDirty: false,
    formatDuration: String, formatClock: String, formatTimer: String, remaining: () => 0, timerRemaining: () => 0,
    formatPlanningDate: () => '', logicalScene: () => '', humanProviderStatus: String, createThumbnail: () => ({}),
  };
  for (const name of ['renderSyncCenter', 'syncMobileStreamerPing', 'renderAudio', 'renderDeck', 'renderPlanning',
    'updatePlanningProviderReadiness', 'showPairing', 'applyTwitchActionCapabilities',
    'renderManagedConnections', 'renderHubChat', 'renderAudience', 'renderChat', 'syncStreamerPings', 'selectSceneVisual']) context[name] = noop;
  let code;
  if (shell === 'preview') {
    code = source(shell).split('const applyState = next => {')[1].split('\nconst notifyStreamerPing')[0];
    code = 'const applyState = next => {' + code + '\nglobalThis.renderState = applyState;';
    context.setProvider = (id, status) => { $(id).textContent = status; };
  } else {
    code = source(shell).slice(source(shell).indexOf('function remoteButtons(disabled) {'), source(shell).indexOf('function offlineState()'));
    code += 'function renderControlHub(hub) {' + source(shell).split('function renderControlHub(hub) {')[1].split('\nconst formatClock')[0];
    code += '\nfunction render(next) {' + source(shell).split('function render(next) {')[1].split('\nfunction tickTimer')[0];
    code += '\nglobalThis.renderState = render;';
  }
  runInNewContext(code, context);
  return { context, $ };
}

for (const shell of ['mobile', 'preview']) {
  test(shell + ': renders live → OBS loss → connecting → confirmed recovery', () => {
    const { context, $ } = harness(shell);
    const live = shell === 'mobile' ? 'live' : '#home-live-copy';
    const connection = shell === 'mobile' ? 'obs' : '#scene-state';
    const button = shell === 'mobile' ? 'stream' : '#stop-live';
    context.renderState(snapshot());
    assert.match($(live).textContent, /En direct.*OBS/);
    assert.equal($(button).disabled, false);
    context.renderState(snapshot(true, false, false, 'error'));
    assert.match($(live).textContent, /inconnu/);
    assert.doesNotMatch($(live).textContent, /En direct/);
    assert.match($(connection).textContent, /Erreur/);
    assert.equal($(button).disabled, true);
    context.renderState(snapshot(true, false, false, 'connecting'));
    assert.match($(connection).textContent, /Connexion/);
    assert.equal($(button).disabled, true);
    context.renderState(snapshot(false));
    assert.match($(live).textContent, /Hors live/);
    assert.equal($(button).disabled, false);
    assert.match($(button).textContent, /démarrer/i);
  });

  test(shell + ': Twitch live is distinct from unknown OBS and cannot enable stream controls', () => {
    const { context, $ } = harness(shell);
    context.renderState(snapshot(true, false, false, 'error', true));
    const summary = shell === 'mobile' ? 'home-live-status' : '#home-live-copy';
    assert.match($(summary).textContent, /En direct · Twitch/);
    assert.match($(summary).textContent, /OBS.*inconnu/);
    assert.equal($(shell === 'mobile' ? 'stream' : '#stop-live').disabled, true);
    context.renderState(snapshot(false, true, true, 'connected', true));
    assert.match($(shell === 'mobile' ? 'stream' : '#stop-live').textContent, /démarrer/i);
  });

  for (const start of [true, false]) {
    test(shell + ': failed ' + (start ? 'start' : 'stop') + ' is not reconciled from retained offline telemetry', async () => {
      const { context, $ } = harness(shell);
      context.state = snapshot(!start);
      const messages = [], outcomes = [], commands = [];
      const lost = snapshot(start, false, false, 'error');
      const controller = createCommandController({
        send: async value => { commands.push(value.type); if (value.type === 'session.prepare') return {}; throw new Error('OBS lost'); },
        readState: async () => lost, applyState: current => { context.state = current; },
        onMessage: message => messages.push(message),
      });
      const execute = async (value, options) => {
        try { const result = await controller.execute(value, options); outcomes.push(result.accepted); return result.accepted; }
        catch (error) { outcomes.push(false); messages.push(error.message); return false; }
      };
      Object.assign(context, { commandController: controller, command: execute, execute, confirm: () => true, requireConnection: () => true, toast: message => messages.push(message) });
      const text = source(shell);
      const handler = shell === 'mobile'
        ? "$('stream').onclick = () => {" + text.split("$('stream').onclick = () => {")[1].split('\nconst liveToolTitles')[0]
        : "$('#stop-live').onclick=async()=>{" + text.split("$('#stop-live').onclick=async()=>{")[1].split("\n$('#sound-search')")[0];
      runInNewContext(handler, context);
      await $(shell === 'mobile' ? 'stream' : '#stop-live').onclick();
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(outcomes.at(-1), false);
      assert.equal(messages.includes('Commande confirmée après resynchronisation.'), false);
      assert.ok(messages.includes('OBS lost'));
      assert.equal(commands.filter(type => type === (start ? 'session.start' : 'session.stop')).length, 1);
      assert.equal(controller.isLocked('stream'), false);
    });
  }
}

for (const expected of [true, false]) {
  test('stream reconciliation requires explicit confirmed telemetry: ' + expected, async () => {
    for (const [connected, known] of [[false, false], [false, true], [true, false], [true, undefined]]) {
      const current = snapshot(expected, connected, known);
      current.obs.streamingKnown = known;
      assert.equal(confirmsObsStreaming(current, expected), false);
      const controller = createCommandController({
        send: async () => { throw new Error('timeout'); }, readState: async () => current, applyState: noop,
      });
      await assert.rejects(controller.execute({ type: expected ? 'session.start' : 'session.stop' }, { reconcile: () => true }), /timeout/);
    }
    const current = snapshot(expected);
    const controller = createCommandController({
      send: async () => { throw new Error('timeout'); }, readState: async () => current, applyState: noop,
    });
    const result = await controller.execute({ type: expected ? 'session.start' : 'session.stop' }, { reconcile: next => confirmsObsStreaming(next, expected) });
    assert.equal(result.reconciled, true);
    assert.equal(result.accepted, true);
  });
}
