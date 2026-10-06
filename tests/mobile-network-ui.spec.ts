import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import { type Server } from 'node:http';
import path from 'node:path';
import { createMobileFixture } from '../apps/mobile/dev-fixtures.js';

let server: Server;
let origin: string;
test.beforeAll(async () => {
  const app = express();
  app.use('/mobile', express.static(path.resolve('apps/mobile')));
  server = await new Promise<Server>(resolve => { const value = app.listen(0, '127.0.0.1', () => resolve(value)); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function setup(page: Page, obs = { connected: true, streamingKnown: true }, holdSocket = false) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = { state: { ...createMobileFixture('live').state, serverInstanceId: 'desktop-first', stateRevision: 100 }, unavailable: false, status: 200, ticketStatus: 201, stateCalls: 0, calls: [] as { url: string; auth: string | undefined }[] };
  Object.assign(backend.state.obs, { ...obs, connectionStatus: obs.connected ? 'connected' : 'offline' });
  await page.clock.install();
  await page.addInitScript(holdSocket => {
    const win = window as any;
    if (!localStorage.getItem('test-initialized')) {
      localStorage.setItem('test-initialized', 'yes');
      localStorage.setItem('native-credential', 'persistent-device-credential');
      localStorage.setItem('streamdashboard.server', 'http://192.168.1.10:48132');
    }
    win.StreamDashboardNative = {
      isAndroid: () => true,
      getCredential: () => localStorage.getItem('native-credential'),
      setCredential: (value: string) => localStorage.setItem('native-credential', value),
      clearCredential: () => localStorage.removeItem('native-credential'),
    };
    win.sockets = [];
    win.WebSocket = class {
      readyState = 0;
      onopen: any; onmessage: any; onclose: any; onerror: any;
      constructor(public url: string) {
        win.sockets.push(this);
        queueMicrotask(() => { if (!holdSocket && this.readyState !== 3) { this.readyState = 1; this.onopen?.(); } });
      }
      close() { this.readyState = 3; this.onclose?.(); }
    };
  }, holdSocket);
  await page.route('**/api/v1/**', async route => {
    const request = route.request();
    backend.calls.push({ url: request.url(), auth: request.headers().authorization });
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith('/state')) {
      backend.stateCalls++;
      if (backend.unavailable) { await route.abort(); return; }
      await route.fulfill({ status: backend.status, json: backend.status === 200 ? backend.state : { error: { message: 'Non autorisé' } } });
    } else if (pathname.endsWith('/ws-ticket')) {
      await route.fulfill({ status: backend.ticketStatus, json: { ticket: 'single-use-ticket' } });
    } else if (pathname.endsWith('/capabilities')) {
      await route.fulfill({ json: { serverVersion: 'test', features: [] } });
    } else { await route.fulfill({ json: {} }); }
  });
  await page.goto(`${origin}/mobile/index.html`);
  await expect(page.locator('#pc')).toHaveText('Connecté');
  await expect.poll(() => page.evaluate(() => (window as any).sockets.length)).toBe(1);
  return { backend, errors };
}
const nativeCredential = (page: Page) => page.evaluate(() => localStorage.getItem('native-credential'));

test('shipped Android address recovery uses no pairing code and persists the existing credential', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.locator('[data-tab="more"]').click();
  // Use the shipped connection navigation, not preview.html or an internal function.
  await page.getByRole('button', { name: 'Comptes connectés' }).click();
  await expect(page.getByRole('button', { name: 'Oublier cette télécommande' })).toBeVisible();
  await page.getByRole('button', { name: 'Modifier l’adresse du PC' }).click();
  await page.locator('#pair-server').fill('192.168.2.20:48132');
  // A heartbeat/telemetry update must leave the recovery form and typed address intact.
  await page.clock.fastForward(10_000);
  await expect(page.locator('#pair-server')).toHaveValue('192.168.2.20:48132');
  await expect(page.locator('#pair-id')).toHaveValue('');
  await expect(page.locator('#pair-code')).toHaveValue('');
  await page.getByRole('button', { name: 'Reconnexion à cette adresse' }).click();
  await expect(page.locator('#pc')).toHaveText('Connecté');
  await expect.poll(() => backend.calls.some(call => call.url === 'http://192.168.2.20:48132/api/v1/state' && call.auth === 'Device persistent-device-credential')).toBe(true);
  expect(backend.calls.some(call => call.url.endsWith('/remote/pair'))).toBe(false);
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  await page.reload();
  await expect(page.locator('#pc')).toHaveText('Connecté');
  expect(await page.evaluate(() => localStorage.getItem('streamdashboard.server'))).toBe('http://192.168.2.20:48132');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(errors).toEqual([]);
});

test('silent network loss is detected by HTTP and automatically recovers after Desktop restart', async ({ page }) => {
  const { backend, errors } = await setup(page);
  backend.unavailable = true;
  await page.clock.fastForward(10_000);
  await expect(page.locator('#pc')).toHaveText('Hors ligne');
  await expect(page.locator('#obs')).toHaveText('Déconnecté');
  await expect(page.locator('#stream')).toBeDisabled();
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(await page.evaluate(() => (window as any).sockets[0].readyState)).toBe(3);
  backend.unavailable = false;
  backend.state = { ...backend.state, serverInstanceId: 'desktop-restarted', stateRevision: 0, obs: { ...backend.state.obs, connected: true, streaming: false } };
  await page.clock.fastForward(1000);
  await expect(page.locator('#pc')).toHaveText('Connecté');
  await expect(page.locator('#obs')).toHaveText('Connecté');
  await expect(page.locator('#stream')).toHaveText('DÉMARRER LE LIVE');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(errors).toEqual([]);
});

test('concurrent reconnect events close old sockets and ignore delayed responses and callbacks', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.evaluate(() => { const w = window as any; const old = w.sockets[0]; w.stale = { message: old.onmessage, close: old.onclose, error: old.onerror }; });
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  await page.route('**/api/v1/state', async route => {
    if (!held) { held = true; await gate; await route.fulfill({ status: 401, json: {} }); }
    else await route.fulfill({ json: backend.state });
  });
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => held).toBe(true);
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new Event('online')); });
  await expect.poll(() => page.evaluate(() => (window as any).sockets.length)).toBe(2);
  release();
  await page.evaluate(() => {
    const w = window as any;
    w.stale.message({ data: JSON.stringify({ type: 'state.updated', data: { obs: { connected: false } } }) });
    w.stale.close(); w.stale.error();
  });
  await page.clock.fastForward(1000);
  await expect(page.locator('#pc')).toHaveText('Connecté');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  expect(await page.evaluate(() => (window as any).sockets.filter((socket: any) => socket.readyState === 1).length)).toBe(1);
  expect(errors).toEqual([]);
});

test('HTTP fallback stays usable, 403 preserves credentials, and revocation clears native storage', async ({ page }) => {
  const { backend, errors } = await setup(page);
  backend.ticketStatus = 503;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#connection')).toContainText('temps réel indisponible');
  await expect(page.locator('#stream')).toBeEnabled();
  backend.status = 403;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#pc')).toHaveText('Hors ligne');
  expect(await nativeCredential(page)).toBe('persistent-device-credential');
  backend.status = 401;
  await page.clock.fastForward(2000);
  await expect(page.locator('#pairing')).toBeVisible();
  await expect.poll(() => nativeCredential(page)).toBeNull();
  const calls = backend.stateCalls;
  await page.clock.fastForward(30_000);
  expect(backend.stateCalls).toBe(calls);
  expect(errors).toEqual([]);
});

for (const restart of ['online event', 'HTTP heartbeat']) {
  test(`late command response cannot restore the old Desktop state after ${restart}`, async ({ page }) => {
    const { backend, errors } = await setup(page);
    const oldState = structuredClone(backend.state);
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let commandHeld = false;
    let responseSent = false;
    await page.route('**/api/v1/commands', async route => {
      commandHeld = true;
      await gate;
      await route.fulfill({ json: { state: oldState } });
      responseSent = true;
    });
    page.on('dialog', dialog => dialog.accept());
    await page.locator('#stream').click();
    await expect.poll(() => commandHeld).toBe(true);
    backend.state = { ...backend.state, serverInstanceId: 'new-desktop', stateRevision: 0, obs: { ...backend.state.obs, streaming: false } };
    if (restart === 'online event') await page.evaluate(() => window.dispatchEvent(new Event('online')));
    else await page.clock.fastForward(10_000);
    await expect(page.locator('#stream')).toHaveText('DÉMARRER LE LIVE');
    await expect(page.locator('#pc')).toHaveText('Connecté');
    release();
    await expect.poll(() => responseSent).toBe(true);
    // Drain the released fetch and its UI continuations before checking state.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator('#stream')).toHaveText('DÉMARRER LE LIVE');
    await expect(page.locator('#stream')).toBeEnabled();
    await expect(page.locator('#obs')).toHaveText('Connecté');
    expect(await nativeCredential(page)).toBe('persistent-device-credential');
    expect(errors).toEqual([]);
  });
}

for (const connected of [false, true]) {
  test(`stream guards survive HTTP, WebSocket and heartbeat with OBS connected=${connected} but unknown`, async ({ page }) => {
    const { backend, errors } = await setup(page, { connected, streamingKnown: false }, true);
    const guarded = async (disabled: boolean) => {
      for (const id of ['stream', 'live-stream']) {
        if (disabled) await expect(page.locator('#' + id)).toBeDisabled();
        else await expect(page.locator('#' + id)).toBeEnabled();
      }
    };
    // The real HTTP bootstrap has rendered and applied connection-mode guards.
    await guarded(true);
    await page.evaluate(() => { const socket = (window as any).sockets[0]; socket.readyState = 1; socket.onopen(); });
    await guarded(true);
    await page.evaluate(() => {
      const win = window as any;
      win.renderCount = 0;
      window.addEventListener('mobile-state-updated', () => { win.renderCount++; });
    });
    const calls = backend.stateCalls;
    await page.clock.fastForward(10_000);
    await expect.poll(() => backend.stateCalls).toBeGreaterThan(calls);
    await expect.poll(() => page.evaluate(() => (window as any).renderCount)).toBeGreaterThan(0);
    await guarded(true);
    Object.assign(backend.state.obs, { connected: true, streamingKnown: true, streaming: false });
    await page.clock.fastForward(10_000);
    await guarded(false);
    // Telemetry loss must close both controls again even while the PC stays online.
    Object.assign(backend.state.obs, { streamingKnown: false });
    await page.evaluate(state => (window as any).sockets[0].onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
    await guarded(true);
    // Confirmed cached OBS state cannot override an unavailable PC channel.
    Object.assign(backend.state.obs, { streamingKnown: true });
    await page.clock.fastForward(10_000);
    await guarded(false);
    backend.unavailable = true;
    await page.clock.fastForward(10_000);
    await expect(page.locator('#pc')).toHaveText('Hors ligne');
    await guarded(true);
    expect(backend.calls.filter(call => call.url.endsWith('/commands'))).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('Live HTTP matrix: confirmation, modes, mic, timer, Twitch, media and Soundboard without WS', async ({ page }) => {
  const { backend, errors } = await setup(page, { connected: true, streamingKnown: true }, true);
  backend.ticketStatus = 503;
  backend.state.obs.mediaInputs = ['Jingle'];
  const commands: any[] = [];
  const writes: { path: string; body: any }[] = [];
  const board = { ...createMobileFixture('live').soundboard, supportsStop: true, currentPlayback: null as null | { soundId: string } };
  await page.route('**/api/v1/twitch/moderation/capabilities', route => route.fulfill({ json: { chatWrite: true, updateChannel: true, createClip: true, chatters: true, deleteMessage: true, timeout: true, ban: true } }));
  await page.route('**/api/v1/soundboard', route => route.fulfill({ json: board }));
  await page.route('**/api/v1/twitch/categories?*', route => route.fulfill({ json: [{ id: '42', name: 'Test Category' }] }));
  await page.route('**/api/v1/commands', async route => {
    const command = route.request().postDataJSON(); commands.push(command);
    backend.state.stateRevision++;
    if (command.type === 'session.stop') backend.state.obs.streaming = false;
    if (command.type === 'session.start') backend.state.obs.streaming = true;
    if (command.type === 'obs.mute') backend.state.obs.inputs.Mic.muted = command.muted;
    await route.fulfill({ json: { ok: true, state: backend.state } });
  });
  for (const path of ['/twitch/chat/messages', '/twitch/channel', '/twitch/clips', '/soundboard/play', '/soundboard/stop']) {
    await page.route(`**/api/v1${path}`, async route => {
      writes.push({ path, body: route.request().postDataJSON() });
      if (path === '/soundboard/play') board.currentPlayback = { soundId: 'bonk' };
      if (path === '/soundboard/stop') board.currentPlayback = null;
      if (path === '/twitch/channel') Object.assign(backend.state.twitch, { channelTitle: writes.at(-1)!.body.title, gameId: writes.at(-1)!.body.gameId, gameName: writes.at(-1)!.body.gameName });
      await route.fulfill({ json: path === '/soundboard/play' ? { status: 'succeeded' } : path === '/soundboard/stop' ? board : backend.state });
    });
  }
  await page.reload();
  await expect(page.locator('#pc')).toHaveText('Connecté');
  await page.locator('[data-tab="live"]').click();
  await expect(page.locator('#hub-chat')).toContainText('mdrrrr');
  await expect(page.locator('#live-viewers')).toHaveText('17');
  page.once('dialog', dialog => dialog.dismiss());
  await page.locator('#live-stream').click();
  expect(commands).toHaveLength(0);
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#live-stream').click();
  await expect.poll(() => commands.map(c => c.type)).toEqual(['session.stop']);
  await expect(page.locator('#live-stream')).toContainText(/démarrer/i);
  await page.locator('#live-stream').click();
  await expect.poll(() => commands.map(c => c.type)).toEqual(['session.stop','session.prepare','session.start']);
  for (const mode of ['intro','live','chatting','pause','end']) {
    await page.locator('#open-scenes-live').click();
    await page.locator(mode === 'chatting' ? '[data-chatting]' : `[data-mode="${mode}"]`).click();
    await expect.poll(() => commands.at(-1)).toMatchObject(mode === 'chatting' ? { type: 'scene.chatting' } : { type: 'mode.set', mode });
    if (await page.locator('#live-tools-sheet').evaluate(el => (el as HTMLDialogElement).open)) await page.locator('#close-live-tool').click();
  }
  for (const muted of [true,false]) {
    await page.locator('#quick-mic').click();
    await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'obs.mute', input: 'Mic', muted });
    await expect(page.locator('#quick-mic')).toBeEnabled();
  }
  await page.locator('[data-open-live-tool="timer"]').click();
  for (const type of ['timer.start','timer.pause','timer.add','timer.reset']) {
    await page.locator(`[data-command="${type}"]${type === 'timer.add' ? '[data-seconds="60"]' : ''}`).click();
    await expect.poll(() => commands.at(-1)).toMatchObject({ type, ...(type === 'timer.add' ? { seconds: 60 } : {}) });
  }
  await page.locator('#close-live-tool').click();
  await page.locator('#chat-message').fill('Live matrix');
  await page.locator('#chat-form button').click();
  await expect.poll(() => writes.at(-1)).toMatchObject({ path: '/twitch/chat/messages', body: { message: 'Live matrix' } });
  await page.locator('#live-clip').click();
  await expect.poll(() => writes.at(-1)?.path).toBe('/twitch/clips');
  await page.locator('[data-open-live-tool="twitch"]').click();
  await page.locator('#twitch-title').fill('Live matrix title');
  await page.locator('#twitch-category').fill('Test');
  await page.clock.runFor(350);
  await expect(page.locator('#twitch-results')).toContainText('Test Category');
  backend.state.stateRevision++; backend.state.controlHub.audience.viewerCount = 41;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#live-viewers')).toHaveText('41');
  await expect(page.locator('#twitch-title')).toHaveValue('Live matrix title');
  await expect(page.locator('#twitch-category')).toBeFocused();
  await page.locator('#twitch-results [data-game-id="42"]').click();
  backend.state.stateRevision++; backend.state.controlHub.audience.viewerCount = 42;
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.locator('#live-viewers')).toHaveText('42');
  await expect(page.locator('#twitch-game-id')).toHaveValue('42');
  let navigations = 0; page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations++; });
  await page.locator('#save-twitch').click();
  await expect.poll(() => writes.at(-1)).toMatchObject({ path: '/twitch/channel', body: { title: 'Live matrix title', gameId: '42' } });
  if (await page.locator('#live-tools-sheet').evaluate(el => (el as HTMLDialogElement).open)) await page.locator('#close-live-tool').click();
  await page.locator('[data-open-live-tool="media"]').click();
  await page.locator('[data-media="Jingle"]').click();
  await expect.poll(() => commands.at(-1)).toMatchObject({ type: 'obs.media.restart', input: 'Jingle' });
  await page.locator('#close-live-tool').click();
  await page.locator('[data-tab="sounds"]').click();
  await page.locator('#sound-grid .sound-pad').filter({ hasText: 'BONK' }).click();
  await expect.poll(() => writes.at(-1)?.path).toBe('/soundboard/play');
  await page.locator('#stop-sound').click();
  await expect.poll(() => writes.at(-1)?.path).toBe('/soundboard/stop');
  await expect(page.locator('.bottom-nav [data-tab]:visible small')).toHaveText(['Accueil','Live','Sons','Planning','Plus']);
  expect(navigations).toBe(0);
  expect(errors).toEqual([]);
});

test('retrying unavailable WS tickets preserves an in-flight HTTP command on the same PC', async ({ page }) => {
  const { backend, errors } = await setup(page);
  backend.ticketStatus = 503;
  await page.reload();
  await expect(page.locator('#connection')).toContainText('temps réel indisponible');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/v1/commands', async route => {
    requests++;
    await gate;
    backend.state.stateRevision++;
    backend.state.obs.streaming = false;
    await route.fulfill({ json: { state: backend.state } });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.locator('#stream').click();
  await expect.poll(() => requests).toBe(1);
  const reads = backend.stateCalls;
  await page.clock.runFor(600);
  await expect.poll(() => backend.stateCalls).toBeGreaterThan(reads);
  await expect(page.locator('#connection')).toContainText('temps réel indisponible');
  release();
  await expect(page.locator('#stream')).toContainText(/démarrer/i);
  expect(requests).toBe(1);
  expect(errors).toEqual([]);
});

test('CB-52 mobile keeps newer chat draft, audio DOM, Sounds selection, Focus and inline timer', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.route('**/api/v1/twitch/moderation/capabilities', route => route.fulfill({ json: { chatWrite: true } }));
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let sent = false;
  await page.route('**/api/v1/twitch/chat/messages', async route => { sent = true; await gate; await route.fulfill({ json: { ok: true } }); });
  await page.locator('[data-tab="live"]').click();
  await page.locator('#chat-message').fill('Premier message'); await page.locator('#chat-form button').click();
  await expect.poll(() => sent).toBe(true);
  await page.locator('#chat-message').fill('Brouillon suivant'); release();
  await expect(page.locator('#chat-message')).toHaveValue('Brouillon suivant');
  const commands: any[] = [];
  await page.route('**/api/v1/commands', async route => { commands.push(route.request().postDataJSON()); await route.fulfill({ json: { ok: true, state: backend.state } }); });
  await expect(page.locator('#live-timer-value')).toBeVisible(); await page.locator('#live-timer-add').click();
  await expect.poll(() => commands.at(-1)?.type).toBe('timer.add');
  await page.locator('[data-open-live-tool="audio"]').click();
  const slider = page.locator('#audio [data-volume="Mic"]'); await slider.focus(); const original = await slider.elementHandle();
  await slider.fill('-12');
  backend.state.stateRevision++;
  backend.state.obs.inputs.Mic.volumeDb = -30;
  await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
  await expect(slider).toBeFocused(); await expect(slider).toHaveValue('-12');
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await page.locator('#live-tools-sheet').evaluate((node: HTMLDialogElement) => node.close());
  await page.locator('[data-tab="sounds"]').click();
  await expect(page.locator('[data-tab="sounds"]')).toHaveClass(/active/);
  await expect(page.locator('[data-tab="more"]')).not.toHaveClass(/active/);
  await page.locator('[data-tab="more"]').click();
  await page.locator('[data-settings-target="preferences"]').click();
  await page.locator('#focus-mode').check();
  await page.locator('[data-tab="live"]').click();
  await expect(page.locator('.tool-launcher-list small').first()).toBeHidden();
  await expect(page.locator('#live-timer-add')).toBeVisible();
  expect(errors).toEqual([]);
});

test('CB-52 profile response never replaces text entered during save or periodic refresh', async ({ page }) => {
  const { errors } = await setup(page);
  const profile = { profile: { displayName: 'Serveur', channelName: 'Chaîne', language: 'fr' }, appearance: { theme: 'dark' }, modules: {} };
  await page.route('**/api/v1/profile', route => route.fulfill({ json: { profile } }));
  await page.route('**/api/v1/capabilities', route => route.fulfill({ json: { features: ['mobile-profile-presentation'] } }));
  await page.reload();
  await page.locator('[data-tab="more"]').click();
  await page.locator('[data-settings-target="profile"]').click();
  const name = page.locator('#profile-display-name');
  await expect(name).toHaveValue('Serveur');
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); let saving = false;
  await page.route('**/api/v1/profile/presentation', async route => { saving = true; await gate; await route.fulfill({ json: { profile: { ...profile, ...route.request().postDataJSON() } } }); });
  await name.fill('Première saisie');
  await page.locator('#profile-appearance-form button[type="submit"]').click();
  await expect.poll(() => saving).toBe(true);
  await name.fill('Brouillon suivant'); release();
  await expect(page.locator('#message')).toContainText('Profil et apparence enregistrés');
  await expect(name).toHaveValue('Brouillon suivant');
  await page.clock.fastForward(61_000);
  await expect(name).toHaveValue('Brouillon suivant');
  await expect(name).toBeFocused();
  expect(errors).toEqual([]);
});

test('CB-52 mobile series round trip preserves timezone and exceptions; occurrence patch carries description', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.clock.setFixedTime(new Date('2030-06-01T12:00:00Z'));
  const recurrence = { frequency:'monthly',interval:2,timeZone:'America/New_York',until:'2032-12-01T20:00:00Z',exceptions:{'2030-08-02':{cancelled:true},'2030-10-02':{patch:{title:'Exception'}}} };
  const series = {id:'series',title:'Série audit',category:'live',startAtUtc:'2030-06-02T22:30:00Z',endAtUtc:'2030-06-05T23:30:00Z',recurrence,description:'Original',desiredPublication:{twitch:false,google:false}};
  (backend.state as any).planning=[series]; backend.state.stateRevision++;
  await page.evaluate(state => (window as any).sockets.at(-1).onmessage({data:JSON.stringify({type:'state.updated',data:state})}),backend.state);
  await page.locator('[data-tab="planning"]').click();
  const row=page.getByRole('button',{name:'Ouvrir Série audit',exact:true}).first();
  await row.locator('summary').click();
  await row.getByRole('button',{name:'Modifier toute la série',exact:true}).click();
  const form=page.locator('#slot-form');
  await form.locator('[name="title"]').fill('Série modifiée');
  await form.locator('[data-open-planning-page="advanced"]').click();
  await expect(form.locator('[name="recurrence"]')).toHaveValue('monthly-2');
  let saved: any;
  await page.route('**/api/v1/planning/series',async route=>{saved=route.request().postDataJSON();Object.assign(series,saved);backend.state.stateRevision++;await route.fulfill({json:backend.state});});
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#slot-dialog')).not.toBeVisible();
  expect(saved.recurrence).toEqual(recurrence);
  expect(saved.startAtUtc).toBe('2030-06-02T22:30:00.000Z');expect(saved.endAtUtc).toBe('2030-06-05T23:30:00.000Z');
  await page.getByRole('button',{name:'Ouvrir Série modifiée',exact:true}).first().click();
  await form.locator('[name="description"]').fill('Nouvelle description occurrence');
  let patch: any;
  await page.route('**/api/v1/planning/series/occurrence',async route=>{patch=route.request().postDataJSON();backend.state.stateRevision++;await route.fulfill({json:backend.state});});
  await form.locator('button[type="submit"]').click();
  await expect(page.locator('#slot-dialog')).not.toBeVisible();
  expect(JSON.stringify(patch)).toContain('Nouvelle description occurrence');
  expect(patch.patch.desiredPublication).toMatchObject({ twitch: false, google: false });
  expect(errors).toEqual([]);
});

test('CB-127 planning refresh preserves expanded series actions and focus during click', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.clock.setFixedTime(new Date('2030-06-01T12:00:00Z'));
  const series = { id: 'race-series', title: 'Série concurrente', category: 'live', startAtUtc: '2030-06-02T22:30:00Z', endAtUtc: '2030-06-02T23:30:00Z', description: 'Original', recurrence: { frequency: 'monthly', interval: 2, timeZone: 'America/New_York', exceptions: { '2030-08-02': { cancelled: true } } } };
  const other = { id: 'other', title: 'Autre événement', category: 'live', startAtUtc: '2030-06-03T12:00:00Z', endAtUtc: '2030-06-03T13:00:00Z' };
  (backend.state as any).planning = [series, other];
  const refresh = async () => {
    backend.state.stateRevision++;
    await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
  };
  await refresh();
  await page.locator('[data-tab="planning"]').click();
  const row = page.getByRole('button', { name: 'Ouvrir Série concurrente', exact: true }).first();
  await row.locator('summary').click();
  const action = row.getByRole('button', { name: 'Modifier toute la série', exact: true });
  await action.focus();
  const original = await action.elementHandle();
  // A real HTTP heartbeat while the menu is open must preserve the actual nodes.
  const reads = backend.stateCalls;
  backend.state.controlHub.audience.viewerCount = 88;
  backend.state.stateRevision++;
  await page.clock.fastForward(10_000);
  await expect.poll(() => backend.stateCalls).toBeGreaterThan(reads);
  await expect(page.locator('#live-viewers')).toHaveText('88');
  await expect(action).toBeFocused();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  // Hold the pointer across a WS snapshot that also changes a different row.
  const box = await action.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  other.title = 'Autre événement actualisé';
  await refresh();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await expect(row.locator('details')).toHaveAttribute('open', '');
  await expect(action).toBeFocused();
  await expect(page.getByRole('button', { name: 'Ouvrir Autre événement actualisé', exact: true })).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('#slot-dialog')).toBeVisible();
  await expect(page.locator('#slot-form [name="description"]')).toHaveValue('Original');
  await page.locator('#slot-dialog').evaluate((node: HTMLDialogElement) => node.close());
  series.description = 'Description fraîche';
  series.title = 'Série actualisée';
  await refresh();
  const updated = page.getByRole('button', { name: 'Ouvrir Série actualisée', exact: true }).first();
  await updated.locator('summary').click();
  await updated.getByRole('button', { name: 'Modifier toute la série', exact: true }).click();
  await expect(page.locator('#slot-form [name="description"]')).toHaveValue('Description fraîche');
  expect(errors).toEqual([]);
});

test('CB-127 failed provider retry stays usable after unchanged refresh and succeeds on second attempt', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.clock.setFixedTime(new Date('2030-06-01T12:00:00Z'));
  const item = { id: 'retry-event', title: 'Publication à reprendre', category: 'live', startAtUtc: '2030-06-02T12:00:00Z', endAtUtc: '2030-06-02T13:00:00Z', providers: { google: { status: 'error', lastError: 'Publication échouée' } } };
  (backend.state as any).planning = [item];
  const refresh = async () => {
    backend.state.stateRevision++;
    await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
  };
  await refresh();
  await page.locator('[data-tab="planning"]').click();
  let attempts = 0;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/v1/planning/retry-event/retry/google', async route => {
    attempts++;
    if (attempts === 1) {
      await gate;
      await route.fulfill({ status: 503, json: { error: { message: 'Google temporairement indisponible' } } });
    } else {
      item.providers.google = { status: 'synced', lastError: '' };
      backend.state.stateRevision++;
      await route.fulfill({ json: backend.state });
    }
  });
  const retry = page.getByRole('button', { name: 'Réessayer Google', exact: true });
  const original = await retry.elementHandle();
  await retry.click();
  await expect.poll(() => attempts).toBe(1);
  await expect(retry).toBeDisabled();
  await refresh();
  await expect(retry).toBeDisabled();
  expect(attempts).toBe(1);
  release();
  await expect(page.locator('#message')).toContainText('Google temporairement indisponible');
  await expect(retry).toBeEnabled();
  await refresh();
  expect(await original!.evaluate(node => node.isConnected)).toBe(true);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect.poll(() => attempts).toBe(2);
  await expect(page.locator('#planning .provider-synced')).toContainText('Google');
  await expect(retry).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('CB-131 mobile deletes the canonical whole series with native confirmation and removes rows', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.clock.setFixedTime(new Date('2030-06-01T12:00:00Z'));
  const series = { id: 'delete-series', localId: 'durable-series', title: 'Série à supprimer', category: 'live', startAtUtc: '2030-06-02T19:00:00Z', endAtUtc: '2030-06-02T20:00:00Z', twitchRecurring: true, recurrence: { frequency: 'weekly', interval: 1, timeZone: 'UTC' } };
  (backend.state as any).planning = [series]; backend.state.stateRevision++;
  await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
  let deletion: any;
  await page.route('**/api/v1/planning/delete-series', async route => {
    expect(route.request().method()).toBe('DELETE'); deletion = route.request().postDataJSON();
    (backend.state as any).planning = []; backend.state.stateRevision++;
    await route.fulfill({ json: backend.state });
  });
  page.on('dialog', dialog => dialog.accept());
  await page.locator('[data-tab="planning"]').click();
  const row = page.getByRole('button', { name: 'Ouvrir Série à supprimer', exact: true }).first();
  await row.locator('summary').click();
  await row.getByRole('button', { name: 'Supprimer toute la série', exact: true }).click();
  await expect.poll(() => deletion).toEqual({ confirmRecurring: true, scope: 'series' });
  await expect(page.getByRole('button', { name: 'Ouvrir Série à supprimer', exact: true })).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('CB-131 mobile pending series shows deletion status and retry clears its row', async ({ page }) => {
  const { backend, errors } = await setup(page);
  const item = { id: 'pending-series', title: 'Suppression partielle', category: 'live', startAtUtc: '2030-06-02T19:00:00Z', endAtUtc: '2030-06-02T20:00:00Z', deletionPending: true, recurrence: { frequency: 'daily', interval: 1, timeZone: 'UTC' }, desiredPublication: { local: true, twitch: false, google: false }, providers: { google: { status: 'error', remoteId: 'remaining', lastError: 'Suppression de série en attente.' } } };
  (backend.state as any).planning = [item]; backend.state.stateRevision++;
  await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
  await page.locator('[data-tab="planning"]').click();
  const row = page.getByRole('button', { name: 'Ouvrir Suppression partielle', exact: true });
  await expect(row).toContainText('Suppression de série en attente');
  await page.route('**/api/v1/planning/pending-series/retry/google', async route => {
    (backend.state as any).planning = []; backend.state.stateRevision++;
    await route.fulfill({ json: backend.state });
  });
  page.on('dialog', dialog => dialog.accept());
  await row.getByRole('button', { name: 'Réessayer Google', exact: true }).click();
  await expect(row).toHaveCount(0);
  expect(errors).toEqual([]);
});


test.describe('CB-138 mobile recurrence editor', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: 'Europe/Paris' });

  for (const [value, label, frequency, interval, until] of [
    ['daily-1', 'Chaque jour', 'daily', 1, '2030-06-30'],
    ['daily-1', 'Chaque jour', 'daily', 1, ''],
    ['weekly-1', 'Chaque semaine', 'weekly', 1, '2030-06-30'],
    ['weekly-2', 'Toutes les 2 semaines', 'weekly', 2, '2030-06-30'],
    ['monthly-1', 'Chaque mois', 'monthly', 1, '2030-06-30'],
  ] as const) {
    test(`creates ${value} with until=${until || 'unbounded'} through the mobile API`, async ({ page }) => {
      const { backend, errors } = await setup(page);
      await page.locator('[data-tab="planning"]').click();
      await page.locator('#add-slot').click();
      const form = page.locator('#slot-form');
      await form.locator('[name="title"]').fill('Nouvelle série');
      await form.locator('[name="date"]').fill('2030-06-02');
      await form.locator('[name="start"]').fill('19:00');
      await form.locator('[name="end"]').fill('20:00');
      await form.locator('[data-open-planning-page="advanced"]').click();
      const recurrence = form.locator('[name="recurrence"]');
      await expect(recurrence).toBeVisible();
      await expect(recurrence).toBeEnabled();
      await expect(recurrence.locator('option')).toHaveText(['Aucune', 'Chaque jour', 'Chaque semaine', 'Toutes les 2 semaines', 'Chaque mois']);
      await recurrence.selectOption({ label });
      await expect(recurrence).toHaveValue(value);
      await form.locator('[name="recurrenceUntil"]').fill(until);
      // A live state refresh must preserve the selected cadence and end date.
      backend.state.stateRevision++;
      await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
      await expect(recurrence).toHaveValue(value);
      await expect(form.locator('[name="recurrenceUntil"]')).toHaveValue(until);
      let saved: any;
      await page.route('**/api/v1/planning', async route => {
        expect(route.request().method()).toBe('POST');
        saved = route.request().postDataJSON();
        await route.fulfill({ json: backend.state });
      });
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('#slot-dialog')).toBeHidden();
      expect(saved.recurrence).toEqual({ frequency, interval, timeZone: 'Europe/Paris', until: until ? '2030-06-30T21:59:59.000Z' : null });
      expect(errors).toEqual([]);
    });
  }

  test('existing daily series retains its canonical rule and can change until', async ({ page }) => {
    const { backend, errors } = await setup(page);
    await page.clock.setFixedTime(new Date('2030-06-01T12:00:00Z'));
    const recurrence = { frequency: 'daily', interval: 1, timeZone: 'America/New_York', until: '2030-06-30T20:00:00Z', exceptions: { '2030-06-04': { cancelled: true } } };
    const series = { id: 'daily-series', title: 'Série quotidienne', category: 'live', startAtUtc: '2030-06-02T19:00:00Z', endAtUtc: '2030-06-02T20:00:00Z', recurrence };
    (backend.state as any).planning = [series]; backend.state.stateRevision++;
    await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
    await page.locator('[data-tab="planning"]').click();
    const form = page.locator('#slot-form');
    const saved: any[] = [];
    await page.route('**/api/v1/planning/daily-series', async route => {
      expect(route.request().method()).toBe('PUT');
      saved.push(route.request().postDataJSON());
      Object.assign(series, saved.at(-1)); backend.state.stateRevision++;
      await route.fulfill({ json: backend.state });
    });
    for (const until of ['2030-06-30', '2030-07-10', '']) {
      const row = page.getByRole('button', { name: 'Ouvrir Série quotidienne', exact: true }).first();
      if (!(await row.locator('summary').evaluate(node => node.parentElement!.hasAttribute('open')))) await row.locator('summary').click();
      await row.getByRole('button', { name: 'Modifier toute la série', exact: true }).click();
      await form.locator('[data-open-planning-page="advanced"]').click();
      await expect(form.locator('[name="recurrence"]')).toHaveValue('daily-1');
      await expect(form.locator('[name="recurrence"] option:checked')).toHaveText('Chaque jour');
      await form.locator('[name="recurrenceUntil"]').fill(until);
      await form.locator('button[type="submit"]').click();
      await expect(page.locator('#slot-dialog')).toBeHidden();
      expect(saved.at(-1).recurrence).toEqual({ ...recurrence, until: until === '2030-06-30' ? recurrence.until : until ? '2030-07-10T21:59:59.000Z' : null });
    }
    expect(errors).toEqual([]);
  });
});

for (const width of [320, 390]) test(`Live tags edit, refresh and retry on touch at ${width}px`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width, height: 740 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const { backend, errors } = await setup(page);
    Object.assign(backend.state.twitch, { channelTitle: '', gameId: '', gameName: '', tags: ['Current'] });
    const refresh = async () => {
      backend.state.stateRevision++;
      await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
    };
    await refresh();
    await page.locator('[data-tab="live"]').tap();
    await page.locator('[data-open-live-tool="twitch"]').tap();
    await expect(page.locator('#twitch-tags')).toHaveValue('Current');
    await page.route('**/api/v1/twitch/tags/suggest', route => route.fulfill({ json: { tags: { values: ['Recommended'] }, observedSuggestions: [{ tag: 'Polluted' }] } }));
    await page.locator('#twitch-tags-regenerate').tap();
    await page.clock.runFor(1);
    await expect(page.locator('#twitch-tags-suggestions')).toContainText('Recommended');
    await expect(page.locator('#twitch-tags')).toHaveValue('Current');
    await page.locator('#twitch-tags').fill('Manual');
    await refresh();
    await expect(page.locator('#twitch-tags')).toHaveValue('Manual');
    await expect(page.locator('#twitch-tags-suggestions')).toContainText('Recommended');
    await expect(page.locator('#twitch-tags-suggestions')).not.toContainText('Polluted');
    await page.locator('#twitch-tags-adopt').tap();
    await expect(page.locator('#twitch-tags')).toHaveValue('Recommended');
    await page.locator('#twitch-tags').fill('Manual');
    const submissions: any[] = [];
    let release!: () => void;
    let pending = false;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route('**/api/v1/twitch/channel', async route => {
      submissions.push(route.request().postDataJSON());
      if (submissions.length === 1) { await route.fulfill({ status: 503, json: { error: { message: 'Réessaie' } } }); return; }
      if (submissions.length === 2) { await route.fulfill({ json: { ...backend.state, twitch: { ...backend.state.twitch, tagsWarning: 'Tags refusés. Corrige puis réessaie.' } } }); return; }
      if (submissions.length === 3) { pending = true; await gate; }
      Object.assign(backend.state.twitch, { tags: submissions.at(-1).tags, tagsWarning: undefined });
      backend.state.stateRevision++;
      await route.fulfill({ json: backend.state });
    });
    await page.locator('#save-twitch').tap();
    await expect(page.locator('#twitch-tags-status')).toContainText('Réessaie');
    await refresh();
    await expect(page.locator('#twitch-tags')).toHaveValue('Manual');
    expect(submissions[0]).toEqual({ title: '', gameId: '', gameName: '', tags: ['Manual'] });
    await page.locator('#save-twitch').tap();
    await expect(page.locator('#twitch-tags-status')).toContainText('Tags refusés');
    await refresh();
    await expect(page.locator('#twitch-tags')).toHaveValue('Manual');
    await page.locator('#save-twitch').tap();
    await expect.poll(() => pending).toBe(true);
    await page.locator('#twitch-tags').fill('Newer');
    await refresh();
    release();
    await expect(page.locator('#save-twitch')).toBeEnabled();
    await refresh();
    await expect(page.locator('#twitch-tags')).toHaveValue('Newer');
    await page.locator('#save-twitch').tap();
    await expect(page.locator('#twitch-tags-status')).toContainText('enregistrées');
    await expect(page.locator('#save-twitch')).toBeEnabled();
    expect(submissions.at(-1).tags).toEqual(['Newer']);
    await page.locator('#twitch-tags').fill('');
    await page.locator('#save-twitch').tap();
    await expect(page.locator('#save-twitch')).toBeEnabled();
    expect(submissions.at(-1).tags).toEqual(['']);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    for (const id of ['twitch-tags', 'twitch-tags-regenerate', 'save-twitch']) {
      const box = await page.locator(`#${id}`).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(40);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width);
    }
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});

test('Live suggestions ignore late contexts and survive telemetry while pending', async ({ page }) => {
  const { backend, errors } = await setup(page);
  await page.locator('[data-tab="live"]').click();
  await page.locator('[data-open-live-tool="twitch"]').click();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const requests: any[] = [];
  await page.route('**/api/v1/twitch/tags/suggest', async route => {
    const body = route.request().postDataJSON();
    requests.push(body);
    if (body.title === 'Old context') await gate;
    await route.fulfill({ json: { tags: { values: [body.title === 'Old context' ? 'Stale' : 'Fresh'] } } });
  });
  await page.locator('#twitch-title').fill('Old context');
  await page.clock.runFor(301);
  await expect.poll(() => requests.length).toBe(1);
  await page.locator('#twitch-tags').fill('KeepMe');
  backend.state.stateRevision++;
  await page.evaluate(state => (window as any).sockets.at(-1).onmessage({ data: JSON.stringify({ type: 'state.updated', data: state }) }), backend.state);
  await expect(page.locator('#twitch-tags-suggestions')).toContainText('en cours');
  await expect(page.locator('#twitch-title')).toHaveValue('Old context');
  await page.locator('#twitch-title').fill('New context');
  await page.clock.runFor(301);
  await expect(page.locator('#twitch-tags-suggestions')).toContainText('Fresh');
  const response = page.waitForResponse(async response => response.url().endsWith('/tags/suggest') && response.request().postDataJSON().title === 'Old context');
  release();
  await response;
  await expect(page.locator('#twitch-tags-suggestions')).toContainText('Fresh');
  await expect(page.locator('#twitch-tags')).toHaveValue('KeepMe');
  expect(requests[1]).toMatchObject({ title: 'New context', gameId: '27471', gameName: 'Minecraft' });
  expect(errors).toEqual([]);
});
