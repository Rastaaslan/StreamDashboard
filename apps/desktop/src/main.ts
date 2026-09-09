import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import path from 'node:path';
import { createDashboardWindow, isAllowedTwitchUrl } from './window.js';
import { startDesktopRuntime, type DesktopRuntime } from './lifecycle.js';
import { startUpdater } from './updater.js';

app.setName('StreamDashboard');
if (process.platform === 'win32') app.setAppUserModelId('com.squirrel.StreamDashboard.StreamDashboard');
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
let window: BrowserWindow | null = null; let runtime: DesktopRuntime | null = null; let stopUpdater: () => void = () => undefined;
app.on('second-instance', () => { if (!window) return; if (window.isMinimized()) window.restore(); window.show(); window.focus(); });
const showStartupError = async (error: unknown) => { const choice = await dialog.showMessageBox({ type: 'error', title: 'StreamDashboard n’a pas pu démarrer', message: 'StreamDashboard n’a pas pu démarrer.', detail: error instanceof Error ? error.message : String(error), buttons: ['Quitter', 'Ouvrir les logs', 'Réessayer'], defaultId: 2 }); if (choice.response === 1) await shell.openPath(path.join(app.getPath('userData'), 'logs')); if (choice.response === 2) return boot(); app.quit(); };
async function boot(): Promise<void> { try { runtime = await startDesktopRuntime(); window = createDashboardWindow(runtime.dashboard.url, path.join(import.meta.dirname, 'preload.js')); stopUpdater = startUpdater(window, runtime.dashboard, runtime.logger); window.webContents.on('render-process-gone', (_event: unknown, details: { reason: string }) => runtime?.logger.error('Renderer crash', details.reason)); window.webContents.on('did-fail-load', (_event: unknown, code: number, description: string) => { runtime?.logger.error('Renderer load failure', code, description); void showStartupError(new Error(description)); }); } catch (error) { await showStartupError(error); } }
app.whenReady().then(() => primary ? boot() : undefined);
ipcMain.handle('app:get-version', () => app.getVersion());
ipcMain.handle('app:open-twitch-activation', async (_event: unknown, url: unknown) => { if (typeof url !== 'string' || !isAllowedTwitchUrl(url)) return false; await shell.openExternal(url); return true; });
ipcMain.handle('app:open-logs', async () => { if (runtime) await shell.openPath(path.dirname(runtime.logger.file)); });
ipcMain.handle('app:ensure-obs-running', async () => runtime?.ensureObsRunning() ?? { launched: false, detail: 'StreamDashboard Desktop n’est pas prêt.' });
ipcMain.on('app:minimize', () => window?.minimize()); ipcMain.on('app:close', () => window?.close());
app.on('window-all-closed', () => app.quit());
app.on('before-quit', (event: { preventDefault(): void }) => { if (!runtime) return; event.preventDefault(); const current = runtime; runtime = null; stopUpdater(); void current.stop().finally(() => app.exit(0)); });
process.on('uncaughtException', error => { runtime?.logger.error(error); if (!app.isPackaged) throw error; });
process.on('unhandledRejection', error => runtime?.logger.error(error));
