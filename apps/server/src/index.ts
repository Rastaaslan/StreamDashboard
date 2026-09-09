import express from 'express';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer } from 'ws';
import { ObsClient } from '../../../integrations/obs/src/client.js';
import { TwitchClient } from '../../../integrations/twitch/src/client.js';
import { parseCommand, protocolVersion, type CalendarItem, type ChecklistItem, type DashboardEvent, type DashboardSettings, type DashboardState, type RunMode, type ServerCapabilities, type TimerState } from '../../../packages/contracts/src/index.js';
import { DashboardCommandService } from './command-service.js';
import { AtomicJsonStore, DASHBOARD_SCHEMA_VERSION, MemorySecretStore, migratePlaintextTwitchTokens, type SecretStore } from './storage.js';

interface PersistedSettings extends Omit<DashboardSettings, 'obsPasswordSet' | 'twitchConnected' | 'twitchUserName'> { launchObs: boolean }
interface TwitchIdentity { broadcasterId: string; userName: string; displayName: string; accessToken?: string; refreshToken?: string }
interface LocalData { schemaVersion: number; mode: RunMode; timer: TimerState; planning: CalendarItem[]; checklist: ChecklistItem[]; settings: PersistedSettings & { obsPassword?: string }; twitch: TwitchIdentity; twitchLastSyncedAt: string | null }
export interface DashboardServerOptions { port?: number; host?: string; dataDir?: string; webDir?: string; secretStore?: SecretStore; version?: string; twitchClientId?: string; electronVersion?: string; logsPath?: string; logger?: Pick<Console, 'info' | 'warn' | 'error'> }
export interface DashboardServerHandle { port: number; url: string; state(): DashboardState; stop(): Promise<void>; server: Server }

export async function startDashboardServer(options: DashboardServerOptions = {}): Promise<DashboardServerHandle> {
  const requestedPort = options.port ?? Number(process.env.PORT ?? 47832);
  const host = options.host ?? '127.0.0.1';
  if (!['127.0.0.1', 'localhost', '::1'].includes(host)) throw new Error('Le mode remote-LAN est désactivé tant que le pairing authentifié n’est pas configuré.');
  const dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.dirname(process.env.DATA_FILE ?? 'data/dashboard.json'));
  const dataFile = path.resolve(process.env.DATA_FILE ?? path.join(dataDir, 'dashboard.json'));
  const store = new AtomicJsonStore<LocalData>(dataFile);
  const secrets = options.secretStore ?? new MemorySecretStore();
  const logger = options.logger ?? console;
  const defaults: LocalData = {
    schemaVersion: DASHBOARD_SCHEMA_VERSION, mode: 'idle', timer: { running: false, duration: 300, remaining: 300, deadline: null }, planning: [],
    checklist: [
      { id: 'obs', label: 'OBS connecté et scènes vérifiées', done: false }, { id: 'audio', label: 'Micro, musique et alertes testés', done: false },
      { id: 'title', label: 'Titre, catégorie et notification prêts', done: false }, { id: 'water', label: 'Eau et environnement prêts', done: false },
    ],
    settings: { streamerName: 'Streamer', accent: 'violet', confirmStop: true, obsUrl: process.env.OBS_URL ?? 'ws://127.0.0.1:4455', launchObs: false },
    twitch: { broadcasterId: '', userName: '', displayName: '' }, twitchLastSyncedAt: null,
  };
  let local = await store.read(defaults);
  local.settings = { ...defaults.settings, ...(local.settings ?? {}) };
  local.twitch = { ...defaults.twitch, ...(local.twitch ?? {}) };
  const requiresSchemaMigration = local.schemaVersion !== DASHBOARD_SCHEMA_VERSION;
  const migratedTokens = await migratePlaintextTwitchTokens(local, secrets);
  const migratedObsPassword = Boolean(local.settings.obsPassword);
  if (local.settings.obsPassword) { await secrets.setObsPassword(local.settings.obsPassword); delete local.settings.obsPassword; }
  if (requiresSchemaMigration || migratedTokens || migratedObsPassword) await store.write(local);
  let errors: Array<{ at: string; message: string }> = [];
  const logError = (error: unknown) => { const message = error instanceof Error ? error.message : String(error); errors = [{ at: new Date().toISOString(), message }, ...errors].slice(0, 30); logger.error(message); };
  let currentObsPassword = await secrets.getObsPassword();
  const obs = new ObsClient(local.settings.obsUrl, currentObsPassword);
  const savedTokens = await secrets.getTwitchTokens() ?? {};
  const twitch = new TwitchClient({ clientId: options.twitchClientId ?? process.env.TWITCH_CLIENT_ID ?? '', accessToken: savedTokens.accessToken ?? '', refreshToken: savedTokens.refreshToken ?? '', ...local.twitch }, async tokens => {
    if (tokens) await secrets.setTwitchTokens(tokens); else await secrets.clearTwitchTokens();
  });

  const app = express(); const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://local').pathname;
    if (pathname !== '/ws' && pathname !== '/ws/v1') { socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request));
  });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.resolve(options.webDir ?? 'apps/web'), { index: 'index.html' }));

  const remaining = () => local.timer.running && local.timer.deadline ? Math.max(0, Math.ceil((local.timer.deadline - Date.now()) / 1000)) : local.timer.remaining;
  const publicSettings = (): DashboardSettings => ({ streamerName: local.settings.streamerName, accent: local.settings.accent, confirmStop: local.settings.confirmStop,
    obsUrl: local.settings.obsUrl, obsPasswordSet: Boolean(currentObsPassword), twitchConnected: twitch.state.connected, twitchUserName: twitch.state.displayName, launchObs: local.settings.launchObs });
  const capabilities: ServerCapabilities = { protocolVersion, serverVersion: options.version ?? '1.1.0', features: ['obs', 'twitch', 'timer', 'planning', 'checklist', 'deck'], accessMode: 'desktop-local' };
  let runtimePort = requestedPort;
  const snapshot = (): DashboardState => {
    local.timer.remaining = remaining(); if (local.timer.running && !local.timer.remaining) { local.timer.running = false; local.timer.deadline = null; }
    const nextLive = local.planning.filter(x => (x.category === 'live' || x.kind === 'LIVE') && Date.parse(x.endAtUtc) > Date.now()).sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc))[0] ?? null;
    return { at: new Date().toISOString(), mode: local.mode, timer: local.timer, planning: local.planning, checklist: local.checklist, settings: publicSettings(), obs: obs.state,
      runtime: { serverVersion: capabilities.serverVersion, nodeVersion: process.version, electronVersion: options.electronVersion ?? null, platform: `${process.platform} ${process.arch}`, port: runtimePort, logsPath: options.logsPath ?? null },
      twitch: { ...twitch.state, lastSyncedAt: local.twitchLastSyncedAt }, nextLive, health: {
        dashboard: { ok: true, detail: 'API locale opérationnelle', reconnects: 0 }, storage: { ok: true, detail: dataFile, reconnects: 0 },
        obs: { ok: obs.state.connected, detail: obs.state.connected ? `WebSocket connecté${obs.state.obsVersion ? ` · OBS ${obs.state.obsVersion}` : ''}` : (obs.state.error ?? 'OBS hors ligne — cockpit disponible'), reconnects: obs.reconnectCount },
        twitch: { ok: twitch.state.connected, detail: twitch.state.connected ? `Connecté en tant que ${twitch.state.displayName}` : (twitch.state.error ?? 'Twitch non connecté'), reconnects: 0 },
      } };
  };
  const broadcast = () => { const body = JSON.stringify({ type: 'state.updated', data: snapshot() } satisfies DashboardEvent); for (const ws of sockets.clients) if (ws.readyState === ws.OPEN) ws.send(body); };
  const save = async () => { await store.write(local); };
  const changed = async () => { await save(); broadcast(); return snapshot(); };
  const commands = new DashboardCommandService(local, obs, changed);
  const execute = async (body: unknown) => commands.execute(parseCommand(body));
  const validateTwitch = async () => {
    if (!twitch.state.connected) return;
    if (!await twitch.validateSession()) { local.twitch = { broadcasterId: '', userName: '', displayName: '' }; await save(); }
    broadcast();
  };

  const health = (_req: express.Request, res: express.Response) => res.json({ ok: true, status: 'ready', protocolVersion, version: capabilities.serverVersion });
  app.get('/api/v1/health', health); app.get('/api/v1/state', (_req, res) => res.json(snapshot())); app.get('/api/v1/capabilities', (_req, res) => res.json(capabilities));
  app.post('/api/v1/commands', async (req, res, next) => { try { const command = parseCommand(req.body); res.json({ ok: true, state: await commands.execute(command), commandType: command.type }); } catch (error) { next(error); } });
  app.get('/api/state', (_req, res) => res.json(snapshot())); app.post('/api/commands', async (req, res, next) => { try { res.json(await execute(req.body)); } catch (error) { next(error); } });
  app.post('/api/planning', async (req, res, next) => { try { const input = req.body as Partial<CalendarItem>; if (!input.title || !input.startAtUtc || !input.endAtUtc || Date.parse(input.endAtUtc) <= Date.parse(input.startAtUtc)) return res.status(400).json({ error: 'Titre et période valides requis.' }); local.planning.push({ id: randomUUID(), title: input.title, description: input.description ?? '', startAtUtc: input.startAtUtc, endAtUtc: input.endAtUtc, category: input.category ?? 'live' }); res.status(201).json(await changed()); } catch (error) { next(error); } });
  app.delete('/api/planning/:id', async (req, res, next) => { try { const item = local.planning.find(x => x.id === req.params.id); if (item?.twitchSegmentId && twitch.state.connected) await twitch.deleteSegment(item.twitchSegmentId); local.planning = local.planning.filter(x => x.id !== req.params.id); res.json(await changed()); } catch (error) { next(error); } });
  app.put('/api/settings', async (req, res, next) => { try { const input = req.body as Partial<DashboardSettings> & { obsPassword?: string }; const newUrl = typeof input.obsUrl === 'string' && input.obsUrl.trim() ? input.obsUrl.trim() : local.settings.obsUrl; const newPassword = typeof input.obsPassword === 'string' && input.obsPassword ? input.obsPassword : currentObsPassword; const obsChanged = newUrl !== local.settings.obsUrl || newPassword !== currentObsPassword; if (typeof input.streamerName === 'string') local.settings.streamerName = input.streamerName; if (['violet', 'cyan', 'rose'].includes(String(input.accent))) local.settings.accent = input.accent!; if (typeof input.confirmStop === 'boolean') local.settings.confirmStop = input.confirmStop; if (typeof input.launchObs === 'boolean') local.settings.launchObs = input.launchObs; local.settings.obsUrl = newUrl; if (newPassword !== currentObsPassword) { await secrets.setObsPassword(newPassword); currentObsPassword = newPassword; } await save(); if (obsChanged) await obs.configure(newUrl, newPassword); broadcast(); res.json(snapshot()); } catch (error) { next(error); } });
  app.post('/api/twitch/device', async (_req, res, next) => { try { const alreadyPending = Boolean(twitch.state.deviceAuthorization); const authorization = await twitch.startDeviceAuthorization(); broadcast(); res.status(201).json(authorization); if (!alreadyPending) void twitch.waitForDeviceAuthorization().then(async () => { Object.assign(local.twitch, twitch.publicIdentity()); await save(); broadcast(); }).catch(error => { logError(error); broadcast(); }); } catch (error) { next(error); } });
  app.post('/api/twitch/disconnect', async (_req, res, next) => { try { await twitch.disconnect(); local.twitch = { broadcasterId: '', userName: '', displayName: '' }; await changed(); res.json(snapshot()); } catch (error) { next(error); } });
  app.post('/api/twitch/sync', async (_req, res, next) => { try { local.planning = await twitch.sync(local.planning); local.twitchLastSyncedAt = new Date().toISOString(); res.json(await changed()); } catch (error) { next(error); } });
  app.post('/api/obs/test', async (req, res, next) => { try { res.json(await obs.test(req.body.obsUrl?.trim() || local.settings.obsUrl, req.body.obsPassword || await secrets.getObsPassword())); } catch (error) { next(error); } });
  app.get('/api/diagnostics', (_req, res) => res.json({ state: snapshot(), errors, runtime: { node: process.version, pid: process.pid, uptime: process.uptime(), version: capabilities.serverVersion, port: requestedPort, dataDir } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { logError(error); res.status(400).json({ ok: false, error: { code: 'INVALID_REQUEST', message: error instanceof Error ? error.message : 'Erreur interne' } }); });
  sockets.on('connection', ws => { ws.send(JSON.stringify({ type: 'server.ready', data: capabilities })); ws.send(JSON.stringify({ type: 'state.updated', data: snapshot() } satisfies DashboardEvent)); });

  await mkdir(dataDir, { recursive: true });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(requestedPort, host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); const actualPort = typeof address === 'object' && address ? address.port : requestedPort;
  runtimePort = actualPort;
  const ticker = setInterval(broadcast, 1000); ticker.unref();
  const validator = setInterval(() => { void validateTwitch().catch(logError); }, 60 * 60_000); validator.unref();
  await validateTwitch().catch(logError);
  void obs.configure(local.settings.obsUrl, await secrets.getObsPassword()).then(broadcast);
  logger.info(`StreamDashboard ready on ${host}:${actualPort}`);
  let stopPromise: Promise<void> | undefined;
  const stop = () => stopPromise ??= (async () => {
    clearInterval(ticker); clearInterval(validator); twitch.cancelDeviceAuthorization(); for (const ws of sockets.clients) ws.terminate(); sockets.close(); await obs.close(); await save(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  })();
  return { port: actualPort, url: `http://${host}:${actualPort}`, state: snapshot, server, stop };
}
