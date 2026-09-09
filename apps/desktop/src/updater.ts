import { app, autoUpdater, dialog, type BrowserWindow } from 'electron';
import type { DashboardServerHandle } from '../../server/src/index.js';
export function startUpdater(window: BrowserWindow, dashboard: DashboardServerHandle, logger: Pick<Console, 'info' | 'error'> = console) {
  if (!app.isPackaged || process.platform !== 'win32') return () => undefined;
  const feed = `https://update.electronjs.org/Rastaaslan/StreamDashboard/${process.platform}-${process.arch}/${app.getVersion()}`;
  autoUpdater.setFeedURL({ url: feed });
  let ready = false;
  autoUpdater.on('update-downloaded', () => { logger.info('Mise à jour téléchargée'); ready = true; void offerWhenSafe(); });
  autoUpdater.on('error', (error: Error) => logger.error('Erreur updater', error));
  const offerWhenSafe = async () => {
    if (!ready || dashboard.state().obs.streaming) return;
    ready = false;
    const choice = await dialog.showMessageBox(window, { type: 'info', title: 'Mise à jour prête', message: 'Une mise à jour de StreamDashboard est prête.', detail: 'Redémarrer maintenant pour l’installer ?', buttons: ['Plus tard', 'Redémarrer et installer'], defaultId: 1, cancelId: 0 });
    if (choice.response === 1) autoUpdater.quitAndInstall();
  };
  autoUpdater.checkForUpdates();
  const check = setInterval(() => autoUpdater.checkForUpdates(), 30 * 60_000); check.unref();
  const readyWatcher = setInterval(() => { if (ready) void offerWhenSafe(); }, 5_000); readyWatcher.unref();
  return () => { clearInterval(check); clearInterval(readyWatcher); };
}
