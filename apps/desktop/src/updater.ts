import { app, autoUpdater, dialog, type BrowserWindow } from 'electron';
import type { DashboardServerHandle } from '../../server/src/index.js';
import { requireDesktopRestartSafety } from './restart-safety.js';
import { preflightDesktopUpgrade, type DesktopUpgradePreflightDependencies } from './streamcockpit-upgrade.js';

export function startUpdater(
  window: BrowserWindow,
  dashboard: DashboardServerHandle,
  logger: Pick<Console, 'info' | 'error'> = console,
  // Kept for caller compatibility; cleanup must never run for a blocked preflight.
  _beforeInstall: () => Promise<void> = async () => undefined,
  preflightDependencies?: Omit<DesktopUpgradePreflightDependencies, 'assessRestartSafety'>,
) {
  const preflight = () => preflightDesktopUpgrade({
    ...preflightDependencies,
    assessRestartSafety: () => dashboard.assessRestartSafety(),
  });
  if (!app.isPackaged || process.platform !== 'win32' || process.env.NODE_ENV === 'test') {
    return Object.assign(() => undefined, { preflight });
  }
  const feed = `https://update.electronjs.org/Rastaaslan/StreamDashboard/${process.platform}-${process.arch}/${app.getVersion()}`;
  autoUpdater.setFeedURL({ url: feed });
  let ready = false;
  let dialogOpen = false;
  let deferredUntil = 0;
  let active = true;

  const logError = (...values: unknown[]) => { void Promise.resolve(logger.error(...values)).catch(() => undefined); };
  const offerWhenSafe = async () => {
    if (!active || !ready || dialogOpen || Date.now() < deferredUntil) return;
    dialogOpen = true;
    try {
      // This covers every configured OBS output, including Aitum. Unknown
      // observations never authorize a restart, and slow reads cannot overlap.
      try { await requireDesktopRestartSafety(() => dashboard.assessRestartSafety()); }
      catch { return; }
      if (!active || !ready) return;
      const choice = await dialog.showMessageBox(window, {
        type: 'info', title: 'Mise à jour téléchargée', message: 'Une mise à jour de StreamDashboard doit être vérifiée.',
        detail: 'Vérifier les conditions de mise à jour. L’installation transactionnelle n’est pas encore disponible.', buttons: ['Plus tard', 'Vérifier le préflight'], defaultId: 0, cancelId: 0,
      });
      if (choice.response === 1) {
        if (!active || !ready) return;
        try { await requireDesktopRestartSafety(() => dashboard.assessRestartSafety()); }
        catch { logError('Installation différée : une diffusion est active ou non confirmée'); return; }
        if (!active || !ready) return;
        ready = false;
        const report = await preflight();
        logError('Installation bloquée par le préflight', report);
        if (active) await dialog.showMessageBox(window, {
          type: 'warning', title: 'Mise à jour bloquée',
          message: 'Aucun redémarrage ni installation effectué.',
          detail: report.reasons.join('\n'), buttons: ['Fermer'], defaultId: 0, cancelId: 0,
        });
      } else {
        deferredUntil = Date.now() + 15 * 60_000;
      }
    } catch { logError('Erreur dialogue updater (détails masqués)'); }
    finally { dialogOpen = false; }
  };
  const onDownloaded = () => {
    void Promise.resolve(logger.info('Mise à jour téléchargée')).catch(() => undefined);
    ready = true; deferredUntil = 0; void offerWhenSafe();
  };
  const onError = () => logError('Erreur updater (détails masqués)');
  autoUpdater.on('update-downloaded', onDownloaded);
  autoUpdater.on('error', onError);

  const checkNow = () => {
    if (!active) return;
    try {
      void Promise.resolve(autoUpdater.checkForUpdates()).catch(() => logError('Vérification updater impossible (détails masqués)'));
    } catch {
      // Some Electron backends throw synchronously before returning a promise.
      logError('Vérification updater impossible (détails masqués)');
    }
  };
  const firstCheck = setTimeout(checkNow, process.argv.includes('--squirrel-firstrun') ? 10_000 : 0);
  const check = setInterval(checkNow, 30 * 60_000); check.unref();
  const readyWatcher = setInterval(() => { if (ready) void offerWhenSafe(); }, 5_000); readyWatcher.unref();

  return Object.assign(() => {
    active = false;
    clearTimeout(firstCheck); clearInterval(check); clearInterval(readyWatcher);
    autoUpdater.off('update-downloaded', onDownloaded);
    autoUpdater.off('error', onError);
  }, { preflight });
}
