import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createCompanionStore, CompanionMode } from '../apps/mobile/companion-store.js';
import { createStandaloneProviderSync, createNativeProviderAdapter } from '../apps/mobile/provider-sync.js';
import { createProviderRetry, eventProviderState } from '../apps/mobile/sync-center.js';
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const desktop = read('apps/web/preview/preview.js');

test('Twitch guards follow granted scopes, connection and Twitch live state', () => {
  const state = { dashboard: { twitch: { connected: true, capabilities: { chatWrite: false, createClip: true, updateChannel: true } }, controlHub: { live: { isLive: false } } } };
  const context = vm.createContext({ state });
  vm.runInContext(desktop.slice(desktop.indexOf('const twitchCan='), desktop.indexOf('function liveQuickActions()')), context);
  const value = expression => vm.runInContext(expression, context);
  assert.equal(value("twitchCan('chatWrite')"), false);
  assert.equal(value("twitchCan('updateChannel')"), true);
  assert.equal(value('canCreateClip()'), false);
  state.dashboard.controlHub.live.isLive = true;
  assert.equal(value('canCreateClip()'), true);
  state.dashboard.twitch.capabilities.createClip = false;
  assert.equal(value('canCreateClip()'), false);
  state.dashboard.twitch.connected = false;
  assert.equal(value("twitchCan('updateChannel')"), false);
  assert.equal(value("audienceRole('moderator')"), 'Modérateur');
});

test('Desktop bridge calls and connection/Application actions have implementations', () => {
  const preload = read('apps/desktop/src/preload.cts');
  for (const [, method] of desktop.matchAll(/streamDashboardDesktop(?:\?\.|\.)(\w+)/g)) {
    assert.match(preload, new RegExp(`\\b${method}:`), method);
  }
  const markup = desktop.split('function bindConnections')[0];
  for (const [, action] of markup.matchAll(/data-connection-action="([a-z-]+)"/g)) {
    assert.ok(desktop.includes(`action==='${action}'`), action);
  }
  for (const [, action] of markup.matchAll(/data-camp-action="([a-z-]+)"/g)) {
    assert.ok(desktop.includes(`querySelector('[data-camp-action="${action}"]')`), action);
  }
});

test('Planning persists edits and standalone Twitch sync keeps remote link; PC/offline do not publish directly', async () => {
  const values = new Map();
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const store = createCompanionStore(storage);
  const event = store.createEvent({ id: 'local', title: 'Live', startAtUtc: '2030-01-01T18:00:00Z', endAtUtc: '2030-01-01T20:00:00Z', desiredPublication: { twitch: true } }).item;
  let calls = 0;
  const sync = createStandaloneProviderSync({ store, adapter: { mutate: async (provider, action) => { calls++; assert.equal(provider, 'twitch'); assert.equal(action, 'create'); return { remoteId: 'segment', fingerprint: 'revision' }; } } });
  await sync.apply(CompanionMode.OFFLINE, event, 'create');
  await sync.apply(CompanionMode.ONLINE_PC, event, 'create');
  assert.equal(calls, 0);
  await sync.apply(CompanionMode.ONLINE_STANDALONE, event, 'create');
  assert.equal(calls, 1);
  const saved = createCompanionStore(storage).snapshot().planning[0];
  assert.equal(saved.providerLinks.twitch.status, 'synced');
  assert.equal(saved.providerLinks.twitch.remoteId, 'segment');
  const updated = store.updateEvent(saved.id, { title: 'Nouveau titre' }, saved.revision).item;
  assert.equal(createCompanionStore(storage).snapshot().planning[0].title, 'Nouveau titre');
  store.deleteEvent(updated.id, updated.revision);
  assert.equal(createCompanionStore(storage).snapshot().planning.length, 0);
});

test('Mobile appearance survives reload without a PC', () => {
  const mobile = read('apps/mobile/mobile.js');
  const start = mobile.indexOf('const preferenceKey');
  const end = mobile.indexOf('function setFocusPreference', start);
  assert.ok(start >= 0 && end > start);
  const values = new Map();
  const elements = new Map();
  const element = id => { if (!elements.has(id)) elements.set(id, {}); return elements.get(id); };
  const document = { body: { classList: { toggle() {} }, dataset: {} }, documentElement: { style: { setProperty() {} } } };
  const context = () => vm.createContext({ document, $: element, localStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  const first = context();
  vm.runInContext(mobile.slice(start, end), first);
  vm.runInContext("uxPreferences.theme='oled'; uxPreferences.accent='#123456'; applyUxPreferences()", first);
  const second = context();
  vm.runInContext(mobile.slice(start, end), second);
  assert.equal(vm.runInContext('uxPreferences.theme', second), 'oled');
  assert.equal(vm.runInContext('uxPreferences.accent', second), '#123456');
});

// Execute production handlers with a small DOM facade; no browser or npm packages.
function dom() {
  const nodes = new Map();
  function node(tag = 'div', textContent = '') {
    return { tag, textContent, value: '', dataset: {}, children: [], listeners: {}, disabled: false,
      append(...children) { this.children.push(...children); },
      replaceChildren(...children) { this.children = children; },
      setAttribute() {}, addEventListener(type, handler) { this.listeners[type] = handler; },
      showModal() { this.open = true; }, close() { this.open = false; },
      querySelector() { return this.button ||= node('button'); },
    };
  }
  const $ = id => { if (!nodes.has(id)) nodes.set(id, node()); return nodes.get(id); };
  const fields = Object.fromEntries(['title','date','start','end','category','description','twitch','google','recurrence','recurrenceUntil'].map(key => [key, node('input')]));
  fields.namedItem = name => fields[name];
  $('slot-form').elements = fields;
  $('slot-form').reset = () => { for (const field of Object.values(fields)) if (typeof field !== 'function') { field.value = ''; field.checked = false; } };
  return { $, document: { createElement: node }, text: node };
}
const mobile = read('apps/mobile/mobile.js');
const section = (source, start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, `Missing production section: ${start}`);
  return source.slice(a, b);
};

test('Streamlabs internal test works disconnected; real test needs OAuth and socket', async () => {
  const state = { runtime: true, supports: {}, dashboard: { controlHub: { integrations: { streamlabs: { status: 'DISCONNECTED' } } } }, streamlabsOAuth: { authorized: false } };
  const requests = [];
  const context = vm.createContext({ state, euro: String, esc: String, request: async path => requests.push(path), toast() {} });
  vm.runInContext("const runtimeDisabled=()=>state.runtime?'':' disabled';" + section(desktop, 'function supportsContent()', 'function conditionRow'), context);
  const disabled = (html, action) => /\bdisabled\b/.test(html.match(new RegExp(`<button[^>]*data-(?:camp|connection)-action="${action}"[^>]*>`))[0]);
  assert.equal(disabled(vm.runInContext('supportsContent()', context), 'supports-test'), false);
  assert.equal(disabled(vm.runInContext('supportsContent()', context), 'supports-test-real'), true);
  const button = desktop.match(/<button[^>]*data-connection-action="streamlabs-test"[^>]*>/)[0];
  assert.equal(disabled(vm.runInContext('`'+button+'`', context), 'streamlabs-test'), false);
  const branch = section(desktop, "if(action==='streamlabs-test'){", "if(action==='streamlabs-test-real'){");
  await vm.runInContext(`(async()=>{const action='streamlabs-test';${branch}})()`, context);
  assert.deepEqual(requests, ['/api/v1/supports/streamlabs/test']);
  state.runtime = false;
  assert.equal(disabled(vm.runInContext('supportsContent()', context), 'supports-test'), true);
  state.runtime = true;
  state.dashboard.controlHub.integrations.streamlabs.status = 'CONNECTED';
  assert.equal(disabled(vm.runInContext('supportsContent()', context), 'supports-test-real'), true);
  state.streamlabsOAuth.authorized = true;
  assert.equal(disabled(vm.runInContext('supportsContent()', context), 'supports-test-real'), false);
});

test('Server capabilities survive remote projection and reauthorization updates mobile buttons/actions', async () => {
  const { stripTypeScriptTypes } = await import('node:module');
  const ui = dom();
  const calls = [];
  const context = vm.createContext({ ...ui, structuredClone, CompanionMode, companionMode: CompanionMode.ONLINE_PC, state: null,
    next: null, updatePlanningProviderReadiness() {}, loadModerationCapabilities() {}, ensureTwitchCapabilities: async () => {}, note() {},
    transport: { sendTwitchChat: async () => calls.push('chat'), updateTwitch: async () => calls.push('channel') }, render() {} });
  const remote = section(read('apps/server/src/remote-policy.ts'), 'export function toRemoteDashboardState', 'function denied');
  vm.runInContext(stripTypeScriptTypes(remote.replace('export function', 'function')), context);
  vm.runInContext(section(mobile, 'let moderationCapabilities = null;', 'async function loadModerationCapabilities'), context);
  vm.runInContext(section(mobile, "$('save-twitch').onclick =", "$('forget-device').onclick"), context);
  vm.runInContext(section(mobile, "$('chat-form').onsubmit", "$('unban-user').onclick"), context);
  const capabilities = { chatWrite: false, createClip: false, updateChannel: false, chatters: false, schedule: true, requiredScopes: {} };
  // Evaluate the actual server snapshot expression, including its capabilities call.
  const expression = read('apps/server/src/index.ts').match(/twitch: (\{ \.\.\.twitch.state, capabilities: twitch.controlCapabilities\(\).*? \}),/)[1];
  const snapshot = () => vm.runInNewContext(`(${expression})`, { twitch: { state: { connected: true }, controlCapabilities: () => capabilities }, local: {}, twitchChannel: {} });
  const dashboard = () => ({ twitch: snapshot(), controlHub: { live: { isLive: true } }, obs: { streaming: true, scenes: [], inputs: {}, activeAudioInputs: [], mediaInputs: [] }, settings: {}, planning: [], checklist: [] });
  const project = () => {
    context.input = dashboard();
    vm.runInContext('next=toRemoteDashboardState(input);state=next;', context);
    vm.runInContext(section(mobile, '  if (next.twitch?.capabilities)', '  const chattingActive'), context);
  };
  project();
  for (const id of ['chat-message','live-clip','create-clip','save-twitch','more-chatters']) assert.equal(ui.$(id).disabled, true, id);
  ui.$('chat-message').value = 'Bonjour';
  await ui.$('chat-form').onsubmit({ preventDefault() {} });
  await ui.$('save-twitch').onclick();
  assert.equal(calls.length, 0);
  Object.assign(capabilities, { chatWrite: true, createClip: true, updateChannel: true, chatters: true });
  project();
  for (const id of ['chat-message','live-clip','create-clip','save-twitch','more-chatters']) assert.equal(ui.$(id).disabled, false, id);
  await ui.$('chat-form').onsubmit({ preventDefault() {} });
  await ui.$('save-twitch').onclick();
  assert.deepEqual(calls, ['chat','channel']);
  context.companionMode = CompanionMode.ONLINE_STANDALONE;
  vm.runInContext('applyTwitchActionCapabilities()', context);
  for (const id of ['chat-message','live-clip','create-clip','save-twitch','more-chatters']) assert.equal(ui.$(id).disabled, true, id);
  ui.$('chat-message').value = 'Non envoyé';
  await ui.$('chat-form').onsubmit({ preventDefault() {} });
  await ui.$('save-twitch').onclick();
  assert.equal(calls.length, 2);
});

test('Standalone Planning form uses real sync: second provider, failed creation retry, edit and delete', async () => {
  const ui = dom(), values = new Map(), publications = [], notices = [];
  const companion = createCompanionStore({ getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) });
  let failGoogleCreate = true;
  const bridge = Object.fromEntries(['twitch','google'].flatMap(provider => ['create','update','delete'].map(action => [
    `${provider}${action[0].toUpperCase()}${action.slice(1)}Planning`, raw => {
      const { event, link } = JSON.parse(raw);
      publications.push({ provider, action, event, link });
      if (action !== 'create' && !link.remoteId) return JSON.stringify({ ok: false, code: 'INVALID_LINK', message: 'Missing remoteId' });
      if (provider === 'google' && action === 'create' && failGoogleCreate) {
        failGoogleCreate = false;
        return JSON.stringify({ ok: false, code: 'HTTP_403', message: 'Simulated definitive creation refusal' });
      }
      return JSON.stringify({ ok: true, remoteId: link.remoteId || `${provider}-remote` });
    },
  ])));
  for (const provider of ['twitch', 'google']) bridge[`${provider}Test`] = () => JSON.stringify({ ok: true, configured: true, connected: true, tested: true, capabilities: ['schedule', 'calendar'] });
  const providerSync = createStandaloneProviderSync({ store: companion, adapter: createNativeProviderAdapter(bridge) });
  const settle = () => new Promise(resolve => setImmediate(resolve));
  const context = vm.createContext({ ...ui, CompanionMode, companionMode: CompanionMode.ONLINE_STANDALONE, companion,
    providerSync, StreamDashboardProviders: bridge, createProviderRetry, eventProviderState, renderSyncCenter() {}, refreshProviderAccounts: async () => {}, createThumbnail: () => ui.document.createElement('span'),
    mobileEditing: null, planningPage: 1, planningPageSize: 20, planningFilters: {}, planningTemporal: '',
    moderationCapabilities: { schedule: false }, // A stale PC denial must not block the native provider.
    ensureTwitchCapabilities: async () => {}, structuredClone,
    FormData: class { constructor(form) { this.form = form; } get(key) { const field = this.form.elements[key]; return ['twitch','google'].includes(key) ? field.checked ? 'on' : null : field?.value; } },
    selectPlanningPage() {}, updatePlanningProviderReadiness() {}, renderOnlinePlanningProviders() {},
    filterPlanning: items => items, filterPlanningTemporal: items => items,
    paginatePlanning: items => ({ items, page: 1, total: items.length, totalPages: 1 }),
    planningWhenParts: () => ({ date: '2030-01-01', time: '18:00' }),
    note: message => notices.push(message), confirm: () => false,
    offlineState: () => ({ planning: companion.snapshot().planning }),
  });
  context.render = state => { context.state = state; context.items = state.planning; vm.runInContext('renderPlanning(items)', context); };
  vm.runInContext(section(mobile, 'const planningProviderNames', 'function applyPlanningProviderCapabilities'), context);
  vm.runInContext(section(mobile, 'function renderPlanning(items)', 'async function removeMobileOccurrence'), context);
  vm.runInContext(section(mobile, 'async function syncEventProviders(', 'function render(next)'), context);
  vm.runInContext(section(mobile, "$('add-slot').onclick", 'const recentKey'), context);
  ui.$('add-slot').onclick();
  assert.equal(ui.$('slot-dialog').open, true);
  const fields = ui.$('slot-form').elements;
  for (const [key,value] of Object.entries({ title:'Premier live',date:'2030-01-01',start:'18:00',end:'20:00',category:'live' })) fields[key].value = value;
  fields.twitch.checked = true;
  ui.$('slot-twitch-game-id').value = '123';
  const submit = () => ui.$('slot-form').onsubmit({ preventDefault() {}, currentTarget: ui.$('slot-form') });
  await submit();
  await settle();
  assert.equal(companion.snapshot().planning.length, 1, notices.join('; '));
  assert.equal(publications[0].action, 'create');
  assert.equal(ui.$('slot-dialog').open, false);
  ui.$('planning').children[0].listeners.click({ target: { closest: () => null } });
  assert.equal(ui.$('slot-dialog').open, true);
  assert.equal(fields.title.value, 'Premier live');
  fields.title.value = 'Live modifié';
  fields.google.checked = true;
  await submit();
  await settle();
  assert.equal(companion.snapshot().planning[0].title, 'Live modifié');
  assert.deepEqual(publications.map(({provider, action}) => [provider, action]), [
    ['twitch','create'], ['twitch','update'], ['google','create'],
  ]);
  assert.equal(publications[1].link.remoteId, 'twitch-remote');
  assert.equal(companion.snapshot().planning[0].providerLinks.google.status, 'error');
  const retry = ui.$('planning').children[0].children.flatMap(node => node.children || []).find(node => node.textContent === 'Réessayer Google');
  assert.ok(retry);
  await retry.onclick();
  await settle();
  assert.equal(publications.length, 4, 'Targeted Google retry must not republish Twitch');
  assert.deepEqual(publications.slice(-1).map(({provider, action}) => [provider, action]), [['google','create']]);
  const synced = companion.snapshot().planning[0];
  assert.equal(synced.providerLinks.twitch.remoteId, 'twitch-remote');
  assert.equal(synced.providerLinks.google.remoteId, 'google-remote');
  assert.equal(synced.providerLinks.google.status, 'synced');
  ui.$('planning').children[0].listeners.click({ target: { closest: () => null } });
  fields.title.value = 'Publié sur les deux providers';
  await submit();
  await settle();
  assert.deepEqual(publications.slice(-2).map(({provider, action, link}) => [provider, action, link.remoteId]), [
    ['twitch','update','twitch-remote'], ['google','update','google-remote'],
  ]);
  const remove = ui.$('planning').children[0].children.find(node => node.textContent === 'Supprimer');
  remove.onclick();
  assert.equal(companion.snapshot().planning.length, 1);
  context.confirm = () => true;
  remove.onclick();
  await settle();
  assert.equal(companion.snapshot().planning.length, 0);
  assert.deepEqual(publications.slice(-2).map(({provider, action}) => [provider, action]), [['twitch','delete'], ['google','delete']]);
});
