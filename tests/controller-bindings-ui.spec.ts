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
  const backend = { snapshot: null as any, failure: 0, offline: false, conflict: false, sameDevice: false, calls: [] as string[], pairGate: undefined as Promise<void> | undefined };
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
      const snapshot = url.origin === OTHER_REGIE && !backend.sameDevice ? {...backend.snapshot,workspace:'confirmed-second-workspace'} : backend.snapshot;
      if (url.pathname === '/api/v2/autonomy') json = snapshot;
      else if (url.pathname === '/api/v1/soundboard') json = backend.snapshot.bundle.sounds;
      else if (url.pathname === '/api/v2/device') json = {version:1,device:{id:url.origin===REGIE||backend.sameDevice?'first-pc':'second-pc',name:'Fixture PC',platform:'windows',roles:['obs-executor'],capabilities:['obs','clips','audio'],enabled:true}};
      else if (url.pathname === '/api/v2/replay') json = { active: false, available: true, enabled: true, seconds: 20 };
      else if (url.pathname === '/api/v2/autonomy/sync') json = { ...snapshot, receipt: { status: backend.conflict ? 'conflict' : 'applied', fields: ['label'], message: 'Réglage modifié sur la régie' } };
      else if (url.pathname === '/api/v2/actions') json = {id:'stop-receipt',action:'sound.stop',status:'succeeded',message:'Tous les sons sont arrêtés.'};
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

test('the pairing form keeps drafts, pending edits and button destinations when the same PC changes address', async ({ page }) => {
  const {backend,errors}=await setup(page);backend.sameDevice=true;backend.conflict=true;
  await page.evaluate(async origin=>{
    const storeModule=await import('/mobile/control/autonomy-store.js' as string),model=await import('/mobile/shared/installation.js' as string);
    const store=await storeModule.openReplica(origin),action=store.record.bundle.data.configuration.actions[0];
    await store.draft('metadata',{title:'Brouillon antérieur au changement'});
    await store.stage({['action/'+action.id]:{...action,label:'Nom modifié hors ligne'}});store.close();
    const local=model.migrateInstallation({id:localStorage.getItem('sd2.installation.device-id'),platform:'windows',legacy:{role:'control',configured:true}});
    const device={id:'first-pc',name:'Premier PC',platform:'windows',roles:['obs-executor'],capabilities:['obs','clips','audio'],enabled:true};
    const associated=model.planInstallationChange(local,model.associateInstallationDevice(local,origin,device),local.revision).next;
    associated.actionRoutes=[{workspace:origin,actionId:action.id,deviceId:device.id,definition:action}];
    localStorage.setItem('sd2.installation.v2',JSON.stringify(associated));
  },REGIE);
  await page.locator('header [data-task="connection"]').click();
  await page.locator('#connection-form [name="server"]').fill(OTHER_REGIE);
  await page.locator('#connection-form [name="pair"]').fill('test-pair');
  await page.locator('#connection-form [name="code"]').fill('123456');
  await page.locator('#connection-form [name="fingerprint"]').fill('ab'.repeat(32));
  await page.locator('#connection-form button').filter({hasText:'Se connecter'}).click();
  await expect.poll(()=>page.evaluate(()=>localStorage.getItem('sd2.server'))).toBe(OTHER_REGIE);
  await expect(page.locator('#connection')).toContainText('Régie connectée');
  const result=await page.evaluate(async origin=>{
    const m=await import('/mobile/control/autonomy-store.js' as string),store=await m.openReplica(origin),record=store.record;store.close();
    return {record,installation:JSON.parse(localStorage.getItem('sd2.installation.v2')!),credentials:(window as any).deviceCredentials};
  },OTHER_REGIE);
  expect(result.record.workspace).toBe('confirmed-controller-workspace');
  expect(result.record.drafts.metadata.title).toBe('Brouillon antérieur au changement');
  expect(result.record.pending).toHaveLength(1);expect(result.record.pending[0].value.label).toBe('Nom modifié hors ligne');
  expect(result.installation.actionRoutes[0].workspace).toBe(REGIE);
  expect(result.installation.devices.find((device:any)=>device.id==='first-pc').endpoint).toBe(OTHER_REGIE);
  expect(result.credentials[REGIE]).toBe(CREDENTIAL);expect(result.credentials[OTHER_REGIE]).toBe('new-synthetic-credential');
  expect((await nativeConfiguration(page)).actions).toEqual([]);expect(errors).toEqual([]);
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

test('Stop remains executable while an unrelated offline action edit has a conflict',async({page})=>{
 const {backend,errors}=await setup(page);backend.conflict=true;
 await page.evaluate(async()=>{
  const modulePath='/mobile/control/autonomy-store.js', {openReplica}=await import(modulePath);const scope=localStorage.getItem('sd2.server');const replica=await openReplica(scope);const value=replica.view().data.configuration.actions[0];await replica.stage({['action/'+value.id]:{...value,label:'Local pending edit'}});replica.close();
 });
 await pollRenderer(page);await page.locator('[data-page="deck"]').first().click();
 await page.locator('[data-action="sound.stop"]').first().click();
 await expect.poll(()=>backend.calls.some(value=>value.startsWith('POST ')&&value.endsWith('/api/v2/actions'))).toBe(true);
 expect(errors).toEqual([]);
});

// Retain coverage of the optional classic phone navigation. The default four-tab layout has its own cleanup regression.
test.beforeEach(async ({page})=>{await page.addInitScript(()=>localStorage.setItem('sd2.navigation','classic'));});

test('displays the contextual four-pane mobile destinations and persistent DJI mic badge', async ({page}) => {
  await setup(page);
  await page.setViewportSize({width:390,height:800});
  await page.locator('nav button[data-page="live"]').click();
  await expect(page.locator('#mobile-pane-nav')).toBeVisible();
  await expect(page.locator('[data-mobile-pane="chat"]')).toBeVisible();
  await expect(page.locator('#floating-mic-battery')).toBeVisible();
  await expect(page.locator('#floating-mic-battery strong')).toContainText('DJI');
  await page.locator('#mobile-pane-nav [data-pane-tab="micro"]').click();
  await expect(page.locator('[data-mobile-pane="micro"]')).toBeVisible();
  await expect(page.locator('#dji-battery-panel')).toBeVisible();
  await expect(page.locator('#spotify-panel')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="sounds"]').click();
  await expect(page.locator('#mobile-live-sounds')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="control"]').click();
  await expect(page.locator('[data-mobile-pane="control"] [data-action="live.stop"]')).toBeVisible();
  await page.locator('#floating-mic-battery button').click();
  await expect(page.locator('[data-mobile-pane="micro"]')).toBeVisible();

  await page.locator('nav button[data-page="planning"]').click();
  await expect(page.locator('[data-mobile-pane="next"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="week"]').click();
  await expect(page.locator('[data-mobile-pane="week"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="events"]').click();
  await expect(page.locator('[data-mobile-pane="events"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="manage"]').click();
  await expect(page.locator('[data-mobile-pane="manage"] [data-planning="new"]')).toBeVisible();

  await page.locator('nav button[data-page="deck"]').click();
  await expect(page.locator('[data-mobile-pane="sounds"] #mobile-deck-sounds')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="actions"]').click();
  await expect(page.locator('[data-mobile-pane="actions"] [data-action="live.stop"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="wizebot"]').click();
  await expect(page.locator('[data-mobile-pane="wizebot"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="streamlabs"]').click();
  await expect(page.locator('[data-mobile-pane="streamlabs"] #streamlabs-feed')).toBeVisible();

  // Horizontal swipe navigates between adjacent sections without any live commands.
  await page.evaluate(() => {
    const target=document.querySelector('[data-mobile-pane="streamlabs"] .mobile-pane-title')!;
    const touch=(x:number)=>new Touch({identifier:1,target,clientX:x,clientY:200});
    target.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch(280)],targetTouches:[touch(280)],changedTouches:[touch(280)]}));
    target.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],targetTouches:[],changedTouches:[touch(80)]}));
  });
  await expect(page.locator('[data-mobile-pane="streamlabs"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="actions"]').click();
  await page.evaluate(() => {
    const target=document.querySelector('[data-mobile-pane="actions"] .mobile-pane-title')!;
    const touch=(x:number)=>new Touch({identifier:2,target,clientX:x,clientY:180});
    target.dispatchEvent(new TouchEvent('touchstart',{bubbles:true,touches:[touch(280)],targetTouches:[touch(280)],changedTouches:[touch(280)]}));
    target.dispatchEvent(new TouchEvent('touchend',{bubbles:true,touches:[],targetTouches:[],changedTouches:[touch(80)]}));
  });
  await expect(page.locator('[data-mobile-pane="wizebot"]')).toBeVisible();
});

test('mobile floating DJI badge stays above contextual and global navigation', async ({page},testInfo) => {
  await setup(page);
  await page.setViewportSize({width:360,height:740});
  await page.locator('nav button[data-page="live"]').click();
  await expect(page.locator('#floating-mic-battery')).toBeVisible();
  const parts=await page.evaluate(() => {
    const battery=document.querySelector('#floating-mic-battery')!.getBoundingClientRect();
    const section=document.querySelector('#mobile-pane-nav')!.getBoundingClientRect();
    const global=document.querySelector('aside')!.getBoundingClientRect();
    const content=document.querySelector('#content')!.getBoundingClientRect();
    return {
      battery:{top:battery.top,bottom:battery.bottom,left:battery.left,right:battery.right},
      section:{top:section.top,bottom:section.bottom},
      global:{top:global.top,bottom:global.bottom},
      bodyOverflows:document.body.scrollWidth>document.documentElement.clientWidth,
      contentRight:content.right,viewport:innerWidth,
    };
  });
  expect(parts.battery.bottom).toBeLessThanOrEqual(parts.section.top+1);
  expect(parts.section.bottom).toBeLessThanOrEqual(parts.global.top+1);
  expect(parts.battery.left).toBeGreaterThanOrEqual(-1);
  expect(parts.battery.right).toBeLessThanOrEqual(parts.viewport+1);
  expect(parts.bodyOverflows).toBe(false);
  await page.screenshot({path:testInfo.outputPath('mobile-live-floating-mic-360.png'),fullPage:false});
  await page.locator('#mobile-pane-nav [data-pane-tab="micro"]').click();
  await page.screenshot({path:testInfo.outputPath('mobile-micro-spotify-dji-360.png'),fullPage:false});
});

test('optimized mobile layout keeps the DJI badge in the top status bar without covering controls', async ({page},testInfo) => {
  await setup(page);
  for (const [width,height] of [[320,700],[360,780],[390,844],[412,915]]) {
    await page.setViewportSize({width,height});
    await page.locator('aside nav button[data-page="live"]').click();
    await expect(page.locator('#floating-mic-battery')).toBeVisible();
    await expect(page.locator('#mobile-pane-nav')).toBeVisible();
    const positions=await page.evaluate(() => {
      const rect=(selector:string)=>{
        const r=document.querySelector(selector)!.getBoundingClientRect();
        return {x:r.left,y:r.top,right:r.right,bottom:r.bottom,width:r.width,height:r.height};
      };
      const nav=rect('#mobile-pane-nav');
      return {
        width:innerWidth,height:innerHeight,
        badge:rect('#floating-mic-battery'),
        header:rect('.workspace > header'),
        connection:rect('#connection'),
        contextual:nav,
        primary:rect('aside'),
        touchMin:Math.min(...Array.from(document.querySelectorAll('#mobile-pane-nav button')).map(b=>b.getBoundingClientRect().height)),
        horizontalOverflow:document.documentElement.scrollWidth>innerWidth+2,
      };
    });
    expect(positions.badge.y).toBeGreaterThanOrEqual(-1);
    expect(positions.badge.bottom).toBeLessThanOrEqual(positions.header.bottom+1);
    expect(positions.connection.right).toBeLessThanOrEqual(positions.badge.x+3);
    expect(positions.contextual.bottom).toBeLessThanOrEqual(positions.primary.y+1);
    expect(positions.touchMin).toBeGreaterThanOrEqual(38);
    expect(positions.horizontalOverflow).toBe(false);
    await page.screenshot({path:testInfo.outputPath('live-optimized-'+width+'x'+height+'.png'),fullPage:false});
    await page.locator('#mobile-pane-nav [data-pane-tab="micro"]').click();
    await expect(page.locator('[data-mobile-pane="micro"]')).toBeVisible();
    await page.screenshot({path:testInfo.outputPath('micro-optimized-'+width+'x'+height+'.png'),fullPage:false});
  }
});

test('DJI header shows both real raw transmitter levels and warning color without covering status on 320px',async({page},testInfo)=>{
 await setup(page);
 await page.setViewportSize({width:320,height:700});
 await page.route('**/api/v1/dji/overview',async route=>{
   await route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},
     json:{status:'ok',source:'dji-mic3-rx-winusb',observedAt:new Date().toISOString(),validFrames:31,
       tx:[{slot:1,connected:true,rawGauge:6,calibration:'raw-only'},
           {slot:2,connected:true,rawGauge:7,calibration:'raw-only'}],
       rx:{rawGauge:1,calibration:'raw-only',percent:null}}});
 });
 await page.reload();
 await page.locator('aside nav button[data-page="live"]').click();
 await expect(page.locator('#floating-mic-battery')).toHaveAttribute('data-tone','check');
 await expect(page.locator('#floating-mic-battery strong')).toContainText('TX1 6');
 await expect(page.locator('#floating-mic-battery strong')).toContainText('TX2 7');
 await expect(page.locator('#floating-mic-battery strong')).toContainText('RX 1');
 const position=await page.evaluate(()=>{
   const rect=(query:string)=>document.querySelector(query)!.getBoundingClientRect();
   const badge=rect('#floating-mic-battery'),header=rect('.workspace>header');
   return {badgeTop:badge.top,badgeBottom:badge.bottom,headerBottom:header.bottom};
 });
 expect(position.badgeTop).toBeGreaterThanOrEqual(-1);
 expect(position.badgeBottom).toBeLessThanOrEqual(position.headerBottom+1);
 await page.screenshot({path:testInfo.outputPath('djimic-three-devices-at-a-glance.png'),fullPage:false});
});

test('native touchscreen layout remains accessible on a tablet and in short landscape',async({page},testInfo)=>{
 await page.addInitScript(()=>{
  const base=window.matchMedia.bind(window);
  window.matchMedia=((query:string)=>{
    const mql=base(query);
    if(!query.includes('(pointer:coarse)'))return mql;
    return new Proxy(mql,{
      get(target,prop){
        if(prop==='matches')return true;
        const value=Reflect.get(target,prop,target);
        return typeof value==='function'?value.bind(target):value;
      },
    });
  }) as typeof window.matchMedia;
 });
 await setup(page);
 for (const [width,height] of [[768,1024],[780,440]]) {
  await page.setViewportSize({width,height});
  await page.locator('aside nav button[data-page="live"]').click();
  await expect(page.locator('#floating-mic-battery')).toBeVisible();
  await expect(page.locator('#mobile-pane-nav')).toBeVisible();
  const state=await page.evaluate(()=>{
    const r=(selector:string)=>document.querySelector(selector)!.getBoundingClientRect();
    const b=r('#floating-mic-battery'),header=r('.workspace>header'),nav=r('#mobile-pane-nav'),primary=r('aside'),connection=r('#connection');
    return {badgeBottom:b.bottom,headerBottom:header.bottom,navBottom:nav.bottom,primaryTop:primary.top,
       badgeLeft:b.left,connectionRight:connection.right,overflow:document.documentElement.scrollWidth>innerWidth+2};
  });
  expect(state.badgeBottom).toBeLessThanOrEqual(state.headerBottom+1);
  expect(state.connectionRight).toBeLessThanOrEqual(state.badgeLeft+3);
  expect(state.navBottom).toBeLessThanOrEqual(state.primaryTop+1);
  expect(state.overflow).toBe(false);
  await page.screenshot({path:testInfo.outputPath('native-touch-'+width+'x'+height+'.png'),fullPage:false});
 }
});

test('a horizontal swipe follows the finger then snaps to the next Live pane',async({page})=>{
  await setup(page);
  await page.setViewportSize({width:390,height:800});
  await page.locator('aside nav button[data-page="live"]').click();
  const state=await page.evaluate(()=>{
    const pane=document.querySelector<HTMLElement>('[data-mobile-pane="chat"]')!;
    const target=pane.querySelector<HTMLElement>('.mobile-pane-title')!;
    const make=(x:number,y=180)=>new Touch({identifier:72,target,clientX:x,clientY:y});
    const dispatch=(type:string,x:number,y=180)=>{
      const t=make(x,y);
      target.dispatchEvent(new TouchEvent(type,{
        bubbles:true,cancelable:true,
        touches:type==='touchend'?[]:[t],
        targetTouches:type==='touchend'?[]:[t],
        changedTouches:[t],
      }));
    };
    dispatch('touchstart',300);
    dispatch('touchmove',170);
    const dragging={
      transform:pane.style.transform,
      opacity:pane.style.opacity,
      marker:pane.dataset.paneDragging,
    };
    dispatch('touchend',105);
    return {dragging,reset:pane.style.transform};
  });
  expect(state.dragging.marker).toBe('true');
  expect(state.dragging.transform).toMatch(/translate3d\(-\d+px/);
  expect(Number(state.dragging.opacity)).toBeLessThan(1);
  expect(state.reset).toBe('');
  await expect(page.locator('[data-mobile-pane="micro"]')).toBeVisible();
  await expect(page.locator('#mobile-pane-nav [data-pane-tab="micro"]')).toHaveAttribute('aria-selected','true');
});
test('small horizontal pulls spring back and never switch or send live commands',async({page})=>{
  const {backend}=await setup(page);
  await page.setViewportSize({width:390,height:800});
  await page.locator('aside nav button[data-page="live"]').click();
  const before=backend.calls.filter(v=>v.includes('/api/v2/actions')).length;
  const outcome=await page.evaluate(()=>{
    const pane=document.querySelector<HTMLElement>('[data-mobile-pane="chat"]')!;
    const target=pane.querySelector<HTMLElement>('.mobile-pane-title')!;
    const touch=(x:number)=>new Touch({identifier:8,target,clientX:x,clientY:190});
    for(const [type,x] of ([['touchstart',200],['touchmove',223],['touchend',237]] as Array<[string,number]>)){
      const t=touch(x);
      target.dispatchEvent(new TouchEvent(type,{
        bubbles:true,cancelable:true,
        touches:type==='touchend'?[]:[t],changedTouches:[t],targetTouches:[],
      }));
    }
    return {transform:pane.style.transform,hidden:pane.hidden};
  });
  expect(outcome.transform).toBe('');
  await expect(page.locator('[data-mobile-pane="chat"]')).toBeVisible();
  expect(backend.calls.filter(v=>v.includes('/api/v2/actions'))).toHaveLength(before);
});
test('vertical gestures and text entry never trigger pane navigation',async({page})=>{
  await setup(page);
  await page.setViewportSize({width:390,height:800});
  await page.locator('aside nav button[data-page="live"]').click();
  await page.evaluate(()=>{
    const pane=document.querySelector<HTMLElement>('[data-mobile-pane="chat"]')!;
    const title=pane.querySelector<HTMLElement>('.mobile-pane-title')!;
    const touch=(x:number,y:number,target:EventTarget)=>new Touch({identifier:19,target,clientX:x,clientY:y});
    const dispatch=(target:Element,type:string,x:number,y:number)=>{
      const finger=touch(x,y,target);
      target.dispatchEvent(new TouchEvent(type,{
        bubbles:true,cancelable:true,
        touches:type==='touchend'?[]:[finger],changedTouches:[finger],targetTouches:[],
      }));
    };
    dispatch(title,'touchstart',180,150);
    dispatch(title,'touchmove',185,260);
    dispatch(title,'touchend',190,300);
    const textarea=pane.querySelector('textarea');
    if(textarea){
      dispatch(textarea,'touchstart',290,410);
      dispatch(textarea,'touchmove',100,420);
      dispatch(textarea,'touchend',70,425);
    }
  });
  await expect(page.locator('[data-mobile-pane="chat"]')).toBeVisible();
});
test('reduced-motion preference removes finger-follow visual movement but keeps navigation',async({page})=>{
  await page.emulateMedia({reducedMotion:'reduce'});
  await setup(page);
  await page.setViewportSize({width:390,height:800});
  await page.locator('aside nav button[data-page="live"]').click();
  const style=await page.evaluate(()=>{
    const pane=document.querySelector<HTMLElement>('[data-mobile-pane="chat"]')!;
    const target=pane.querySelector<HTMLElement>('.mobile-pane-title')!;
    const touch=(x:number)=>new Touch({identifier:37,target,clientX:x,clientY:180});
    for(const [type,x] of ([['touchstart',300],['touchmove',170],['touchend',70]] as Array<[string,number]>)){
      const t=touch(x);
      target.dispatchEvent(new TouchEvent(type,{
        bubbles:true,cancelable:true,
        touches:type==='touchend'?[]:[t],changedTouches:[t],targetTouches:[],
      }));
    }
    return pane.style.transform;
  });
  expect(style).toBe('');
  await expect(page.locator('[data-mobile-pane="micro"]')).toBeVisible();
});
test('spontaneous live opens a confirmation but does not dispatch an OBS action when unavailable',async({page})=>{
  const {backend}=await setup(page);
  await page.setViewportSize({width:390,height:800});
  await page.locator('aside nav button[data-page="live"]').click();
  await page.locator('#mobile-pane-nav [data-pane-tab="control"]').click();
  const before=backend.calls.filter(v=>v.includes('/api/v2/actions')).length;
  await page.locator('[data-mobile-pane="control"] [data-task="spontaneous-live"]').click();
  await expect(page.locator('#dialog-content')).toContainText('Live spontané');
  await expect(page.locator('#dialog-content')).toContainText('sans créer d’événement programmé');
  await expect(page.locator('#dialog-content [data-task="spontaneous-live-confirm"]')).toBeDisabled();
  expect(backend.calls.filter(v=>v.includes('/api/v2/actions'))).toHaveLength(before);
  await page.locator('#dialog-content [data-task="close-dialog"]').click();
  await expect(page.locator('dialog')).not.toBeVisible();
  expect(backend.calls.filter(v=>v.includes('/api/v2/actions'))).toHaveLength(before);
});
test('spontaneous live confirms only through the existing Twitch live-start action',async({page})=>{
  const {backend}=await setup(page);
  const dispatchedActions:any[]=[];
  await page.route('**/api/v2/actions',async route=>{
    dispatchedActions.push(route.request().postDataJSON());
    await route.fallback();
  });
  const fixture=backend.snapshot.bundle.data;
  Object.assign(fixture.host.state.obs,{connected:true,streamingKnown:true,streaming:false});
  fixture.host.platforms.twitch={live:false,observedAt:new Date().toISOString()};
  fixture.configuration.outputs.twitch={kind:'main',name:''};
  fixture.configuration.metadata.title='Improvisation du soir';
  await page.reload();
  await expect(page.locator('#connection')).toContainText('Régie connectée');
  await page.setViewportSize({width:390,height:800});
  await page.locator('aside nav button[data-page="live"]').click();
  await page.locator('#mobile-pane-nav [data-pane-tab="control"]').click();
  const before=backend.calls.filter(v=>v.includes('/api/v2/actions')).length;
  await page.locator('[data-mobile-pane="control"] [data-task="spontaneous-live"]').click();
  await expect(page.locator('#dialog-content')).toContainText('Improvisation du soir');
  await expect(page.locator('#dialog-content [data-task="spontaneous-live-confirm"]')).toBeEnabled();
  expect(backend.calls.filter(v=>v.includes('/api/v2/actions'))).toHaveLength(before);
  await page.locator('#dialog-content [data-task="spontaneous-live-confirm"]').click();
  await expect.poll(()=>backend.calls.filter(v=>v.includes('/api/v2/actions')).length)
    .toBe(before+1);
  const actionCalls=backend.calls.filter(v=>v.includes('/api/v2/actions'));
  expect(actionCalls.at(-1)).toContain('POST ');
  expect(dispatchedActions).toHaveLength(1);
  expect(dispatchedActions[0]).toMatchObject({action:'live.start'});
  expect(backend.calls.some(v=>v.includes('/api/v1/planning')&&v.startsWith('POST '))).toBe(false);
  await expect(page.locator('dialog')).not.toBeVisible();
});

test('Planning and Deck follow a horizontal drag and animate on the new pane after re-render',async({page})=>{
  await setup(page);
  await page.setViewportSize({width:390,height:800});
  await page.evaluate(()=>{
    const store:(unknown[])=[];
    (window as any).__paneMotionFrames=store;
    const animate=Element.prototype.animate;
    Element.prototype.animate=function(keyframes,options){
      if(this.matches('[data-mobile-pane]')){
        store.push({
          panel:(this as HTMLElement).dataset.mobilePane,
          first:Array.isArray(keyframes)?keyframes[0]:null,
          duration:typeof options==='object'&&options!==null?'duration' in options?options.duration:null:null,
        });
      }
      return animate.call(this,keyframes,options);
    };
  });
  await page.locator('aside nav button[data-page="planning"]').click();
  await expect(page.locator('[data-mobile-pane="next"]')).toBeVisible();
  const following=await page.evaluate(()=>{
    const pane=document.querySelector<HTMLElement>('[data-mobile-pane="next"]')!;
    const target=pane.querySelector<HTMLElement>('.mobile-pane-title')!;
    const finger=(x:number)=>new Touch({identifier:55,target,clientX:x,clientY:190});
    for(const [type,x] of ([['touchstart',290],['touchmove',150]] as Array<[string,number]>)){
      const t=finger(x);
      target.dispatchEvent(new TouchEvent(type,{
        bubbles:true,cancelable:true,touches:[t],targetTouches:[t],changedTouches:[t],
      }));
    }
    const drag=pane.style.transform;
    const t=finger(85);
    target.dispatchEvent(new TouchEvent('touchend',{
      bubbles:true,cancelable:true,touches:[],targetTouches:[],changedTouches:[t],
    }));
    return drag;
  });
  expect(following).toMatch(/translate3d\(-\d+px/);
  await expect(page.locator('[data-mobile-pane="week"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="events"]').click();
  await expect(page.locator('[data-mobile-pane="events"]')).toBeVisible();
  await page.locator('aside nav button[data-page="deck"]').click();
  await page.locator('#mobile-pane-nav [data-pane-tab="actions"]').click();
  await expect(page.locator('[data-mobile-pane="actions"]')).toBeVisible();
  await page.locator('#mobile-pane-nav [data-pane-tab="sounds"]').click();
  await expect(page.locator('[data-mobile-pane="sounds"]')).toBeVisible();
  const animations=await page.evaluate(()=>(window as any).__paneMotionFrames);
  expect(animations.some((v:any)=>v.panel==='week'&&v.duration===180)).toBe(true);
  expect(animations.some((v:any)=>v.panel==='events'&&v.duration===180)).toBe(true);
  expect(animations.some((v:any)=>v.panel==='actions'&&v.duration===180)).toBe(true);
  expect(animations.some((v:any)=>v.panel==='sounds'&&v.first?.transform?.includes('-26px'))).toBe(true);
});
