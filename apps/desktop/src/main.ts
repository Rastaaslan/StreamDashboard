import { app, BrowserWindow, dialog, ipcMain, shell, Menu, Tray, nativeImage, type OpenDialogOptions } from 'electron';
import path from 'node:path';
import { copyFile, mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDashboardWindow, isAllowedExternalAuthUrl, isAllowedTwitchUrl } from './window.js';
import { startDesktopRuntime, type DesktopRuntime } from './lifecycle.js';
import { handleSquirrelStartup } from './squirrel.js';
import { startUpdater } from './updater.js';
import { DesktopLogger } from './logger.js';
import { presentWindow } from './presentation.js';
import { openTwitchViewerSession } from './twitch-viewer.js';
import { installControllerKeys, startControllerAssets } from './controller.js';
import { requireDesktopRestartSafety } from './restart-safety.js';
import { isSameOrigin } from './security.js';
import type { Server } from 'node:http';
import { InstallationStore } from './installation-store.js';
import type { Installation, InstallationChanges, InstallationPlan, DeviceRole } from '../../mobile/shared/installation.js';

const squirrelHandled = handleSquirrelStartup();
app.setName('StreamDashboard Next');
app.setPath('userData', path.join(app.getPath('appData'), 'StreamDashboard-Next'));
if (process.platform === 'win32') app.setAppUserModelId('com.rastaaslan.StreamDashboard.Next');
const logger = new DesktopLogger(path.join(app.getPath('userData'), 'logs'));
const log = (event: string) => { void logger.info(event, { pid: process.pid }).catch(() => undefined); };
const primary = !squirrelHandled && app.requestSingleInstanceLock();
if (!primary) app.quit();
else log('Primary instance acquired');

let window: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let controllerServer: Server | undefined;
let stopControllerKeys: (() => void) & { restore?: () => Promise<void>; flush?: () => Promise<unknown> } = () => {};
let stopUpdater: () => void = () => undefined;
let quitting = false;
let bootPromise: Promise<void> | undefined;
let runtimePromise: Promise<DesktopRuntime> | undefined;
let cleanupPromise: Promise<void> | undefined;
const startup = new AbortController();
let failing = false;
let controllerRole = false;
let roleChangePending = false;
const roleFile = path.join(app.getPath('userData'), 'device-role.json');
const installations = new InstallationStore(app.getPath('userData'), process.argv.includes('--role=client')?'control':'stream');
let installation: Installation;
const deviceDescriptor = async () => { const value = await installations.read(); return value.devices.find(d => d.id === value.localDeviceId)!; };
let tray: Tray | undefined;
const agentRequested = process.argv.includes('--agent');
let startupAgent = agentRequested;
const backgroundEnabled = () => installation?.background === true || agentRequested;

function ensureTray() {
  if (tray || !backgroundEnabled()) return;
  const icon = nativeImage.createFromPath(path.join(app.getAppPath(), 'resources', 'streamdashboard.ico'));
  tray = new Tray(icon);
  tray.setToolTip('StreamDashboard — agent actif');
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
  else if (app.isReady()) { startupAgent = false; bootPromise = undefined; void boot(); }
  // Before readiness, boot will create and present the window unconditionally.
}
app.on('second-instance', present);
app.on('activate', present);

function cleanupRuntime(): Promise<void> {
  return cleanupPromise ??= (async () => {
    stopUpdater(); stopUpdater = () => undefined;
    tray?.destroy(); tray = undefined;
    stopControllerKeys();
    await stopControllerKeys.flush?.();
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
  await logger.error('Desktop lifecycle failure', error).catch(() => undefined);
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
    try {
      log('Electron ready; creating visible startup window');
      const preview = process.argv.includes('--ui-preview=desktop-v2');
      const legacy = process.argv.includes('--ui-legacy=desktop-v1');
      installation = await installations.read();
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
        stopControllerKeys = installControllerKeys(() => window, app.getPath('userData'), uiOrigin);
        void stopControllerKeys.restore?.();
        if (client) controllerServer = await startControllerAssets(path.join(app.getAppPath(), 'apps', 'mobile'));
        runtimePromise = startDesktopRuntime(logger, startup.signal, client, obsEnabled, deviceDescriptor);
        runtime = await runtimePromise;
        log('Agent ready without a dashboard window');
        return;
      }
      window = createDashboardWindow(targetUrl, path.join(import.meta.dirname, 'preload.cjs'), 'StreamDashboard — Démarrage…');
      window.on('closed', () => { window = null; bootPromise = undefined; });
      window.webContents.on('render-process-gone', (_event, details) => { void fail(new Error(`Renderer stopped: ${details.reason}`)); });
      window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) void fail(new Error(`Renderer load failed (${code}): ${description}`));
      });
      presentWindow(window);
      if (runtime) {
        await window.loadURL(targetUrl + (client ? '?role=client' : ''));
        return;
      }
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>StreamDashboard — Démarrage…</title><body style="background:#080a10;color:#fff;font:20px system-ui;padding:48px"><h1>StreamDashboard</h1><p>Démarrage en cours…</p><p>Vous pouvez fermer cette fenêtre pour annuler.</p></body>'));
      if (quitting) return;
      stopControllerKeys = installControllerKeys(() => window, app.getPath('userData'), uiOrigin);
      void stopControllerKeys.restore?.();
      if (client) {
        controllerServer = await startControllerAssets(path.join(app.getAppPath(), 'apps', 'mobile'));
        runtimePromise = startDesktopRuntime(logger, startup.signal, true, obsEnabled, deviceDescriptor);
        runtime = await runtimePromise;
        if (!quitting) await window!.loadURL(targetUrl + '?role=client');
        return;
      }
      log('Startup window visible; starting local runtime');
      runtimePromise = startDesktopRuntime(logger, startup.signal, false, obsEnabled, deviceDescriptor);
      runtime = await runtimePromise;
      if (quitting) return;
      log('Local runtime ready; loading renderer');
      // Candidate stays isolated: production updater must not replace it or the stable installation.
      if (process.argv.includes('--enable-candidate-updater')) stopUpdater = startUpdater(window!, runtime.dashboard, logger, cleanupRuntime);
      await window!.loadURL(targetUrl);
      log('Renderer loaded');
    } catch (error) { await fail(error); }
  })();
}

void app.whenReady().then(() => primary ? boot() : undefined).catch(fail);
function requireInstallationSender(event: Electron.IpcMainInvokeEvent) {
  const origin = `http://127.0.0.1:${controllerRole ? 48134 : 48133}`;
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isSameOrigin(event.senderFrame?.url || '', origin)) throw new Error('Interface non autorisée.');
}
async function beforeInstallationCommit(plan: InstallationPlan) {
  if (quitting || !runtime) throw new Error('Application en cours de démarrage ou d’arrêt.');
  if (plan.restart) await requireDesktopRestartSafety(() => runtime!.dashboard.assessRestartSafety());
}
function committedInstallation(plan: InstallationPlan) {
  installation = plan.next;
  if (plan.restart) {
    app.relaunch({ args: process.argv.slice(1).filter(value => !value.startsWith('--role=')) });
    setImmediate(() => app.quit());
  } else if (backgroundEnabled()) ensureTray();
  else { tray?.destroy(); tray = undefined; }
  return plan;
}
ipcMain.handle('installation:get', async event => { requireInstallationSender(event); return installations.read(); });
ipcMain.handle('installation:change', async (event, changes: InstallationChanges, revision: number) => {
  requireInstallationSender(event);
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) throw new Error('Modification invalide.');
  return committedInstallation(await installations.change(changes, revision, beforeInstallationCommit));
});
ipcMain.handle('installation:restore', async (event, revision: number) => {
  requireInstallationSender(event);
  return committedInstallation(await installations.restore(revision, beforeInstallationCommit));
});
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:device-profile', async () => {
  let profile: {name?:string;role?:string} | undefined;
  try { profile = JSON.parse(await readFile(roleFile, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  const local = installation?.devices.find(d => d.id === installation.localDeviceId);
  return {name:local?.name || profile?.name,role:local?.roles.includes('obs-executor')?'stream':'control',configured:installation?.configured ?? Boolean(profile)};
});
ipcMain.handle('app:set-device-role', async (event, role: unknown, name: unknown) => {
  const origin = `http://127.0.0.1:${controllerRole ? 48134 : 48133}`;
  if (!window || window.isDestroyed() || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !isSameOrigin(event.senderFrame?.url || '', origin) || !['stream','control'].includes(String(role)) || typeof name !== 'string' || !name.trim() || name.length > 80) throw new Error('Choix de rôle refusé.');
  if (roleChangePending || quitting) throw new Error('Un changement de rôle ou un arrêt est déjà en cours.');
  roleChangePending = true;
  try {
    const current = await installations.read();
    const local = current.devices.find(d => d.id === current.localDeviceId)!;
    const roles: DeviceRole[] = local.roles.filter(value => value !== 'obs-executor');
    if (role === 'stream') roles.push('obs-executor');
    const plan = await installations.change({name:name.trim(),roles},current.revision,beforeInstallationCommit);
    committedInstallation(plan);
    return {restart:plan.restart};
  } finally { roleChangePending = false; }
});
ipcMain.handle('app:open-twitch-activation', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !isAllowedTwitchUrl(url)) return false;
  await shell.openExternal(url); return true;
});
ipcMain.handle('app:open-external-auth', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !isAllowedExternalAuthUrl(url)) return false;
  await shell.openExternal(url); return true;
});
ipcMain.handle('viewer:open-twitch-session', (event, value: unknown) => {
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
ipcMain.handle('app:open-logs', async () => { if (runtime) await shell.openPath(path.dirname(runtime.logger.file)); });
ipcMain.handle('app:ensure-obs-running', async () => runtime?.ensureObsRunning() ?? { launched: false, detail: 'StreamDashboard Desktop n’est pas prêt.' });
const SOUND_EXTENSIONS = new Set(['.wav', '.mp3', '.ogg', '.aac', '.m4a', '.flac']);
ipcMain.handle('soundboard:select-file', async () => {
  const options: OpenDialogOptions = { title: 'Ajouter un son', properties: ['openFile'], filters: [{ name: 'Audio OBS', extensions: [...SOUND_EXTENSIONS].map(value => value.slice(1)) }] };
  const result = window && !window.isDestroyed()
    ? await dialog.showOpenDialog(window, options)
    : await dialog.showOpenDialog(options);
  return result.canceled ? null : result.filePaths[0] ?? null;
});
ipcMain.handle('soundboard:import-file', async (_event, source: unknown) => {
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
    await logger.info('Shutdown complete');
    await logger.flush();
    app.exit(failing ? 1 : 0);
  }).catch(async error => {
    await logger.error('Shutdown failed', error).catch(() => undefined);
    app.exit(1);
  });
});

process.on('uncaughtException', error => { void fail(error); });
process.on('unhandledRejection', error => { void fail(error); });
