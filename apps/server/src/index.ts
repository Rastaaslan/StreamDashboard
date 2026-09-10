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

const RUN_MODES: RunMode[] = ['idle', 'intro', 'live', 'pause', 'end'];
const ACCENTS: DashboardSettings['accent'][] = ['violet', 'cyan', 'rose'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function object(value: unknown): value is Record<string, unknown> { return Boolean(value && typeof value === 'object' && !Array.isArray(value)); }
function normalizeObsUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error('Adresse OBS WebSocket invalide.'); }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error('OBS WebSocket doit utiliser une adresse locale ws://127.0.0.1, ws://localhost ou ws://[::1].');
  }
  return parsed.href.replace(/\/$/, '');
}
function safeObsUrl(value: unknown, fallback: string) {
  try { return typeof value === 'string' ? normalizeObsUrl(value.trim()) : fallback; } catch { return fallback; }
}
function modeScenes(value: unknown): DashboardSettings['modeScenes'] {
  if (!object(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([mode, scene]) => ['intro', 'live', 'pause', 'end'].includes(mode) && typeof scene === 'string' && scene.trim().length > 0 && scene.length <= 200));
}
function sanitizeCalendarItem(value: unknown): CalendarItem | null {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.title !== 'string') return null;
  const title = value.title.trim();
  const startAtUtc = typeof value.startAtUtc === 'string' ? value.startAtUtc : '';
  const endAtUtc = typeof value.endAtUtc === 'string' ? value.endAtUtc : '';
  const start = Date.parse(startAtUtc), end = Date.parse(endAtUtc);
  if (!title || title.length > 140 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  const item: CalendarItem = { id: value.id, title, startAtUtc, endAtUtc };
  if (typeof value.description === 'string') item.description = value.description.slice(0, 4000);
  if (['live', 'production', 'personal'].includes(String(value.category))) item.category = value.category as CalendarItem['category'];
  if (['DAMPLANNER', 'GOOGLE', 'TWITCH'].includes(String(value.source))) item.source = value.source as CalendarItem['source'];
  if (['LOCAL', 'EXTERNAL'].includes(String(value.ownership))) item.ownership = value.ownership as CalendarItem['ownership'];
  if (['LIVE', 'PERSONAL'].includes(String(value.kind))) item.kind = value.kind as CalendarItem['kind'];
  if (typeof value.editable === 'boolean') item.editable = value.editable;
  if (typeof value.draft === 'boolean') item.draft = value.draft;
  if (typeof value.twitchSegmentId === 'string' && value.twitchSegmentId) item.twitchSegmentId = value.twitchSegmentId;
  if (typeof value.twitchRecurring === 'boolean') item.twitchRecurring = value.twitchRecurring;
  if (typeof value.syncError === 'string') item.syncError = value.syncError.slice(0, 500);
  if (typeof value.syncedAt === 'string' && Number.isFinite(Date.parse(value.syncedAt))) item.syncedAt = value.syncedAt;
  return item;
}

export async function startDashboardServer(options: DashboardServerOptions = {}): Promise<DashboardServerHandle> {
  const requestedPort = options.port ?? Number(process.env.PORT ?? 47832);
  const host = options.host ?? '127.0.0.1';
  if (!LOOPBACK_HOSTS.has(host)) throw new Error('Le mode remote-LAN est désactivé tant que le pairing authentifié n’est pas configuré.');
  const dataDir = path.resolve(options.dataDir ?? process.env.DATA_DIR ?? path.dirname(process.env.DATA_FILE ?? 'data/dashboard.json'));
  const dataFile = path.resolve(process.env.DATA_FILE ?? path.join(dataDir, 'dashboard.json'));
  const store = new AtomicJsonStore<LocalData>(dataFile);
  const secrets = options.secretStore ?? new MemorySecretStore();
  const logger = options.logger ?? console;
  const defaultObsUrl = safeObsUrl(process.env.OBS_URL, 'ws://127.0.0.1:4455');
  const defaults: LocalData = {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    mode: 'idle',
    timer: { running: false, duration: 300, remaining: 300, deadline: null },
    planning: [],
    checklist: [
      { id: 'obs', label: 'OBS connecté et scènes vérifiées', done: false },
      { id: 'audio', label: 'Micro, musique et alertes testés', done: false },
      { id: 'title', label: 'Titre, catégorie et notification prêts', done: false },
      { id: 'water', label: 'Eau et environnement prêts', done: false },
    ],
    settings: { streamerName: 'Streamer', accent: 'violet', confirmStop: true, obsUrl: defaultObsUrl, launchObs: false, modeScenes: {} },
    twitch: { broadcasterId: '', userName: '', displayName: '' },
    twitchLastSyncedAt: null,
  };

  let local = await store.read(defaults);
  if (!object(local)) local = structuredClone(defaults);
  local.mode = RUN_MODES.includes(local.mode) ? local.mode : 'idle';
  if (!object(local.timer)) local.timer = structuredClone(defaults.timer);
  else {
    const duration = Number(local.timer.duration), remainingValue = Number(local.timer.remaining), deadline = Number(local.timer.deadline);
    local.timer.duration = Number.isFinite(duration) && duration >= 1 && duration <= 86_400 ? Math.floor(duration) : defaults.timer.duration;
    local.timer.remaining = Number.isFinite(remainingValue) && remainingValue >= 0 ? Math.min(Math.floor(remainingValue), 86_400) : local.timer.duration;
    local.timer.running = local.timer.running === true && Number.isFinite(deadline) && deadline > 0;
    local.timer.deadline = local.timer.running ? deadline : null;
  }
  local.planning = Array.isArray(local.planning) ? local.planning.map(sanitizeCalendarItem).filter((item): item is CalendarItem => Boolean(item)) : [];
  if (!Array.isArray(local.checklist)) local.checklist = structuredClone(defaults.checklist);
  else {
    const seen = new Set<string>();
    local.checklist = local.checklist.filter(item => object(item) && typeof item.id === 'string' && item.id && typeof item.label === 'string' && item.label.trim()).map(item => ({ id: String(item.id), label: String(item.label).slice(0, 200), done: item.done === true })).filter(item => !seen.has(item.id) && Boolean(seen.add(item.id)));
    if (!local.checklist.length) local.checklist = structuredClone(defaults.checklist);
  }
  const rawSettings = object(local.settings) ? local.settings : {};
  local.settings = {
    streamerName: typeof rawSettings.streamerName === 'string' && rawSettings.streamerName.trim() ? rawSettings.streamerName.trim().slice(0, 80) : defaults.settings.streamerName,
    accent: ACCENTS.includes(rawSettings.accent as DashboardSettings['accent']) ? rawSettings.accent as DashboardSettings['accent'] : defaults.settings.accent,
    confirmStop: typeof rawSettings.confirmStop === 'boolean' ? rawSettings.confirmStop : defaults.settings.confirmStop,
    obsUrl: safeObsUrl(rawSettings.obsUrl, defaults.settings.obsUrl),
    launchObs: typeof rawSettings.launchObs === 'boolean' ? rawSettings.launchObs : false,
    obsExecutablePath: typeof rawSettings.obsExecutablePath === 'string' && rawSettings.obsExecutablePath.trim().length <= 500 ? rawSettings.obsExecutablePath.trim() || undefined : undefined,
    modeScenes: modeScenes(rawSettings.modeScenes),
    ...(typeof rawSettings.obsPassword === 'string' && rawSettings.obsPassword.length <= 500 ? { obsPassword: rawSettings.obsPassword } : {}),
  };
  const rawTwitch = object(local.twitch) ? local.twitch : {};
  local.twitch = {
    broadcasterId: typeof rawTwitch.broadcasterId === 'string' ? rawTwitch.broadcasterId : '',
    userName: typeof rawTwitch.userName === 'string' ? rawTwitch.userName : '',
    displayName: typeof rawTwitch.displayName === 'string' ? rawTwitch.displayName : '',
    ...(typeof rawTwitch.accessToken === 'string' ? { accessToken: rawTwitch.accessToken } : {}),
    ...(typeof rawTwitch.refreshToken === 'string' ? { refreshToken: rawTwitch.refreshToken } : {}),
  };
  local.twitchLastSyncedAt = typeof local.twitchLastSyncedAt === 'string' && Number.isFinite(Date.parse(local.twitchLastSyncedAt)) ? local.twitchLastSyncedAt : null;

  const requiresSchemaMigration = local.schemaVersion !== DASHBOARD_SCHEMA_VERSION;
  const migratedTokens = await migratePlaintextTwitchTokens(local, secrets);
  const migratedObsPassword = Boolean(local.settings.obsPassword && secrets.persistent);
  if (local.settings.obsPassword && secrets.persistent) { await secrets.setObsPassword(local.settings.obsPassword); delete local.settings.obsPassword; }
  if (requiresSchemaMigration || migratedTokens || migratedObsPassword) await store.write(local);

  let errors: Array<{ at: string; message: string }> = [];
  const logError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    errors = [{ at: new Date().toISOString(), message }, ...errors].slice(0, 30);
    void Promise.resolve(logger.error(message)).catch(() => undefined);
  };
  let currentObsPassword = await secrets.getObsPassword() || local.settings.obsPassword || '';
  const obs = new ObsClient(local.settings.obsUrl, currentObsPassword, { logger });
  const savedTokens = await secrets.getTwitchTokens() ?? {};
  const twitch = new TwitchClient({ clientId: options.twitchClientId ?? process.env.TWITCH_CLIENT_ID ?? '', accessToken: savedTokens.accessToken ?? '', refreshToken: savedTokens.refreshToken ?? '', ...local.twitch }, async tokens => {
    if (tokens) await secrets.setTwitchTokens(tokens); else await secrets.clearTwitchTokens();
  });

  const app = express();
  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true });
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://local').pathname;
    const origin = request.headers.origin;
    const requestHost = request.headers.host;
    const acceptedOrigin = (() => {
      if (!origin) return true; // Native/local clients do not necessarily send Origin.
      try {
        const parsed = new URL(origin);
        return LOOPBACK_HOSTS.has(parsed.hostname) && Boolean(requestHost) && parsed.host === requestHost;
      } catch { return false; }
    })();
    if ((pathname !== '/ws' && pathname !== '/ws/v1') || !acceptedOrigin) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    sockets.handleUpgrade(request, socket, head, ws => sockets.emit('connection', ws, request));
  });
  app.use((_req, res, next) => { res.set({ 'Content-Security-Policy': "default-src 'self'; connect-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'", 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'no-referrer' }); next(); });
  app.use(express.json({ limit: '32kb' }));
  app.use(express.static(path.resolve(options.webDir ?? 'apps/web'), { index: 'index.html' }));

  let mutationQueue: Promise<void> = Promise.resolve();
  const mutate = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = mutationQueue.then(operation);
    mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  const remaining = () => local.timer.running && local.timer.deadline ? Math.max(0, Math.ceil((local.timer.deadline - Date.now()) / 1000)) : local.timer.remaining;
  const publicSettings = (): DashboardSettings => ({
    streamerName: local.settings.streamerName,
    accent: local.settings.accent,
    confirmStop: local.settings.confirmStop,
    obsUrl: local.settings.obsUrl,
    obsPasswordSet: Boolean(currentObsPassword),
    twitchConnected: twitch.state.connected,
    twitchUserName: twitch.state.displayName,
    launchObs: local.settings.launchObs,
    obsExecutablePath: local.settings.obsExecutablePath,
    modeScenes: local.settings.modeScenes ?? {},
  });
  const capabilities: ServerCapabilities = { protocolVersion, serverVersion: options.version ?? '1.1.0', features: ['obs', 'twitch', 'timer', 'planning', 'checklist', 'deck'], accessMode: 'desktop-local' };
  let runtimePort = requestedPort;
  const snapshot = (): DashboardState => {
    local.timer.remaining = remaining();
    if (local.timer.running && !local.timer.remaining) { local.timer.running = false; local.timer.deadline = null; }
    const nextLive = local.planning.filter(x => (x.category === 'live' || x.kind === 'LIVE') && Date.parse(x.endAtUtc) > Date.now()).sort((a, b) => Date.parse(a.startAtUtc) - Date.parse(b.startAtUtc))[0] ?? null;
    return {
      at: new Date().toISOString(), mode: local.mode, timer: local.timer, planning: local.planning, checklist: local.checklist, settings: publicSettings(), obs: obs.state,
      runtime: { serverVersion: capabilities.serverVersion, nodeVersion: process.version, electronVersion: options.electronVersion ?? null, platform: `${process.platform} ${process.arch}`, port: runtimePort, logsPath: options.logsPath ?? null },
      twitch: { ...twitch.state, lastSyncedAt: local.twitchLastSyncedAt }, nextLive,
      health: {
        dashboard: { ok: true, detail: 'API locale opérationnelle', reconnects: 0 },
        storage: { ok: true, detail: dataFile, reconnects: 0 },
        obs: { ok: obs.state.connected, detail: obs.state.connected ? `WebSocket connecté${obs.state.obsVersion ? ` · OBS ${obs.state.obsVersion}` : ''}` : (obs.state.error ?? 'OBS hors ligne — cockpit disponible'), reconnects: obs.reconnectCount },
        twitch: { ok: twitch.state.connected, detail: twitch.state.connected ? `Connecté en tant que ${twitch.state.displayName}` : (twitch.state.error ?? 'Twitch non connecté'), reconnects: 0 },
      },
    };
  };
  const broadcast = () => { const body = JSON.stringify({ type: 'state.updated', data: snapshot() } satisfies DashboardEvent); for (const ws of sockets.clients) if (ws.readyState === ws.OPEN) ws.send(body); };
  const save = async () => { await store.write(local); };
  let timerExpiry: NodeJS.Timeout | undefined;
  const scheduleTimerExpiry = () => {
    if (timerExpiry) clearTimeout(timerExpiry);
    timerExpiry = undefined;
    if (!local.timer.running || !local.timer.deadline) return;
    const expectedDeadline = local.timer.deadline;
    timerExpiry = setTimeout(() => {
      timerExpiry = undefined;
      void mutate(async () => {
        if (!local.timer.running || local.timer.deadline !== expectedDeadline) return;
        local.timer.running = false; local.timer.remaining = 0; local.timer.deadline = null;
        await save(); broadcast();
      }).catch(logError);
    }, Math.max(0, expectedDeadline - Date.now()));
    timerExpiry.unref();
  };
  const changed = async () => { scheduleTimerExpiry(); await save(); broadcast(); return snapshot(); };
  const commands = new DashboardCommandService(local, obs, changed, { settings: local.settings, logger });
  const execute = async (body: unknown) => mutate(() => commands.execute(parseCommand(body)));
  const validateTwitch = async () => mutate(async () => {
    if (!twitch.state.connected) return;
    if (!await twitch.validateSession()) { local.twitch = { broadcasterId: '', userName: '', displayName: '' }; await save(); }
    broadcast();
  });

  const health = (_req: express.Request, res: express.Response) => res.json({ ok: true, status: 'ready', protocolVersion, version: capabilities.serverVersion });
  app.get('/api/v1/health', health);
  app.get('/api/v1/state', (_req, res) => res.json(snapshot()));
  app.get('/api/v1/capabilities', (_req, res) => res.json(capabilities));
  app.post('/api/v1/commands', async (req, res, next) => { try { const command = parseCommand(req.body); res.json({ ok: true, state: await mutate(() => commands.execute(command)), commandType: command.type }); } catch (error) { next(error); } });
  app.get('/api/state', (_req, res) => res.json(snapshot()));
  app.post('/api/commands', async (req, res, next) => { try { res.json(await execute(req.body)); } catch (error) { next(error); } });

  const planningCreate: express.RequestHandler = async (req, res, next) => {
    try {
      const input = req.body as Partial<CalendarItem>;
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const startAtUtc = typeof input.startAtUtc === 'string' ? input.startAtUtc : '';
      const endAtUtc = typeof input.endAtUtc === 'string' ? input.endAtUtc : '';
      const start = Date.parse(startAtUtc), end = Date.parse(endAtUtc);
      const category = input.category ?? 'live';
      if (!title || title.length > 140 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !['live', 'production', 'personal'].includes(category)) {
        res.status(400).json({ error: 'Titre (140 caractères maximum), type et période valides requis.' }); return;
      }
      const state = await mutate(async () => {
        local.planning.push({ id: randomUUID(), title, description: typeof input.description === 'string' ? input.description.slice(0, 4000) : '', startAtUtc, endAtUtc, category });
        return changed();
      });
      res.status(201).json(state);
    } catch (error) { next(error); }
  };
  const planningDelete: express.RequestHandler = async (req, res, next) => {
    try {
      const state = await mutate(async () => {
        const item = local.planning.find(x => x.id === req.params.id);
        if (!item) { const error = new Error('Événement introuvable.'); error.name = 'NOT_FOUND'; throw error; }
        if (item.twitchRecurring && req.query.confirmRecurring !== 'true') { const error = new Error('Ce segment appartient à une série récurrente Twitch. Confirmez la suppression de toute la série.'); error.name = 'CONFIRM_REQUIRED'; throw error; }
        if (item.twitchSegmentId) {
          if (!twitch.state.connected) { const error = new Error('Reconnectez Twitch avant de supprimer cet événement lié au planning Twitch.'); error.name = 'TWITCH_DISCONNECTED'; throw error; }
          await twitch.deleteSegment(item.twitchSegmentId);
        }
        local.planning = local.planning.filter(x => x.id !== req.params.id);
        return changed();
      });
      res.json(state);
    } catch (error) { next(error); }
  };
  const settingsUpdate: express.RequestHandler = async (req, res, next) => {
    try {
      const input = req.body as Partial<DashboardSettings> & { obsPassword?: string; clearObsPassword?: boolean };
      const state = await mutate(async () => {
        const newUrl = input.obsUrl !== undefined ? normalizeObsUrl(String(input.obsUrl).trim()) : local.settings.obsUrl;
        const clearPassword = input.clearObsPassword === true;
        const suppliedPassword = typeof input.obsPassword === 'string' && input.obsPassword.length ? input.obsPassword : undefined;
        if (suppliedPassword && suppliedPassword.length > 500) throw new Error('Mot de passe OBS trop long.');
        const newPassword = clearPassword ? '' : suppliedPassword ?? currentObsPassword;
        const obsChanged = newUrl !== local.settings.obsUrl || newPassword !== currentObsPassword;
        if (typeof input.streamerName === 'string') { const name = input.streamerName.trim(); if (!name || name.length > 80) throw new Error('Le nom affiché doit contenir entre 1 et 80 caractères.'); local.settings.streamerName = name; }
        if (input.accent !== undefined) { if (!ACCENTS.includes(input.accent)) throw new Error('Couleur d’accent invalide.'); local.settings.accent = input.accent; }
        if (typeof input.confirmStop === 'boolean') local.settings.confirmStop = input.confirmStop;
        if (typeof input.launchObs === 'boolean') local.settings.launchObs = input.launchObs;
        if (input.obsExecutablePath !== undefined) { if (typeof input.obsExecutablePath !== 'string' || input.obsExecutablePath.length > 500) throw new Error('Chemin OBS invalide.'); local.settings.obsExecutablePath = input.obsExecutablePath.trim() || undefined; }
        if (input.modeScenes !== undefined) local.settings.modeScenes = modeScenes(input.modeScenes);
        local.settings.obsUrl = newUrl;
        if (newPassword !== currentObsPassword) {
          if (secrets.persistent) await secrets.setObsPassword(newPassword);
          else if (newPassword) local.settings.obsPassword = newPassword;
          else delete local.settings.obsPassword;
          currentObsPassword = newPassword;
        }
        await save();
        if (obsChanged) await obs.configure(newUrl, newPassword);
        broadcast();
        return snapshot();
      });
      res.json(state);
    } catch (error) { next(error); }
  };
  for (const prefix of ['/api', '/api/v1']) { app.post(`${prefix}/planning`, planningCreate); app.delete(`${prefix}/planning/:id`, planningDelete); app.put(`${prefix}/settings`, settingsUpdate); }

  app.post(['/api/twitch/device', '/api/v1/twitch/device'], async (_req, res, next) => {
    try {
      const alreadyPending = Boolean(twitch.state.deviceAuthorization);
      const authorization = await twitch.startDeviceAuthorization();
      broadcast();
      res.status(201).json(authorization);
      if (!alreadyPending) void twitch.waitForDeviceAuthorization().then(() => mutate(async () => { Object.assign(local.twitch, twitch.publicIdentity()); await save(); broadcast(); })).catch(error => { logError(error); broadcast(); });
    } catch (error) { next(error); }
  });
  app.post(['/api/twitch/disconnect', '/api/v1/twitch/disconnect'], async (_req, res, next) => {
    try { res.json(await mutate(async () => { await twitch.disconnect(); local.twitch = { broadcasterId: '', userName: '', displayName: '' }; return changed(); })); }
    catch (error) { next(error); }
  });
  app.post(['/api/twitch/sync', '/api/v1/twitch/sync'], async (_req, res, next) => {
    try {
      res.json(await mutate(async () => {
        const synced = await twitch.sync(structuredClone(local.planning));
        local.planning = synced;
        local.twitchLastSyncedAt = new Date().toISOString();
        return changed();
      }));
    } catch (error) { next(error); }
  });

  const obsTest: express.RequestHandler = async (req, res, next) => {
    try {
      const url = req.body.obsUrl !== undefined ? normalizeObsUrl(String(req.body.obsUrl).trim()) : local.settings.obsUrl;
      const password = Object.prototype.hasOwnProperty.call(req.body, 'obsPassword') ? String(req.body.obsPassword ?? '') : currentObsPassword;
      res.json(await obs.test(url, password));
    } catch (error) { next(error); }
  };
  app.post(['/api/obs/test', '/api/v1/obs/test'], obsTest);
  const diagnostics = (_req: express.Request, res: express.Response) => res.json({ state: snapshot(), errors, runtime: { node: process.version, pid: process.pid, uptime: process.uptime(), version: capabilities.serverVersion, port: runtimePort, dataDir } });
  app.get(['/api/diagnostics', '/api/v1/diagnostics'], diagnostics);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logError(error);
    const name = error instanceof Error ? error.name : '';
    const status = name === 'NOT_FOUND' ? 404 : ['CHECKLIST_INCOMPLETE', 'CONFIRM_REQUIRED', 'TWITCH_DISCONNECTED'].includes(name) ? 409 : 400;
    const code = name === 'CHECKLIST_INCOMPLETE' ? 'CHECKLIST_INCOMPLETE' : name === 'CONFIRM_REQUIRED' ? 'CONFIRM_REQUIRED' : name === 'TWITCH_DISCONNECTED' ? 'TWITCH_DISCONNECTED' : name === 'NOT_FOUND' ? 'NOT_FOUND' : 'INVALID_REQUEST';
    res.status(status).json({ ok: false, error: { code, message: error instanceof Error ? error.message : 'Erreur interne' } });
  });
  sockets.on('connection', ws => { ws.send(JSON.stringify({ type: 'server.ready', data: capabilities })); ws.send(JSON.stringify({ type: 'state.updated', data: snapshot() } satisfies DashboardEvent)); });

  await mkdir(dataDir, { recursive: true });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(requestedPort, host, () => { server.off('error', reject); resolve(); }); });
  const address = server.address(); const actualPort = typeof address === 'object' && address ? address.port : requestedPort;
  runtimePort = actualPort;
  const unsubscribeObs = obs.onStateChanged(broadcast);
  const validator = setInterval(() => { void validateTwitch().catch(logError); }, 60 * 60_000); validator.unref();
  await validateTwitch().catch(logError);
  void obs.configure(local.settings.obsUrl, currentObsPassword).then(broadcast).catch(error => { logError(error); broadcast(); });
  void Promise.resolve(logger.info(`StreamDashboard ready on ${host}:${actualPort}`)).catch(() => undefined);
  let stopPromise: Promise<void> | undefined;
  scheduleTimerExpiry();
  const stop = () => stopPromise ??= (async () => {
    unsubscribeObs(); clearInterval(validator); if (timerExpiry) clearTimeout(timerExpiry); twitch.cancelDeviceAuthorization();
    for (const ws of sockets.clients) ws.terminate(); sockets.close();
    await mutationQueue;
    await obs.close(); await save();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  })();
  return { port: actualPort, url: `http://${host}:${actualPort}`, state: snapshot, server, stop };
}
