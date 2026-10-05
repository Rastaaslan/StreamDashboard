import { app, BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import path from 'node:path';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDashboardWindow, isAllowedExternalAuthUrl, isAllowedTwitchUrl } from './window.js';
import { startDesktopRuntime, type DesktopRuntime } from './lifecycle.js';
import { handleSquirrelStartup } from './squirrel.js';
import { startUpdater } from './updater.js';
import { DesktopLogger } from './logger.js';
import { presentWindow } from './presentation.js';

const squirrelHandled = handleSquirrelStartup();
app.setName('StreamDashboard');
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.StreamDashboard.StreamDashboard');
const logger = new DesktopLogger(path.join(app.getPath('userData'), 'logs'));
const log = (event: string) => { void logger.info(event, { pid: process.pid }).catch(() => undefined); };
const primary = !squirrelHandled && app.requestSingleInstanceLock();
if (!primary) app.quit();
else log('Primary instance acquired');

let window: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let stopUpdater: () => void = () => undefined;
let quitting = false;
let bootPromise: Promise<void> | undefined;
let runtimePromise: Promise<DesktopRuntime> | undefined;
let cleanupPromise: Promise<void> | undefined;
const startup = new AbortController();
let failing = false;

function present() {
  if (!primary || quitting) return;
  log('Window presentation requested');
  if (window && !window.isDestroyed()) presentWindow(window);
  else if (app.isReady()) void boot();
  // Before readiness, boot will create and present the window unconditionally.
}
app.on('second-instance', present);
app.on('activate', present);

function cleanupRuntime(): Promise<void> {
  return cleanupPromise ??= (async () => {
    stopUpdater(); stopUpdater = () => undefined;
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
      const route = preview || !legacy ? (preview ? '/preview/' : '/preview/?runtime=1') : '/';
      const targetUrl = new URL(route, 'http://127.0.0.1:48132').toString();
      window = createDashboardWindow(targetUrl, path.join(import.meta.dirname, 'preload.cjs'), 'StreamDashboard — Démarrage…');
      window.on('closed', () => { window = null; });
      window.webContents.on('render-process-gone', (_event, details) => { void fail(new Error(`Renderer stopped: ${details.reason}`)); });
      window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
        if (isMainFrame && code !== -3) void fail(new Error(`Renderer load failed (${code}): ${description}`));
      });
      presentWindow(window);
      await window.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'"><title>StreamDashboard — Démarrage…</title><body style="background:#080a10;color:#fff;font:20px system-ui;padding:48px"><h1>StreamDashboard</h1><p>Démarrage en cours…</p><p>Vous pouvez fermer cette fenêtre pour annuler.</p></body>'));
      if (quitting) return;
      log('Startup window visible; starting local runtime');
      runtimePromise = startDesktopRuntime(logger, startup.signal);
      runtime = await runtimePromise;
      if (quitting) return;
      log('Local runtime ready; loading renderer');
      stopUpdater = startUpdater(window!, runtime.dashboard, logger, cleanupRuntime);
      await window!.loadURL(targetUrl);
      log('Renderer loaded');
    } catch (error) { await fail(error); }
  })();
}

void app.whenReady().then(() => primary ? boot() : undefined).catch(fail);
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:open-twitch-activation', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !isAllowedTwitchUrl(url)) return false;
  await shell.openExternal(url); return true;
});
ipcMain.handle('app:open-external-auth', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !isAllowedExternalAuthUrl(url)) return false;
  await shell.openExternal(url); return true;
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
  const library = path.join(app.getPath('userData'), 'soundboard'); await mkdir(library, { recursive: true });
  const destination = path.join(library, `${randomUUID()}${path.extname(source).toLowerCase()}`); const temporary = `${destination}.tmp`;
  try { await copyFile(source, temporary); await rename(temporary, destination); } catch (error) { await unlink(temporary).catch(() => undefined); throw error; }
  return { libraryId: path.basename(destination) };
});
ipcMain.on('app:minimize', () => window?.minimize());
ipcMain.on('app:close', () => window?.close());

app.on('window-all-closed', () => app.quit());
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
