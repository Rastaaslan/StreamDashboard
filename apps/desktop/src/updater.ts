import { app, autoUpdater, dialog, type BrowserWindow } from 'electron';
import type { DashboardServerHandle } from '../../server/src/index.js';

export function startUpdater(
  window: BrowserWindow,
  dashboard: DashboardServerHandle,
  logger: Pick<Console, 'info' | 'error'> = console,
  beforeInstall: () => Promise<void> = async () => undefined,
) {
  if (!app.isPackaged || process.platform !== 'win32' || process.env.NODE_ENV === 'test') return () => undefined;
  const feed = `https://update.electronjs.org/Rastaaslan/StreamDashboard/${process.platform}-${process.arch}/${app.getVersion()}`;
  autoUpdater.setFeedURL({ url: feed });
  let ready = false;
  let dialogOpen = false;
  let deferredUntil = 0;
  let active = true;

  const logError = (...values: unknown[]) => { void Promise.resolve(logger.error(...values)).catch(() => undefined); };
  const offerWhenSafe = async () => {
    if (!active || !ready || dialogOpen || Date.now() < deferredUntil || dashboard.state().obs.streaming) return;
    dialogOpen = true;
    try {
      const choice = await dialog.showMessageBox(window, {
        type: 'info', title: 'Mise à jour prête', message: 'Une mise à jour de StreamDashboard est prête.',
        detail: 'Redémarrer maintenant pour l’installer ?', buttons: ['Plus tard', 'Redémarrer et installer'], defaultId: 1, cancelId: 0,
      });
      if (choice.response === 1) {
        ready = false;
        try { await beforeInstall(); }
        catch (error) { ready = true; logError('Préparation de la mise à jour impossible', error); return; }
        autoUpdater.quitAndInstall();
      } else {
        deferredUntil = Date.now() + 15 * 60_000;
      }
    } catch (error) { logError('Erreur dialogue updater', error); }
    finally { dialogOpen = false; }
  };
  const onDownloaded = () => {
    void Promise.resolve(logger.info('Mise à jour téléchargée')).catch(() => undefined);
    ready = true; deferredUntil = 0; void offerWhenSafe();
  };
  const onError = (error: Error) => logError('Erreur updater', error);
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error', onError);

  const checkNow = () => { if (active) void Promise.resolve(autoUpdater.checkForUpdates()).catch(error => logError('Vérification updater impossible', error)); };
  const firstCheck = setTimeout(checkNow, process.argv.includes('--squirrel-firstrun') ? 10_000 : 0);
  const check = setInterval(checkNow, 30 * 60_000); check.unref();
  const readyWatcher = setInterval(() => { if (ready) void offerWhenSafe(); }, 5_000); readyWatcher.unref();

  return () => {
    active = false;
    clearTimeout(firstCheck); clearInterval(check); clearInterval(readyWatcher);
    autoUpdater.off('update-downloaded', onDownloaded);
    autoUpdater.off('error', onError);
  };
}
