import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { diagnosePrelive, diagnosticLabels } from '../../apps/mobile/prelive-diagnostic.js';
import { fixture } from '../../apps/web/preview/fixtures.js';

const read = file => readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
const moduleUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
// Execute the real server allowlist, including its actual contracts dependency, using Node's TS stripping.
const contracts = moduleUrl(stripTypeScriptTypes(read('packages/contracts/src/index.ts')));
const remoteSource = stripTypeScriptTypes(read('apps/server/src/remote-policy.ts')).replace('../../../packages/contracts/src/index.js', contracts);
const { toRemoteDashboardState } = await import(moduleUrl(remoteSource));
function dashboard() {
  return { at: new Date().toISOString(), mode: 'idle', timer: {}, planning: [], checklist: [], nextLive: null,
    obs: { connected: true, scenes: ['Intro'], inputs: { Mic: { muted: false, volume: 1 } }, activeAudioInputs: ['Mic'], mediaInputs: [], browserInputs: ['Timer'] },
    settings: { startMode: 'intro', modeScenes: { intro: 'Intro' }, primaryMicInput: 'Mic', requireTimerOverlayOnStart: true, timerBrowserSource: 'Timer', obsPassword: 'SECRET', obsUrl: 'PRIVATE' },
    twitch: { connected: true, capabilities: { updateChannel: true } } };
}
const status = (result, id) => result.checks.find(c => c.id === id).status;
test('real mobile projection supports nominal, missing scene and required timer without exposing credentials', () => {
  const state = dashboard();
  const run = () => diagnosePrelive({ state: toRemoteDashboardState(state), capabilities: { updateChannel: true } });
  assert.equal(run().status, 'ok');
  assert.equal(JSON.stringify(toRemoteDashboardState(state)).includes('SECRET'), false);
  assert.equal(JSON.stringify(toRemoteDashboardState(state)).includes('PRIVATE'), false);
  state.obs.scenes = []; assert.equal(status(run(), 'scene'), 'blocker');
  state.obs.scenes = ['Intro']; state.obs.browserInputs = []; assert.equal(status(run(), 'timer'), 'blocker');
  state.obs.browserInputs = ['Timer']; delete state.settings.startMode;
  assert.equal(status(run(), 'scene'), 'ok', 'server default start mode is intro');
});

function element() {
  return { children: [], dataset: {}, style: { setProperty() {} }, classList: { toggle() {}, add() {}, remove() {} },
    textContent: '', innerHTML: '', listeners: {}, addEventListener(name, fn) { this.listeners[name] = fn; },
    append(child) { this.children.push(child); }, replaceChildren(...children) { this.children = children; },
    setAttribute() {}, querySelector() { return element(); }, querySelectorAll() { return []; }, closest() { return null; } };
}
test('mobile feature keeps fresh OBS blocker when Twitch capabilities request fails', async () => {
  const root = element(), button = element();
  let current = {}; const received = dashboard(); received.obs.connected = false;
  const context = {
    getMode: () => 'ONLINE_PC', ensureCredential: async () => {},
    transport: { state: async () => toRemoteDashboardState(received), twitchModerationCapabilities: async () => { throw Error('Twitch unavailable'); } },
    applyState: value => { current = value; }, getState: () => current, companion: { snapshot: () => ({}) }
  };
  const scope = vm.createContext({ getMobileContext: () => context, diagnosePrelive, diagnosticLabels,
    document: { getElementById: id => id === 'run-prelive' ? button : root, querySelectorAll: () => [], createElement: element } });
  // Run the shipped feature and its automatic first diagnostic, not a copied orchestration function.
  vm.runInContext(read('apps/mobile/features/prelive.js').replace(/^import .*;\n/gm, '').replace(/void run\(\);\s*$/, 'globalThis.finished = run();'), scope);
  await scope.finished;
  assert.match(root.children[0].textContent, /^Bloquant/);
  assert.ok(root.children.some(row => /OBS déconnecté/.test(row.textContent)));
  assert.ok(root.children.some(row => /Autorisations Twitch non vérifiées/.test(row.textContent)));
  assert.equal(button.disabled, false);
  context.transport.state = async () => { throw Error('PC unavailable'); };
  await button.listeners.click(); await new Promise(resolve => setImmediate(resolve));
  assert.match(root.children[0].textContent, /^Avertissement/);
});

function desktop() {
  const nodes = new Map(), sockets = [];
  let openButtons = [];
  const get = id => { if (!nodes.has(id)) nodes.set(id, element()); return nodes.get(id); };
  const scope = vm.createContext({ fixture, diagnosePrelive, diagnosticLabels, structuredClone, URLSearchParams, Date,
    expandRecurringItems: items => items, buildPlanningPng: () => {},
    location: { search: '', protocol: 'http:', host: 'localhost' }, localStorage: { getItem: () => null, setItem() {} },
    document: { querySelector: get, querySelectorAll: selector => {
      if(selector !== '[data-open-camp]') return [];
      openButtons = [...get('#view').innerHTML.matchAll(/<button[^>]*data-open-camp="([^"]+)"[^>]*>([^<]*)<\/button>/g)].map(match => {
        const button = element(); button.dataset.openCamp = match[1]; button.textContent = match[2]; return button;
      });
      return openButtons;
    }, documentElement: element(), activeElement: null },
    window: { addEventListener() {} }, setInterval() {}, setTimeout() {}, clearTimeout() {},
    fetch: async () => { throw Error('Runtime unavailable'); },
    WebSocket: class { constructor() { this.readyState = 1; sockets.push(this); } close() { this.readyState = 3; this.onclose?.(); } }
  });
  vm.runInContext(read('apps/web/preview/preview.js').replace(/^import .*;\n/gm, '') + '\nglobalThis.api={state,applyDashboard,refreshRuntime,preliveContent,render,connectRuntimeSocket};', scope);
  return { ...scope.api, nodes, sockets, scope, get openButtons() { return openButtons; } };
}
test('desktop invalidates cached positive results on refresh failure, socket close and restores them on new telemetry', async () => {
  const app = desktop(); app.state.runtime = true; app.applyDashboard(dashboard());
  assert.match(app.preliveContent(), /Diagnostic pré-live · OK/);
  assert.equal(await app.refreshRuntime(), false);
  assert.equal(app.state.runtimeAvailable, false);
  assert.match(app.preliveContent(), /OBS non vérifiable hors connexion/);
  app.applyDashboard(dashboard()); assert.match(app.preliveContent(), /Diagnostic pré-live · OK/);
  app.connectRuntimeSocket(); app.sockets[0].close();
  assert.match(app.preliveContent(), /OBS non vérifiable hors connexion/);
  app.applyDashboard(dashboard()); assert.match(app.preliveContent(), /Diagnostic pré-live · OK/);
});
test('desktop preparation renders diagnostic with checklist disabled, without redirect or checklist controls', () => {
  const app = desktop(); app.state.runtime = true; app.applyDashboard(dashboard());
  app.state.productProfile.modules.checklist = false;
  for (const entry of ['home', 'live']) {
    app.state.view = entry; app.render();
    const button = app.openButtons.find(button => button.textContent === 'Diagnostic pré-live');
    assert.ok(button, `${entry} diagnostic entry point`);
    button.listeners.click();
    assert.equal(app.state.view, 'camp');
    assert.equal(app.state.campItem, 'Préparation');
    assert.match(app.nodes.get('#view').innerHTML, /Diagnostic pré-live/);
    assert.doesNotMatch(app.nodes.get('#view').innerHTML, /camp-check-add|check-reset/);
  }
});

// CalendarItem fixtures use the dashboard contract, not the Standalone cache schema.
for (const provider of ['twitch', 'google']) {
  for (const publicationStatus of ['error', 'pending', 'conflict', 'synced', 'not-published']) {
    test(`CalendarItem ${provider} ${publicationStatus}: PC and real mobile projection`, () => {
      const state = dashboard();
      state.planning = [{ id: 'live-1', title: 'Live', startAtUtc: '2026-09-28T18:00:00Z', endAtUtc: '2026-09-28T20:00:00Z',
        providers: { [provider]: { status: publicationStatus } } }];
      const expected = ['synced', 'not-published'].includes(publicationStatus) ? 'ok' : 'warning';
      for (const snapshot of [state, toRemoteDashboardState(state)]) {
        const result = diagnosePrelive({ state: snapshot, capabilities: { updateChannel: true } });
        const check = result.checks.find(check => check.id === 'planning-sync');
        assert.equal(check.status, expected);
        assert.equal(result.status, expected);
        assert.equal(check.action, 'planning');
      }
    });
  }
}
for (const patch of [{ syncError: 'Publication refusée' }, { conflict: { provider: 'google', detectedAt: '2026-09-28T12:00:00Z' } }]) {
  test(`CalendarItem explicit ${Object.keys(patch)[0]} warns even with synced provider`, () => {
    const state = dashboard();
    state.planning = [{ id: 'live-1', title: 'Live', startAtUtc: '2026-09-28T18:00:00Z', endAtUtc: '2026-09-28T20:00:00Z',
      providers: { google: { status: 'synced' } }, ...patch }];
    for (const snapshot of [state, toRemoteDashboardState(state)]) {
      const result = diagnosePrelive({ state: snapshot, capabilities: { updateChannel: true } });
      assert.equal(result.status, 'warning');
      const check = result.checks.find(check => check.id === 'planning-sync');
      assert.equal(check.status, 'warning');
      assert.equal(check.action, 'planning');
      assert.match(check.message, patch.conflict ? /Conflits/ : /échoué/);
    }
  });
}
test('Standalone providerLinks still reports error, pending, syncing and conflict', () => {
  for (const status of ['error', 'pending', 'syncing', 'conflict']) {
    const result = diagnosePrelive({ mode: 'ONLINE_STANDALONE', cache: { planning: [{ providerLinks: { google: { status } } }] } });
    const check = result.checks.find(check => check.id === 'planning-sync');
    assert.equal(result.status, 'warning');
    assert.equal(check.status, 'warning');
    assert.equal(check.action, 'planning');
  }
});
