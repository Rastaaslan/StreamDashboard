import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { createDashboardWindow, isAllowedTwitchUrl } from './window.js';
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
  if (choice.response === 1) {
    await shell.openPath(path.join(app.getPath('userData'), 'logs'));
    return showStartupError(error);
  }
  if (choice.response === 2) { await boot(); return; }
  app.quit();
};

async function boot(): Promise<void> {
  try {
    await cleanupRuntime();
    if (window && !window.isDestroyed()) window.destroy();
    window = null;
    runtime = await startDesktopRuntime();
    window = createDashboardWindow(runtime.dashboard.url, path.join(import.meta.dirname, 'preload.cjs'));
    stopUpdater = startUpdater(window, runtime.dashboard, runtime.logger, async () => {
      await cleanupRuntime();
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      void Promise.resolve(runtime?.logger.error('Renderer crash', details.reason)).finally(() => {
        void showStartupError(new Error(`Le renderer StreamDashboard s’est arrêté : ${details.reason}`));
      });
    });
    window.webContents.on('did-fail-load', (_event, code, description) => {
      if (code === -3) return; // ERR_ABORTED during an intentional navigation/close.
      void Promise.resolve(runtime?.logger.error('Renderer load failure', code, description)).finally(() => {
        void showStartupError(new Error(description));
      });
    });
  } catch (error) { await showStartupError(error); }
}

app.whenReady().then(() => primary ? boot() : undefined);
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:open-twitch-activation', async (_event, url: unknown) => {
  if (typeof url !== 'string' || !isAllowedTwitchUrl(url)) return false;
  await shell.openExternal(url); return true;
});
ipcMain.handle('app:open-logs', async () => { if (runtime) await shell.openPath(path.dirname(runtime.logger.file)); });
ipcMain.handle('app:ensure-obs-running', async () => runtime?.ensureObsRunning() ?? { launched: false, detail: 'StreamDashboard Desktop n’est pas prêt.' });
ipcMain.on('app:minimize', () => window?.minimize());
ipcMain.on('app:close', () => window?.close());

app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!runtime || quitting) return;
  event.preventDefault();
  quitting = true;
  void cleanupRuntime().catch(error => runtime?.logger.error('Erreur pendant la fermeture', error)).finally(() => app.exit(0));
});

process.on('uncaughtException', error => {
  if (!app.isPackaged) {
    process.removeAllListeners('uncaughtException');
    throw error;
  }
  const fallback = setTimeout(() => app.exit(1), 1_000); fallback.unref();
  void Promise.resolve(runtime?.logger.error('Uncaught exception', error)).finally(() => { clearTimeout(fallback); app.exit(1); });
});
process.on('unhandledRejection', error => { void Promise.resolve(runtime?.logger.error('Unhandled rejection', error)).catch(() => undefined); });
