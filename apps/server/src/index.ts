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
    settings: { streamerName: 'Streamer', accent: 'violet', confirmStop: true, obsUrl: process.env.OBS_URL ?? 'ws://127.0.0.1:4455', launchObs: false, modeScenes: {} },
    twitch: { broadcasterId: '', userName: '', displayName: '' }, twitchLastSyncedAt: null,
  };
  let local = await store.read(defaults);
  const object = (value: unknown): value is Record<string, unknown> => Boolean(value && typeof value === 'object' && !Array.isArray(value));
  if (!object(local)) local = structuredClone(defaults);
  if (!object(local.timer)) local.timer = structuredClone(defaults.timer);
  else {
    const duration = Number(local.timer.duration), remainingValue = Number(local.timer.remaining);
    local.timer.duration = Number.isFinite(duration) && duration >= 1 && duration <= 86_400 ? Math.floor(duration) : defaults.timer.duration;
    local.timer.remaining = Number.isFinite(remainingValue) && remainingValue >= 0 ? Math.min(Math.floor(remainingValue), 86_400) : local.timer.duration;
    local.timer.running = local.timer.running === true && typeof local.timer.deadline === 'number' && Number.isFinite(local.timer.deadline);
    local.timer.deadline = local.timer.running ? local.timer.deadline : null;
  }
  if (!Array.isArray(local.planning)) local.planning = [];
  local.planning = local.planning.filter(item => object(item) && typeof item.id === 'string' && typeof item.title === 'string' && Number.isFinite(Date.parse(String(item.startAtUtc))) && Number.isFinite(Date.parse(String(item.endAtUtc))));
  if (!Array.isArray(local.checklist)) local.checklist = structuredClone(defaults.checklist);
  else local.checklist = local.checklist.filter(item => object(item) && typeof item.id === 'string' && typeof item.label === 'string').map(item => ({ id: item.id, label: item.label, done: item.done === true }));
  if (!object(local.settings)) local.settings = structuredClone(defaults.settings);
  local.settings = { ...defaults.settings, ...(local.settings ?? {}) };
  if (!['violet', 'cyan', 'rose'].includes(local.settings.accent)) local.settings.accent = defaults.settings.accent;
  if (!object(local.settings.modeScenes)) local.settings.modeScenes = {};
  local.twitch = { ...defaults.twitch, ...(local.twitch ?? {}) };
  const requiresSchemaMigration = local.schemaVersion !== DASHBOARD_SCHEMA_VERSION;
  const migratedTokens = await migratePlaintextTwitchTokens(local, secrets);
  const migratedObsPassword = Boolean(local.settings.obsPassword && secrets.persistent);
  if (local.settings.obsPassword && secrets.persistent) { await secrets.setObsPassword(local.settings.obsPassword); delete local.settings.obsPassword; }
  if (requiresSchemaMigration || migratedTokens || migratedObsPassword) await store.write(local);
  let errors: Array<{ at: string; message: string }> = [];
  const logError = (error: unknown) => { const message = error instanceof Error ? error.message : String(error); errors = [{ at: new Date().toISOString(), message }, ...errors].slice(0, 30); logger.error(message); };
  let currentObsPassword = await secrets.getObsPassword() || local.settings.obsPassword || '';
  const obs = new ObsClient(local.settings.obsUrl, currentObsPassword);
  const savedTokens = await secrets.getTwitchTokens() ?? {};
  const twitch = new TwitchClient({ clientId: options.twitchClientId ?? process.env.TWITCH_CLIENT_ID ?? '', accessToken: savedTokens.accessToken ?? '', refreshToken: savedTokens.refreshToken ?? '', ...local.twitch }, async tokens => {
    if (tokens) await secrets.setTwitchTokens(tokens); else await secrets.clearTwitchTokens();
  });

  const app = express(); const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://local').pathname;
    const origin = request.headers.origin;
    const localOrigin = (() => { try { return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(origin ?? 'http://127.0.0.1').hostname); } catch { return false; } })();
    if ((pathname !== '/ws' && pathname !== '/ws/v1') || !localOrigin) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request));
  });
  app.use((_req, res, next) => { res.set({ 'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws: wss:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); next(); });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.resolve(options.webDir ?? 'apps/web'), { index: 'index.html' }));

  const remaining = () => local.timer.running && local.timer.deadline ? Math.max(0, Math.ceil((local.timer.deadline - Date.now()) / 1000)) : local.timer.remaining;
  const publicSettings = (): DashboardSettings => ({ streamerName: local.settings.streamerName, accent: local.settings.accent, confirmStop: local.settings.confirmStop,
    obsUrl: local.settings.obsUrl, obsPasswordSet: Boolean(currentObsPassword), twitchConnected: twitch.state.connected, twitchUserName: twitch.state.displayName, launchObs: local.settings.launchObs, modeScenes: local.settings.modeScenes ?? {} });
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
  let timerExpiry: NodeJS.Timeout | undefined;
  const scheduleTimerExpiry = () => {
    if (timerExpiry) clearTimeout(timerExpiry);
    timerExpiry = undefined;
    if (!local.timer.running || !local.timer.deadline) return;
    timerExpiry = setTimeout(() => { timerExpiry = undefined; local.timer.running = false; local.timer.remaining = 0; local.timer.deadline = null; void save().then(broadcast).catch(logError); }, Math.max(0, local.timer.deadline - Date.now()));
    timerExpiry.unref();
  };
  const save = async () => { await store.write(local); };
  const changed = async () => { scheduleTimerExpiry(); await save(); broadcast(); return snapshot(); };
  const commands = new DashboardCommandService(local, obs, changed, { settings: local.settings, logger });
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
  const planningCreate: express.RequestHandler = async (req, res, next) => { try { const input = req.body as Partial<CalendarItem>; if (!input.title || input.title.length > 140 || !input.startAtUtc || !input.endAtUtc || Date.parse(input.endAtUtc) <= Date.parse(input.startAtUtc)) { res.status(400).json({ error: 'Titre (140 caractères maximum) et période valides requis.' }); return; } local.planning.push({ id: randomUUID(), title: input.title, description: input.description ?? '', startAtUtc: input.startAtUtc, endAtUtc: input.endAtUtc, category: input.category ?? 'live' }); res.status(201).json(await changed()); } catch (error) { next(error); } };
  const planningDelete: express.RequestHandler = async (req, res, next) => { try { const item = local.planning.find(x => x.id === req.params.id); if (item?.twitchRecurring && req.query.confirmRecurring !== 'true') { res.status(409).json({ error: 'Ce segment appartient à une série récurrente Twitch. Confirmez la suppression de toute la série.' }); return; } if (item?.twitchSegmentId && twitch.state.connected) await twitch.deleteSegment(item.twitchSegmentId, Boolean(item.twitchRecurring)); local.planning = local.planning.filter(x => x.id !== req.params.id); res.json(await changed()); } catch (error) { next(error); } };
  const settingsUpdate: express.RequestHandler = async (req, res, next) => { try { const input = req.body as Partial<DashboardSettings> & { obsPassword?: string }; const newUrl = typeof input.obsUrl === 'string' && input.obsUrl.trim() ? input.obsUrl.trim() : local.settings.obsUrl; const newPassword = typeof input.obsPassword === 'string' && input.obsPassword ? input.obsPassword : currentObsPassword; const obsChanged = newUrl !== local.settings.obsUrl || newPassword !== currentObsPassword; if (typeof input.streamerName === 'string') local.settings.streamerName = input.streamerName; if (['violet', 'cyan', 'rose'].includes(String(input.accent))) local.settings.accent = input.accent!; if (typeof input.confirmStop === 'boolean') local.settings.confirmStop = input.confirmStop; if (typeof input.launchObs === 'boolean') local.settings.launchObs = input.launchObs; if (typeof input.obsExecutablePath === 'string' && input.obsExecutablePath.length <= 500) local.settings.obsExecutablePath = input.obsExecutablePath; if (input.modeScenes && typeof input.modeScenes === 'object') local.settings.modeScenes = Object.fromEntries(Object.entries(input.modeScenes).filter(([mode, scene]) => ['intro', 'live', 'pause', 'end'].includes(mode) && typeof scene === 'string' && scene.length <= 200)); local.settings.obsUrl = newUrl; if (newPassword !== currentObsPassword) { if (secrets.persistent) await secrets.setObsPassword(newPassword); else local.settings.obsPassword = newPassword; currentObsPassword = newPassword; } await save(); if (obsChanged) await obs.configure(newUrl, newPassword); broadcast(); res.json(snapshot()); } catch (error) { next(error); } };
  for (const prefix of ['/api', '/api/v1']) { app.post(`${prefix}/planning`, planningCreate); app.delete(`${prefix}/planning/:id`, planningDelete); app.put(`${prefix}/settings`, settingsUpdate); }
  app.post(['/api/twitch/device', '/api/v1/twitch/device'], async (_req, res, next) => { try { const alreadyPending = Boolean(twitch.state.deviceAuthorization); const authorization = await twitch.startDeviceAuthorization(); broadcast(); res.status(201).json(authorization); if (!alreadyPending) void twitch.waitForDeviceAuthorization().then(async () => { Object.assign(local.twitch, twitch.publicIdentity()); await save(); broadcast(); }).catch(error => { logError(error); broadcast(); }); } catch (error) { next(error); } });
  app.post(['/api/twitch/disconnect', '/api/v1/twitch/disconnect'], async (_req, res, next) => { try { await twitch.disconnect(); local.twitch = { broadcasterId: '', userName: '', displayName: '' }; await changed(); res.json(snapshot()); } catch (error) { next(error); } });
  app.post(['/api/twitch/sync', '/api/v1/twitch/sync'], async (_req, res, next) => { try { local.planning = await twitch.sync(local.planning); local.twitchLastSyncedAt = new Date().toISOString(); res.json(await changed()); } catch (error) { next(error); } });
  app.post('/api/obs/test', async (req, res, next) => { try { res.json(await obs.test(req.body.obsUrl?.trim() || local.settings.obsUrl, req.body.obsPassword || await secrets.getObsPassword())); } catch (error) { next(error); } });
  app.post('/api/v1/obs/test', async (req, res, next) => { try { res.json(await obs.test(req.body.obsUrl?.trim() || local.settings.obsUrl, req.body.obsPassword || await secrets.getObsPassword())); } catch (error) { next(error); } });
  app.get('/api/diagnostics', (_req, res) => res.json({ state: snapshot(), errors, runtime: { node: process.version, pid: process.pid, uptime: process.uptime(), version: capabilities.serverVersion, port: requestedPort, dataDir } }));
  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { logError(error); res.status(400).json({ ok: false, error: { code: error instanceof Error && error.name === 'CHECKLIST_INCOMPLETE' ? 'CHECKLIST_INCOMPLETE' : 'INVALID_REQUEST', message: error instanceof Error ? error.message : 'Erreur interne' } }); });
  sockets.on('connection', ws => { ws.send(JSON.stringify({ type: 'server.ready', data: capabilities })); ws.send(JSON.stringify({ type: 'state.updated', data: snapshot() } satisfies DashboardEvent)); });

  await mkdir(dataDir, { recursive: true });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(requestedPort, host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); const actualPort = typeof address === 'object' && address ? address.port : requestedPort;
  runtimePort = actualPort;
  const unsubscribeObs = obs.onStateChanged(broadcast);
  const validator = setInterval(() => { void validateTwitch().catch(logError); }, 60 * 60_000); validator.unref();
  await validateTwitch().catch(logError);
  void obs.configure(local.settings.obsUrl, currentObsPassword).then(broadcast);
  logger.info(`StreamDashboard ready on ${host}:${actualPort}`);
  let stopPromise: Promise<void> | undefined;
  scheduleTimerExpiry();
  const stop = () => stopPromise ??= (async () => {
    unsubscribeObs(); clearInterval(validator); if (timerExpiry) clearTimeout(timerExpiry); twitch.cancelDeviceAuthorization(); for (const ws of sockets.clients) ws.terminate(); sockets.close(); await obs.close(); await save(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  })();
  return { port: actualPort, url: `http://${host}:${actualPort}`, state: snapshot, server, stop };
}
