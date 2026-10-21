import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import packageJson from '../package.json' with { type: 'json' };

const packagedExecutable = process.env.STREAMDASHBOARD_PACKAGED_EXE;
const RUNTIME_ORIGIN = 'http://127.0.0.1:48133';
// Linux CI uses a virtual display and has no desktop keyring or GPU session.
const testArgs=process.platform==='linux'?['--disable-gpu','--password-store=basic']:[];

async function launch(profile: string, extraArgs: string[] = []): Promise<ElectronApplication> {
  const env = { ...process.env, NODE_ENV: 'test', APPDATA: profile, XDG_CONFIG_HOME: profile };
  return electron.launch(packagedExecutable
    ? { executablePath: path.resolve(packagedExecutable), args: [...testArgs,`--qa-profile=${profile}`,...extraArgs], env }
    : { args: [path.resolve('.'),...testArgs,`--qa-profile=${profile}`,...extraArgs], env });
}

async function expectEndpointClosed(origin: string) {
  await expect.poll(async () => {
    try { await fetch(`${origin}/api/v1/health`, { signal: AbortSignal.timeout(300) }); return false; }
    catch { return true; }
  }, { timeout: 5_000 }).toBe(true);
}

async function expectRuntimeReady(page: Page) {
  await expect(page).toHaveURL(RUNTIME_ORIGIN + '/mobile/control/', { timeout: 30_000 });
  await expect(page.locator('#connection')).toContainText('Régie connectée');
  await expect(page.locator('#content')).not.toBeEmpty();
}

test('Electron réel démarre, persiste, impose une instance et arrête son backend', async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-qa-'));
  let application: ElectronApplication | undefined;
  try {
    await expectEndpointClosed(RUNTIME_ORIGIN);
    application = await launch(profile);
    const window = await application.firstWindow();
    await expect(window).toHaveTitle(/StreamDashboard/);
    await expectRuntimeReady(window);

    // A new profile uses the same welcome form and controller shell as the
    // installed application. Keep its current host role, without a restart.
    await expect(window.locator('#installation-form')).toBeVisible();
    await window.locator('#installation-form [name="name"]').fill('PC du test Electron');
    await window.locator('#installation-form [name="preset"]').selectOption('single-pc');
    await window.locator('#installation-form').getByRole('button', { name: 'Prévisualiser le changement' }).click();
    await window.getByRole('button', { name: 'Appliquer', exact: true }).click();
    await expect(window.locator('#dialog')).not.toBeVisible();
    await expect(window.locator('#role')).toContainText('PC du test Electron');

    for (const [route, title] of [
      ['live', null], ['deck', 'Mon Deck'], ['planning', 'Planning & événements'],
      ['settings', 'Configuration'], ['sounds', 'Soundboard'], ['activity', 'Activité'], ['manage', 'Gestion'],
    ] as const) {
      await window.locator(`nav [data-page="${route}"]`).click();
      await expect(window.locator('#content')).toHaveAttribute('data-rendered-page', route);
      await expect(window.locator(`nav [data-page="${route}"]`)).toHaveClass(/active/);
      if (title) await expect(window.getByRole('heading', { name: title, exact: true })).toBeVisible();
      else await expect(window.locator('#live-overview h1')).toBeVisible();
      await expect(window.locator('#content')).not.toBeEmpty();
    }
    await window.locator('#content [data-page="actions"]').click();
    await expect(window.getByRole('heading', { name: 'Boutons & macros', exact: true })).toBeVisible();
    await window.locator('nav [data-page="settings"]').click();
    for (const [tab, selector] of [
      ['obs', '#settings-form'], ['platforms', '#platform-form'], ['profile', '#profile-settings'],
      ['integrations', '[data-task="streamlabs"]'], ['devices', '#shortcut-status'],
    ] as const) {
      await window.locator(`[data-tab="${tab}"]`).click();
      await expect(window.locator(selector)).toBeAttached();
      await expect(window.locator('.config-panel')).not.toBeEmpty();
    }
    await window.locator('nav [data-page="live"]').click();
    const electronVersion = await application.evaluate(() => process.versions.electron);
    expect(electronVersion).toBe(packageJson.devDependencies.electron);

    const health = await window.evaluate(() => fetch('/api/v1/health').then(response => response.json()));
    expect(health).toMatchObject({ ok: true, protocolVersion: 1 });
    for (const route of ['/api/v1/state', '/api/v1/capabilities', '/api/v1/diagnostics']) {
      const response = await window.evaluate(route => fetch(route).then(async result => ({ ok: result.ok, body: await result.json() })), route);
      expect(response.ok).toBe(true); expect(response.body).toBeTruthy();
    }

    const desktopBridge = await window.evaluate(async () => {
      const bridge = (window as typeof window & { streamDashboardDesktop?: { getVersion(): Promise<string> } }).streamDashboardDesktop;
      if (!bridge) return { available: false, version: '' };
      return { available: true, version: await bridge.getVersion() };
    });
    expect(desktopBridge.available).toBe(true);
    expect(desktopBridge.version).toMatch(/^\d+\.\d+\.\d+/);

    const before = await window.evaluate(() => fetch('/api/v1/state').then(response => response.json()));
    expect(before.runtime.logsPath).toBeTruthy();
    await access(before.runtime.logsPath);
    const marker = `Smoke-${Date.now()}`;
    const saved = await window.evaluate(marker => fetch('/api/v1/settings', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ streamerName: marker }),
    }).then(response => response.json()), marker);
    expect(saved.settings.streamerName).toBe(marker);

    if (packagedExecutable) {
      for (let attempt = 0; attempt < 20; attempt++) {
      await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].minimize(); });
      const second = spawn(path.resolve(packagedExecutable), [...(process.platform === 'linux' ? ['--no-sandbox'] : []),`--qa-profile=${profile}`], { env: { ...process.env, NODE_ENV: 'test', APPDATA: profile, XDG_CONFIG_HOME: profile }, stdio: 'ignore', windowsHide: true });
      const code = await new Promise<number | null>((resolve, reject) => {
        const timeout = setTimeout(() => { second.kill(); reject(new Error('La seconde instance ne s’est pas arrêtée.')); }, 8_000);
        second.once('error', reject);
        second.once('exit', value => { clearTimeout(timeout); resolve(value); });
      });
      expect(code).toBe(0);
      await expect.poll(() => application!.evaluate(({ BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows()[0];
        return { count: BrowserWindow.getAllWindows().length, visible: main.isVisible(), minimized: main.isMinimized(), focused: main.isFocused() };
      })).toEqual({ count: 1, visible: true, minimized: false, focused: true });
      }
    }

    const origin = await window.evaluate(() => location.origin);
    expect(application.process().pid).toBeGreaterThan(0);
    await application.close(); application = undefined;
    await expectEndpointClosed(origin);

    application = await launch(profile);
    const reloaded = await application.firstWindow();
    await expectRuntimeReady(reloaded);
    await expect(reloaded.locator('#installation-form')).toHaveCount(0);
    await expect(reloaded.locator('#role')).toContainText('PC du test Electron');
    await expect(reloaded.locator('.brand small')).toHaveText(marker);
    const after = await reloaded.evaluate(() => fetch('/api/v1/state').then(response => response.json()));
    expect(after.settings.streamerName).toBe(marker);
    const secondOrigin = await reloaded.evaluate(() => location.origin);
    await application.close(); application = undefined;
    await expectEndpointClosed(secondOrigin);
  } catch(error) { console.error('Electron smoke failure',error);throw error; } finally {
    if (application) {const timer=setTimeout(()=>application?.process().kill('SIGKILL'),15_000);try{await application.close().catch(() => undefined);}finally{clearTimeout(timer);}}
    await rm(profile, { recursive: true, force: true });
  }
});


test('20 démarrages réels, fermeture précoce et libération du port', async () => {
  test.setTimeout(180_000);
  const profile = await mkdtemp(path.join(os.tmpdir(), 'streamdashboard-qa-'));
  let application: ElectronApplication | undefined;
  try {
    await expectEndpointClosed(RUNTIME_ORIGIN);
    for (let attempt = 0; attempt < 20; attempt++) {
      application = await launch(profile);
      const page = await application.firstWindow();
      const logs = await application.evaluate(({ app, BrowserWindow }) => {
        const main = BrowserWindow.getAllWindows()[0];
        if (!main.isVisible()) throw new Error('Startup window is hidden');
        return app.getPath('userData');
      });
      // Alternate a fully loaded launch and a close as soon as a window exists.
      // Deferred unit tests cover the precise startup/stop interleaving.
      if (attempt % 2 === 0) await expectRuntimeReady(page);
      await application.close(); application = undefined;
      await expectEndpointClosed(RUNTIME_ORIGIN);
      const lines = (await readFile(path.join(logs, 'logs', 'streamdashboard.log'), 'utf8')).trim().split('\n');
      expect(lines.at(-1)).toContain('Shutdown complete');
    }
  } catch(error) { console.error('Electron smoke failure',error);throw error; } finally {
    if (application) {const timer=setTimeout(()=>application?.process().kill('SIGKILL'),15_000);try{await application.close().catch(() => undefined);}finally{clearTimeout(timer);}}
    await rm(profile, { recursive: true, force: true });
  }
});


test('agent sans fenêtre : services autonomes disponibles et fenêtre refermable sans arrêt du runtime', async () => {
 const profile=await mkdtemp(path.join(os.tmpdir(),'streamdashboard-qa-'));
 let application: ElectronApplication | undefined;
 try {
  await expectEndpointClosed('http://127.0.0.1:48135');
  application=await launch(profile,['--role=client','--agent']);
  await expect.poll(async()=>{
   try{return (await fetch('http://127.0.0.1:48135/api/v1/health')).status;}catch{return 0;}
  }).toBe(200);
  expect(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(0);
  await application.evaluate(({app})=>{app.emit('activate');});
  const window=await application.firstWindow();
  await expect(window).toHaveURL('http://127.0.0.1:48134/mobile/control/?role=client');
  await expect(window.locator('#installation-form')).toBeVisible();
  await application.evaluate(({BrowserWindow})=>{BrowserWindow.getAllWindows()[0].close();});
  await expect.poll(()=>application!.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().length)).toBe(0);
  expect((await fetch('http://127.0.0.1:48135/api/v1/health')).status).toBe(200);
  // A silent file verifies the real Chromium decoder and hidden agent player.
  // No OBS instance, real account, or physical audio change is required.
  const samples=8000*10,wav=Buffer.alloc(44+samples*2);wav.write('RIFF',0);wav.writeUInt32LE(wav.length-8,4);wav.write('WAVEfmt ',8);wav.writeUInt32LE(16,16);wav.writeUInt16LE(1,20);wav.writeUInt16LE(1,22);wav.writeUInt32LE(8000,24);wav.writeUInt32LE(16000,28);wav.writeUInt16LE(2,32);wav.writeUInt16LE(16,34);wav.write('data',36);wav.writeUInt32LE(samples*2,40);
  const origin='http://127.0.0.1:48135';
  const upload=await fetch(origin+'/api/v2/sounds/upload?name=Silent-test&extension=wav',{method:'POST',headers:{'content-type':'application/octet-stream'},body:wav});
  expect(upload.status).toBe(201);const sound=await upload.json() as {id:string};
  const edit=await fetch(origin+'/api/v1/soundboard/sounds/'+sound.id,{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({outputId:'device-default',volume:0,playbackMode:'mix'})});expect(edit.status).toBe(200);
  const send=async(action:string,id:string)=>{const response=await fetch(origin+'/api/v2/actions',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id,issuedAt:new Date().toISOString(),action,...(action==='sound.play'?{soundId:sound.id}:{})})});return response.json() as Promise<{status:string;message:string}>;};
  const played=await send('sound.play','silent_audio_play');expect(played,played.message).toMatchObject({status:'succeeded'});
  expect(await application.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().every(w=>!w.isVisible()))).toBe(true);
  expect(await send('sound.play','silent_audio_mix')).toMatchObject({status:'succeeded'});
  expect((await (await fetch(origin+'/api/v1/soundboard')).json()).activePlaybacks).toHaveLength(2);
  expect(await send('sound.stop','silent_audio_stop')).toMatchObject({status:'succeeded'});
  expect((await (await fetch(origin+'/api/v1/soundboard')).json()).activePlaybacks).toHaveLength(0);
  await application.close();application=undefined;
  await expectEndpointClosed('http://127.0.0.1:48135');
 }finally{if(application)await application.close().catch(()=>{});await rm(profile,{recursive:true,force:true});}
});

test('TLS réel : une empreinte erronée ne reçoit aucun identifiant et la confiance reste limitée à cet agent', async () => {
  const {createServer}=await import('node:https');
  const {X509Certificate}=await import('node:crypto');
  const certificate=await readFile(path.resolve('tests/fixtures/tls/agent.pem'),'utf8');
  const key=await readFile(path.resolve('tests/fixtures/tls/agent.key'),'utf8');
  const pin=new X509Certificate(certificate).fingerprint256.replaceAll(':','').toLowerCase();
  const requests:string[]=[];
  const endpoint=createServer({cert:certificate,key},(request,response)=>{requests.push(request.headers.authorization||'');request.resume();response.setHeader('Content-Type','application/json');response.end('{"ok":true}');});
  await new Promise<void>(resolve=>endpoint.listen(0,'127.0.0.1',resolve));
  const origin='https://127.0.0.1:'+(endpoint.address() as {port:number}).port;
  const profile=await mkdtemp(path.join(os.tmpdir(),'streamdashboard-qa-'));
  let application:ElectronApplication|undefined;
  try {
    application=await launch(profile);
    // The isolated Linux runner has no keyring. Only this test's dummy pin and
    // TEST_SECRET use Electron's explicit basic backend; production is unchanged.
    if(process.platform==='linux')await application.evaluate(({safeStorage})=>safeStorage.setUsePlainTextEncryption(true));
    const window=await application.firstWindow();await expectRuntimeReady(window);
    const result=await window.evaluate(async({origin,pin})=>{
      const bridge=(globalThis as any).streamDashboardDesktop;
      const send=()=>bridge.requestPeer({id:crypto.randomUUID(),url:origin+'/api/v2/actions',method:'POST',credential:'TEST_SECRET',body:'{"id":"only-once"}',timeoutMs:5000});
      await bridge.trustPeer(origin,'00'.repeat(32),'');const wrong=await send();
      await bridge.trustPeer(origin,pin,'00'.repeat(32));const correct=await send();
      const ordinary=await fetch(origin+'/api/v2/state').then(()=>true,()=>false);
      await bridge.trustPeer(origin,'00'.repeat(32),pin);const changed=await send();
      await bridge.trustPeer(origin,pin,'00'.repeat(32));
      return {wrong,correct,ordinary,changed,pin:await bridge.getPeerFingerprint(origin)};
    },{origin,pin});
    expect(result.wrong.ok).toBe(false);expect(result.correct).toMatchObject({ok:true,status:200});expect(result.changed.ok).toBe(false);
    expect(result.ordinary).toBe(false);expect(result.pin).toBe(pin);expect(requests).toEqual(['Device TEST_SECRET']);
    await application.close();application=await launch(profile);if(process.platform==='linux')await application.evaluate(({safeStorage})=>safeStorage.setUsePlainTextEncryption(true));const restarted=await application.firstWindow();await expectRuntimeReady(restarted);
    expect(await restarted.evaluate(origin=>(globalThis as any).streamDashboardDesktop.getPeerFingerprint(origin),origin)).toBe(pin);
  }finally{await application?.close();await new Promise<void>(resolve=>{endpoint.close(()=>resolve());endpoint.closeAllConnections();});await rm(profile,{recursive:true,force:true});}
});
