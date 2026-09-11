import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../../server/src/index.js';
import { ElectronSecretStore } from './secrets.js';
import { DesktopLogger } from './logger.js';
import { launchObsIfRequested } from './obs-launcher.js';

export interface DesktopRuntime { dashboard: DashboardServerHandle; logger: DesktopLogger; ensureObsRunning(): ReturnType<typeof launchObsIfRequested>; stop(): Promise<void> }

export async function startDesktopRuntime(): Promise<DesktopRuntime> {
  let distribution: { twitchClientId?: string; googleClientId?: string } = {};
  try { distribution = JSON.parse(await readFile(path.join(app.getAppPath(), 'resources', 'distribution.json'), 'utf8')); } catch { /* development may use the environment */ }
  const userData = app.getPath('userData');
  const logger = new DesktopLogger(path.join(userData, 'logs'));
  let launchObs = false; let obsExecutablePath: string | undefined; let remoteEnabled = false;
  try {
    const config = JSON.parse(await readFile(path.join(userData, 'config', 'dashboard.json'), 'utf8'));
    launchObs = config.settings?.launchObs === true;
    obsExecutablePath = typeof config.settings?.obsExecutablePath === 'string' ? config.settings.obsExecutablePath : undefined;
    remoteEnabled = config.settings?.remoteEnabled === true;
  } catch { /* first run */ }
  const obsResult = await launchObsIfRequested(launchObs, obsExecutablePath);
  await logger.info(obsResult.detail).catch(() => undefined);
  const dashboard = await startDashboardServer({
    // A stable desktop port is required by OBS Browser Sources and paired phones.
    // If it is occupied, fail loudly instead of silently changing the overlay/mobile URL.
    port: 47832,
    host: remoteEnabled ? '0.0.0.0' : '127.0.0.1',
    remoteEnabled,
    dataDir: path.join(userData, 'config'),
    webDir: path.join(app.getAppPath(), 'apps', 'web'),
    mobileDir: path.join(app.getAppPath(), 'apps', 'mobile'),
    secretStore: new ElectronSecretStore(userData),
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    logsPath: logger.file,
    twitchClientId: distribution.twitchClientId || process.env.TWITCH_CLIENT_ID || '',
    googleClientId: distribution.googleClientId || process.env.GOOGLE_CLIENT_ID || '',
    logger,
  });
  let stopped = false;
  return {
    dashboard,
    logger,
    ensureObsRunning: () => launchObsIfRequested(true, dashboard.state().settings.obsExecutablePath),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await dashboard.stop();
      await logger.info('Arrêt propre terminé').catch(() => undefined);
    },
  };
}
