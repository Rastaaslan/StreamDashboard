import { test, expect, type Page } from '@playwright/test';
import express from 'express';
import type { Server } from 'node:http';
import path from 'node:path';

const REGIE = 'https://100.126.186.44:48136';
const OTHER_REGIE = 'https://192.168.1.9:48136';
const CREDENTIAL = 'synthetic-controller-credential';
let server: Server, origin: string;
test.beforeAll(async () => {
  const app = express();
  app.use('/mobile', express.static(path.resolve('apps/mobile')));
  app.get('/fixture', (_request, response) => response.send('<!doctype html><title>Macro fixture</title>'));
  server = await new Promise<Server>(resolve => { const running = app.listen(0, '127.0.0.1', () => resolve(running)); });
  origin = 'http://127.0.0.1:' + (server.address() as { port: number }).port;
});
test.afterAll(async () => { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });

async function setup(page: Page, rejectNative = false) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const backend = { snapshot: null as any, failure: 0, offline: false, conflict: false, calls: [] as string[], pairGate: undefined as Promise<void> | undefined };
  await page.addInitScript(({ regie, credential, rejectNative }) => {
    const win = window as any;
    localStorage.setItem('sd2.server', regie);
    localStorage.setItem('sd2.workspace-mode', 'paired');
    localStorage.setItem('sd2.page', 'settings');
    win.credential = credential;
    win.deviceCredentials = { [regie]:credential };
    win.nativeConfigurations = [];
    win.nativeConfiguration = { server: '', credential: '', actions: [] };
    win.rejectNative = rejectNative;
    // The real shipped orchestration runs, but periodic callbacks are controlled
    // explicitly: recovery cannot depend on the renderer polling again.
    win.intervals = [];
    win.setInterval = (callback: () => void, ms: number) => { win.intervals.push({ callback, ms }); return win.intervals.length; };
    win.clearInterval = () => {};
    win.peerPins = {[regie]:'ab'.repeat(32)};
    win.streamDashboardDesktop = {
      getPeerFingerprint:async(origin:string)=>win.peerPins[origin]||'',
      trustPeer:async(origin:string,pin:string,expected:string)=>{if((win.peerPins[origin]||'')!==expected)throw Error('pin changed');win.peerPins[origin]=pin;},
      // UI orchestration only; actual TLS verification is covered by the real Electron test.
      requestPeer:async(value:any)=>{
        if(!win.peerPins[new URL(value.url).origin])throw Error('untrusted peer');
        try{const response=await fetch(value.url,{method:value.method,headers:{Authorization:'Device '+value.credential,...(value.body?{'Content-Type':'application/json'}:{})},body:value.body});return {ok:true,status:response.status,body:await response.text()};}
        catch{return {ok:false,error:{message:'synthetic transport unavailable'}};}
      },
      getDeviceProfile: async () => ({ configured: true, name: 'PC jeu de test', role: 'control' }),
      getControllerCredential: async () => win.credential,
      getDeviceCredential: async (server:string) => win.deviceCredentials[server]||'',
      setDeviceCredential: async (server:string,value:string) => { win.deviceCredentials[server]=value; },
      setControllerCredential: async (value: string) => { win.credential = value; },
      configureController: async (value: any) => {
        win.nativeConfigurations.push(structuredClone(value));
        if (win.rejectNative) throw Error("Error invoking remote method 'controller:configure': Error: Adresse refusée " + credential);
        win.nativeConfiguration = structuredClone(value);
        return { registered: value.actions.map((action: any) => action.shortcut), unavailable: [] };
      },
      controllerStatus: async () => ({ registered: win.nativeConfiguration.actions.map((action: any) => action.shortcut), unavailable: [] }),
      onControllerReceipt: () => {},
    };
  }, { regie: REGIE, credential: CREDENTIAL, rejectNative });
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if ([REGIE, OTHER_REGIE].includes(url.origin) && url.pathname.startsWith('/api/')) {
      const headers = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'Authorization, Content-Type', 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (request.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers }); return; }
      backend.calls.push(request.method() + ' ' + request.url());
      if (url.pathname === '/api/v2/autonomy' && backend.offline) { await route.abort(); return; }
      if (url.pathname === '/api/v2/autonomy' && backend.failure) { await route.fulfill({ status: backend.failure, headers, json: { error: { message: 'Échec synthétique' } } }); return; }
      let json: unknown;
      if (url.pathname === '/api/v2/autonomy') json = backend.snapshot;
      else if (url.pathname === '/api/v1/soundboard') json = backend.snapshot.bundle.sounds;
      else if (url.pathname === '/api/v2/device') json = {version:1,device:{id:url.origin===REGIE?'first-pc':'second-pc',name:'Fixture PC',platform:'windows',roles:['obs-executor'],capabilities:['obs','clips','audio'],enabled:true}};
      else if (url.pathname === '/api/v2/replay') json = { active: false, available: true, enabled: true, seconds: 20 };
      else if (url.pathname === '/api/v2/autonomy/sync') json = { ...backend.snapshot, receipt: { status: backend.conflict ? 'conflict' : 'applied', fields: ['label'], message: 'Réglage modifié sur la régie' } };
      else if (url.pathname === '/api/v1/remote/pair') { if (backend.pairGate) await backend.pairGate; json = { credential: 'new-synthetic-credential' }; }
      else { await route.fulfill({ status: 501, headers, json: { error: { message: 'Unexpected test request' } } }); return; }
      await route.fulfill({ headers, json }); return;
    }
    if (url.origin === origin) { await route.continue(); return; }
    await route.abort();
  });
  await page.goto(origin + '/fixture');
  backend.snapshot = await page.evaluate(async () => {
    const modulePath = '/mobile/control/device-workspace.js';
    const { newWorkspace } = await import(modulePath);
    const snapshot = newWorkspace({ name: 'Régie de test', role: 'stream', configured: true });
    snapshot.workspace = 'confirmed-controller-workspace';
    snapshot.bundle.data.host.settings.streamerName = 'Chaîne de test';
    return snapshot;
  });
  await page.goto(origin + '/mobile/control/index.html?role=client');
  await expect(page.locator('#connection')).toContainText('Régie connectée');
  await expect.poll(() => page.evaluate(() => (window as any).nativeConfigurations.length)).toBeGreaterThan(0);
  return { backend, errors };
}
async function pollRenderer(page: Page) {
  const before = await page.evaluate(() => {
    const win = window as any;
    const before = win.nativeConfigurations.length;
    win.intervals.find((interval: any) => interval.ms === 2500).callback();
    return before;
  });
  await expect.poll(() => page.evaluate(() => (window as any).nativeConfigurations.length)).toBeGreaterThan(before);
}
const nativeConfiguration = (page: Page) => page.evaluate(() => (window as any).nativeConfiguration);

test('a transient transport failure leaves confirmed global mappings armed without another renderer poll', async ({ page }) => {
  const { backend, errors } = await setup(page);
  const before = await nativeConfiguration(page);
  expect(before.actions).toHaveLength(6);
  backend.offline = true;
  await pollRenderer(page);
  await expect(page.locator('#connection')).toContainText('Régie non confirmée · boutons suspendus');
  expect(await nativeConfiguration(page)).toEqual(before);
  const reads = backend.calls.length;
  backend.offline = false;
  // No interval callback, focus event or UI refresh is fired here.
  expect(await nativeConfiguration(page)).toEqual(before);
  expect(backend.calls.length).toBe(reads);
  expect(errors).toEqual([]);
});

test('temporary HTTP sync failures retain keys, while authentication rejection retires them', async ({ page }) => {
  const { backend, errors } = await setup(page);
  const before = await nativeConfiguration(page);
  for (const status of [503, 429, 408]) {
    backend.failure = status;
    await pollRenderer(page);
    expect(await nativeConfiguration(page)).toEqual(before);
  }
  backend.failure = 401;
  await pollRenderer(page);
  expect((await nativeConfiguration(page)).actions).toEqual([]);
  backend.failure = 0;
  await pollRenderer(page);
  expect(await nativeConfiguration(page)).toEqual(before);
  expect(errors).toEqual([]);
});

test('switching to the autonomous workspace explicitly clears the paired macros', async ({ page }) => {
  const { errors } = await setup(page);
  expect((await nativeConfiguration(page)).actions).toHaveLength(6);
  await page.locator('#workspace-toggle').click();
  await expect(page.locator('#connection')).toContainText('Espace de cet appareil');
  expect((await nativeConfiguration(page)).actions).toEqual([]);
  expect(errors).toEqual([]);
});

test('new pairing suspends old macros before waiting and arms only the new identity after validation', async ({ page }) => {
  const { backend, errors } = await setup(page);
  let release!: () => void;
  backend.pairGate = new Promise<void>(resolve => { release = resolve; });
  await page.locator('header [data-task="connection"]').click();
  await page.locator('#connection-form [name="server"]').fill(OTHER_REGIE);
  await page.locator('#connection-form [name="pair"]').fill('test-pair');
  await page.locator('#connection-form [name="code"]').fill('123456');
  await page.locator('#connection-form [name="fingerprint"]').fill('ab'.repeat(32));
  await page.locator('#connection-form button').filter({ hasText: 'Se connecter' }).click();
  await expect.poll(() => backend.calls.some(call => call.startsWith('POST ' + OTHER_REGIE + '/api/v1/remote/pair'))).toBe(true);
  expect((await nativeConfiguration(page)).actions).toEqual([]);
  expect(await page.evaluate(() => localStorage.getItem('sd2.server'))).toBe(REGIE);
  release();
  await expect.poll(async () => (await nativeConfiguration(page)).server).toBe(OTHER_REGIE);
  const current = await nativeConfiguration(page);
  expect(current.credential).toBe('new-synthetic-credential');
  expect(current.actions).toHaveLength(6);
  expect(errors).toEqual([]);
});

test('pending and conflicted action edits never arm the locally modified mapping', async ({ page }) => {
  const { backend, errors } = await setup(page);
  backend.conflict = true;
  await page.locator('nav [data-page="manage"]').click();
  await page.locator('#content [data-page="actions"]').click();
  await page.locator('[data-edit-action="scene-live"]').click();
  await page.locator('#action-form [name="label"]').fill('Version locale non confirmée');
  await page.locator('#action-form button').filter({ hasText: 'Enregistrer' }).click();
  await expect(page.locator('#connection')).toContainText('à résoudre');
  expect((await nativeConfiguration(page)).actions).toEqual([]);
  expect(await page.evaluate(() => (window as any).nativeConfigurations.some((value: any) => value.actions.some((action: any) => action.label === 'Version locale non confirmée')))).toBe(false);
  expect(errors).toEqual([]);
});

test('native registration rejection is visible in diagnostics without exposing its credential', async ({ page }) => {
  const { errors } = await setup(page, true);
  await page.locator('[data-tab="devices"]').click();
  await expect(page.locator('#shortcut-status')).toContainText('Configuration des macros impossible');
  await expect(page.locator('#shortcut-status')).toContainText('Adresse refusée');
  await expect(page.locator('#shortcut-status')).not.toContainText(CREDENTIAL);
  await page.locator('[data-task="shortcut-status"]').click();
  await expect(page.locator('#shortcut-status')).toContainText('Configuration des macros impossible');
  expect(errors).toEqual([]);
});
