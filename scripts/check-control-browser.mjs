import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir, networkInterfaces } from 'node:os';
import path from 'node:path';
import { chromium, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { encode, decode } from '@msgpack/msgpack';
import { startDashboardServer } from '../dist/apps/server/src/index.js';

// Isolated browser -> paired LAN controller -> real host -> simulated OBS v5.
// No account tokens, real OBS process or public broadcast is used by this check.
const dataDir = await mkdtemp(path.join(tmpdir(), 'streamdashboard-browser-'));
const outputDir = path.resolve(process.env.CONTROL_SCREENSHOTS || 'test-results/control-next');
await mkdir(outputDir, { recursive: true });
let muted = false, scene = 'Jeu', muteCalls = 0, sceneCalls = 0;
const obs = new WebSocketServer({ host: '127.0.0.1', port: 0 });
obs.on('connection', socket => {
  socket.send(encode({ op: 0, d: { obsWebSocketVersion: '5.6.3', rpcVersion: 1 } }));
  socket.on('message', data => {
    const message = decode(new Uint8Array(data));
    if (message.op === 1) { socket.send(encode({ op: 2, d: { negotiatedRpcVersion: 1 } })); return; }
    if (message.op !== 6) return;
    const { requestId, requestType, requestData = {} } = message.d;
    if (requestType === 'SetInputMute') { muted = requestData.inputMuted; muteCalls++; }
    if (requestType === 'SetCurrentProgramScene') { scene = requestData.sceneName; sceneCalls++; }
    const responses = {
      GetVersion: { obsVersion: '31', obsWebSocketVersion: '5' },
      GetCurrentProgramScene: { currentProgramSceneName: scene },
      GetSceneList: { scenes: ['Jeu','Pause','Introduction','Discussion'].map(sceneName => ({ sceneName })) },
      GetStreamStatus: { outputActive: false }, GetRecordStatus: { outputActive: false },
      GetInputList: { inputs: [{ inputName: 'Micro', inputKind: 'wasapi_input_capture' }] },
      GetInputMute: { inputMuted: muted }, GetInputVolume: { inputVolumeMul: 1, inputVolumeDb: 0 },
      GetSpecialInputs: { mic1: 'Micro' },
      GetSceneItemList: { sceneItems: [{ sourceName: 'Micro', sceneItemEnabled: true }] },
    };
    socket.send(encode({ op: 7, d: { requestId, requestType, requestStatus: { result: true, code: 100 }, responseData: responses[requestType] || {} } }));
  });
});
await once(obs, 'listening');
process.env.OBS_URL = `ws://127.0.0.1:${obs.address().port}`;
const options = { port: 0, host: '0.0.0.0', remoteEnabled: true, dataDir, logger: { info(){}, warn(){}, error(){} } };
let host, browser;
try {
  host = await startDashboardServer(options);
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST') => {
    const response = await fetch(host.url + route, { method, headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const value = await response.json(); assert.ok(response.ok, JSON.stringify(value)); return value;
  };
  let state = await api('/api/v2/state');
  await api('/api/v2/settings', { expectedRevision: state.host.settingsRevision, primaryMicInput: 'Micro', modeScenes: { live: 'Jeu', pause: 'Pause', intro: 'Introduction' }, chattingScene: 'Discussion' }, 'PUT');
  const pair = await api('/api/v1/remote/pairing', { management: true });
  const paired = await api('/api/v1/remote/pair', { id: pair.id, code: pair.code, name: 'Browser mobile verification' });
  const address = Object.values(networkInterfaces()).flat().find(v => v?.family === 'IPv4' && !v.internal)?.address;
  assert.ok(address, 'LAN interface required to verify paired remote authorization');
  const remote = `http://${address}:${host.port}`;
  browser = await chromium.launch({ headless: true });
  const desktop = await browser.newPage({ viewport: { width: 1440, height: 1080 } });
  const phone = await browser.newPage({ viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true });
  const errors = [];
  for (const page of [desktop, phone]) { page.on('pageerror', e => errors.push(e.message)); page.on('dialog', dialog => dialog.accept()); }
  await phone.addInitScript(value => localStorage.setItem('streamdashboard.device', value), paired.credential);
  await desktop.goto(host.url + '/mobile/control/');
  await phone.goto(remote + '/mobile/control/');
  await expect(desktop.locator('[data-action="micro"]')).toBeEnabled();
  await expect(phone.locator('[data-action="micro"]')).toBeEnabled();
  await desktop.keyboard.press('Control+Alt+Shift+F1');
  await expect.poll(() => muted).toBe(true);
  await expect(desktop.locator('.receipt').first()).toContainText('Réussi');
  assert.equal(muteCalls, 1);
  await phone.locator('[data-action="scene-pause"]').click();
  await expect.poll(() => scene).toBe('Pause');
  await expect(phone.locator('.receipt').first()).toContainText('Réussi');
  assert.equal(sceneCalls, 1);
  await phone.locator('[data-action="timer-plus"]').click();
  await expect.poll(async () => (await api('/api/v2/state')).host.state.timer.remaining).toBe(600);
  await desktop.screenshot({ path: path.join(outputDir, 'desktop.png'), fullPage: true });
  await phone.screenshot({ path: path.join(outputDir, 'phone.png'), fullPage: true });
  for (const page of [desktop, phone]) await page.locator('nav [data-page="planning"]').click();
  await desktop.locator('[data-task="new-event"]').click();
  await desktop.locator('#event-form [name="title"]').fill('Parcours partagé vérifié');
  await desktop.locator('#event-form button:not([type="button"])').click();
  await expect(phone.locator('.event-content')).toContainText('Parcours partagé vérifié', { timeout: 12000 });
  await phone.locator('[data-edit-event]').click();
  await phone.locator('#event-form [name="title"]').fill('Modifié sur téléphone');
  await phone.locator('#event-form button:not([type="button"])').click();
  await expect(desktop.locator('.event-content')).toContainText('Modifié sur téléphone', { timeout: 12000 });
  await phone.locator('nav [data-page="settings"]').click();
  await phone.locator('[data-tab="profile"]').click();
  await phone.locator('[name="streamerName"]').fill('Configuration partagée');
  await phone.locator('#profile-settings button').click();
  await expect.poll(async () => (await api('/api/v2/state')).host.settings.streamerName).toBe('Configuration partagée');
  await browser.close(); browser = undefined;
  await host.stop(); host = await startDashboardServer(options);
  state = await api('/api/v2/state');
  assert.equal(state.host.planning[0].title, 'Modifié sur téléphone');
  assert.equal(state.host.settings.streamerName, 'Configuration partagée');
  assert.equal(state.host.state.timer.remaining, 600);
  const response = await fetch(`http://${address}:${host.port}/api/v2/state`, { headers: { Authorization: `Device ${paired.credential}` } });
  assert.equal(response.status, 200, 'Pairing must survive host restart');
  const item = state.host.planning[0];
  await api('/api/v2/planning/' + item.id, { expectedRevision: state.host.planningRevisions[item.id] }, 'DELETE');
  assert.equal((await api('/api/v2/state')).host.planning.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: paired LAN mobile + desktop, keyboard mic, scene, timer, shared planning CRUD, settings, host restart and pairing persistence. OBS is simulated.');
} finally {
  await browser?.close(); await host?.stop();
  for (const socket of obs.clients) socket.terminate();
  await new Promise(resolve => obs.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
