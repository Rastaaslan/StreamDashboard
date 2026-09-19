import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { copyFile, mkdir, rename, stat, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDashboardWindow, isAllowedExternalAuthUrl, isAllowedTwitchUrl } from './window.js';
import { startDesktopRuntime, type DesktopRuntime } from './lifecycle.js';
import { handleSquirrelStartup } from './squirrel.js';
import { startUpdater } from './updater.js';

const squirrelHandled = handleSquirrelStartup();
app.setName('StreamDashboard');
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.StreamDashboard.StreamDashboard');
const primary = !squirrelHandled && app.requestSingleInstanceLock();
if (!primary) app.quit();

let window: BrowserWindow | null = null;
let runtime: DesktopRuntime | null = null;
let stopUpdater: () => void = () => undefined;
let quitting = false;

app.on('second-instance', () => {
  if (!window || window.isDestroyed()) return;
  if (window.isMinimized()) window.restore();
  window.show(); window.focus();
});

async function cleanupRuntime() {
  stopUpdater(); stopUpdater = () => undefined;
  const current = runtime; runtime = null;
  if (current) await current.stop();
}

const showStartupError = async (error: unknown): Promise<void> => {
  const choice = await dialog.showMessageBox({
    type: 'error', title: 'StreamDashboard n’a pas pu démarrer', message: 'StreamDashboard n’a pas pu démarrer.',
    detail: error instanceof Error ? error.message : String(error), buttons: ['Quitter', 'Ouvrir les logs', 'Réessayer'], defaultId: 2,
  });
  if (choice.response === 1) { await shell.openPath(path.join(app.getPath('userData'), 'logs')); return showStartupError(error); }
  if (choice.response === 2) { await boot(); return; }
  app.quit();
};

async function boot(): Promise<void> {
  try {
    await cleanupRuntime();
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
    runtime = await startDesktopRuntime();
    const preview = process.argv.includes('--ui-preview=desktop-v2');
    const targetUrl = preview ? new URL('/preview/', runtime.dashboard.url).toString() : runtime.dashboard.url;
    window = createDashboardWindow(targetUrl, path.join(import.meta.dirname, 'preload.cjs'), preview ? 'StreamDashboard Desktop Preview' : 'StreamDashboard');
    stopUpdater = startUpdater(window, runtime.dashboard, runtime.logger, async () => { await cleanupRuntime(); });
    window.webContents.on('render-process-gone', (_event, details) => {
      void Promise.resolve(runtime?.logger.error('Renderer crash', details.reason)).finally(() => { void showStartupError(new Error(`Le renderer StreamDashboard s’est arrêté : ${details.reason}`)); });
    });
    window.webContents.on('did-fail-load', (_event, code, description) => {
      if (code === -3) return;
      void Promise.resolve(runtime?.logger.error('Renderer load failure', code, description)).finally(() => { void showStartupError(new Error(description)); });
    });
  } catch (error) { await showStartupError(error); }
}

app.whenReady().then(() => primary ? boot() : undefined);
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
  const options = { title: 'Ajouter un son', properties: ['openFile'] as const, filters: [{ name: 'Audio OBS', extensions: [...SOUND_EXTENSIONS].map(value => value.slice(1)) }] };
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
  if (!runtime || quitting) return;
  event.preventDefault(); quitting = true;
  void cleanupRuntime().catch(error => runtime?.logger.error('Erreur pendant la fermeture', error)).finally(() => app.exit(0));
});

process.on('uncaughtException', error => {
  if (!app.isPackaged) { process.removeAllListeners('uncaughtException'); throw error; }
  const fallback = setTimeout(() => app.exit(1), 1_000); fallback.unref();
  void Promise.resolve(runtime?.logger.error('Uncaught exception', error)).finally(() => { clearTimeout(fallback); app.exit(1); });
});
process.on('unhandledRejection', error => { void Promise.resolve(runtime?.logger.error('Unhandled rejection', error)).catch(() => undefined); });
