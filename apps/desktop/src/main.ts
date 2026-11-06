import { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, nativeImage, protocol, Notification, type OpenDialogOptions } from 'electron';
import path from 'node:path';
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDashboardWindow, isAllowedExternalAuthUrl, isAllowedTwitchUrl } from './window.js';
import { startDesktopRuntime, type DesktopRuntime } from './lifecycle.js';
import { acquireDesktopApplicationOwnership, type DesktopApplicationOwnership } from './streamcockpit-application-ownership.js';
import { handleSquirrelStartup } from './squirrel.js';
import { startUpdater } from './updater.js';
import { DesktopLogger } from './logger.js';
import { presentWindow } from './presentation.js';
import { openTwitchViewerSession } from './twitch-viewer.js';
import { installControllerKeys, startControllerAssets } from './controller.js';
import { requireDesktopRestartSafety } from './restart-safety.js';
import { isSameOrigin } from './security.js';
import type { Server } from 'node:http';
import { configureLoginStartup } from './login-startup.js';
import { InstallationStore } from './installation-store.js';
import { desktopUserData } from './qa-profile.js';
import {ControllerAgentLink} from '../../controller/src/agent-link.js';
import {loadManagedControllerPeer} from '../../agent/src/readonly-network-config.js';
import {PeerTransport} from './peer-transport.js';
import {ElectronSecretStore} from './secrets.js';
import {createAgentCertificate} from './agent-certificate.js';
import {djiNotificationDefinition} from './dji-notification.js';
import {DjiBackgroundPublisher} from './dji-background-publisher.js';
import {DjiHostWarningWatcher} from './dji-host-warning-watcher.js';
import {X509Certificate} from 'node:crypto';
import {AutonomousExecutor} from './autonomous-executor.js';
import type { Installation, InstallationChanges, InstallationPlan, InstallationDevice, DeviceRole } from '../../mobile/shared/installation.js';

protocol.registerSchemesAsPrivileged([{scheme:'streamdashboard-audio',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}}]);
const squirrelHandled = handleSquirrelStartup();
app.setName('StreamDashboard Next');
app.setPath('userData', desktopUserData(path.join(app.getPath('appData'), 'StreamDashboard-Next')));
if (process.platform === 'win32') app.setAppUserModelId('com.rastaaslan.StreamDashboard.Next');
const logger = new DesktopLogger(path.join(app.getPath('userData'), 'logs'));
const desktopSecrets=new ElectronSecretStore(app.getPath('userData'));
const peers=new PeerTransport(desktopSecrets);
const peerRequests=new Map<string,AbortController>();
const nodeAgent=new ControllerAgentLink(()=>loadManagedControllerPeer(process.env));
let applicationOwnership: DesktopApplicationOwnership | undefined;
let applicationOwnershipPromise: Promise<DesktopApplicationOwnership> | undefined;
const profileAccessAllowed = () => process.platform !== 'win32' || Boolean(applicationOwnership);
const log = (event: string) => { if (profileAccessAllowed()) void logger.info(event, { pid: process.pid }).catch(() => undefined); };
const pendingMainWork = new Set<Promise<void>>();
// UI completion promises can outlive their windows. Native session writes remain
// covered by process-lifetime ownership until exit; do not await window closure.
const presentationOnly = new Set(['viewer:open-twitch-session', 'soundboard:select-file',
  'app:open-external-auth', 'app:open-twitch-activation', 'app:open-logs']);
function registerMainHandler(channel: string, handler: Parameters<typeof ipcMain.handle>[1]) {
  ipcMain.handle(channel, (event, ...args) => {
    if (quitting || !profileAccessAllowed()) throw new Error('APPLICATION_NOT_READY');
    if (presentationOnly.has(channel)) return handler(event, ...args);
    // Register before calling out, including a reentrant request to quit. Keep
    // synchronous return/throw semantics required by existing trusted handlers.
    let settle!: () => void;
    const pending = new Promise<void>(resolve => { settle = resolve; });
    pendingMainWork.add(pending);
    const finish = () => { pendingMainWork.delete(pending); settle(); };
    try {
      const result: unknown = handler(event, ...args);
      if (result && typeof (result as PromiseLike<unknown>).then === 'function')
        return Promise.resolve(result).then(value => { finish(); return value; }, error => { finish(); throw error; });
      finish(); return result;
    } catch (error) { finish(); throw error; }
  });
}
const primary = !squirrelHandled && app.requestSingleInstanceLock();
if (!primary) app.quit();
// The first profile log is emitted only after application ownership is acquired.

let window: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let controllerServer: Server | undefined;
let controllerRestore: Promise<void> | undefined;
let stopControllerKeys: (() => void) & { restore?: () => Promise<void>; flush?: () => Promise<unknown> } = () => {};
let stopUpdater: () => void = () => undefined;
let quitting = false;
let bootPromise: Promise<void> | undefined;
let booting = false;
let runtimePromise: Promise<DesktopRuntime> | undefined;
let cleanupPromise: Promise<void> | undefined;
const startup = new AbortController();
let failing = false;
let controllerRole = false;
let djiBackgroundPublisher: DjiBackgroundPublisher | undefined;
let djiHostWarningWatcher: DjiHostWarningWatcher | undefined;
let roleChangePending = false;
const roleFile = path.join(app.getPath('userData'), 'device-role.json');
const installations = new InstallationStore(app.getPath('userData'), process.argv.includes('--role=client')?'control':'stream');
let installation: Installation;
let activeDevice:InstallationDevice;
const deviceDescriptor = async () => { const value = await installations.read(); return value.devices.find(d => d.id === value.localDeviceId)!; };
let tray: Tray | undefined;
const agentRequested = process.argv.includes('--agent');
let startupAgent = agentRequested;
const backgroundEnabled = () => installation?.background === true || agentRequested;
const autonomous=new AutonomousExecutor(()=>`http://127.0.0.1:${controllerRole?48134:48133}`,async()=>{
  await runtimePromise;
  if(quitting||!runtime)throw new Error('Agent local indisponible.');
  return {endpoint:`http://127.0.0.1:${controllerRole?48135:48133}`,device:activeDevice};
});

function ensureTray() {
  if (tray || !backgroundEnabled()) return;
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'streamdashboard.ico'));
  tray = new Tray(icon);
  tray.setToolTip('Le StreamCockpit — agent actif');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Ouvrir StreamDashboard', click: present },
    { label: 'Quitter l’agent et les macros', click: () => app.quit() },
  ]));
  tray.on('double-click', present);
}

function present() {
  if (!primary || quitting) return;
  log('Window presentation requested');
  if (window && !window.isDestroyed()) presentWindow(window);
  else if (booting && bootPromise) { void bootPromise.then(() => { if(!quitting)present(); }); }
  else if (app.isReady()) { startupAgent = false; bootPromise = undefined; void boot(); }
  // Before readiness, boot will create and present the window unconditionally.
}
app.on('second-instance', present);
app.on('activate', present);

/**
 * Battery telemetry runs in the Electron main process, not in a browser tab.
 * Thus minimizing/hiding the game-control UI does not suspend the USB relay.
 */
function enableDjiBackgroundPublisher() {
  if(!controllerRole||!runtime||djiBackgroundPublisher)return;
  const dashboard=runtime.dashboard;
  const publisher=new DjiBackgroundPublisher({
    topology:()=>installations.read(),
    localRead:async()=>{
      const response=await fetch(dashboard.url+'/api/v1/dji/mic-battery',{
        signal:AbortSignal.timeout(12_000),redirect:'error',
      });
      if(!response.ok)throw new Error('Lecture locale des batteries indisponible.');
      return response.json();
    },
    send:async(host,measurement)=>{
      const credential=await desktopSecrets.getControllerDevice(host);
      if(!credential)throw new Error('Régie fixe non appairée.');
      const response=await peers.fetch(host+'/api/v1/dji/telemetry',{
        method:'POST',
        headers:{Authorization:'Device '+credential,'Content-Type':'application/json'},
        body:JSON.stringify(measurement),
        signal:AbortSignal.timeout(12_000),
        redirect:'error',
      });
      if(response.status!==202)throw new Error('Le PC fixe n’a pas accepté la télémétrie DJI.');
    },
  });
  djiBackgroundPublisher=publisher;
  publisher.start();
}
/**
 * OBS host warnings run in Electron's main process, even when the dashboard
 * tab or window is hidden. No commands go to OBS or DJI hardware.
 */
function enableDjiHostWarningWatcher() {
  if(controllerRole||!runtime||djiHostWarningWatcher||typeof runtime.dashboard.state!=='function')return;
  const dashboard=runtime.dashboard;
  const watcher=new DjiHostWarningWatcher({
    streaming:()=>dashboard.state().obs.streaming===true,
    read:async()=>{
      const response=await fetch(dashboard.url+'/api/v1/dji/overview',{
        signal:AbortSignal.timeout(12_000),redirect:'error',
      });
      if(!response.ok)throw new Error('Batterie DJI indisponible.');
      return response.json();
    },
    notify:code=>{ showDjiNativeWarning(code); },
  });
  djiHostWarningWatcher=watcher;
  watcher.start();
}
function cleanupRuntime(): Promise<void> {
  return cleanupPromise ??= (async () => {
    stopUpdater(); stopUpdater = () => undefined;
    djiBackgroundPublisher?.stop(); djiBackgroundPublisher=undefined;
    djiHostWarningWatcher?.stop(); djiHostWarningWatcher=undefined;
    tray?.destroy(); tray = undefined;
    stopControllerKeys();
    for(const request of peerRequests.values())request.abort();
    await Promise.all([...pendingMainWork]);
    await installationChange;
    await bootPromise;
    await controllerRestore;
    await stopControllerKeys.flush?.();
    await autonomous.dispose();
    await nodeAgent.stop();
    await peers.close();
    if (controllerServer) await new Promise<void>((resolve,reject) => {
      controllerServer!.close(error => error ? reject(error) : resolve());
      // Chromium can keep speculative HTTP connections open after embedded views
      // close. This server only serves static client assets; no business writes.
      controllerServer!.closeAllConnections();
    });
    // Acquisition and teardown have one owner, even when quit races startup.
    // Startup cancellation interrupts provider I/O, but never abandons cleanup.
    let current: DesktopRuntime | undefined;
    try { current = await runtimePromise; }
    catch (error) { if (error !== startup.signal.reason) throw error; }
    if (current) await current.stop();
    runtime = null;
  })();
}

async function fail(error: unknown): Promise<void> {
  if (failing || quitting || !primary) return;
  failing = true;
  if (profileAccessAllowed()) await logger.error('Desktop lifecycle failure', error).catch(() => undefined);
  try {
    dialog.showErrorBox('StreamDashboard n’a pas pu démarrer',
      `Le démarrage ou le chargement a échoué. Fermez puis relancez StreamDashboard.\nDiagnostics : ${logger.file}`);
  } finally {
    app.quit();
  }
}

function boot(): Promise<void> {
  if (quitting) return Promise.resolve();
  return bootPromise ??= (async () => {
    booting = true;
    try {
      if (process.platform === 'win32') {
        applicationOwnershipPromise ??= acquireDesktopApplicationOwnership(
          app.getPath('appData'), app.getPath('userData'), app.getVersion());
        applicationOwnership = await applicationOwnershipPromise;
      }
      startup.signal.throwIfAborted();
      log('Electron ready; creating visible startup window');
      nodeAgent.start();
      const preview = process.argv.includes('--ui-preview=desktop-v2') && await stat(path.join(app.getAppPath(),'apps/web/preview/index.html')).then(()=>true,()=>false);
      const legacy = process.argv.includes('--ui-legacy=desktop-v1');
      installation = await installations.recover(async current => { configureLoginStartup(app, Boolean(current.startAtLogin)); });
      startup.signal.throwIfAborted();
      if(!runtime)activeDevice=structuredClone(installation.devices.find(d=>d.id===installation.localDeviceId)!);
      // The original runtime directory and origin never change with roles.
      // This preserves RC11.7 accounts, caches, data and browser sessions.
      const client = installation.runtimeProfile === 'device-runtime';
      const obsEnabled = installation.devices.find(d => d.id === installation.localDeviceId)!.roles.includes('obs-executor');
      controllerRole = client;
      const route = legacy ? '/' : preview ? '/preview/' : '/mobile/control/';
      const uiOrigin = `http://127.0.0.1:${client ? 48134 : 48133}`;
      const targetUrl = new URL(route, uiOrigin).toString();
      ensureTray();
      if (!runtime && startupAgent) {
        stopControllerKeys = installControllerKeys(() => window, app.getPath('userData'), uiOrigin,peers.fetch,installation.devices.find(d=>d.id===installation.localDeviceId)!.roles.includes('controller'),autonomous);
        controllerRestore = Promise.resolve(stopControllerKeys.restore?.());
        void controllerRestore.catch(fail);
        if (client) controllerServer = await startControllerAssets(path.join(app.getAppPath(), 'apps', 'mobile'));
        runtimePromise = startDesktopRuntime(logger, startup.signal, client, obsEnabled, deviceDescriptor, applicationOwnership);
        runtime = await runtimePromise;
        if (quitting) return;
        enableDjiBackgroundPublisher();
        enableDjiHostWarningWatcher();
        log('Agent ready without a dashboard window');
        return;
      }
      window = createDashboardWindow(targetUrl, path.join(import.meta.dirname, 'preload.cjs'), 'Le StreamCockpit — Démarrage…');
      const owner = window;
      let closing = false;
      owner.on('close', () => { closing = true; });
      owner.on('closed', () => { closing = true; if(window === owner)window = null; if(!backgroundEnabled())app.quit(); });
      const loadWindow = async (url: string) => {
        if(closing || owner.isDestroyed())return;
        try { await owner.loadURL(url); }
        catch(error) { if(!closing && !owner.isDestroyed())throw error; }
      };
      window.webContents.on('render-process-gone', (_event, details) => { if(!closing && window === owner)void fail(new Error(`Renderer stopped: ${details.reason}`)); });
      window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (!closing && window === owner && isMainFrame && code !== -3) void fail(new Error(`Renderer load failed (${code}): ${description}`));
      });
      presentWindow(window);
      if (runtime) {
        await loadWindow(targetUrl + (client ? '?role=client' : ''));
        return;
      }
      await loadWindow('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>StreamDashboard — Démarrage…</title><body style="background:#080a10;color:#fff;font:20px system-ui;padding:48px"><h1>Le StreamCockpit</h1><p>Démarrage en cours…</p><p>Vous pouvez fermer cette fenêtre pour annuler.</p></body>'));
      if (quitting) return;
      stopControllerKeys = installControllerKeys(() => window, app.getPath('userData'), uiOrigin,peers.fetch,installation.devices.find(d=>d.id===installation.localDeviceId)!.roles.includes('controller'),autonomous);
      controllerRestore = Promise.resolve(stopControllerKeys.restore?.());
      void controllerRestore.catch(fail);
      if (client) {
        controllerServer = await startControllerAssets(path.join(app.getAppPath(), 'apps', 'mobile'));
        runtimePromise = startDesktopRuntime(logger, startup.signal, true, obsEnabled, deviceDescriptor, applicationOwnership);
        runtime = await runtimePromise;
        if (quitting) return;
        enableDjiBackgroundPublisher();
        enableDjiHostWarningWatcher();
        if (!quitting) await loadWindow(targetUrl + '?role=client');
        return;
      }
      log('Startup window visible; starting local runtime');
      runtimePromise = startDesktopRuntime(logger, startup.signal, false, obsEnabled, deviceDescriptor, applicationOwnership);
      runtime = await runtimePromise;
      if (quitting) return;
      enableDjiHostWarningWatcher();
      log('Local runtime ready; loading renderer');
      // Candidate stays isolated: production updater must not replace it or the stable installation.
      if (!closing && process.argv.includes('--enable-candidate-updater')) stopUpdater = startUpdater(owner, runtime.dashboard, logger, cleanupRuntime);
      await loadWindow(targetUrl);
      log('Renderer loaded');
    } catch (error) { await fail(error); }
  })().finally(() => { booting = false; });
}

void app.whenReady().then(() => primary ? boot() : undefined).catch(fail);
function requireInstallationSender(event: Electron.IpcMainInvokeEvent) {
  const origin = `http://127.0.0.1:${controllerRole ? 48134 : 48133}`;
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isSameOrigin(event.senderFrame?.url || '', origin)) throw new Error('Interface non autorisée.');
}
async function beforeInstallationCommit(plan: InstallationPlan) {
  if (quitting || installationRestartPending || !runtime) throw new Error('Application en cours de démarrage ou d’arrêt.');
  if (plan.restart) await requireDesktopRestartSafety(() => runtime!.dashboard.assessRestartSafety());
  if (Boolean(plan.next.startAtLogin) !== Boolean(installation.startAtLogin)) configureLoginStartup(app, Boolean(plan.next.startAtLogin));
}
function committedInstallation(plan: InstallationPlan) {
  installation = plan.next;
  if (plan.restart) {
    installationRestartPending=true;
    try{app.relaunch({ args: process.argv.slice(1).filter(value => !value.startsWith('--role=')) });}catch(error){installationRestartPending=false;throw error;}
    setImmediate(() => app.quit());
  } else if (backgroundEnabled()) ensureTray();
  else { tray?.destroy(); tray = undefined; }
  return plan;
}
let installationChange: Promise<unknown> = Promise.resolve();
let installationRestartPending=false;
function applyInstallation(operation: () => Promise<InstallationPlan>) {
  const pending = installationChange.then(async () => {
    try {
      await installations.recover(async current => { configureLoginStartup(app, Boolean(current.startAtLogin)); });
      return committedInstallation(await operation());
    }
    catch (error) {
      // A disk failure must not leave a different Windows startup setting active.
      try { installation = await installations.recover(async current => { configureLoginStartup(app, Boolean(current.startAtLogin)); }); }
      catch { throw new Error('Configuration non appliquée. Vérifiez le démarrage automatique dans les paramètres Windows avant de réessayer.'); }
      throw error;
    }
  });
  installationChange = pending.catch(() => undefined);
  return pending;
}
registerMainHandler('node-agent:status',event=>{
  requireInstallationSender(event);nodeAgent.start();return nodeAgent.snapshot();
});
registerMainHandler('installation:get', async event => { requireInstallationSender(event); return installations.read(); });
registerMainHandler('twitch:local-credential', async event => {
  requireInstallationSender(event);
  const current = await runtimePromise;
  requireInstallationSender(event);
  if (controllerRole || quitting || !current?.dashboard.issueLocalTwitchCredential) throw new Error('LOCAL_TWITCH_AUTHORITY_UNAVAILABLE');
  return current.dashboard.issueLocalTwitchCredential();
});
registerMainHandler('autonomous:request',async(event,operation:'state'|'command',body?:unknown)=>{requireInstallationSender(event);return autonomous.request(operation,body);});
const agentIdentityStore=new ElectronSecretStore(app.getPath('userData'));
registerMainHandler('peer:identity',async event=>{
  requireInstallationSender(event);const saved=await agentIdentityStore.getAgentCertificate();
  if(!saved)return {fingerprint:'',expires:''};
  const certificate=new X509Certificate(saved.certificate);
  return {fingerprint:certificate.fingerprint256.replaceAll(':','').toLowerCase(),expires:new Date(certificate.validTo).toISOString()};
});
registerMainHandler('peer:renew',async(event,expected:string)=>{
  requireInstallationSender(event);
  const operation=installationChange.then(async()=>{
    if(!runtime)throw new Error('Attendez la fin du démarrage de l’agent.');
    await requireDesktopRestartSafety(()=>runtime!.dashboard.assessRestartSafety());
    const saved=await agentIdentityStore.getAgentCertificate();
    const fingerprint=saved?new X509Certificate(saved.certificate).fingerprint256.replaceAll(':','').toLowerCase():'';
    if(expected!==fingerprint)throw new Error('Certificat modifié ailleurs. Actualisez les informations de cet agent.');
    const replacement=await createAgentCertificate();
    await requireDesktopRestartSafety(()=>runtime!.dashboard.assessRestartSafety());
    await agentIdentityStore.replaceAgentCertificate(replacement,saved?.certificate||'');
    try{app.relaunch();}catch(error){await agentIdentityStore.replaceAgentCertificate(saved,replacement.certificate);throw error;}
    setImmediate(()=>app.quit());
    return {restart:true};
  });
  installationChange=operation.catch(()=>undefined);return operation;
});
// Only the trusted dashboard renderer can request fixed, whitelisted DJI
// notification messages. Main-process cooldown also defends against rerenders.
const nativeDjiWarningAt=new Map<string,number>();
function showDjiNativeWarning(code:unknown) {
  const def=djiNotificationDefinition(code);
  if(!def||!Notification.isSupported())return false;
  const now=Date.now(),key=code as string;
  if(now-(nativeDjiWarningAt.get(key)||0)<300_000)return false;
  nativeDjiWarningAt.set(key,now);
  const warning=new Notification({title:def.title,body:def.body,silent:false});
  warning.on('click',()=>present());
  warning.show();
  return true;
}
registerMainHandler('dji:warning',(event,code:unknown)=>{
  requireInstallationSender(event);
  return showDjiNativeWarning(code);
});
registerMainHandler('peer:fingerprint',async(event,origin:string)=>{requireInstallationSender(event);return peers.fingerprint(origin);});
registerMainHandler('peer:trust',async(event,origin:string,fingerprint:string,expected:string)=>{requireInstallationSender(event);await peers.trust(origin,fingerprint,expected);});
registerMainHandler('peer:cancel',async(event,id:string)=>{requireInstallationSender(event);peerRequests.get(id)?.abort();});
registerMainHandler('peer:request',async(event,value:{id:string;url:string;method:string;credential:string;body?:string|Uint8Array;contentType?:string;timeoutMs:number})=>{
  requireInstallationSender(event);
  if(!value||!/^[-\w]{8,100}$/.test(value.id)||peerRequests.has(value.id)||peerRequests.size>=32||typeof value.url!=='string'||value.url.length>4096||typeof value.credential!=='string'||value.credential.length>256||!['GET','POST','PUT','DELETE'].includes(value.method)||!Number.isFinite(value.timeoutMs)||value.timeoutMs<1000||value.timeoutMs>120000)throw new Error('Requête d’agent invalide ou service occupé.');
  if(value.body!==undefined&&!(typeof value.body==='string'?value.body.length<=16*1024*1024:value.body instanceof Uint8Array&&value.body.byteLength<=100*1024*1024))throw new Error('Corps de requête invalide.');
  const controller=new AbortController();peerRequests.set(value.id,controller);
  try {
    const response=await peers.fetch(value.url,{method:value.method,headers:{...(value.credential?{Authorization:'Device '+value.credential}:{}),...(value.body!==undefined?{'Content-Type':value.contentType==='application/octet-stream'?'application/octet-stream':'application/json'}:{})},body:value.body===undefined?undefined:typeof value.body==='string'?value.body:Buffer.from(value.body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(value.timeoutMs)])});
    const reader=response.body?.getReader();let size=0;const chunks:Uint8Array[]=[];
    if(reader)while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>32*1024*1024){await reader.cancel();throw new Error('Réponse d’agent trop volumineuse.');}chunks.push(part.value);}
    return {ok:true,status:response.status,body:Buffer.concat(chunks).toString('utf8')};
  }catch{return {ok:false,error:{code:'PEER_TRANSPORT_FAILED',message:'Connexion sécurisée non confirmée. Vérifiez l’empreinte de l’agent et son réseau ; aucune commande ne sera répétée.'}};}
  finally {peerRequests.delete(value.id);}
});
registerMainHandler('installation:change', async (event, changes: InstallationChanges, revision: number) => {
  requireInstallationSender(event);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Modification invalide.');
  return applyInstallation(() => installations.change(changes, revision, beforeInstallationCommit));
});
registerMainHandler('installation:restore', async (event, revision: number) => {
  requireInstallationSender(event);
  return applyInstallation(() => installations.restore(revision, beforeInstallationCommit));
});
ipcMain.handle('app:get-version', () => app.getVersion());
registerMainHandler('app:device-profile', async () => {
  let profile: {name?:string;role?:string} | undefined;
  try { profile = JSON.parse(await readFile(roleFile, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const local = installation?.devices.find(d => d.id === installation.localDeviceId);
  return {name:local?.name || profile?.name,role:local?.roles.includes('obs-executor')?'stream':'control',configured:installation?.configured ?? Boolean(profile)};
});
registerMainHandler('app:set-device-role', async (event, role: unknown, name: unknown) => {
  const origin = `http://127.0.0.1:${controllerRole ? 48134 : 48133}`;
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isSameOrigin(event.senderFrame?.url || '', origin) || !['stream','control'].includes(String(role)) || typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Choix de rôle refusé.');
  if (roleChangePending || quitting) throw new Error('Un changement de rôle ou un arrêt est déjà en cours.');
  roleChangePending = true;
  try {
    const plan = await applyInstallation(async()=>{
      const current = await installations.read();
      const local = current.devices.find(d => d.id === current.localDeviceId)!;
      const roles: DeviceRole[] = local.roles.filter(value => value !== 'obs-executor');
      if (role === 'stream') roles.push('obs-executor');
      return installations.change({name:name.trim(),roles},current.revision,beforeInstallationCommit);
    });
    return {restart:plan.restart};
  } finally { roleChangePending = false; }
});
registerMainHandler('app:open-twitch-activation', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !isAllowedTwitchUrl(url)) return false;
  await shell.openExternal(url); return true;
});
registerMainHandler('app:open-external-auth', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !isAllowedExternalAuthUrl(url)) return false;
  await shell.openExternal(url); return true;
});
registerMainHandler('viewer:open-twitch-session', (event, value: unknown) => {
  const owner = window;
  const origin = `http://127.0.0.1:${controllerRole ? 48134 : 48133}`;
  if (!owner || owner.isDestroyed() || event.sender !== owner.webContents
    || event.senderFrame !== owner.webContents.mainFrame
    || new URL(event.senderFrame?.url || 'about:blank').origin !== origin) {
    throw new Error('Interface non autorisée.');
  }
  const channel = value && typeof value === 'object' ? (value as {channel?: unknown}).channel : undefined;
  if (typeof channel !== 'string' || !/^[a-zA-Z0-9_]{1,25}$/.test(channel)) throw new Error('Chaîne Twitch invalide.');
  return openTwitchViewerSession(owner, channel);
});
registerMainHandler('app:open-logs', async () => { if (runtime) await shell.openPath(path.dirname(runtime.logger.file)); });
registerMainHandler('app:ensure-obs-running', async () => runtime?.ensureObsRunning() ?? { launched: false, detail: 'StreamDashboard Desktop n’est pas prêt.' });
const SOUND_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.aac', '.m4a', '.flac']);
registerMainHandler('soundboard:select-file', async () => {
  const options: OpenDialogOptions = { title: 'Ajouter un son', properties: ['openFile'], filters: [{ name: 'Audio OBS', extensions: [...SOUND_EXTENSIONS].map(value => value.slice(1)) }] };
  const result = window && !window.isDestroyed()
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});
registerMainHandler('soundboard:import-file', async (_event, source: unknown) => {
  if (typeof source !== 'string' || !path.isAbsolute(source) || !SOUND_EXTENSIONS.has(path.extname(source).toLowerCase())) throw new Error('Format audio refusé.');
  const info = await stat(source); if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('Le fichier audio est invalide ou dépasse 100 Mo.');
  // The client has its own local runtime and library; an import must not end up
  // in the host role's profile, where that runtime cannot resolve its libraryId.
  const library = path.join(app.getPath('userData'), ...(controllerRole ? ['device-runtime'] : []), 'soundboard'); await mkdir(library, { recursive: true });
  const destination = path.join(library, `${randomUUID()}${path.extname(source).toLowerCase()}`); const temporary = `${destination}.tmp`;
  try { await copyFile(source, temporary); await rename(temporary, destination); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  return { libraryId: path.basename(destination) };
});
ipcMain.on('app:minimize', () => window?.minimize());
ipcMain.on('app:close', () => window?.close());

app.on('window-all-closed', () => { if (!runtime || !backgroundEnabled()) app.quit(); });
app.on('before-quit', event => {
  if (!primary) return;
  event.preventDefault();
  if (quitting) return;
  quitting = true;
  log('Shutdown requested');
  startup.abort(new Error('Desktop startup cancelled'));
  void cleanupRuntime().then(async () => {
    if (profileAccessAllowed()) {
      await logger.info('Shutdown complete');
      await logger.flush();
    }
    // Retain application ownership until OS process exit: pending renderer or
    // final logging work must never open a maintenance window after runtime.stop.
    app.exit(failing ? 1 : 0);
  }).catch(async error => {
    if (profileAccessAllowed()) await logger.error('Shutdown failed', error).catch(() => undefined);
    app.exit(1);
  });
});

process.on('uncaughtException', error => { void fail(error); });
process.on('unhandledRejection', error => { void fail(error); });
