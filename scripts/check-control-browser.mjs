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
    if (requestType === 'SetCurrentProgramScene') { scene = requestData.sceneName; sceneCalls++; socket.send(encode({op:5,d:{eventType:'CurrentProgramSceneChanged',eventIntent:4,eventData:{sceneName:scene}}})); }
    const responses = {
      GetVersion: { obsVersion: '31', obsWebSocketVersion: '5' },
      GetOutputList: { outputs: [] },
      CallVendorRequest: { responseData: requestData?.requestType === 'version' ? { success:true, version:'1.2.4' } : { success:true, outputs:[{name:'YouTube horizontal',type:'stream',active:false}] } },
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
  // Embed documents are simulated; exercise real DOM lifecycle, CSP and URL routing.
  // Never request a public stream or put a fixture broadcast into persisted settings.
  assert.equal((await api('/api/v2/state')).host.monitor.twitchLogin, '');
  await expect(desktop.locator('[data-monitor-slot="youtube"]')).toContainText('Choisissez la diffusion');
  let monitorPolls = 0, fixtureVideo = 'abcdefghijk';
  const embedLoads = [];
  await desktop.route(/https:\/\/(player\.twitch\.tv|www\.twitch\.tv|www\.youtube\.com)\//, async route => {
    embedLoads.push(route.request().url());
    assert.equal(route.request().headers().authorization, undefined);
    assert.ok(route.request().headers().referer, 'Embeds need a Referer');
    await route.fulfill({contentType:'text/html', body:'<!doctype html><title>Embed fixture</title><label>Draft <input id="draft"></label>'});
  });
  await desktop.route('**/api/v2/state', async route => {
    const response = await route.fetch();
    const value = await response.json();
    value.host.monitor = {twitchLogin:'twitchdev'};
    value.configuration.youtube.broadcastId = fixtureVideo;
    monitorPolls++;
    await route.fulfill({response, json:value});
  });
  const twitchChat = desktop.frameLocator('[data-monitor-slot="twitch"] iframe');
  const youtubeChat = desktop.frameLocator('[data-monitor-slot="youtube"] iframe');
  await expect(twitchChat.locator('#draft')).toBeVisible();
  await twitchChat.locator('#draft').fill('Brouillon Twitch conservé');
  await youtubeChat.locator('#draft').fill('Brouillon YouTube conservé');
  await desktop.locator('[data-action="scene-pause"]').click(); // Forces a busy + result redraw.
  await expect.poll(() => monitorPolls, {timeout:15000}).toBeGreaterThan(3);
  assert.equal(embedLoads.length, 3, 'Polling and actions must not reload the player or chats');
  await expect(twitchChat.locator('#draft')).toHaveValue('Brouillon Twitch conservé');
  await expect(youtubeChat.locator('#draft')).toHaveValue('Brouillon YouTube conservé');
  await desktop.locator('[data-monitor-source="youtube"]').click();
  await expect.poll(() => embedLoads.length).toBe(4);
  await expect(youtubeChat.locator('#draft')).toHaveValue('Brouillon YouTube conservé');
  fixtureVideo = 'lmnopqrstuv';
  await expect(desktop.locator('[data-monitor-slot="youtube"] iframe')).toHaveAttribute('src', /v=lmnopqrstuv/);
  await expect(desktop.locator('[data-monitor-slot="video"] iframe')).toHaveAttribute('src', /embed\/lmnopqrstuv/);
  await expect(twitchChat.locator('#draft')).toHaveValue('Brouillon Twitch conservé');
  await desktop.locator('[data-monitor-toggle]').click();
  await expect(desktop.locator('#live-monitor iframe')).toHaveCount(0);
  await desktop.locator('[data-monitor-toggle]').click();
  await expect(desktop.locator('#live-monitor iframe')).toHaveCount(3);
  const playerUrl = new URL(embedLoads.find(url => url.startsWith('https://player.twitch.tv')));
  assert.equal(playerUrl.searchParams.get('muted'), 'true');
  assert.equal(playerUrl.searchParams.get('parent'), new URL(host.url).hostname);
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
  await phone.locator('[data-tab="devices"]').click();
  await expect(phone.locator('tr').filter({hasText:'Hôte'})).toContainText('FIXE');
  await expect(phone.locator('tr').filter({hasText:'Pilotage'})).toContainText('laptop-damien');
  await phone.locator('[data-tab="platforms"]').click();
  await phone.locator('[data-task="outputs"]').click();
  await expect(phone.locator('#output-list')).toContainText('Aitum Stream Suite 1.2.4');
  await phone.locator('[data-suite-output="YouTube horizontal"][data-platform="youtube"]').click();
  await phone.locator('#platform-form button:not([type="button"])').click();
  await expect.poll(async () => (await api('/api/v2/state')).configuration.outputs.youtube).toEqual({kind:'aitum-suite',name:'YouTube horizontal'});
  await phone.locator('[data-tab="profile"]').click();
  await phone.locator('[name="streamerName"]').fill('Configuration partagée');
  await phone.locator('#profile-settings button').click();
  await expect.poll(async () => (await api('/api/v2/state')).host.settings.streamerName).toBe('Configuration partagée');
  await browser.close(); browser = undefined;
  await host.stop(); host = await startDashboardServer(options);
  state = await api('/api/v2/state');
  assert.equal(state.host.planning[0].title, 'Modifié sur téléphone');
  assert.equal(state.host.settings.streamerName, 'Configuration partagée');
  assert.deepEqual(state.configuration.outputs.youtube,{kind:'aitum-suite',name:'YouTube horizontal'});
  assert.equal(state.host.state.timer.remaining, 600);
  const response = await fetch(`http://${address}:${host.port}/api/v2/state`, { headers: { Authorization: `Device ${paired.credential}` } });
  assert.equal(response.status, 200, 'Pairing must survive host restart');
  const item = state.host.planning[0];
  await api('/api/v2/planning/' + item.id, { expectedRevision: state.host.planningRevisions[item.id] }, 'DELETE');
  assert.equal((await api('/api/v2/state')).host.planning.length, 0);
  assert.deepEqual(errors, []);
  console.log('PASS: paired LAN mobile + desktop, keyboard mic, scene, timer, shared planning CRUD, settings, host restart, pairing persistence, stable video + both chats, source switch and broadcast change. OBS and embed documents are simulated.');
} finally {
  await browser?.close(); await host?.stop();
  for (const socket of obs.clients) socket.terminate();
  await new Promise(resolve => obs.close(resolve));
  await rm(dataDir, { recursive: true, force: true });
}
