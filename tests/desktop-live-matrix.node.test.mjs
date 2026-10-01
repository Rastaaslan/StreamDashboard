import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
import { WebSocketServer } from 'ws';
import { createMobileFixture } from '../apps/mobile/dev-fixtures.js';

test('Desktop Live runtime matrix: HTTP controls, custom scenes, confirmations and WS drafts', async () => {
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = pathname.startsWith('/mobile/') ? `apps${pathname}` : `apps/web${pathname === '/preview/' ? '/preview/index.html' : pathname}`;
    try { res.setHeader('content-type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : 'text/html'); res.end(await readFile(file)); }
    catch { res.writeHead(404).end(); }
  });
  const sockets = new WebSocketServer({ server, path: '/ws/v1' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    const page = await browser.newPage(); page.setDefaultTimeout(5000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const data = createMobileFixture('live'); const state = data.state;
    for(let i=0;i<7;i++){const name=`Extra ${i}`;state.obs.inputs[name]={muted:false,volume:0.5};state.obs.activeAudioInputs.push(name)}
    state.obs.streamingKnown = true; state.obs.mediaInputs = ['Jingle']; state.obs.browserInputs = ['Overlay'];
    state.obs.scenes.push('Custom OBS'); state.google = { configured: false };
    state.twitch.capabilities = { chatWrite: true, updateChannel: true, createClip: true };
    const commands = [], writes = [];
    await page.route('**/api/**', route => route.fulfill({ json: {} }));
    await page.goto(`http://127.0.0.1:${server.address().port}/preview/`);
    await page.waitForFunction(() => window.__preview);
    const profile = await page.evaluate(() => window.__preview.state.productProfile);
    profile.obs.scenes = [{ label: 'Custom', scene: 'Custom OBS' }];
    profile.obs.quickActions = ['mute-main','clip'];
    let holdRefresh = false, releaseRefresh, refreshStarted;
    const refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
    const refreshPending = new Promise(resolve => { refreshStarted = resolve; });
    await page.route('**/api/v1/state', async route => {
      if (holdRefresh) { refreshStarted(); await refreshGate; }
      await route.fulfill({ json: state });
    });
    await page.route('**/api/v1/profile', route => route.fulfill({ json: { profile } }));
    await page.route('**/api/v1/soundboard', route => route.fulfill({ json: data.soundboard }));
    await page.route('**/api/v1/soundboard/obs/status', route => route.fulfill({ json: { connected: true, inputExists: true, attachedScenes: state.obs.scenes } }));
    await page.route('**/api/v1/twitch/categories?*', route => route.fulfill({ json: [{ id: '42', name: 'Test Category' }] }));
    await page.route('**/api/v1/commands', async route => {
      const value = route.request().postDataJSON(); commands.push(value);
      if (value.type === 'session.stop') { state.obs.streaming = false; state.controlHub.live.isLive = false; }
      if (value.type === 'session.start') { state.obs.streaming = true; state.controlHub.live.isLive = true; }
      if (value.type === 'obs.mute') state.obs.inputs.Mic.muted = value.muted;
      if (value.type === 'timer.start') state.timer.running = true;
      if (value.type === 'timer.pause' || value.type === 'timer.reset') state.timer.running = false;
      await route.fulfill({ json: { ok: true, state } });
    });
    for (const path of ['/twitch/chat/messages','/twitch/channel','/twitch/clips','/soundboard/play','/soundboard/stop']) {
      await page.route(`**/api/v1${path}`, async route => {
        writes.push({ path, body: route.request().postDataJSON() });
        if (path === '/soundboard/play') data.soundboard.currentPlayback = { soundId: 'bonk' };
        await route.fulfill({ json: path === '/soundboard/play' ? { status: 'succeeded' } : path === '/soundboard/stop' ? data.soundboard : state });
      });
    }
    await page.locator('#mode').click();
    await expect(page.locator('#runtime-status')).toHaveText('Runtime PC');
    await page.locator('[data-view="live"]').click();
    page.once('dialog', dialog => dialog.dismiss());
    await page.locator('[data-live-toggle]').click();
    assert.equal(commands.length, 0, 'cancelled stop sends nothing');
    page.on('dialog', dialog => dialog.accept());
    await page.locator('[data-live-toggle]').click();
    await expect.poll(() => commands.map(c => c.type)).toEqual(['session.stop']);
    await expect(page.locator('[data-live-toggle]')).toContainText('Démarrer');
    await page.locator('[data-live-toggle]').click();
    await expect.poll(() => commands.map(c => c.type)).toEqual(['session.stop','session.prepare','session.start']);
    await expect(page.locator('.audio-row')).toHaveCount(state.obs.activeAudioInputs.length);
    for(const label of ['Intro','Gameplay','Chatting','Pause','Fin'])await expect(page.locator(`[data-scene="${label}"]`)).toBeVisible();
    await page.locator('[data-audio-volume="Extra 6"]').fill('25');
    await page.locator('[data-audio-volume="Extra 6"]').dispatchEvent('change');
    await expect.poll(()=>commands.at(-1)).toMatchObject({type:'obs.volume',input:'Extra 6',volume:0.25});
    const volumeSlider=page.locator('[data-audio-volume="Extra 6"]');
    await volumeSlider.focus();const volumeNode=await volumeSlider.elementHandle();
    state.obs.inputs['Late source']={muted:false,volume:0.75};state.obs.activeAudioInputs.push('Late source');
    for(const socket of sockets.clients)socket.send(JSON.stringify({type:'state.updated',data:state}));
    await expect(page.locator('[data-audio-volume="Late source"]')).toBeVisible();
    await expect(volumeSlider).toBeFocused();
    assert.equal(await volumeNode.evaluate(node=>node.isConnected),true);
    const custom = page.locator('[data-scene="Custom"]');
    const customNode = await custom.elementHandle();
    await custom.hover(); await page.mouse.down();
    state.controlHub.audience.viewerCount = 18;
    for (const socket of sockets.clients) socket.send(JSON.stringify({ type: 'state.updated', data: state }));
    await expect(page.locator('.live-chat-panel .section-head .label')).toContainText('18 viewers');
    assert.equal(await customNode.evaluate(node => node.isConnected), true);
    await page.mouse.up();
    await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'obs.scene', scene: 'Custom OBS' });
    assert.equal(commands.filter(command => command.type === 'obs.scene').length, 1);
    // Return to the default mode mapping after verifying the ProductProfile override.
    profile.obs.scenes = [];
    await page.evaluate(() => { window.__preview.state.productProfile.obs.scenes = []; });
    await page.locator('[data-view="live"]').click();
    for (const [scene,type,mode] of [['Intro','mode.set','intro'],['Gameplay','mode.set','live'],['Chatting','scene.chatting'],['Pause','mode.set','pause'],['Fin','mode.set','end']]) {
      await page.locator(`[data-scene="${scene}"]`).click();
      await expect.poll(() => commands.at(-1)).toMatchObject({ type, ...(mode ? { mode } : {}) });
    }
    for (const muted of [true,false]) {
      await page.locator('[data-profile-quick-action="mute-main"]').click();
      await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'obs.mute', input: 'Mic', muted });
      await expect(page.locator('[data-mute="Mic"]')).toHaveText(muted ? 'OFF' : 'ON');
    }
    for (const [control,type,seconds] of [['toggle','timer.start'],['toggle','timer.pause'],['plus','timer.add',60],['minus','timer.add',-60],['reset','timer.reset']]) {
      if (control === 'reset') holdRefresh = true;
      const count = commands.length;
      await page.locator(`[data-timer="${control}"]`).click();
      await expect.poll(() => commands.length).toBe(count + 1);
      assert.equal(commands.at(-1).type, type);
      if (seconds) assert.equal(commands.at(-1).seconds, seconds);
      if (type === 'timer.start') await expect(page.locator('[data-timer="toggle"]')).toContainText('Pause');
    }
    await refreshPending;
    const chat = page.locator('#desktop-chat-form input');
    await chat.fill('Live matrix'); await chat.focus();
    const chatNode = await chat.elementHandle();
    // A late HTTP refresh after a timer command must preserve the new chat draft.
    state.timer.remaining = 177;
    releaseRefresh();
    await page.waitForFunction(() => window.__preview.state.seconds === 177);
    await expect(chat).toHaveValue('Live matrix'); await expect(chat).toBeFocused();
    assert.equal(await chatNode.evaluate(el => el === document.querySelector('#desktop-chat-form input')), true);
    await page.locator('#desktop-chat-form button').click();
    await expect.poll(() => writes.at(-1)).toMatchObject({ path: '/twitch/chat/messages', body: { message: 'Live matrix' } });
    await page.locator('[data-live-clip]').click();
    await expect.poll(() => writes.at(-1)?.path).toBe('/twitch/clips');
    await page.locator('.live-twitch-settings summary').click();
    const title = page.locator('#live-twitch-settings [name="title"]');
    await title.fill('Draft title'); await title.focus();
    for (const count of [19,21,25]) {
      state.controlHub.audience.viewerCount = count;
      for (const socket of sockets.clients) socket.send(JSON.stringify({ type: 'state.updated', data: state }));
      await expect(page.locator('.live-chat-panel .section-head .label')).toContainText(`${count} viewers`);
      await expect(title).toBeFocused(); await expect(title).toHaveValue('Draft title');
    }
    // A draft remains a draft after focus leaves the editor, across every update.
    await chat.fill('Unsent chat draft');
    await title.evaluate(input => input.blur());
    await chat.evaluate(input => input.blur());
    await expect(title).toHaveValue('Draft title');
    for (const count of [26,27]) {
      state.controlHub.audience.viewerCount = count;
      for (const socket of sockets.clients) socket.send(JSON.stringify({ type: 'state.updated', data: state }));
      await expect(page.locator('.live-chat-panel .section-head .label')).toContainText(`${count} viewers`);
      await expect(title).toHaveValue('Draft title');
      await expect(chat).toHaveValue('Unsent chat draft');
    }
    let releaseLate, markLate;
    const lateGate = new Promise(resolve => { releaseLate = resolve; });
    const lateStarted = new Promise(resolve => { markLate = resolve; });
    await page.route('**/api/v1/state', async route => { markLate(); await lateGate; await route.fulfill({ json: state }); });
    await page.locator('[data-timer="plus"]').click();
    await lateStarted;
    await page.locator('[data-timer="plus"]').evaluate(button => button.blur());
    state.timer.remaining = 188;
    releaseLate();
    await page.waitForFunction(() => window.__preview.state.seconds === 188);
    await expect(title).toHaveValue('Draft title');
    await expect(chat).toHaveValue('Unsent chat draft');
    await page.locator('#live-twitch-category').fill('Test');
    await page.locator('[data-live-twitch-category-search]').click();
    await page.locator('#live-twitch-category-results').selectOption('42');
    await page.locator('#live-twitch-settings button[type="submit"], #live-twitch-settings button.action').click();
    await expect.poll(() => writes.at(-1)).toMatchObject({ path: '/twitch/channel', body: { title: 'Draft title', gameId: '42' } });
    await page.locator('[data-view="camp"]').click();
    await page.locator('[data-camp="Médias OBS"]').click();
    await page.locator('[data-media-restart="Jingle"]').click();
    await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'obs.media.restart', input: 'Jingle' });
    await page.locator('[data-browser-refresh="Overlay"]').click();
    await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'obs.browser.refresh', input: 'Overlay' });
    await page.locator('[data-view="sounds"]').click();
    await page.locator('[data-sound="bonk"]').click();
    await expect.poll(() => writes.at(-1)?.path).toBe('/soundboard/play');
    await page.locator('[data-stop]').click();
    await expect.poll(() => writes.at(-1)?.path).toBe('/soundboard/stop');
    await page.locator('[data-view="live"]').click();
    delete state.obs.inputs.Mic;
    state.obs.activeAudioInputs=state.obs.activeAudioInputs.filter(name=>name!=='Mic');
    for(const socket of sockets.clients)socket.send(JSON.stringify({type:'state.updated',data:state}));
    await expect(page.locator('[data-audio-name="Mic"]')).toContainText('principal · absent');
    await expect(page.locator('[data-mute="Mic"]')).toBeDisabled();
    await expect(page.locator('[data-audio-volume="Mic"]')).toBeDisabled();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); for (const client of sockets.clients) client.terminate();
    await new Promise(resolve => sockets.close(resolve)); await new Promise(resolve => server.close(resolve));
  }
});
