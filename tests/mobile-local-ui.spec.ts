import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';

const REGIE = 'https://local-ui-regie.local:48136';
const CREDENTIAL = 'fake-local-ui-device-credential';
const SOUND = 'Jingle de cet appareil';
const FOLLOWER = 'Follower reçu pendant la fermeture';
const ACCOUNT = 'a'.repeat(64);
const WIDGET = 'https://streamlabs.com/widgets/event-list?token=fake-local-history-test-only';
const LOCAL_SCOPE = 'device-workspace-v1';

let server: Server, origin: string;
test.beforeAll(async () => {
  const app = express();
  app.use('/mobile', express.static(path.resolve('apps/mobile')));
  app.get('/local-fixture', (_req, res) => res.send('<!doctype html><meta charset="utf-8"><title>Préparation de l’espace autonome</title>'));
  server = await new Promise<Server>(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

// A complete, small PCM WAV is imported through the real form and IndexedDB.
// Only the native decoder is substituted, so its pending play acknowledgement
// and the disposal of a Blob URL can be observed deterministically.
function wav() {
  const file = Buffer.alloc(44 + 1_600); // 100 ms, 8 kHz, mono, 16-bit PCM.
  file.write('RIFF'); file.writeUInt32LE(file.length - 8, 4); file.write('WAVEfmt ', 8);
  file.writeUInt32LE(16, 16); file.writeUInt16LE(1, 20); file.writeUInt16LE(1, 22);
  file.writeUInt32LE(8_000, 24); file.writeUInt32LE(16_000, 28);
  file.writeUInt16LE(2, 32); file.writeUInt16LE(16, 34); file.write('data', 36);
  file.writeUInt32LE(file.length - 44, 40);
  return file;
}

async function setupLocal(page: Page, { instrumentAudio = true } = {}) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = {
    snapshot: null as any,
    configured: false,
    calls: [] as { path: string; method: string; auth?: string }[],
    unexpected: [] as string[],
    externalRequests: [] as string[],
    serviceCalls: [] as any[],
    commands: [] as any[],
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.install();
  await page.exposeFunction('__localUiService', (payload: any) => {
    backend.serviceCalls.push(payload);
    if (payload.provider === 'streamlabs') {
      if (payload.operation === 'historyConfigure') backend.configured = true;
      if (payload.operation === 'historyClear') backend.configured = false;
      const status = { ok: true, configured: backend.configured, ...(backend.configured ? { accountKey: ACCOUNT } : {}) };
      if (payload.operation === 'historyRead') return { ...status, data: { follows: [
        { _id: 'local-history-follow', type: 'follow', platform: 'twitch_account', display_name: FOLLOWER, created_at: '2026-10-19 16:12:00' },
        { _id: 'control-frame', type: 'rollendcredits', platform: 'twitch_account', display_name: 'Ne doit pas apparaître', created_at: '2026-10-19 16:13:00' },
      ] } };
      if (['historyStatus', 'historyConfigure', 'historyClear'].includes(payload.operation)) return status;
    }
    if (payload.provider === 'wizebot' && payload.operation === 'context') return { ok: true, connected: true, canSend: true, channel: 'chaine_locale' };
    backend.unexpected.push('native ' + JSON.stringify(payload));
    return { ok: false, code: 'NOT_SUPPORTED', message: 'Opération non prévue dans le test.' };
  });
  await page.exposeFunction('__localUiCommand', (payload: any) => {
    backend.commands.push(payload);
    return { ok: true, status: 'sent', messageId: 'fake-local-message-id', message: 'Commande envoyée dans le chat Twitch.' };
  });
  await page.addInitScript(({ regie, credential, instrumentAudio }) => {
    const win = window as any;
    if (!localStorage.getItem('test.mobile-local-initialized')) {
      localStorage.setItem('test.mobile-local-initialized', '1');
      localStorage.setItem('sd2.device', JSON.stringify({ version: 1, name: 'Téléphone autonome de test', role: 'mobile', configured: true }));
      localStorage.setItem('sd2.server', regie);
      localStorage.setItem('sd2.workspace-mode', 'local');
      localStorage.setItem('sd2.page', 'deck');
      localStorage.setItem('sd2.performance-first', '1');
      localStorage.setItem('sd2.live-deck-intro', '1');
      localStorage.setItem('test.local-credential', credential);
    }
    // Synthetic native replies exercise correlation and the real renderer;
    // the Java TLS integration test verifies certificates separately.
    win.StreamDashboardPeer={postMessage:async(raw:string)=>{
      const value=JSON.parse(raw);if(value.operation==='cancel')return;
      let result;
      try{const response=await fetch(value.url,{method:value.method,headers:{...(value.credential?{Authorization:'Device '+value.credential}:{}),...(value.body?{'Content-Type':'application/json'}:{})},body:value.body});result={ok:true,status:response.status,body:await response.text()};}
      catch{result={ok:false,error:{message:'synthetic transport unavailable'}};}
      win.dispatchEvent(new CustomEvent('peer-result',{detail:{id:value.id,result:JSON.stringify(result)}}));
    }};
    win.StreamDashboardNative = {
      isAndroid: () => true,
      getCredential: () => localStorage.getItem('test.local-credential') || '',
      setCredential: (value: string) => localStorage.setItem('test.local-credential', value),
      clearCredential: () => localStorage.removeItem('test.local-credential'),
      setKeepAwake: () => {}, haptic: () => {},
    };
    win.StreamDashboardProviders = {
      deviceService: async (raw: string) => JSON.stringify(await win.__localUiService(JSON.parse(raw))),
      wizebotSendCommand: async (raw: string) => JSON.stringify(await win.__localUiCommand(JSON.parse(raw))),
      twitchStatus: () => JSON.stringify({ connected: false }),
      googleStatus: () => JSON.stringify({ connected: false }),
      youtubeStatus: () => JSON.stringify({ connected: false }),
    };
    win.__localCspViolations = [];
    document.addEventListener('securitypolicyviolation', event => {
      win.__localCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI });
    });
    if (!instrumentAudio) return;
    const media = win.__localMedia = { hold: false, elements: [] as any[], revoked: [] as string[] };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = value => { media.revoked.push(value); revoke(value); };
    win.Audio = class {
      src: string; originalSrc: string; volume = 1; preload = ''; playCalls = 0;
      pauses = 0; loads = 0; playing = false; settled = false;
      onended: unknown = null; onerror: unknown = null; resolvePlay?: () => void;
      constructor(src: string) { this.src = this.originalSrc = src; media.elements.push(this); }
      play() {
        this.playCalls++; this.playing = true;
        if (media.hold) return new Promise<void>(resolve => { this.resolvePlay = () => { this.settled = true; resolve(); }; });
        this.settled = true; return Promise.resolve();
      }
      pause() { this.pauses++; this.playing = false; }
      removeAttribute(name: string) { if (name === 'src') this.src = ''; }
      load() { this.loads++; }
    };
  }, { regie: REGIE, credential: CREDENTIAL, instrumentAudio });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url()), method = request.method();
    if (url.origin === REGIE && url.pathname.startsWith('/api/')) {
      backend.calls.push({ path: url.pathname, method, auth: request.headers().authorization });
      const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, OPTIONS' };
      if (method === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      let json: unknown;
      if (method === 'GET') {
        if (url.pathname === '/api/v2/autonomy') json = backend.snapshot;
        else if (url.pathname === '/api/v2/state') json = backend.snapshot.bundle.data;
        else if (url.pathname === '/api/v1/soundboard') json = backend.snapshot.bundle.sounds;
        else if (url.pathname === '/api/v2/replay') json = { active: false, available: true, enabled: false, seconds: 30 };
      }
      if (json === undefined) {
        backend.unexpected.push(method + ' ' + url.pathname);
        await route.fulfill({ status: 501, headers, json: { error: { message: 'Appel régie inattendu.' } } });
      } else await route.fulfill({ headers, json });
      return;
    }
    if (url.origin === origin && !url.pathname.startsWith('/api/')) { await route.continue(); return; }
    backend.externalRequests.push(method + ' ' + request.url());
    await route.abort();
  });
  await page.goto(origin + '/local-fixture');
  backend.snapshot = await page.evaluate(async () => {
    const modulePath = '/mobile/control/device-workspace.js';
    const { newWorkspace } = await import(modulePath);
    const snapshot = newWorkspace({ version: 1, name: 'Régie synthétique', role: 'stream', configured: true });
    snapshot.workspace = 'local-ui-regie-fixture';
    snapshot.bundle.data.host.standalone = false;
    return snapshot;
  });
  await page.goto(origin + '/mobile/control/index.html');
  await expect(page.getByRole('heading', { name: 'Mon Deck', exact: true })).toBeVisible();
  await expect(page.locator('.deck-session-bar')).toContainText('Espace autonome');
  await expect(page.locator('html')).toHaveClass(/compact-app/);
  return { backend, errors };
}

async function importSound(page: Page) {
  await page.locator('nav [data-page="manage"]').click();
  await page.locator('[data-task="sounds"]').click();
  await page.locator('[data-task="import-sound"]').click();
  await page.locator('#sound-import input[type="file"]').setInputFiles({ name: 'jingle-local.wav', mimeType: 'audio/wav', buffer: wav() });
  await page.getByLabel('Nom du son', { exact: true }).fill(SOUND);
  await page.locator('#sound-import').getByRole('button', { name: 'Importer', exact: true }).click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await page.locator('nav [data-page="sounds"]').click();
  await expect(page.getByRole('heading', { name: 'Soundboard', exact: true })).toBeVisible();
  await expect(page.locator('[data-play-sound]').filter({ hasText: SOUND })).toBeEnabled();
}

async function localRecord(page: Page) {
  return page.evaluate(async scope => {
    const modulePath = '/mobile/control/autonomy-store.js';
    const { openReplica } = await import(modulePath);
    const store = await openReplica(scope);
    const record = store.record, view = store.view(), sound = view.sounds.sounds[0];
    const asset = sound ? await store.soundAsset(sound.id) : null;
    const result = { record, view, asset: asset ? { name: asset.name, type: asset.type, size: asset.size } : null };
    store.close(); return result;
  }, LOCAL_SCOPE);
}

test('native local Soundboard imports an actual asset, persists its volume and plays without a régie', async ({ page }) => {
  const { backend, errors } = await setupLocal(page);
  await importSound(page);
  await page.locator('nav [data-page="manage"]').click();
  await page.locator('[data-task="sounds"]').click();
  await page.locator('[data-sound]').filter({ hasText: SOUND }).click();
  await page.getByLabel('Volume (0 à 1)', { exact: true }).fill('0.35');
  await page.locator('#sound-form').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await page.locator('nav [data-page="sounds"]').click();
  const pad = page.locator('[data-play-sound]').filter({ hasText: SOUND });
  await pad.click();
  await expect(pad).toHaveAttribute('data-active', 'true');
  await expect(pad.locator('.pad-state')).toHaveText('En lecture');
  expect(await page.evaluate(() => {
    const audio = (window as any).__localMedia.elements[0];
    return { volume: audio.volume, blob: audio.src.startsWith('blob:'), playCalls: audio.playCalls };
  })).toEqual({ volume: 0.35, blob: true, playCalls: 1 });
  await page.locator('[data-action="sound.stop"]').click();
  await expect(pad).toHaveAttribute('data-active', 'false');
  await expect(page.locator('[data-action="sound.stop"]')).toBeDisabled();
  expect(await page.evaluate(() => {
    const media = (window as any).__localMedia, audio = media.elements[0];
    return { pauses: audio.pauses, src: audio.src, loads: audio.loads, revoked: media.revoked };
  })).toMatchObject({ pauses: 1, src: '', loads: 1, revoked: [expect.stringMatching(/^blob:/)] });
  const stored = await localRecord(page);
  expect(stored.asset).toEqual({ name: 'jingle-local.wav', type: 'audio/wav', size: wav().length });
  expect(stored.view.sounds.sounds[0]).toMatchObject({ name: SOUND, volume: 0.35, enabled: true });
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Soundboard', exact: true })).toBeVisible();
  await expect(pad).toBeEnabled();
  await pad.click();
  await expect(pad.locator('.pad-state')).toHaveText('En lecture');
  expect(await page.evaluate(() => (window as any).__localMedia.elements[0].volume)).toBe(0.35);
  expect(backend.calls).toEqual([]);
  expect(backend.externalRequests).toEqual([]);
  expect(backend.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('the shipped Content Security Policy allows a real WAV decoder to play an imported Blob after a user gesture', async ({ page }) => {
  const { backend, errors } = await setupLocal(page, { instrumentAudio: false });
  expect(await page.evaluate(() => /\[native code\]/.test(Function.prototype.toString.call(Audio)))).toBe(true);
  await importSound(page);
  await page.locator('[data-play-sound]').filter({ hasText: SOUND }).click();
  // The short sound may already have ended. Its successful receipt requires
  // the real Audio.play() promise to have resolved after the IndexedDB read.
  await expect(page.locator('.deck-feedback')).toHaveAttribute('data-status', 'succeeded');
  await expect(page.locator('.deck-feedback')).toContainText('Lecture sur cet appareil : ' + SOUND);
  expect((await localRecord(page)).record.drafts.deviceReceipts).toEqual([
    expect.objectContaining({ action: 'sound.play', status: 'succeeded', message: 'Lecture sur cet appareil : ' + SOUND }),
  ]);
  expect(await page.evaluate(() => (window as any).__localCspViolations)).toEqual([]);
  expect(backend.calls).toEqual([]);
  expect(backend.externalRequests).toEqual([]);
  expect(backend.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('local Stop cancels a pending play, and changing workspace releases audio without sending a live command', async ({ page }) => {
  const { backend, errors } = await setupLocal(page);
  await importSound(page);
  await page.evaluate(() => { (window as any).__localMedia.hold = true; });
  const pad = page.locator('[data-play-sound]').filter({ hasText: SOUND });
  await pad.click();
  await expect.poll(() => page.evaluate(() => (window as any).__localMedia.elements.length)).toBe(1);
  await expect(page.locator('[data-action="sound.stop"]')).toBeEnabled();
  await page.locator('[data-action="sound.stop"]').click();
  await expect(page.locator('[data-action="sound.stop"]')).toBeDisabled();
  expect(await page.evaluate(() => {
    const audio = (window as any).__localMedia.elements[0];
    return { paused: audio.pauses, src: audio.src, settled: audio.settled };
  })).toEqual({ paused: 1, src: '', settled: false });
  await page.evaluate(() => { const media = (window as any).__localMedia; media.hold = false; media.elements[0].resolvePlay(); });
  await expect(pad).toBeEnabled();
  await expect(pad).toHaveAttribute('data-active', 'false');
  expect((await localRecord(page)).record.drafts.deviceReceipts).toEqual([expect.objectContaining({ action: 'sound.stop', status: 'succeeded' })]);
  await pad.click();
  await expect(pad.locator('.pad-state')).toHaveText('En lecture');
  expect(backend.calls).toEqual([]);
  await page.locator('nav [data-page="manage"]').click();
  await page.getByRole('button', { name: 'Ma régie', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mon espace', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).__localMedia.elements[1].src)).toBe('');
  expect(await page.evaluate(() => {
    const media = (window as any).__localMedia;
    return { pauses: media.elements.map((audio: any) => audio.pauses), revoked: media.revoked.length };
  })).toEqual({ pauses: [1, 1], revoked: 2 });
  await expect.poll(() => backend.calls.filter(call => call.path === '/api/v2/autonomy').length).toBeGreaterThan(0);
  expect(backend.calls.every(call => ['GET', 'OPTIONS'].includes(call.method))).toBe(true);
  expect(backend.calls.filter(call => call.method === 'GET').every(call => call.auth === 'Device ' + CREDENTIAL)).toBe(true);
  await page.getByRole('button', { name: 'Mon espace', exact: true }).click();
  await page.locator('nav [data-page="sounds"]').click();
  await expect(pad).toBeEnabled();
  await expect(pad).toHaveAttribute('data-active', 'false');
  expect(await page.evaluate(() => (window as any).__localMedia.elements.length)).toBe(2);
  expect(backend.externalRequests).toEqual([]);
  expect(backend.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('disabling and restoring the display role releases viewers and keeps local Activity available', async ({ page }) => {
  const { errors } = await setupLocal(page);
  await page.locator('nav [data-page="live"]').click();
  await expect(page.locator('[data-monitor-toggle]')).toBeVisible();
  for (const enabled of [false, true]) {
    await page.locator('nav [data-page="manage"]').click();
    await page.locator('#content [data-page="settings"]').click();
    await page.locator('[data-tab="devices"]').click();
    await page.getByRole('button', { name: 'Mon installation', exact: true }).click();
    await page.locator('[name="role-display"]').setChecked(enabled);
    await page.getByRole('button', { name: 'Prévisualiser le changement' }).click();
    await page.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await page.locator('nav [data-page="live"]').click();
    if (enabled) await expect(page.locator('[data-monitor-toggle]')).toBeVisible();
    else {
      await expect(page.locator('#live-monitor')).toContainText('Visionneuses et chats désactivés');
      await expect(page.locator('[data-monitor-toggle]')).toHaveCount(0);
      await expect(page.locator('#streamlabs-feed')).toBeVisible();
    }
  }
  expect(errors).toEqual([]);
});

test('local Activity configures cloud history through the native bridge and never claims a Socket connection', async ({ page }) => {
  const { backend, errors } = await setupLocal(page);
  await page.locator('nav [data-page="activity"]').click();
  await expect(page.locator('#activity-context')).toContainText('même lorsque les PC sont éteints');
  await expect(page.locator('[data-feed-summary-source]')).toHaveText('Cet appareil · historique Streamlabs');
  await expect(page.locator('[data-feed-summary-direct]')).toHaveText('Direct indisponible');
  await expect(page.locator('[data-feed-summary-history]')).toHaveText('Historique à connecter');
  await page.locator('[data-feed-options] > summary').click();
  await page.locator('[data-feed-config]').click();
  await expect(page.locator('#streamlabs-feed-config')).toHaveCount(0);
  await expect(page.locator('#dialog-content')).toContainText('La connexion Socket en temps réel nécessite une régie');
  await page.getByLabel('URL d’un widget Streamlabs').fill(WIDGET);
  await page.locator('#streamlabs-history-config').getByRole('button', { name: 'Enregistrer et récupérer l’historique' }).click();
  await expect(page.locator('[data-streamlabs-history-status]')).toContainText('synchronisé · 1 événement');
  await expect(page.getByLabel('URL d’un widget Streamlabs')).toHaveValue('');
  await page.locator('[data-task="close-dialog"]').click();
  await expect(page.locator('.streamlabs-event')).toHaveCount(1);
  await expect(page.locator('.streamlabs-event')).toContainText(FOLLOWER);
  await expect(page.locator('.streamlabs-event time')).toHaveAttribute('datetime', '2026-10-19T16:12:00.000Z');
  await expect(page.locator('[data-feed-summary-direct]')).toHaveText('Direct indisponible');
  await expect(page.locator('[data-feed-summary-direct]')).not.toHaveAttribute('data-state', 'ok');
  await expect(page.locator('[data-feed-summary-history]')).toHaveText('Historique à jour');
  await expect(page.locator('#streamlabs-feed')).not.toContainText('rollendcredits');
  const stored = await localRecord(page);
  expect(stored.record.drafts['streamlabs.history:' + ACCOUNT].items).toEqual([expect.objectContaining({ displayName: FOLLOWER, origin: 'cloud' })]);
  expect(JSON.stringify(stored.record)).not.toContain(WIDGET);
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain(WIDGET);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Activité', exact: true })).toBeVisible();
  await expect(page.locator('.streamlabs-event')).toContainText(FOLLOWER);
  await expect(page.locator('[data-feed-summary-direct]')).toHaveText('Direct indisponible');
  await expect(page.locator('[data-feed-summary-history]')).toHaveText('Historique à jour');
  await page.locator('[data-feed-options] > summary').click();
  await page.locator('[data-feed-config]').click();
  await page.locator('[data-streamlabs-history-clear]').click();
  await expect(page.locator('[data-streamlabs-history-status]')).toContainText('à connecter');
  await page.locator('[data-task="close-dialog"]').click();
  await expect(page.locator('.streamlabs-event')).toHaveCount(0);
  await expect(page.locator('[data-feed-summary-history]')).toHaveText('Historique à connecter');
  expect(backend.serviceCalls.filter(call => call.operation === 'historyConfigure')).toEqual([{ provider: 'streamlabs', operation: 'historyConfigure', widgetUrl: WIDGET }]);
  expect(backend.serviceCalls.some(call => call.operation === 'historyRead')).toBe(true);
  expect(backend.calls).toEqual([]);
  expect(backend.externalRequests).toEqual([]);
  expect(backend.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('a local WizeBot pad uses this device account once and persists its receipt without a régie', async ({ page }) => {
  const { backend, errors } = await setupLocal(page);
  await page.locator('nav [data-page="manage"]').click();
  await page.locator('#content [data-page="actions"]').click();
  await page.locator('[data-task="new-action"]').click();
  await page.locator('#action-form [name="label"]').fill('Bonjour WizeBot local');
  await page.getByLabel('Action du bouton', { exact: true }).selectOption('wizebot.command');
  await page.locator('#action-form [name="value"]').fill('!bonjour');
  await page.locator('#action-form').getByRole('button', { name: 'Enregistrer', exact: true }).click();
  await expect(page.locator('#dialog')).not.toBeVisible();
  await page.locator('nav [data-page="deck"]').click();
  await page.locator('[data-deck-bank="wizebot"]').click();
  const pad = page.locator('.live-pad-grid [data-action]').filter({ hasText: 'Bonjour WizeBot local' });
  await expect(pad).toBeEnabled();
  await pad.click();
  await expect(page.locator('.deck-feedback')).toContainText('Commande envoyée dans le chat Twitch.');
  await expect(page.locator('.deck-feedback')).toHaveAttribute('data-status', 'succeeded');
  expect(backend.commands).toEqual([expect.objectContaining({ commandId: expect.any(String), channel: 'chaine_locale', command: '!bonjour' })]);
  const stored = await localRecord(page);
  expect(stored.record.drafts.wizebotCommands).toEqual([expect.objectContaining({ status: 'succeeded', messageId: 'fake-local-message-id', channel: 'chaine_locale', command: '!bonjour' })]);
  expect(stored.record.drafts.deviceReceipts).toEqual([expect.objectContaining({ status: 'succeeded', message: 'Commande envoyée dans le chat Twitch.' })]);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Mon Deck', exact: true })).toBeVisible();
  await expect(pad).toBeEnabled();
  await expect(page.locator('.deck-feedback')).toContainText('Commande envoyée dans le chat Twitch.');
  expect(backend.commands).toHaveLength(1);
  expect(backend.calls).toEqual([]);
  expect(backend.externalRequests).toEqual([]);
  expect(backend.unexpected).toEqual([]);
  expect(errors).toEqual([]);
});

test('alpha3 Android creates and selects YouTube, publishes metadata and keeps the draft without a régie',async({page})=>{
 const {backend,errors}=await setupLocal(page);
 await page.evaluate(()=>{
  const w=window as any;w.__cloudCalls=[];
  w.StreamDashboardProviders.platformService=(raw:string)=>{
   const v=JSON.parse(raw);w.__cloudCalls.push(v);
   if(v.operation==='youtube.channels')return JSON.stringify({ok:true,items:[{id:'channel',title:'Chaîne locale'}]});
   if(v.operation==='youtube.streams')return JSON.stringify({ok:true,items:[{id:'stream',channelId:'channel',title:'Flux local'}]});
   if(v.operation==='youtube.create')return JSON.stringify({ok:true,broadcastId:'Abc_1234-XY',channelId:'channel'});
   return JSON.stringify({ok:true});
  };
 });
 await page.locator('nav [data-page="live"]').click();
 await page.locator('[data-task="metadata"]').click();
 await page.locator('#metadata-form [name="title"]').fill('Titre du téléphone');
 await page.locator('#metadata-form [data-task="youtube-create"]').click();
 await page.locator('[name="madeForKids"]').selectOption('false');
 await page.locator('[name="streamId"]').selectOption('stream');
 await page.getByRole('button',{name:'Créer et préparer la diffusion'}).click();
 await expect(page.locator('[data-prepare-result]')).toContainText('informations vérifiées');
 await page.getByRole('button',{name:'Utiliser pour le prochain lancement'}).click();
 await expect(page.locator('#dialog')).not.toBeVisible();
 await page.locator('[data-task="metadata"]').click();
 await expect(page.locator('#metadata-form [name="title"]')).toHaveValue('Titre du téléphone');
 await page.locator('#metadata-form button[value="apply"]').click();
 await expect(page.locator('#dialog')).not.toBeVisible();
 const calls=await page.evaluate(()=>(window as any).__cloudCalls);
 expect(calls.filter((v:any)=>v.operation==='youtube.create')).toHaveLength(1);
 expect(calls.filter((v:any)=>v.operation==='youtube.metadata').at(-1)).toMatchObject({broadcastId:'Abc_1234-XY',channelId:'channel',metadata:{title:'Titre du téléphone'}});
 expect(calls.filter((v:any)=>v.operation==='twitch.metadata')).toHaveLength(1);
 await page.locator('[data-task="metadata"]').click();
 await page.locator('#metadata-form [name="title"]').fill('Brouillon après publication');
 await expect.poll(async()=>page.evaluate(async()=>{const mod='/mobile/control/autonomy-store.js';const {openReplica}=await import(mod);return (await openReplica('device-workspace-v1')).record.drafts.metadata?.title;})).toBe('Brouillon après publication');
 await page.reload();
 await page.locator('nav [data-page="live"]').click();await page.locator('[data-task="metadata"]').click();
 await expect(page.locator('#metadata-form [name="title"]')).toHaveValue('Brouillon après publication');
 expect(backend.calls).toEqual([]);expect(errors).toEqual([]);
});

test('alpha3 Android shows native Twitch chat and makes automation limits explicit',async({page})=>{
 const {backend,errors}=await setupLocal(page);
 await page.evaluate(()=>{
  const w=window as any;
  w.StreamDashboardProviders.twitchChatState=()=>JSON.stringify({ok:true,accountConnected:true,identity:{broadcasterId:'123',userName:'chaine_locale',displayName:'Chaîne locale'},capabilities:{chatRead:true,chatWrite:true},chat:{connected:true,messages:[{id:'m1',broadcasterId:'123',text:'Message natif de test',receivedAt:new Date().toISOString(),chatter:{id:'456',displayName:'Alice',badges:[]}}]}});
  w.StreamDashboardProviders.twitchChatSend=(raw:string)=>{w.__sentChat=JSON.parse(raw);return JSON.stringify({ok:true,status:'sent',messageId:'m2'});};
 });
 await page.locator('nav [data-page="live"]').click();await page.locator('[data-monitor-toggle]').click();
 await expect(page.locator('[data-twitch-messages]')).toContainText('Message natif de test');
 await page.getByLabel('Message Twitch',{exact:true}).fill('Réponse de test');await page.locator('[data-twitch-send]').click();
 await expect(page.locator('[data-twitch-result]')).toContainText('Message envoyé');
 expect(await page.evaluate(()=>(window as any).__sentChat)).toMatchObject({message:'Réponse de test',expectedBroadcasterId:'123'});
 await page.locator('nav [data-page="manage"]').click();await page.locator('.management-grid [data-page="settings"]').click();
 await expect(page.locator('[data-tab="obs"]')).toHaveCount(0);
 await page.locator('[data-tab="integrations"]').click();await page.locator('[data-task="automations"]').click();
 await expect(page.locator('#dialog')).toContainText('ne possède pas de moteur');await expect(page.locator('[data-task="new-automation"]')).toHaveCount(0);
 expect(backend.calls).toEqual([]);expect(errors).toEqual([]);
});

test('alpha3 YouTube preparation works on the insecure Android asset origin',async({page})=>{
 const androidOrigin=origin.replace('127.0.0.1','appassets.androidplatform.net');
 await page.route('**/*',async route=>route.request().url().startsWith(androidOrigin+'/')?route.fulfill({response:await route.fetch({url:route.request().url().replace('appassets.androidplatform.net','127.0.0.1')})}):route.abort());
 await page.goto(androidOrigin+'/local-fixture');
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 expect(await page.evaluate(()=>typeof crypto.randomUUID)).toBe('undefined');
 await page.evaluate(async()=>{
  const mod='/mobile/control/youtube-preparation-ui.js';const {openYouTubePreparation}=await import(mod);const w=window as any;w.__posts=[];
  document.body.innerHTML='<div id="root"></div>';
  await openYouTubePreparation(document.querySelector('#root'),{request:async(path:string,body:any)=>{
   if(path.endsWith('/channels'))return {items:[{id:'channel',title:'Chaîne'}]};
   if(path.endsWith('/streams'))return {items:[{id:'stream',channelId:'channel',title:'Flux'}]};
   w.__posts.push(body);return {status:'succeeded',broadcastId:'Abc_1234-XY',channelId:'channel',message:'Création simulée'};
  },metadata:{title:'Test HTTP',description:'',youtubeCategoryId:'20',tags:[]},expectedRevision:0,isCurrent:()=>true,remember:async()=>{},select:async()=>{}});
 });
 await page.locator('[name="madeForKids"]').selectOption('false');await page.locator('[name="streamId"]').selectOption('stream');
 await page.getByRole('button',{name:'Créer et préparer la diffusion'}).click();
 await expect(page.locator('[data-prepare-result]')).toContainText('Création simulée');
 expect(await page.evaluate(()=>(window as any).__posts[0].id)).toMatch(/^[a-f0-9-]{36}$/);expect(errors).toEqual([]);
});

// Retain coverage of the optional classic phone navigation. The default four-tab layout has its own cleanup regression.
test.beforeEach(async ({page})=>{await page.addInitScript(()=>localStorage.setItem('sd2.navigation','classic'));});
