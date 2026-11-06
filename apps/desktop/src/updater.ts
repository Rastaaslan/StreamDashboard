import { app, autoUpdater, dialog, type BrowserWindow } from 'electron';
import {readAvailableWindowsRelease} from './streamcockpit-release-availability.js';
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
  // The native application owns signature checks, consent and graceful exit.
  // A downloaded Squirrel notification is not itself installation permission.
  preparedMaintenance?: (isCurrent: () => boolean) => Promise<void>,
  availability: (current:string)=>Promise<string|undefined> = readAvailableWindowsRelease,
) {
  const preflight = () => preflightDesktopUpgrade({
    ...preflightDependencies,
    assessRestartSafety: () => dashboard.assessRestartSafety(),
  });
  if (!app.isPackaged || process.platform !== 'win32' || process.env.NODE_ENV === 'test') {
    return Object.assign(() => undefined, { preflight });
  }
  // Availability cannot download or apply Squirrel packages before consent.
  let checking = false;
  let availableVersion = '';
  let handledVersion = '';
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
        type: 'info', title: 'Mise à jour disponible', message: 'Une mise à jour de StreamDashboard doit être vérifiée.',
        detail: preparedMaintenance
          ? 'Le téléchargement seul ne permet pas une installation. Choisissez le contrat de maintenance signé ; il sera vérifié avant toute fermeture. Aucun redémarrage automatique.'
          : 'Vérifier les conditions de mise à jour. Aucun parcours de maintenance natif n’est raccordé dans cette instance.',
        buttons: ['Plus tard', preparedMaintenance ? 'Choisir le contrat signé' : 'Vérifier le préflight'], defaultId: 0, cancelId: 0,
      });
      if (choice.response === 1) {
        if (!active || !ready) return;
        try { await requireDesktopRestartSafety(() => dashboard.assessRestartSafety()); }
        catch { logError('Installation différée : une diffusion est active ou non confirmée'); return; }
        if (!active || !ready) return;
        ready = false;
        handledVersion = availableVersion;
        if (preparedMaintenance) {
          await preparedMaintenance(() => active);
          return;
        }
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

  const checkNow = async () => {
    if (!active || checking) return;
    checking = true;
    try {
      const version = await availability(app.getVersion());
      if (active && version && version !== handledVersion) {
        availableVersion = version; ready = true;
        void offerWhenSafe();
      }
    } catch { logError('Vérification updater impossible (détails masqués)'); }
    finally { checking = false; }
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
