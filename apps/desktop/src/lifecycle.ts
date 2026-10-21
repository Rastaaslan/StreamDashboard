import { DesktopAudioPlayback } from './audio-player.js';
import {createAgentCertificate,certificateFingerprint,type AgentCertificate} from './agent-certificate.js';
import type { InstallationDevice } from '../../mobile/shared/installation.js';
import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { startDashboardServer, type DashboardServerHandle } from '../../server/src/index.js';
import { ElectronSecretStore } from './secrets.js';
import { DesktopLogger } from './logger.js';
import { launchObsIfRequested } from './obs-launcher.js';

export interface DesktopRuntime { dashboard: DashboardServerHandle; logger: DesktopLogger; ensureObsRunning(): ReturnType<typeof launchObsIfRequested>; stop(): Promise<void> }

export async function startDesktopRuntime(logger = new DesktopLogger(path.join(app.getPath('userData'), 'logs')), signal?: AbortSignal, controller = false, obsEnabled = !controller, deviceDescriptor?: () => Promise<InstallationDevice>): Promise<DesktopRuntime> {
  signal?.throwIfAborted();
  let distribution: { twitchClientId?: string; googleClientId?: string } = {};
  try { distribution = JSON.parse(await readFile(path.join(app.getAppPath(), 'resources', 'distribution.json'), 'utf8')); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || app.isPackaged) throw new Error('Configuration publique Desktop absente ou illisible. Réinstallez le paquet.'); }
  const userData = controller ? path.join(app.getPath('userData'), 'device-runtime') : app.getPath('userData');
  let launchObs = false; let obsExecutablePath: string | undefined; let remoteEnabled = false;
  try {
    const config = JSON.parse(await readFile(path.join(userData, 'config', 'dashboard.json'), 'utf8'));
    launchObs = config.settings?.launchObs === true;
    obsExecutablePath = typeof config.settings?.obsExecutablePath === 'string' ? config.settings.obsExecutablePath : undefined;
    remoteEnabled = config.settings?.remoteEnabled === true;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Configuration utilisateur Desktop illisible. Conservez dashboard.json et consultez les diagnostics.'); }
  const obsResult = await launchObsIfRequested(obsEnabled && launchObs, obsExecutablePath, signal);
  await logger.info(obsResult.detail).catch(() => undefined);
  signal?.throwIfAborted();
  const secretStore = new ElectronSecretStore(userData);
  const identityStore = new ElectronSecretStore(app.getPath('userData'));
  let certificate:AgentCertificate|undefined,remoteError:string|undefined;
  if(remoteEnabled){
    try {
      const saved=await identityStore.getAgentCertificate();
      certificate=saved??await createAgentCertificate();
      certificateFingerprint(certificate.certificate);
      if(!saved)await identityStore.setAgentCertificate(certificate);
    } catch(error) {
      certificate=undefined;
      remoteError=error instanceof Error?error.message:'Identité TLS indisponible.';
      await logger.warn('Partage distant indisponible : '+remoteError);
    }
  }
  const deviceAudio=new DesktopAudioPlayback();
  const dashboard = await startDashboardServer({
    deviceAudio,
    startupSignal: signal,
    deviceDescriptor,
    // Fixed endpoint for OBS, OAuth and phones; binding failures must be explicit.
    port: controller ? 48135 : 48133,
    host: '127.0.0.1',
    remoteEnabled:remoteEnabled&&Boolean(certificate),
    remoteError,
    remoteTls:certificate?{pfx:Buffer.from(certificate.pfx,'base64'),passphrase:certificate.passphrase,certificate:certificate.certificate}:undefined,
    obsEnabled,
    dataDir: path.join(userData, 'config'),
    soundLibraryDir: path.join(userData, 'soundboard'),
    webDir: path.join(app.getAppPath(), 'apps', 'web'),
    mobileDir: path.join(app.getAppPath(), 'apps', 'mobile'),
    secretStore,
    googleClientSecret: await secretStore.getGoogleClientSecret() || process.env.GOOGLE_CLIENT_SECRET || '',
    version: app.getVersion(),
    electronVersion: process.versions.electron,
    logsPath: logger.file,
    twitchClientId: distribution.twitchClientId || process.env.TWITCH_CLIENT_ID || '',
    googleClientId: distribution.googleClientId || process.env.GOOGLE_CLIENT_ID || '',
    logger,
  });
  let stopPromise: Promise<void> | undefined;
  return {
    dashboard,
    logger,
    ensureObsRunning: () => launchObsIfRequested(obsEnabled, dashboard.state().settings.obsExecutablePath),
    stop: () => stopPromise ??= (async () => {
      try { await dashboard.stop(); } finally { await deviceAudio.dispose(); }
      await logger.info('Arrêt propre terminé').catch(() => undefined);
    })(),
  };
}
