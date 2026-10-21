import { createActionRouter } from '../../apps/mobile/control/action-routing.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {migrateInstallation,resolveCapability} from '../../apps/mobile/shared/installation.js';
import { pathToFileURL, fileURLToPath } from 'node:url';

// Regression coverage for the shipped controller. Integration functions and
// handlers run from control.js; only DOM, transport, and storage are substituted.
const root = fileURLToPath(new URL('../../', import.meta.url));
const { readDeckPreferences, saveDeckPreferences, defaultDeckFavorites, renderPerformancePage } =
  await import(pathToFileURL(path.join(root, 'apps/mobile/control/performance-ui.js')));
const source = fs.readFileSync(path.join(root, 'apps/mobile/control/control.js'), 'utf8');
const fixture = {
  host: { hostname: 'PC <stream>', settings: { primaryMicInput: 'Desk Mic', chattingScene: 'Chat', modeScenes: { live: 'Game' } },
    state: { obs: { connected: true, scene: 'Game', inputs: { 'Desk Mic': { muted: false } } }, timer: { remaining: 300 } },
    chat: { connected: true, canSend: true } },
  configuration: { actions: [
    { id: 'custom-micro', type: 'mic.toggle', value: 'Desk Mic', label: 'Micro <script>bad()</script>' },
    { id: 'custom-game', type: 'mode.set', value: 'live', label: 'Jeu' },
    { id: 'custom-replay', type: 'replay.save', label: 'Clip' },
    { id: 'custom-wiz', type: 'wizebot.command', value: '!love', label: 'WizeBot' },
    { id: 'custom-start', type: 'live.start', label: 'Start' },
    { id: 'custom-stop', type: 'live.stop', label: 'Stop' },
  ] },
  receipts: [{ status: 'succeeded', message: '<img src=x onerror=bad()>' }],
};
const sounds = { sounds: [
  { id: 'custom-sound', name: 'Salut & merci', category: 'Ambiance', favorite: true, enabled: true, sourceAvailable: true },
  { id: 'missing-sound', name: 'Absent', category: 'Ambiance', enabled: true, sourceAvailable: false },
], currentPlayback: { soundId: 'custom-sound' } };
function memoryStorage() {
  const values = new Map();
  return { values, getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}
function executableButtons(markup) {
  return [...markup.matchAll(/<button\b[^>]*>/g)].map(match => match[0]).filter(tag => /data-action=|data-play-sound=/.test(tag));
}
const disabled = tag => /\sdisabled(?:\s|>)/.test(tag);
const storage = memoryStorage();
assert.equal(readDeckPreferences(storage, 'regie-A'), null);
saveDeckPreferences(storage, 'regie-A', { bank: 'favorites', soundCategory: '', favorites: [] });
assert.deepEqual(readDeckPreferences(storage, 'regie-A').favorites, []);
assert.equal(readDeckPreferences(storage, 'regie-B'), null);
assert.equal(readDeckPreferences({ getItem() { throw new Error('denied'); } }, 'A'), null);
assert.equal(saveDeckPreferences({ setItem() { throw new Error('denied'); } }, 'A', {}), null);
storage.setItem('sd2.performance-deck.v1:broken', '{oops');
assert.equal(readDeckPreferences(storage, 'broken'), null);
const favorites = defaultDeckFavorites(fixture, sounds);
for (const key of ['action:custom-micro', 'action:custom-replay', 'sound:custom-sound']) assert(favorites.includes(key));
assert(!favorites.some(key => ['action:custom-start', 'action:custom-stop'].includes(key)));
const base = { data: fixture, sounds, replay: { active: true, seconds: 30 }, online: true, busy: false, blocked: false, mode: 'deck', bank: 'all', favorites, actionState: () => 'Prêt' };
const html = renderPerformancePage(base);
for (const attribute of ['data-action="custom-micro"', 'data-action="custom-replay"', 'data-play-sound="custom-sound"']) assert(html.includes(attribute));
assert(!html.includes('data-action="custom-start"'));
assert(!html.includes('data-action="custom-stop"'));
assert(!html.includes('<script>'));
assert(!html.includes('<img'));
assert(html.includes('Micro &lt;script&gt;bad()&lt;/script&gt;'));
for (const patch of [{ online: false }, { blocked: true }]) {
  const buttons = executableButtons(renderPerformancePage({ ...base, ...patch }));
  assert(buttons.length > 0 && buttons.every(disabled));
}
const edit = renderPerformancePage({ ...base, editing: true });
assert(!/data-action=|data-play-sound=/.test(edit));
assert(edit.includes('data-deck-favorite="action:custom-micro"'));
const busyButtons = executableButtons(renderPerformancePage({ ...base, busy: true }));
assert(!disabled(busyButtons.find(tag => tag.includes('data-action="sound.stop"'))));
assert(busyButtons.filter(tag => !tag.includes('data-action="sound.stop"')).every(disabled));
assert(!renderPerformancePage({ ...base, bank: 'favorites', favorites: [] }).includes('class="live-pad"'));
assert(renderPerformancePage({ ...base, replay: { active: null } }).includes('data-deck-clips'));
const noChat = renderPerformancePage({ ...base, data: { ...fixture, host: { ...fixture.host, chat: { connected: true, canSend: false } } } });
assert(disabled(executableButtons(noChat).find(tag => tag.includes('data-action="custom-wiz"'))));
const localMarkup = renderPerformancePage({ ...base, online: false, local: true });
const localButtons = executableButtons(localMarkup);
assert(!disabled(localButtons.find(tag => tag.includes('data-play-sound="custom-sound"'))));
assert(disabled(localButtons.find(tag => tag.includes('data-play-sound="missing-sound"'))));
assert(!disabled(localButtons.find(tag => tag.includes('data-action="sound.stop"'))));
assert(!disabled(localButtons.find(tag => tag.includes('data-action="custom-wiz"'))));
assert(disabled(localButtons.find(tag => tag.includes('data-action="custom-micro"'))));
assert(!localMarkup.includes('Régie déconnectée'));
const startingButtons = executableButtons(renderPerformancePage({ ...base, online: false, local: true, busy: true,
  sounds: { ...sounds, currentPlayback: { soundId: 'custom-sound', status: 'starting' } } }));
assert(!disabled(startingButtons.find(tag => tag.includes('data-action="sound.stop"'))));
assert(startingButtons.filter(tag => !tag.includes('data-action="sound.stop"')).every(disabled));
assert(executableButtons(renderPerformancePage({ ...base, online: false, local: true, blocked: true })).every(disabled));
console.log('PASS module: scoped storage, malformed storage, empty favorites, custom IDs, escaped HTML, no live pads, offline, blocked, safe edit, sound stop, replay, WizeBot');

const listeners = new Map();
const localStorage = memoryStorage();
let blocked = false;
let pending = new Map();
let sent = [];
const scope = vm.createContext({
  online: false, busy: false, activeCommands: 0, compact: true, autonomy: undefined,
  data: { configuration: { actions: [] } }, sounds: { sounds: [] },
  page: 'deck', server: 'regie-A', localEndpoint:'regie-A', resolveCapability,
  installationUI:{current:migrateInstallation({id:'fixture-host',platform:'windows'})}, deviceAudio: undefined, LOCAL_SCOPE: 'device-workspace-v1',
  deckScope: undefined, deckPreferences: undefined, deckEditing: false, deckEditBank: 'all',
  readDeckPreferences, saveDeckPreferences, defaultDeckFavorites, localStorage,
  renderPerformancePage: options => options, actionState: () => '', esc: String,
  replay: { active: true }, commandsBlocked: () => blocked,
  toast: () => {}, confirm: () => true, render: () => {}, resetPerformanceView: () => {},
  refresh: async () => {}, uuid: () => 'test-request', timerStatus: () => 'Test timer',
  labels: { succeeded: 'Réussi' },
  dialog: { open: false, close() { this.open = false; } },
  deviceAccounts: { click: async () => false }, wizebotManagement: { click: async () => false },
  document: { addEventListener: (name, handler) => listeners.set(name, handler) },
  api: async (requestPath, body) => {
    const key = body.action || body.type;
    sent.push({ requestPath, ...body });
    return new Promise(resolve => pending.set(key, resolve));
  },
});
scope.actionRouter=createActionRouter({installation:()=>scope.installationUI.current,workspace:()=>scope.server,localEndpoint:scope.localEndpoint,credential:async()=>'',request:async()=>{throw Error('Unexpected routed request');}});
function sourceBetween(start, end) {
  const begin = source.indexOf(start);
  const finish = source.indexOf(end, begin);
  assert(begin >= 0 && finish > begin, `Source anchors absent: ${start}`);
  return source.slice(begin, finish);
}
vm.runInContext(sourceBetween('function ensureDeckPreferences(){', 'function resetPerformanceView(){'), scope);
vm.runInContext(sourceBetween('function actionAvailability(', 'function actionState('), scope);
vm.runInContext(sourceBetween('async function runAction(', 'async function openAuthorization('), scope);
vm.runInContext(sourceBetween("document.addEventListener('click',", "document.addEventListener('change',"), scope);
vm.runInContext(source.split('\n').find(line => line.startsWith('globalThis.StreamDashboardHandleBack=')), scope);
const click = dataset => listeners.get('click')({ target: { closest: () => ({ dataset, disabled: false }) } });
const turn = () => new Promise(resolve => setImmediate(resolve));
const resolve = key => { assert(pending.has(key), `No request pending for ${key}`); pending.get(key)({ status: 'succeeded', message: key }); pending.delete(key); };

assert.equal(scope.ensureDeckPreferences().favorites.length, 0);
assert.equal(readDeckPreferences(localStorage, 'regie-A'), null, 'Do not persist an empty offline first snapshot');
scope.online = true; scope.data = fixture; scope.sounds = sounds;
assert(scope.ensureDeckPreferences().favorites.length > 0);
scope.updateDeckPreferences({ favorites: [], bank: 'scenes' });
assert.equal(scope.ensureDeckPreferences().favorites.length, 0);
assert.equal(readDeckPreferences(localStorage, 'regie-A').favorites.length, 0);
scope.autonomy = {store:{scope:'regie-A'}};scope.server = 'regie-new-address';
assert.equal(scope.ensureDeckPreferences().bank, 'scenes', 'The same workspace retains its deck after an address change');
assert.equal(readDeckPreferences(localStorage, 'regie-new-address'), null, 'No second deck is silently initialized');
scope.autonomy = undefined;scope.server = 'regie-A';
await click({ deckEdit: '' });
assert.equal(scope.deckEditing, true);
assert.equal(scope.mobilePerformancePage('deck').bank, 'all');
await click({ deckBank: 'alerts' });
assert.equal(scope.mobilePerformancePage('deck').bank, 'alerts');
assert.equal(readDeckPreferences(localStorage, 'regie-A').bank, 'scenes');
await click({ page: 'sounds' });
assert.equal(scope.deckEditing, false);
assert.equal(readDeckPreferences(localStorage, 'regie-A').bank, 'scenes');
await click({ deckEdit: '' });
assert.equal(scope.StreamDashboardHandleBack(), true);
assert.equal(scope.deckEditing, false);
assert.equal(scope.page, 'sounds');
assert.equal(scope.StreamDashboardHandleBack(), true);
assert.equal(scope.page, 'deck');
assert.equal(localStorage.getItem('sd2.page'), 'deck');
await click({ deckEdit: '' });
scope.dialog.open = true;
assert.equal(scope.StreamDashboardHandleBack(), true);
assert.equal(scope.dialog.open, false);
assert.equal(scope.deckEditing, true);
assert.equal(scope.StreamDashboardHandleBack(), true);
assert.equal(scope.deckEditing, false);
assert.equal(scope.StreamDashboardHandleBack(), false);
assert.equal(readDeckPreferences(localStorage, 'regie-A').bank, 'scenes');
console.log('PASS integration: delayed offline initialization, intentionally empty favorites, temporary edit bank, page changes, Android dialog/edit/page back sequence');

for (const firstToFinish of ['sound.stop', 'custom-micro']) {
  sent = []; pending = new Map();
  const micro = scope.runAction('custom-micro');
  const stop = scope.runAction('sound.stop');
  assert.equal(scope.activeCommands, 2);
  resolve(firstToFinish);
  await (firstToFinish === 'sound.stop' ? stop : micro);
  assert.equal(scope.busy, true, 'A remaining command must retain the busy guard');
  await scope.runAction('custom-game');
  assert.equal(sent.length, 2, 'Other pads cannot execute during the remaining request');
  resolve(firstToFinish === 'sound.stop' ? 'custom-micro' : 'sound.stop');
  await Promise.all([micro, stop]);
  assert.equal(scope.busy, false);
  assert.equal(scope.activeCommands, 0);
}
sent = []; pending = new Map();
const timer = click({ command: 'timer.start' });
await turn();
const stop = scope.runAction('sound.stop');
resolve('sound.stop'); await stop;
assert.equal(scope.busy, true, 'A pending timer command must retain the busy guard');
resolve('timer.start'); await timer;
assert.equal(scope.busy, false);
assert.equal(scope.activeCommands, 0);
console.log('PASS concurrency: micro/stop resolving in both orders; timer/stop overlap; other actions remain blocked');

sent = []; pending = new Map();
scope.online = false; await scope.runAction('custom-micro'); assert.equal(sent.length, 0);
scope.online = true; blocked = true; await scope.runAction('custom-micro'); assert.equal(sent.length, 0);
blocked = false;
const custom = scope.runAction('custom-micro');
assert.equal(sent[0].action, 'custom-micro'); resolve('custom-micro'); await custom;
scope.confirm = () => false;
await scope.runAction('custom-stop'); assert.equal(sent.length, 1);
scope.confirm = () => true;
const confirmedStop = scope.runAction('custom-stop');
assert.equal(sent[1].action, 'live.stop'); resolve('live.stop'); await confirmedStop;
console.log('PASS dispatch: offline and pending-config guards, configured IDs retained, custom live-stop requires confirmation');

// The native renderer now checks the selected device before dispatching OBS.
sent=[];scope.online=true;scope.busy=false;scope.installationUI.current.devices[0].enabled=false;
await scope.runAction('custom-micro');assert.equal(sent.length,0);
console.log('PASS installation: a removed executor never receives a command');
