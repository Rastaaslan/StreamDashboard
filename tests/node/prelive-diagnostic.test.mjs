import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { diagnosePrelive } from '../../apps/mobile/prelive-diagnostic.js';
const now = Date.parse('2026-09-28T12:00:00Z');
const nominal = () => ({ now, state: { at: new Date(now).toISOString(), obs: { connected: true, scenes: ['Intro'], inputs: { Mic: { muted: false, volume: 1 } }, activeAudioInputs: ['Mic'], browserInputs: ['Timer'] }, settings: { startMode: 'intro', modeScenes: { intro: 'Intro' }, primaryMicInput: 'Mic' }, twitch: { connected: true }, planning: [] }, capabilities: { updateChannel: true } });
const check = (result, id) => result.checks.find(c => c.id === id);
test('nominal PC, including unscheduled stream, is OK and read-only', () => {
  const input = nominal(), before = structuredClone(input);
  const result = diagnosePrelive(input);
  assert.equal(result.status, 'ok');
  assert.deepEqual(input, before);
  for (const id of ['runtime','obs','microphone','scene','twitch','scopes','planning-sync','providers','timer']) assert.ok(check(result,id));
});
test('muted microphone warns and offers audio correction', () => {
  const input = nominal(); input.state.obs.inputs.Mic.muted = true;
  const result = diagnosePrelive(input);
  assert.equal(result.status, 'warning'); assert.equal(check(result,'microphone').action,'audio');
});
test('OBS disconnected, missing microphone, missing start scene and required timer block independently', () => {
  for (const [id, mutate] of [
    ['obs', i => i.state.obs.connected = false],
    ['microphone', i => i.state.obs.inputs = {}],
    ['scene', i => i.state.obs.scenes = []],
    ['timer', i => i.state.settings.requireTimerOverlayOnStart = true],
  ]) {
    const input = nominal(); mutate(input);
    const result = diagnosePrelive(input);
    assert.equal(result.status,'blocker',id); assert.equal(check(result,id).status,'blocker'); assert.ok(check(result,id).action);
  }
});
test('Standalone Android excludes PC checks even with cached disconnected OBS', () => {
  const input = nominal(); input.mode = 'ONLINE_STANDALONE'; input.state.obs.connected = false; input.state.settings.requireTimerOverlayOnStart = true;
  const result = diagnosePrelive(input);
  assert.equal(result.status,'ok');
  for (const id of ['obs','runtime','microphone','scene','timer','twitch','scopes']) { assert.equal(check(result,id).applicable,false); assert.match(check(result,id).message,/Standalone Android/); }
});
test('stale, offline or redacted data warns instead of confirming failures', () => {
  for (const patch of [{ mode:'OFFLINE' }, { state: {} }, { state: { ...nominal().state, at:'2020-01-01', obs:{connected:false} } }]) {
    const result = diagnosePrelive({...nominal(),...patch}); assert.equal(result.status,'warning');
  }
});
test('only required Twitch metadata scope is checked, unknown and missing scopes warn', () => {
  for (const capabilities of [null, {updateChannel:false}]) {
    const result = diagnosePrelive({...nominal(),capabilities}); assert.equal(check(result,'scopes').status,'warning'); assert.equal(check(result,'scopes').action,'connections');
  }
  assert.equal(diagnosePrelive({...nominal(),capabilities:{updateChannel:true,ban:false,createClip:false}}).status,'ok');
});
test('pending operations, conflicts, provider failures and publications warn', () => {
  for (const patch of [{cache:{pending:[{}]}},{cache:{conflicts:[{}]}},{state:{...nominal().state,planning:[{providerLinks:{twitch:{status:'error'}}}]}},{state:{...nominal().state,planning:[{providerLinks:{google:{status:'syncing'}}}]}}]) {
    const result=diagnosePrelive({...nominal(),...patch});assert.equal(check(result,'planning-sync').status,'warning');assert.equal(check(result,'planning-sync').action,'planning');
  }
  const input=nominal();input.state.controlHub={integrations:{streamlabs:{status:'ERROR'}}};assert.equal(check(diagnosePrelive(input),'providers').status,'warning');
});
test('optional providers and silent intro scene do not block', () => {
  const input=nominal();input.state.controlHub={integrations:{discord:{status:'NOT_CONFIGURED'}}}; assert.equal(diagnosePrelive(input).status,'ok');
  input.state.obs.activeAudioInputs=[];assert.equal(diagnosePrelive(input).status,'warning');
});
test('mobile entry points, offline cache and unchanged five-tab navigation', () => {
  const html=readFileSync(new URL('../../apps/mobile/index.html',import.meta.url),'utf8');
  assert.match(html,/id="run-prelive"/);assert.match(html,/data-open-diagnostic/);
  assert.deepEqual([...html.matchAll(/<button[^>]*data-tab="([^"]+)"/g)].map(m=>m[1]),['home','live','sounds','planning','more']);
  const sw=readFileSync(new URL('../../apps/mobile/sw.js',import.meta.url),'utf8');
  for (const asset of ['prelive-diagnostic.js','features/prelive.js']) assert.ok(sw.includes(`'/mobile/${asset}'`) && sw.includes(`'${asset}'`));
});

test('schedule scope is required only for requested Twitch publications', () => {
  const input=nominal(); input.state.planning=[{desiredPublication:{twitch:true}}];
  assert.equal(check(diagnosePrelive(input),'planning-scopes').status,'warning');
  input.capabilities.schedule=true;assert.equal(diagnosePrelive(input).status,'ok');
});
test('Standalone ignores cached PC provider errors but reports local publication failures', () => {
  const input=nominal();input.mode='ONLINE_STANDALONE';input.state.twitch.error='old PC error';
  assert.equal(diagnosePrelive(input).status,'ok');
  input.cache={planning:[{providerLinks:{google:{status:'error'}}}]};assert.equal(diagnosePrelive(input).status,'warning');
});
