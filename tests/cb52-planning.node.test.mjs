import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { localDate, eventTimes, editedRecurrence } from '../apps/mobile/shared/planning-editor.js';

process.env.TZ = 'Europe/Paris';
test('local midnight, overnight and multi-day event editor round trips', () => {
  assert.equal(localDate('2030-06-01T22:30:00Z'), '2030-06-02');
  assert.deepEqual(eventTimes('2030-06-02', '23:30', '01:30', ''), {
    startAtUtc: '2030-06-02T21:30:00.000Z', endAtUtc: '2030-06-02T23:30:00.000Z',
  });
  assert.equal(eventTimes('2030-06-02', '23:30', '01:30', '2030-06-05').endAtUtc, '2030-06-04T23:30:00.000Z');
  assert.throws(() => eventTimes('2030-06-02', '23:30', '01:30', '2030-06-01'));
});
test('recurrence edit preserves provider timezone, exceptions and exact until', () => {
  const previous = { frequency: 'weekly', interval: 2, timeZone: 'America/New_York', until: '2030-12-01T20:00:00Z', exceptions: { '2030-06-02': { cancelled: true }, '2030-06-16': { patch: { title: 'Exception' } } } };
  const next = editedRecurrence(previous, 'weekly-2', localDate(previous.until));
  assert.deepEqual(next, previous);
  next.exceptions['2030-06-02'].cancelled = false;
  assert.equal(previous.exceptions['2030-06-02'].cancelled, true);
  assert.equal(editedRecurrence(previous, '', ''), null);
});
test('Soundboard starts audible, respects a saved mute and clamps stored volume', () => {
  const source = readFileSync('apps/mobile/mobile.js', 'utf8');
  const code = source.slice(source.indexOf('const soundboardVolumeKey'), source.indexOf('let soundboardVolumeTimer'));
  for (const [stored, expected] of [[null, 1], ['0', 0], ['0.4', 0.4], ['broken', 1], ['2', 1]]) {
    const context = vm.createContext({ localStorage: { getItem: () => stored } });
    vm.runInContext(code, context);
    assert.equal(vm.runInContext('soundboardMasterVolume', context), expected);
  }
});
test('mobile Discord ignores inverted channel responses and clears stale choices', async () => {
  const source = readFileSync('apps/mobile/mobile.js', 'utf8');
  const code = source.slice(source.indexOf('let discordChannelRequest'), source.indexOf("$('discord-channel').onchange"));
  const elements = { 'discord-guild': { value: 'a' }, 'discord-channel': { value: 'old', replaceChildren(...items) { this.items = items; this.value = ''; } } };
  const pending = new Map();
  const context = vm.createContext({ $: key => elements[key], state: { discord: { configured: true } },
    transport: { discordChannels: id => new Promise(resolve => pending.set(id, resolve)) },
    Option: function(label, value) { this.value = value; }, note: () => assert.fail('unexpected error') });
  vm.runInContext(code, context);
  const first = elements['discord-guild'].onchange();
  elements['discord-guild'].value = 'b';
  const second = elements['discord-guild'].onchange();
  assert.equal(elements['discord-channel'].disabled, true);
  pending.get('b')([{ id: 'b1', name: 'B' }]); await second;
  pending.get('a')([{ id: 'a1', name: 'A' }]); await first;
  assert.equal(elements['discord-channel'].items[1].value, 'b1');
  elements['discord-guild'].value = ''; await elements['discord-guild'].onchange();
  assert.equal(elements['discord-channel'].value, '');
  assert.equal(elements['discord-channel'].disabled, true);
});

test('Desktop delayed HTTP snapshot cannot replace newer WebSocket provider state', async () => {
  const source = readFileSync('apps/web/preview/preview.js', 'utf8');
  const code = source.slice(source.indexOf('async function refreshRuntime('), source.indexOf('function applyDashboard('));
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const state = { runtime: true, dashboardVersion: 1, view: 'camp', campItem: 'Connexions', dashboard: { discord: { connected: true } } };
  const context = vm.createContext({ state, request: path => path === '/api/v1/state' ? pending : Promise.resolve({}),
    applyDashboard: snapshot => { state.dashboard = snapshot; state.dashboardVersion++; }, applyProduct() {},
    runtimeUi() {}, connectRuntimeSocket() {}, updateRuntimeView() {}, render() {}, toast() {}, view: { querySelector: () => true } });
  vm.runInContext(code, context);
  const refresh = context.refreshRuntime(true);
  // Same transition as a stored Discord token being disconnected in a WS update.
  state.dashboard = { discord: { connected: false } }; state.dashboardVersion++;
  release({ discord: { connected: true } }); await refresh;
  assert.equal(state.dashboard.discord.connected, false);
});
