import express from 'express';
import { createServer, type Server } from 'node:http';
import { mkdir } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { ObsClient } from '../../../integrations/obs/src/client.js';
import { TwitchClient } from '../../../integrations/twitch/src/client.js';
import { TwitchPreflight } from '../../../integrations/twitch/src/preflight.js';
import {
  createGoogleOAuthAttempt,
  GoogleCalendarClient,
  type GoogleEvent,
  type GoogleEventInput,
  type GoogleOAuthAttempt,
  type GoogleTokens,
} from '../../../integrations/google-calendar/src/client.js';
import {
  createUnplannedLiveItem,
  finalizeUnplannedLive,
  findScheduledLiveForStart,
  findUnplannedDraft,
} from '../../../packages/core/src/live-planning.js';
import { PlanningOrchestrator, type PlanningProvider } from '../../../packages/core/src/planning.js';
import {
  parseCommand,
  protocolVersion,
  type CalendarItem,
  type ChecklistItem,
  type DashboardSettings,
  type DashboardState,
  type PreflightState,
  type ProviderLink,
  type RunMode,
  type ServerCapabilities,
  type TimerState,
} from '../../../packages/contracts/src/index.js';
import { DashboardCommandService } from './command-service.js';
import { RemoteAuth, type PersistedRemoteDevice } from './remote-auth.js';
import { parseRemoteCommand, toRemoteDashboardState } from './remote-policy.js';
import {
  AtomicJsonStore,
  DASHBOARD_SCHEMA_VERSION,
  MemorySecretStore,
  migratePlaintextTwitchTokens,
  type SecretStore,
} from './storage.js';

interface PersistedSettings extends Omit<DashboardSettings, 'obsPasswordSet' | 'twitchConnected' | 'twitchUserName'> {
  launchObs: boolean;
}
interface TwitchIdentity {
  broadcasterId: string;
  userName: string;
  displayName: string;
  accessToken?: string;
  refreshToken?: string;
}
interface GoogleLocalState { targetCalendarId: string | null; lastSyncedAt: string | null }
interface LocalData {
  schemaVersion: number;
  mode: RunMode;
  timer: TimerState;
  planning: CalendarItem[];
  checklist: ChecklistItem[];
  settings: PersistedSettings & { obsPassword?: string };
  twitch: TwitchIdentity;
  twitchLastSyncedAt: string | null;
  google: GoogleLocalState;
  remoteDevices: PersistedRemoteDevice[];
}
export interface DashboardServerOptions {
  port?: number;
  host?: string;
  remoteEnabled?: boolean;
  dataDir?: string;
  webDir?: string;
  mobileDir?: string;
  secretStore?: SecretStore;
  version?: string;
  twitchClientId?: string;
  googleClientId?: string;
  electronVersion?: string;
  logsPath?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
}
export interface DashboardServerHandle {
  port: number;
  url: string;
  state(): DashboardState;
  stop(): Promise<void>;
  server: Server;
}

const RUN_MODES: RunMode[] = ['idle', 'intro', 'live', 'pause', 'end'];
const ACCENTS: DashboardSettings['accent'][] = ['violet', 'cyan', 'rose'];
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOCAL_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const PROVIDER_STATUSES = new Set(['synced', 'pending', 'error', 'not-published', 'conflict']);
const DAY_MS = 86_400_000;
const REMOTE_ACTIVITY_PERSIST_MS = 30_000;

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function normalizeObsUrl(value: string) {
  let parsed: URL;
  try { parsed = new URL(value); }
  catch { throw new Error('Adresse OBS WebSocket invalide.'); }
  if (!['ws:', 'wss:'].includes(parsed.protocol) || !LOOPBACK_HOSTS.has(parsed.hostname) || parsed.username || parsed.password) {
    throw new Error('OBS WebSocket doit utiliser une adresse locale ws://127.0.0.1, ws://localhost ou ws://[::1].');
  }
  return parsed.href.replace(/\/$/, '');
}

function safeObsUrl(value: unknown, fallback: string) {
  try { return typeof value === 'string' ? normalizeObsUrl(value.trim()) : fallback; }
  catch { return fallback; }
}

function modeScenes(value: unknown): DashboardSettings['modeScenes'] {
  if (!object(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([mode, scene]) =>
    ['intro', 'live', 'pause', 'end'].includes(mode)
    && typeof scene === 'string'
    && scene.trim().length > 0
    && scene.length <= 200));
}

function sanitizeProviderLink(value: unknown): ProviderLink | undefined {
  if (!object(value) || !PROVIDER_STATUSES.has(String(value.status))) return undefined;
  const link: ProviderLink = { status: value.status as ProviderLink['status'] };
  for (const key of ['remoteId', 'calendarId', 'remoteRevision', 'lastError'] as const) {
    if (typeof value[key] === 'string') link[key] = String(value[key]).slice(0, 500);
  }
  if (typeof value.lastSyncedAt === 'string' && Number.isFinite(Date.parse(value.lastSyncedAt))) link.lastSyncedAt = value.lastSyncedAt;
  if (typeof value.deletedRemotely === 'boolean') link.deletedRemotely = value.deletedRemotely;
  return link;
}

function inferDesiredPublication(value: Record<string, unknown>) {
  if (object(value.desiredPublication)) {
    return {
      local: true,
      twitch: value.desiredPublication.twitch === true,
      google: value.desiredPublication.google === true,
    };
  }
  const providers = object(value.providers) ? value.providers : {};
  const twitchLink = object(providers.twitch) ? providers.twitch : {};
  const googleLink = object(providers.google) ? providers.google : {};
  return {
    local: true,
    twitch: value.source === 'TWITCH' || typeof value.twitchSegmentId === 'string' || typeof twitchLink.remoteId === 'string',
    google: value.source === 'GOOGLE' || typeof googleLink.remoteId === 'string',
  };
}

function sanitizeCalendarItem(value: unknown): CalendarItem | null {
  if (!object(value) || typeof value.id !== 'string' || !value.id || typeof value.title !== 'string') return null;
  const title = value.title.trim();
  const startAtUtc = typeof value.startAtUtc === 'string' ? value.startAtUtc : '';
  const endAtUtc = typeof value.endAtUtc === 'string' ? value.endAtUtc : '';
  const start = Date.parse(startAtUtc);
  const end = Date.parse(endAtUtc);
  if (!title || title.length > 140 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;

  const item: CalendarItem = {
    id: value.id,
    localId: typeof value.localId === 'string' && value.localId ? value.localId : value.id,
    title,
    startAtUtc,
    endAtUtc,
    desiredPublication: inferDesiredPublication(value),
  };
  if (typeof value.description === 'string') item.description = value.description.slice(0, 4000);
  if (typeof value.allDay === 'boolean') item.allDay = value.allDay;
  if (['live', 'production', 'personal'].includes(String(value.category))) item.category = value.category as CalendarItem['category'];
  if (['DAMPLANNER', 'GOOGLE', 'TWITCH'].includes(String(value.source))) item.source = value.source as CalendarItem['source'];
  if (['LOCAL', 'EXTERNAL'].includes(String(value.ownership))) item.ownership = value.ownership as CalendarItem['ownership'];
  if (['LIVE', 'PERSONAL'].includes(String(value.kind))) item.kind = value.kind as CalendarItem['kind'];
  if (typeof value.editable === 'boolean') item.editable = value.editable;
  if (typeof value.draft === 'boolean') item.draft = value.draft;
  if (typeof value.external === 'boolean') item.external = value.external;
  if (typeof value.twitchSegmentId === 'string' && value.twitchSegmentId) item.twitchSegmentId = value.twitchSegmentId;
  if (typeof value.twitchRecurring === 'boolean') item.twitchRecurring = value.twitchRecurring;
  if (typeof value.twitchCategoryId === 'string' && value.twitchCategoryId) item.twitchCategoryId = value.twitchCategoryId.slice(0, 100);
  if (typeof value.twitchCategoryName === 'string' && value.twitchCategoryName) item.twitchCategoryName = value.twitchCategoryName.slice(0, 140);
  if (typeof value.syncError === 'string') item.syncError = value.syncError.slice(0, 500);
  if (typeof value.syncedAt === 'string' && Number.isFinite(Date.parse(value.syncedAt))) item.syncedAt = value.syncedAt;

  if (object(value.providers)) {
    const twitch = sanitizeProviderLink(value.providers.twitch);
    const google = sanitizeProviderLink(value.providers.google);
    item.providers = { ...(twitch ? { twitch } : {}), ...(google ? { google } : {}) };
  }
  if (object(value.conflict) && ['twitch', 'google'].includes(String(value.conflict.provider)) && typeof value.conflict.detectedAt === 'string') {
    const remoteValue = object(value.conflict.remote) ? value.conflict.remote : null;
    const remote = remoteValue ? {
      title: typeof remoteValue.title === 'string' ? remoteValue.title : title,
      description: typeof remoteValue.description === 'string' ? remoteValue.description : undefined,
      startAtUtc: typeof remoteValue.startAtUtc === 'string' ? remoteValue.startAtUtc : startAtUtc,
      endAtUtc: typeof remoteValue.endAtUtc === 'string' ? remoteValue.endAtUtc : endAtUtc,
      allDay: typeof remoteValue.allDay === 'boolean' ? remoteValue.allDay : undefined,
      twitchCategoryId: typeof remoteValue.twitchCategoryId === 'string' ? remoteValue.twitchCategoryId : undefined,
      twitchCategoryName: typeof remoteValue.twitchCategoryName === 'string' ? remoteValue.twitchCategoryName : undefined,
    } : undefined;
    item.conflict = { provider: value.conflict.provider as 'twitch' | 'google', detectedAt: value.conflict.detectedAt, remote };
  }
  return item;
}

function parseGoogleTokens(value: Record<string, string> | null): GoogleTokens | null {
  if (!value?.accessToken && !value?.refreshToken) return null;
  const expiresAt = Number(value.expiresAt);
  return {
    accessToken: value.accessToken ?? '',
    refreshToken: value.refreshToken ?? '',
    expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
  };
}

function sameCalendarData(local: CalendarItem, remote: GoogleEvent) {
  return local.title === remote.title
    && (local.description ?? '') === (remote.description ?? '')
    && Boolean(local.allDay) === Boolean(remote.allDay)
    && Date.parse(local.startAtUtc) === Date.parse(remote.startAtUtc)
    && Date.parse(local.endAtUtc) === Date.parse(remote.endAtUtc);
}

function googleEventInput(item: CalendarItem): GoogleEventInput {
  return {
    localId: item.localId ?? item.id,
    title: item.title,
    description: item.description,
    startAtUtc: item.startAtUtc,
    endAtUtc: item.endAtUtc,
    allDay: item.allDay,
  };
}

function overlapsWindow(item: CalendarItem, timeMin: string, timeMax: string) {
  return Date.parse(item.endAtUtc) > Date.parse(timeMin) && Date.parse(item.startAtUtc) < Date.parse(timeMax);
}

function lanUrls(port: number) {
  if (!port) return [];
  const result = new Set<string>();
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family === 'IPv4' && !address.internal) result.add(`http://${address.address}:${port}/mobile/`);
    }
  }
  return [...result];
}

export async function startDashboardServer(options: DashboardServerOptions = {}): Promise<DashboardServerHandle> {
  const requestedPort = options.port ?? Number(process.env.PORT ?? 47832);
  const host = options.host ?? '127.0.0.1';
  const remoteRuntimeEnabled = options.remoteEnabled === true;
  if (!LOOPBACK_HOSTS.has(host) && !remoteRuntimeEnabled) {
    throw new Error('Le mode remote-LAN est désactivé tant que le pairing authentifié n’est pas configuré.');
  }
  if (!LOOPBACK_HOSTS.has(host) && host !== '0.0.0.0') throw new Error('Adresse d’écoute LAN invalide.');

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
    settings: {
      streamerName: 'Streamer',
      accent: 'violet',
      confirmStop: true,
      obsUrl: defaultObsUrl,
      launchObs: false,
      modeScenes: {},
      startMode: 'intro',
      remoteEnabled: false,
    },
    twitch: { broadcasterId: '', userName: '', displayName: '' },
    twitchLastSyncedAt: null,
    google: { targetCalendarId: null, lastSyncedAt: null },
    remoteDevices: [],
  };

  let local = await store.read(defaults);
  if (!object(local)) local = structuredClone(defaults);
  local.mode = RUN_MODES.includes(local.mode) ? local.mode : 'idle';
  if (!object(local.timer)) local.timer = structuredClone(defaults.timer);
  else {
    const duration = Number(local.timer.duration);
    const remainingValue = Number(local.timer.remaining);
    const deadline = Number(local.timer.deadline);
    local.timer.duration = Number.isFinite(duration) && duration >= 1 && duration <= 86_400 ? Math.floor(duration) : defaults.timer.duration;
    local.timer.remaining = Number.isFinite(remainingValue) && remainingValue >= 0 ? Math.min(Math.floor(remainingValue), 86_400) : local.timer.duration;
    local.timer.running = local.timer.running === true && Number.isFinite(deadline) && deadline > 0;
    local.timer.deadline = local.timer.running ? deadline : null;
  }
  local.planning = Array.isArray(local.planning)
    ? local.planning.map(sanitizeCalendarItem).filter((item): item is CalendarItem => Boolean(item))
    : [];
  if (!Array.isArray(local.checklist)) local.checklist = structuredClone(defaults.checklist);
  else {
    const seen = new Set<string>();
    local.checklist = local.checklist
      .filter(item => object(item) && typeof item.id === 'string' && item.id && typeof item.label === 'string' && item.label.trim())
      .map(item => ({ id: String(item.id), label: String(item.label).slice(0, 200), done: item.done === true }))
      .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
    if (!local.checklist.length) local.checklist = structuredClone(defaults.checklist);
  }

  const rawSettings: Partial<PersistedSettings & { obsPassword?: string }> = object(local.settings) ? local.settings : {};
  local.settings = {
    streamerName: typeof rawSettings.streamerName === 'string' && rawSettings.streamerName.trim()
      ? rawSettings.streamerName.trim().slice(0, 80)
      : defaults.settings.streamerName,
    accent: ACCENTS.includes(rawSettings.accent as DashboardSettings['accent'])
      ? rawSettings.accent as DashboardSettings['accent']
      : defaults.settings.accent,
    confirmStop: typeof rawSettings.confirmStop === 'boolean' ? rawSettings.confirmStop : defaults.settings.confirmStop,
    obsUrl: safeObsUrl(rawSettings.obsUrl, defaults.settings.obsUrl),
    launchObs: rawSettings.launchObs === true,
    obsExecutablePath: typeof rawSettings.obsExecutablePath === 'string' && rawSettings.obsExecutablePath.trim().length <= 500
      ? rawSettings.obsExecutablePath.trim() || undefined : undefined,
    modeScenes: modeScenes(rawSettings.modeScenes),
    startMode: rawSettings.startMode === 'live' ? 'live' : 'intro',
    timerBrowserSource: typeof rawSettings.timerBrowserSource === 'string' && rawSettings.timerBrowserSource.trim().length <= 200
      ? rawSettings.timerBrowserSource.trim() || undefined : undefined,
    remoteEnabled: rawSettings.remoteEnabled === true,
    ...(typeof rawSettings.obsPassword === 'string' && rawSettings.obsPassword.length <= 500 ? { obsPassword: rawSettings.obsPassword } : {}),
  };

  const rawTwitch: Partial<TwitchIdentity> = object(local.twitch) ? local.twitch : {};
  local.twitch = {
    broadcasterId: typeof rawTwitch.broadcasterId === 'string' ? rawTwitch.broadcasterId : '',
    userName: typeof rawTwitch.userName === 'string' ? rawTwitch.userName : '',
    displayName: typeof rawTwitch.displayName === 'string' ? rawTwitch.displayName : '',
    ...(typeof rawTwitch.accessToken === 'string' ? { accessToken: rawTwitch.accessToken } : {}),
    ...(typeof rawTwitch.refreshToken === 'string' ? { refreshToken: rawTwitch.refreshToken } : {}),
  };
  local.twitchLastSyncedAt = typeof local.twitchLastSyncedAt === 'string' && Number.isFinite(Date.parse(local.twitchLastSyncedAt))
    ? local.twitchLastSyncedAt : null;
  const rawGoogle: Record<string, unknown> = object(local.google) ? local.google as Record<string, unknown> : {};
  local.google = {
    targetCalendarId: typeof rawGoogle.targetCalendarId === 'string' && rawGoogle.targetCalendarId ? rawGoogle.targetCalendarId : null,
    lastSyncedAt: typeof rawGoogle.lastSyncedAt === 'string' && Number.isFinite(Date.parse(rawGoogle.lastSyncedAt)) ? rawGoogle.lastSyncedAt : null,
  };
  local.remoteDevices = Array.isArray(local.remoteDevices)
    ? local.remoteDevices
      .filter(device => object(device) && typeof device.id === 'string' && typeof device.name === 'string' && typeof device.credentialHash === 'string')
      .map(device => ({
        id: String(device.id),
        name: String(device.name).slice(0, 80),
        createdAt: String(device.createdAt ?? ''),
        lastSeenAt: String(device.lastSeenAt ?? ''),
        ...(typeof device.revokedAt === 'string' ? { revokedAt: device.revokedAt } : {}),
        credentialHash: String(device.credentialHash),
      }))
    : [];

  const requiresSchemaMigration = local.schemaVersion !== DASHBOARD_SCHEMA_VERSION;
  local.schemaVersion = DASHBOARD_SCHEMA_VERSION;
  const migratedTokens = await migratePlaintextTwitchTokens(local, secrets);
  const migratedObsPassword = Boolean(local.settings.obsPassword && secrets.persistent);
  if (local.settings.obsPassword && secrets.persistent) {
    await secrets.setObsPassword(local.settings.obsPassword);
    delete local.settings.obsPassword;
  }
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
  const twitch = new TwitchClient({
    clientId: options.twitchClientId ?? process.env.TWITCH_CLIENT_ID ?? '',
    accessToken: savedTokens.accessToken ?? '',
    refreshToken: savedTokens.refreshToken ?? '',
    ...local.twitch,
  }, async tokens => {
    if (tokens) await secrets.setTwitchTokens(tokens);
    else await secrets.clearTwitchTokens();
  });
  const googleClientId = options.googleClientId ?? process.env.GOOGLE_CLIENT_ID ?? '';
  const google = new GoogleCalendarClient(
    googleClientId,
    parseGoogleTokens(await secrets.getGoogleTokens?.() ?? null),
    async tokens => {
      if (!tokens) { await secrets.clearGoogleTokens?.(); return; }
      await secrets.setGoogleTokens?.({
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        expiresAt: String(tokens.expiresAt),
      });
    },
  );
  let googleCalendars: Array<{ id: string; summary: string; writable: boolean }> = [];
  let googleError: string | null = null;
  let googleOAuthAttempt: GoogleOAuthAttempt | null = null;
  let preflightState: PreflightState = {
    eventId: null,
    status: 'idle',
    title: null,
    category: null,
    gameId: null,
    error: null,
    preparedAt: null,
  };
  const twitchPreflight = new TwitchPreflight({
    getChannel: () => twitch.getChannelMetadata(),
    searchGame: name => twitch.searchGames(name),
    updateChannel: value => twitch.updateChannelMetadata(value),
  });

  const app = express();
  const remoteAuth = new RemoteAuth(Date.now, local.remoteDevices);
  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true });
  const socketDevices = new Map<WebSocket, string>();

  const isLocalAddress = (address: string | undefined | null) => LOCAL_ADDRESSES.has(address ?? '');
  const isLocalRequest = (req: express.Request) => isLocalAddress(req.socket.remoteAddress);
  const isRemoteRequest = (req: express.Request) => !isLocalRequest(req);
  const requireLocal = (req: express.Request, res: express.Response) => {
    if (isLocalRequest(req)) return true;
    res.status(403).json({ ok: false, error: { code: 'LOCAL_ONLY', message: 'Cette action est disponible uniquement depuis le PC.' } });
    return false;
  };

  server.on('upgrade', (request, socket, head) => {
    const requestUrl = new URL(request.url ?? '/', 'http://local');
    const pathname = requestUrl.pathname;
    const origin = request.headers.origin;
    const requestHost = request.headers.host;
    const acceptedOrigin = (() => {
      if (!origin) return true;
      try { return Boolean(requestHost) && new URL(origin).host === requestHost; }
      catch { return false; }
    })();
    const remoteRequest = !isLocalAddress(request.socket.remoteAddress);
    const deviceId = remoteRequest ? remoteAuth.consumeWsTicket(requestUrl.searchParams.get('ticket') ?? '') : null;
    if ((pathname !== '/ws' && pathname !== '/ws/v1') || !acceptedOrigin || (remoteRequest && (!remoteRuntimeEnabled || !deviceId))) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }
    sockets.handleUpgrade(request, socket, head, ws => {
      if (deviceId) socketDevices.set(ws, deviceId);
      sockets.emit('connection', ws, request);
    });
  });

  app.use((_req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; connect-src 'self' ws://127.0.0.1:* ws://localhost:* ws://[::1]:* ws: wss:; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Referrer-Policy': 'no-referrer',
      'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    });
    next();
  });
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) { next(); return; }
    try {
      if (new URL(origin).host === req.headers.host) { next(); return; }
    } catch { /* rejected below */ }
    res.status(403).json({ ok: false, error: { code: 'ORIGIN_REJECTED', message: 'Origine non autorisée.' } });
  });

  app.use((req, res, next) => {
    if (isLocalRequest(req) || req.path.startsWith('/api') || req.path.startsWith('/mobile')) { next(); return; }
    if (req.path === '/') { res.redirect('/mobile/'); return; }
    res.status(403).type('text/plain').send('Ressource réservée au PC.');
  });
  app.use('/overlay/timer', (_req, res, next) => {
    res.set({ 'Cache-Control': 'no-store, no-cache, must-revalidate, max-age=0', Pragma: 'no-cache', Expires: '0' });
    next();
  });
  app.use('/mobile', express.static(path.resolve(options.mobileDir ?? 'apps/mobile'), { index: 'index.html' }));
  app.use(express.static(path.resolve(options.webDir ?? 'apps/web'), { index: 'index.html' }));

  let planningQueue: Promise<void> = Promise.resolve();
  const plan = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = planningQueue.then(operation);
    planningQueue = result.then(() => undefined, () => undefined);
    return result;
  };
  let settingsQueue: Promise<void> = Promise.resolve();
  const configure = <T>(operation: () => Promise<T>): Promise<T> => {
    const result = settingsQueue.then(operation);
    settingsQueue = result.then(() => undefined, () => undefined);
    return result;
  };

  const remaining = () => local.timer.running && local.timer.deadline
    ? Math.max(0, Math.ceil((local.timer.deadline - Date.now()) / 1000))
    : local.timer.remaining;
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
    startMode: local.settings.startMode ?? 'intro',
    timerBrowserSource: local.settings.timerBrowserSource,
    remoteEnabled: local.settings.remoteEnabled === true,
  });
  const features = ['obs', 'twitch', 'preflight', 'timer', 'planning', 'checklist', 'deck', 'mobile-remote', 'unplanned-live-tracking'];
  if (googleClientId) features.push('google-calendar', 'unplanned-live-google-sync');
  const capabilities: ServerCapabilities = {
    protocolVersion,
    serverVersion: options.version ?? '1.1.0',
    features,
    accessMode: remoteRuntimeEnabled ? 'remote-LAN' : 'desktop-local',
  };
  let runtimePort = requestedPort;
  const nextLive = () => local.planning
    .filter(item => !item.allDay && (item.category === 'live' || item.kind === 'LIVE') && Date.parse(item.endAtUtc) > Date.now())
    .sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc))[0] ?? null;
  const snapshot = (): DashboardState => {
    const currentRemaining = remaining();
    const timer: TimerState = { ...local.timer, remaining: currentRemaining };
    if (timer.running && currentRemaining <= 0) { timer.running = false; timer.deadline = null; }
    return {
      at: new Date().toISOString(),
      mode: local.mode,
      timer,
      planning: local.planning,
      checklist: local.checklist,
      settings: publicSettings(),
      obs: obs.state,
      runtime: {
        serverVersion: capabilities.serverVersion,
        nodeVersion: process.version,
        electronVersion: options.electronVersion ?? null,
        platform: `${process.platform} ${process.arch}`,
        port: runtimePort,
        logsPath: options.logsPath ?? null,
      },
      twitch: { ...twitch.state, lastSyncedAt: local.twitchLastSyncedAt },
      nextLive: nextLive(),
      google: {
        configured: Boolean(googleClientId),
        connected: google.connected,
        targetCalendarId: local.google.targetCalendarId,
        calendars: googleCalendars,
        error: googleError,
        lastSyncedAt: local.google.lastSyncedAt,
      },
      preflight: preflightState,
      remote: {
        supported: true,
        enabled: remoteRuntimeEnabled,
        devices: remoteAuth.list(),
        urls: remoteRuntimeEnabled ? lanUrls(runtimePort) : [],
      },
      health: {
        dashboard: { ok: true, detail: 'API locale opérationnelle', reconnects: 0 },
        storage: { ok: true, detail: dataFile, reconnects: 0 },
        obs: {
          ok: obs.state.connected,
          detail: obs.state.connected ? `WebSocket connecté${obs.state.obsVersion ? ` · OBS ${obs.state.obsVersion}` : ''}` : (obs.state.error ?? 'OBS hors ligne — cockpit disponible'),
          reconnects: obs.reconnectCount,
        },
        twitch: {
          ok: twitch.state.connected,
          detail: twitch.state.connected ? `Connecté en tant que ${twitch.state.displayName}` : (twitch.state.error ?? 'Twitch non connecté'),
          reconnects: 0,
        },
        google: {
          ok: !googleClientId || (google.connected && !googleError),
          detail: !googleClientId
            ? 'Google Calendar optionnel · non configuré'
            : googleError
              ? googleError
              : google.connected
                ? `Google Calendar connecté${local.google.targetCalendarId ? ' · calendrier sélectionné' : ''}`
                : 'Google Calendar non connecté',
          reconnects: 0,
        },
      },
    };
  };

  const stateEvent = (remote = false) => JSON.stringify({
    type: 'state.updated',
    data: remote ? toRemoteDashboardState(snapshot()) : snapshot(),
  });
  const broadcast = () => {
    for (const ws of sockets.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(stateEvent(socketDevices.has(ws)));
    }
  };
  const save = async () => {
    local.remoteDevices = remoteAuth.serialize();
    local.schemaVersion = DASHBOARD_SCHEMA_VERSION;
    await store.write(local);
  };

  let remoteActivitySaveTimer: NodeJS.Timeout | undefined;
  const scheduleRemoteActivitySave = () => {
    if (remoteActivitySaveTimer) return;
    remoteActivitySaveTimer = setTimeout(() => {
      remoteActivitySaveTimer = undefined;
      void save().catch(logError);
    }, REMOTE_ACTIVITY_PERSIST_MS);
    remoteActivitySaveTimer.unref();
  };

  let timerExpiry: NodeJS.Timeout | undefined;
  const scheduleTimerExpiry = () => {
    if (timerExpiry) clearTimeout(timerExpiry);
    timerExpiry = undefined;
    if (!local.timer.running || !local.timer.deadline) return;
    const expectedDeadline = local.timer.deadline;
    timerExpiry = setTimeout(() => {
      timerExpiry = undefined;
      void (async () => {
        if (!local.timer.running || local.timer.deadline !== expectedDeadline) return;
        local.timer.running = false;
        local.timer.remaining = 0;
        local.timer.deadline = null;
        await save();
        broadcast();
      })().catch(logError);
    }, Math.max(0, expectedDeadline - Date.now()));
    timerExpiry.unref();
  };
  const changed = async () => {
    scheduleTimerExpiry();
    await save();
    broadcast();
    return snapshot();
  };
  const commands = new DashboardCommandService(local, obs, changed, { settings: local.settings, logger });

  const refreshGoogleCalendars = async () => {
    if (!googleClientId || !google.connected) { googleCalendars = []; return; }
    try {
      googleCalendars = await google.calendars();
      googleError = null;
    } catch (error) {
      googleError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  };

  const providerAdapters = (): Partial<Record<'twitch' | 'google', PlanningProvider>> => ({
    twitch: twitch.state.connected ? {
      create: item => twitch.createSegment(item),
      update: async (id, item) => { await twitch.updateSegment(id, item); return {}; },
      delete: id => twitch.deleteSegment(id),
    } : undefined,
    google: google.connected ? {
      create: async item => {
        const calendarId = item.providers?.google?.calendarId ?? local.google.targetCalendarId;
        if (!calendarId) throw new Error('Choisissez un calendrier Google cible.');
        const event = await google.create(calendarId, googleEventInput(item));
        return { id: event.id, revision: event.etag, calendarId };
      },
      update: async (id, item, revision) => {
        const calendarId = item.providers?.google?.calendarId ?? local.google.targetCalendarId;
        if (!calendarId) throw new Error('Calendrier Google lié introuvable.');
        const event = await google.update(calendarId, id, googleEventInput(item), revision);
        return { revision: event.etag };
      },
      delete: async (id, item, revision) => {
        const calendarId = item.providers?.google?.calendarId ?? local.google.targetCalendarId;
        if (!calendarId) throw new Error('Calendrier Google lié introuvable.');
        await google.delete(calendarId, id, revision);
      },
    } : undefined,
  });
  const planning = () => new PlanningOrchestrator(local.planning, providerAdapters(), async items => {
    local.planning = items;
    await save();
  });

  const invalidatePreflight = () => {
    twitchPreflight.invalidate();
    preflightState = { eventId: null, status: 'idle', title: null, category: null, gameId: null, error: null, preparedAt: null };
  };
  const runPreflight = async () => {
    const event = nextLive();
    if (!event) {
      preflightState = { eventId: null, status: 'idle', title: null, category: null, gameId: null, error: null, preparedAt: null };
      return changed();
    }
    const category = event.twitchCategoryName ?? null;
    preflightState = {
      eventId: event.id,
      status: 'preparing',
      title: event.title,
      category,
      gameId: event.twitchCategoryId ?? null,
      error: null,
      preparedAt: null,
    };
    broadcast();
    if (!twitch.state.connected) {
      preflightState.status = 'action-required';
      preflightState.error = 'Connectez Twitch pour préparer le titre et la catégorie.';
      const item = local.checklist.find(value => value.id === 'title');
      if (item) item.done = false;
      return changed();
    }
    try {
      const result = await twitchPreflight.prepare({
        eventId: event.id,
        title: event.title,
        category: category ?? undefined,
        categoryId: event.twitchCategoryId ?? undefined,
      });
      preflightState = {
        eventId: event.id,
        status: result.status,
        title: event.title,
        category,
        gameId: 'gameId' in result ? result.gameId : null,
        error: result.status === 'ready' ? null : result.error ?? null,
        preparedAt: result.status === 'ready' ? new Date().toISOString() : null,
      };
      const item = local.checklist.find(value => value.id === 'title');
      if (item) item.done = result.status === 'ready';
      return changed();
    } catch (error) {
      preflightState = {
        eventId: event.id,
        status: 'error',
        title: event.title,
        category,
        gameId: event.twitchCategoryId ?? null,
        error: error instanceof Error ? error.message : String(error),
        preparedAt: null,
      };
      const item = local.checklist.find(value => value.id === 'title');
      if (item) item.done = false;
      return changed();
    }
  };
  const executeCommand = async (body: unknown, remote = false) => {
    const command = remote ? parseRemoteCommand(body, snapshot()) : parseCommand(body);
    const state = await commands.execute(command);
    if (command.type === 'session.prepare') return { command, state: await runPreflight() };
    return { command, state };
  };
  const validateTwitch = async () => {
    if (!twitch.state.connected) return;
    if (!await twitch.validateSession()) {
      local.twitch = { broadcasterId: '', userName: '', displayName: '' };
      await save();
    }
    broadcast();
  };

  let trackedUnplannedLiveId = findUnplannedDraft(local.planning)?.id ?? null;
  let observedObsStreaming = false;
  let obsConnectionObserved = false;
  let streamTrackingQueue: Promise<void> = Promise.resolve();
  let unplannedMetadataQueue: Promise<void> = Promise.resolve();
  let unplannedGoogleQueue: Promise<void> = Promise.resolve();

  const findTrackedDraft = () => findUnplannedDraft(local.planning, trackedUnplannedLiveId);
  const shouldPublishUnplannedToGoogle = () => google.connected && Boolean(local.google.targetCalendarId);

  const recordUnplannedGoogleFailure = async (id: string, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    await plan(async () => {
      const current = local.planning.find(item => item.id === id);
      if (!current || current.desiredPublication?.google !== true) return;
      current.providers ??= {};
      const link = current.providers.google ??= { status: 'error' };
      link.status = 'error';
      link.lastError = message;
      googleError = message;
      await save();
      broadcast();
    });
    void Promise.resolve(logger.warn(`Impossible de synchroniser le live non programmé vers Google Calendar : ${message}`)).catch(() => undefined);
  };

  const syncUnplannedGoogleNow = async (id: string) => {
    const snapshotItem = local.planning.find(item => item.id === id);
    if (!snapshotItem || snapshotItem.desiredPublication?.google !== true) return;
    const item = structuredClone(snapshotItem);
    const calendarId = item.providers?.google?.calendarId ?? local.google.targetCalendarId;
    if (!google.connected || !calendarId) {
      await recordUnplannedGoogleFailure(id, new Error('Google Calendar non connecté ou calendrier cible indisponible.'));
      return;
    }

    try {
      const linkedId = item.providers?.google?.remoteId;
      const event = linkedId
        ? await google.update(calendarId, linkedId, googleEventInput(item), item.providers?.google?.remoteRevision)
        : await google.create(calendarId, googleEventInput(item));
      let shouldRemoveUnexpectedCreate = false;
      await plan(async () => {
        const current = local.planning.find(value => value.id === id);
        if (!current || current.desiredPublication?.google !== true) {
          shouldRemoveUnexpectedCreate = !linkedId;
          return;
        }
        current.providers ??= {};
        const link = current.providers.google ??= { status: 'pending' };
        if (link.remoteId && link.remoteId !== event.id) {
          link.status = 'conflict';
          link.lastError = 'Le lien Google a changé pendant la synchronisation automatique.';
          googleError = link.lastError;
        } else {
          link.status = 'synced';
          link.remoteId = event.id;
          link.calendarId = calendarId;
          link.remoteRevision = event.etag;
          link.lastSyncedAt = new Date().toISOString();
          link.deletedRemotely = false;
          delete link.lastError;
          local.google.lastSyncedAt = link.lastSyncedAt;
          googleError = null;
        }
        await save();
        broadcast();
      });
      if (shouldRemoveUnexpectedCreate) {
        await google.delete(calendarId, event.id, event.etag).catch(error => {
          void Promise.resolve(logger.warn('Nettoyage d’un événement Google créé pendant une dépublication concurrente impossible.', error)).catch(() => undefined);
        });
      }
    } catch (error) {
      await recordUnplannedGoogleFailure(id, error);
    }
  };

  const queueUnplannedGoogleSync = (id: string) => {
    const operation = unplannedGoogleQueue.then(() => syncUnplannedGoogleNow(id));
    unplannedGoogleQueue = operation.catch(logError);
  };

  const enrichUnplannedFromTwitch = async (id: string) => {
    if (!twitch.state.connected) return;
    try {
      const metadata = await twitch.getChannelMetadata();
      let changedMetadata = false;
      let shouldResyncGoogle = false;
      await plan(async () => {
        const current = local.planning.find(item => item.id === id);
        if (!current) return;
        if (current.title === 'Live non programmé' && metadata.title.trim()) {
          current.title = metadata.title.trim().slice(0, 140);
          changedMetadata = true;
        }
        if (!current.twitchCategoryId && metadata.gameId && metadata.gameId !== '0') {
          current.twitchCategoryId = metadata.gameId;
          changedMetadata = true;
        }
        if (!changedMetadata) return;
        shouldResyncGoogle = current.desiredPublication?.google === true;
        await save();
        broadcast();
      });
      if (shouldResyncGoogle) queueUnplannedGoogleSync(id);
    } catch (error) {
      void Promise.resolve(logger.warn('Impossible de récupérer les métadonnées Twitch pour le live non programmé.', error)).catch(() => undefined);
    }
  };

  const queueUnplannedMetadata = (id: string) => {
    const operation = unplannedMetadataQueue.then(() => enrichUnplannedFromTwitch(id));
    unplannedMetadataQueue = operation.catch(logError);
  };

  const startUnplannedLive = async (observedAt: number) => {
    let backgroundId: string | null = null;
    await plan(async () => {
      const existingDraft = findTrackedDraft();
      if (existingDraft) {
        trackedUnplannedLiveId = existingDraft.id;
        backgroundId = existingDraft.id;
        return;
      }
      if (findScheduledLiveForStart(local.planning, observedAt)) {
        trackedUnplannedLiveId = null;
        return;
      }
      const id = randomUUID();
      const item = createUnplannedLiveItem({
        id,
        now: observedAt,
        publishGoogle: shouldPublishUnplannedToGoogle(),
      });
      local.planning.push(item);
      trackedUnplannedLiveId = id;
      backgroundId = id;
      invalidatePreflight();
      await save();
      broadcast();
    });
    if (!backgroundId) return;
    queueUnplannedMetadata(backgroundId);
    if (local.planning.find(item => item.id === backgroundId)?.desiredPublication?.google === true) queueUnplannedGoogleSync(backgroundId);
  };

  const stopUnplannedLive = async (observedAt: number) => {
    let googleSyncId: string | null = null;
    await plan(async () => {
      const item = findTrackedDraft();
      trackedUnplannedLiveId = null;
      if (!item) return;
      finalizeUnplannedLive(item, observedAt);
      if (item.desiredPublication?.google === true) googleSyncId = item.id;
      await save();
      broadcast();
    });
    if (googleSyncId) queueUnplannedGoogleSync(googleSyncId);
  };

  const queueStreamTracking = (operation: () => Promise<void>) => {
    streamTrackingQueue = streamTrackingQueue.then(operation).catch(logError);
  };

  // Local administration and unauthenticated one-time pairing are registered before
  // the general remote API authorization middleware.
  app.post('/api/v1/remote/pairing', async (req, res, next) => {
    try {
      if (!requireLocal(req, res)) return;
      if (!remoteRuntimeEnabled) {
        res.status(409).json({ ok: false, error: { code: 'REMOTE_RESTART_REQUIRED', message: 'Activez la télécommande LAN puis redémarrez StreamDashboard avant le pairing.' } });
        return;
      }
      const pairing = remoteAuth.createPairing();
      await save();
      const urls = lanUrls(runtimePort);
      res.status(201).json({
        ...pairing,
        urls,
        links: urls.map(url => `${url}?pair=${encodeURIComponent(pairing.id)}&code=${encodeURIComponent(pairing.code)}`),
      });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/remote/pair', async (req, res, next) => {
    try {
      if (!remoteRuntimeEnabled) {
        res.status(403).json({ ok: false, error: { code: 'REMOTE_DISABLED', message: 'Télécommande LAN désactivée.' } });
        return;
      }
      const paired = remoteAuth.pair(String(req.body.id ?? ''), String(req.body.code ?? ''), String(req.body.name ?? ''), req.ip);
      await save();
      res.status(201).json(paired);
    } catch (error) { next(error); }
  });
  app.get('/api/v1/remote/devices', (req, res) => {
    if (!requireLocal(req, res)) return;
    res.json(remoteAuth.list());
  });
  app.get('/api/v1/remote/info', (req, res) => {
    if (!requireLocal(req, res)) return;
    res.json({ enabled: remoteRuntimeEnabled, configured: local.settings.remoteEnabled === true, urls: remoteRuntimeEnabled ? lanUrls(runtimePort) : [] });
  });
  app.delete('/api/v1/remote/devices/:id', async (req, res, next) => {
    try {
      if (!requireLocal(req, res)) return;
      const id = String(req.params.id);
      remoteAuth.revoke(id);
      for (const [ws, deviceId] of socketDevices) if (deviceId === id) ws.terminate();
      await save();
      broadcast();
      res.sendStatus(204);
    } catch (error) { next(error); }
  });

  app.use('/api', (req, res, next) => {
    if (isLocalRequest(req)) { next(); return; }
    if (!remoteRuntimeEnabled) {
      res.status(403).json({ ok: false, error: { code: 'REMOTE_DISABLED', message: 'Accès LAN désactivé.' } });
      return;
    }
    const pathName = req.path;
    if (req.method === 'GET' && ['/v1/health', '/v1/capabilities'].includes(pathName)) { next(); return; }
    const credential = req.headers.authorization?.match(/^Device (\S+)$/)?.[1];
    const deviceId = credential ? remoteAuth.authenticate(credential) : null;
    if (!deviceId) {
      res.status(401).json({ ok: false, error: { code: 'DEVICE_AUTH_REQUIRED', message: 'Télécommande non autorisée.' } });
      return;
    }
    scheduleRemoteActivitySave();
    const allowed = (req.method === 'GET' && pathName === '/v1/state')
      || (req.method === 'POST' && ['/v1/commands', '/v1/remote/ws-ticket'].includes(pathName));
    if (!allowed) {
      res.status(403).json({ ok: false, error: { code: 'REMOTE_SCOPE_DENIED', message: 'Cette action n’est pas autorisée depuis la télécommande.' } });
      return;
    }
    next();
  });
  app.post('/api/v1/remote/ws-ticket', (req, res, next) => {
    try {
      const credential = req.headers.authorization?.match(/^Device (\S+)$/)?.[1] ?? '';
      res.status(201).json(remoteAuth.createWsTicket(credential));
    } catch (error) { next(error); }
  });

  const health = (_req: express.Request, res: express.Response) => res.json({
    ok: true,
    status: 'ready',
    protocolVersion,
    version: capabilities.serverVersion,
  });
  app.get('/api/v1/health', health);
  app.get('/api/v1/state', (req, res) => res.json(isRemoteRequest(req) ? toRemoteDashboardState(snapshot()) : snapshot()));
  app.get('/api/v1/capabilities', (_req, res) => res.json(capabilities));
  app.post('/api/v1/commands', async (req, res, next) => {
    try {
      const remote = isRemoteRequest(req);
      const result = await executeCommand(req.body, remote);
      res.json({
        ok: true,
        state: remote ? toRemoteDashboardState(result.state) : result.state,
        commandType: result.command.type,
      });
    } catch (error) { next(error); }
  });
  app.get('/api/state', (_req, res) => res.json(snapshot()));
  app.post('/api/commands', async (req, res, next) => {
    try { res.json((await executeCommand(req.body)).state); }
    catch (error) { next(error); }
  });

  const planningCreate: express.RequestHandler = async (req, res, next) => {
    try {
      const input = req.body as Partial<CalendarItem>;
      const title = typeof input.title === 'string' ? input.title.trim() : '';
      const startAtUtc = typeof input.startAtUtc === 'string' ? input.startAtUtc : '';
      const endAtUtc = typeof input.endAtUtc === 'string' ? input.endAtUtc : '';
      const start = Date.parse(startAtUtc);
      const end = Date.parse(endAtUtc);
      const category = input.category ?? 'live';
      const allDay = input.allDay === true;
      if (!title || title.length > 140 || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !['live', 'production', 'personal'].includes(category)) {
        res.status(400).json({ error: 'Titre (140 caractères maximum), type et période valides requis.' });
        return;
      }
      const desired = object(input.desiredPublication) ? {
        local: true,
        twitch: input.desiredPublication.twitch === true,
        google: input.desiredPublication.google === true,
      } : { local: true, twitch: false, google: false };
      if (desired.twitch && (category !== 'live' || allDay)) throw new Error('La publication Twitch nécessite un événement Live avec des horaires précis.');
      await plan(async () => planning().create({
        title,
        description: typeof input.description === 'string' ? input.description.slice(0, 4000) : '',
        startAtUtc,
        endAtUtc,
        allDay,
        category,
        kind: category === 'live' ? 'LIVE' : category === 'personal' ? 'PERSONAL' : undefined,
        desiredPublication: desired,
        twitchCategoryId: typeof input.twitchCategoryId === 'string' ? input.twitchCategoryId : undefined,
        twitchCategoryName: typeof input.twitchCategoryName === 'string' ? input.twitchCategoryName : undefined,
      }));
      invalidatePreflight();
      res.status(201).json(await changed());
    } catch (error) { next(error); }
  };

  const planningUpdate: express.RequestHandler = async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const item = local.planning.find(value => value.id === id);
      if (!item) { const error = new Error('Événement introuvable.'); error.name = 'NOT_FOUND'; throw error; }
      if (item.editable === false) { const error = new Error('Cet événement est en lecture seule.'); error.name = 'NOT_EDITABLE'; throw error; }

      const title = typeof req.body.title === 'string' ? req.body.title.trim() : item.title;
      const startAtUtc = typeof req.body.startAtUtc === 'string' ? req.body.startAtUtc : item.startAtUtc;
      const endAtUtc = typeof req.body.endAtUtc === 'string' ? req.body.endAtUtc : item.endAtUtc;
      const category = ['live', 'production', 'personal'].includes(String(req.body.category)) ? req.body.category as CalendarItem['category'] : item.category;
      const allDay = typeof req.body.allDay === 'boolean' ? req.body.allDay : Boolean(item.allDay);
      if (!title || title.length > 140 || !Number.isFinite(Date.parse(startAtUtc)) || !Number.isFinite(Date.parse(endAtUtc)) || Date.parse(endAtUtc) <= Date.parse(startAtUtc)) {
        throw new Error('Modification planning invalide.');
      }
      const desiredPublication = object(req.body.desiredPublication) ? {
        local: true,
        twitch: req.body.desiredPublication.twitch === true,
        google: req.body.desiredPublication.google === true,
      } : undefined;
      const effectiveTwitch = desiredPublication?.twitch ?? item.desiredPublication?.twitch ?? false;
      if (effectiveTwitch && (category !== 'live' || allDay)) throw new Error('La publication Twitch nécessite un événement Live avec des horaires précis.');
      const kind = category === 'live' ? 'LIVE' : category === 'personal' ? 'PERSONAL' : undefined;
      await plan(async () => planning().update(id, {
        title,
        description: typeof req.body.description === 'string' ? req.body.description.slice(0, 4000) : item.description,
        startAtUtc,
        endAtUtc,
        allDay,
        category,
        kind,
        twitchCategoryId: typeof req.body.twitchCategoryId === 'string' ? req.body.twitchCategoryId : item.twitchCategoryId,
        twitchCategoryName: typeof req.body.twitchCategoryName === 'string' ? req.body.twitchCategoryName : item.twitchCategoryName,
      }, {
        desiredPublication,
        confirmRecurring: req.body.confirmRecurring === true,
      }));
      invalidatePreflight();
      res.json(await changed());
    } catch (error) { next(error); }
  };

  const planningRetry: express.RequestHandler = async (req, res, next) => {
    try {
      const provider = String(req.params.provider);
      const id = String(req.params.id);
      if (!['twitch', 'google'].includes(provider)) throw new Error('Provider invalide.');
      await plan(async () => planning().retry(id, provider as 'twitch' | 'google', { confirmRecurring: req.body?.confirmRecurring === true }));
      if (provider === 'google') googleError = null;
      res.json(await changed());
    } catch (error) { next(error); }
  };

  const planningResolveConflict: express.RequestHandler = async (req, res, next) => {
    try {
      const provider = String(req.params.provider);
      const id = String(req.params.id);
      const strategy = String(req.body?.strategy ?? '');
      if (!['twitch', 'google'].includes(provider) || !['local', 'remote'].includes(strategy)) throw new Error('Résolution de conflit invalide.');
      await plan(async () => planning().resolveConflict(id, provider as 'twitch' | 'google', strategy as 'local' | 'remote'));
      if (provider === 'google') googleError = null;
      invalidatePreflight();
      res.json(await changed());
    } catch (error) { next(error); }
  };

  const planningDelete: express.RequestHandler = async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const item = local.planning.find(value => value.id === id);
      if (!item) { const error = new Error('Événement introuvable.'); error.name = 'NOT_FOUND'; throw error; }
      const explicit = object(req.body?.destinations);
      const destinations = explicit ? {
        local: req.body.destinations.local === true,
        twitch: req.body.destinations.twitch === true,
        google: req.body.destinations.google === true,
        confirmRecurring: req.body.confirmRecurring === true || req.query.confirmRecurring === 'true',
      } : {
        local: true,
        twitch: Boolean(item.twitchSegmentId || item.providers?.twitch?.remoteId),
        google: Boolean(item.providers?.google?.remoteId),
        confirmRecurring: req.query.confirmRecurring === 'true',
      };
      await plan(async () => planning().remove(id, destinations));
      invalidatePreflight();
      res.json(await changed());
    } catch (error) { next(error); }
  };

  const settingsUpdate: express.RequestHandler = async (req, res, next) => {
    try {
      const input = req.body as Partial<DashboardSettings> & { obsPassword?: string; clearObsPassword?: boolean };
      const state = await configure(async () => {
        const newUrl = input.obsUrl !== undefined ? normalizeObsUrl(String(input.obsUrl).trim()) : local.settings.obsUrl;
        const clearPassword = input.clearObsPassword === true;
        const suppliedPassword = typeof input.obsPassword === 'string' && input.obsPassword.length ? input.obsPassword : undefined;
        if (suppliedPassword && suppliedPassword.length > 500) throw new Error('Mot de passe OBS trop long.');
        const newPassword = clearPassword ? '' : suppliedPassword ?? currentObsPassword;
        const obsChanged = newUrl !== local.settings.obsUrl || newPassword !== currentObsPassword;

        if (typeof input.streamerName === 'string') {
          const name = input.streamerName.trim();
          if (!name || name.length > 80) throw new Error('Le nom affiché doit contenir entre 1 et 80 caractères.');
          local.settings.streamerName = name;
        }
        if (input.accent !== undefined) {
          if (!ACCENTS.includes(input.accent)) throw new Error('Couleur d’accent invalide.');
          local.settings.accent = input.accent;
        }
        if (typeof input.confirmStop === 'boolean') local.settings.confirmStop = input.confirmStop;
        if (typeof input.launchObs === 'boolean') local.settings.launchObs = input.launchObs;
        if (input.startMode !== undefined) {
          if (!['intro', 'live'].includes(String(input.startMode))) throw new Error('Mode de démarrage invalide.');
          local.settings.startMode = input.startMode;
        }
        if (typeof input.remoteEnabled === 'boolean') local.settings.remoteEnabled = input.remoteEnabled;
        if (input.timerBrowserSource !== undefined) {
          if (typeof input.timerBrowserSource !== 'string' || input.timerBrowserSource.length > 200) throw new Error('Source timer OBS invalide.');
          local.settings.timerBrowserSource = input.timerBrowserSource.trim() || undefined;
        }
        if (input.obsExecutablePath !== undefined) {
          if (typeof input.obsExecutablePath !== 'string' || input.obsExecutablePath.length > 500) throw new Error('Chemin OBS invalide.');
          local.settings.obsExecutablePath = input.obsExecutablePath.trim() || undefined;
        }
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

  for (const prefix of ['/api', '/api/v1']) {
    app.post(`${prefix}/planning`, planningCreate);
    app.put(`${prefix}/planning/:id`, planningUpdate);
    app.delete(`${prefix}/planning/:id`, planningDelete);
    app.post(`${prefix}/planning/:id/retry/:provider`, planningRetry);
    app.post(`${prefix}/planning/:id/conflict/:provider`, planningResolveConflict);
    app.put(`${prefix}/settings`, settingsUpdate);
  }

  app.post(['/api/twitch/device', '/api/v1/twitch/device'], async (_req, res, next) => {
    try {
      const alreadyPending = Boolean(twitch.state.deviceAuthorization);
      const authorization = await twitch.startDeviceAuthorization();
      broadcast();
      res.status(201).json(authorization);
      if (!alreadyPending) {
        void twitch.waitForDeviceAuthorization().then(async () => {
          Object.assign(local.twitch, twitch.publicIdentity());
          await save();
          broadcast();
        }).catch(error => { logError(error); broadcast(); });
      }
    } catch (error) { next(error); }
  });
  app.post(['/api/twitch/disconnect', '/api/v1/twitch/disconnect'], async (_req, res, next) => {
    try {
      await twitch.disconnect();
      local.twitch = { broadcasterId: '', userName: '', displayName: '' };
      local.twitchLastSyncedAt = null;
      invalidatePreflight();
      res.json(await changed());
    } catch (error) { next(error); }
  });
  app.post(['/api/twitch/sync', '/api/v1/twitch/sync'], async (_req, res, next) => {
    try {
      res.json(await plan(async () => {
        local.planning = await twitch.sync(structuredClone(local.planning));
        local.twitchLastSyncedAt = new Date().toISOString();
        invalidatePreflight();
        return changed();
      }));
    } catch (error) { next(error); }
  });

  app.post('/api/v1/google/oauth/start', async (req, res, next) => {
    try {
      if (!requireLocal(req, res)) return;
      if (!googleClientId) throw new Error('GOOGLE_CLIENT_ID n’est pas configuré dans cette distribution.');
      googleOAuthAttempt = createGoogleOAuthAttempt(googleClientId, `http://127.0.0.1:${runtimePort}/api/v1/google/oauth/callback`);
      res.status(201).json({ authorizationUrl: googleOAuthAttempt.authorizationUrl });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/google/oauth/callback', async (req, res) => {
    try {
      if (!requireLocal(req, res)) return;
      if (!googleOAuthAttempt) throw new Error('Aucune connexion Google en attente.');
      const attempt = googleOAuthAttempt;
      googleOAuthAttempt = null;
      await google.exchangeCode(String(req.query.code ?? ''), String(req.query.state ?? ''), attempt);
      await refreshGoogleCalendars();
      googleError = null;
      await changed();
      res.type('text/plain').send('Google Calendar connecté. Vous pouvez fermer cette fenêtre et revenir dans StreamDashboard.');
    } catch (error) {
      googleOAuthAttempt = null;
      googleError = error instanceof Error ? error.message : String(error);
      logError(error);
      res.status(400).type('text/plain').send(`Connexion Google impossible : ${googleError}`);
    }
  });
  app.get('/api/v1/google/calendars', async (req, res, next) => {
    try { if (!requireLocal(req, res)) return; await refreshGoogleCalendars(); res.json(googleCalendars); }
    catch (error) { next(error); }
  });
  app.put('/api/v1/google/target', async (req, res, next) => {
    try {
      if (!requireLocal(req, res)) return;
      await refreshGoogleCalendars();
      const id = String(req.body.calendarId ?? '');
      const calendar = googleCalendars.find(value => value.id === id);
      if (!calendar?.writable) throw new Error('Choisissez un calendrier Google modifiable.');
      local.google.targetCalendarId = id;
      googleError = null;
      res.json(await changed());
    } catch (error) { next(error); }
  });
  app.post('/api/v1/google/disconnect', async (req, res, next) => {
    try {
      if (!requireLocal(req, res)) return;
      googleOAuthAttempt = null;
      await google.disconnect();
      googleCalendars = [];
      googleError = null;
      local.google = { targetCalendarId: null, lastSyncedAt: null };
      res.json(await changed());
    } catch (error) { next(error); }
  });
  app.post('/api/v1/google/sync', async (req, res, next) => {
    try {
      if (!requireLocal(req, res)) return;
      res.json(await plan(async () => {
        if (!google.connected) throw new Error('Connectez Google Calendar avant de synchroniser.');
        const calendarId = local.google.targetCalendarId;
        if (!calendarId) throw new Error('Choisissez un calendrier Google cible.');
        const timeMin = new Date(Date.now() - 30 * DAY_MS).toISOString();
        const timeMax = new Date(Date.now() + 730 * DAY_MS).toISOString();
        const remote = await google.events(calendarId, { timeMin, timeMax });
        const remoteById = new Map(remote.map(event => [event.id, event]));
        const localById = new Map(local.planning.map(item => [item.localId ?? item.id, item]));
        const remoteIds = new Set(remote.filter(event => !event.deleted).map(event => event.id));

        local.planning = local.planning.filter(item => {
          const linkedId = item.providers?.google?.remoteId;
          if (item.source !== 'GOOGLE' || item.ownership !== 'EXTERNAL' || !linkedId) return true;
          if (!overlapsWindow(item, timeMin, timeMax)) return true;
          return remoteIds.has(linkedId);
        });

        for (const item of local.planning) {
          const link = item.providers?.google;
          if (!link?.remoteId || !overlapsWindow(item, timeMin, timeMax)) continue;
          const event = remoteById.get(link.remoteId);
          if (!event || event.deleted) {
            link.deletedRemotely = true;
            link.status = 'error';
            link.lastError = 'Événement supprimé sur Google Calendar — action utilisateur requise.';
            continue;
          }
          if (link.remoteRevision && event.etag && link.remoteRevision !== event.etag && !sameCalendarData(item, event)) {
            item.conflict = {
              provider: 'google',
              detectedAt: new Date().toISOString(),
              remote: {
                title: event.title,
                description: event.description,
                startAtUtc: event.startAtUtc,
                endAtUtc: event.endAtUtc,
                allDay: event.allDay,
              },
            };
            link.status = 'conflict';
            link.remoteRevision = event.etag;
            link.lastError = 'Conflit avec une modification Google distante.';
            continue;
          }
          if (item.conflict?.provider === 'google') continue;
          link.remoteRevision = event.etag;
          link.status = 'synced';
          link.deletedRemotely = false;
          link.lastSyncedAt = new Date().toISOString();
          delete link.lastError;
        }

        for (const event of remote) {
          if (event.deleted) continue;
          const managedLocal = event.managed ? localById.get(event.localId) : undefined;
          if (managedLocal) {
            managedLocal.providers ??= {};
            const existingLink = managedLocal.providers.google;
            if (managedLocal.conflict?.provider === 'google') continue;
            if (!sameCalendarData(managedLocal, event)) {
              managedLocal.conflict = {
                provider: 'google',
                detectedAt: new Date().toISOString(),
                remote: {
                  title: event.title,
                  description: event.description,
                  startAtUtc: event.startAtUtc,
                  endAtUtc: event.endAtUtc,
                  allDay: event.allDay,
                },
              };
              managedLocal.providers.google = {
                ...(existingLink ?? {}),
                status: 'conflict',
                remoteId: event.id,
                calendarId,
                remoteRevision: event.etag,
                lastError: 'Conflit avec une modification Google distante.',
              };
              continue;
            }
            managedLocal.providers.google = {
              status: 'synced',
              remoteId: event.id,
              calendarId,
              remoteRevision: event.etag,
              lastSyncedAt: new Date().toISOString(),
              deletedRemotely: false,
            };
            managedLocal.desiredPublication ??= { local: true, twitch: false, google: true };
            managedLocal.desiredPublication.google = true;
            continue;
          }
          if (local.planning.some(item => item.providers?.google?.remoteId === event.id)) continue;
          local.planning.push({
            id: `google:${calendarId}:${event.id}`,
            localId: event.localId,
            title: event.title,
            description: event.description,
            startAtUtc: event.startAtUtc,
            endAtUtc: event.endAtUtc,
            allDay: event.allDay,
            category: 'personal',
            source: 'GOOGLE',
            ownership: 'EXTERNAL',
            editable: event.editable,
            kind: 'PERSONAL',
            external: true,
            desiredPublication: { local: true, twitch: false, google: true },
            providers: {
              google: {
                status: 'synced',
                remoteId: event.id,
                calendarId,
                remoteRevision: event.etag,
                lastSyncedAt: new Date().toISOString(),
                deletedRemotely: false,
              },
            },
          });
        }
        local.google.lastSyncedAt = new Date().toISOString();
        googleError = null;
        invalidatePreflight();
        return changed();
      }));
    } catch (error) {
      googleError = error instanceof Error ? error.message : String(error);
      next(error);
    }
  });

  const obsTest: express.RequestHandler = async (req, res, next) => {
    try {
      const url = req.body.obsUrl !== undefined ? normalizeObsUrl(String(req.body.obsUrl).trim()) : local.settings.obsUrl;
      const password = Object.prototype.hasOwnProperty.call(req.body, 'obsPassword') ? String(req.body.obsPassword ?? '') : currentObsPassword;
      res.json(await obs.test(url, password));
    } catch (error) { next(error); }
  };
  app.post(['/api/obs/test', '/api/v1/obs/test'], obsTest);
  const diagnostics = (_req: express.Request, res: express.Response) => res.json({
    state: snapshot(),
    errors,
    runtime: {
      node: process.version,
      pid: process.pid,
      uptime: process.uptime(),
      version: capabilities.serverVersion,
      port: runtimePort,
      dataDir,
    },
  });
  app.get(['/api/diagnostics', '/api/v1/diagnostics'], diagnostics);

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logError(error);
    const name = error instanceof Error ? error.name : '';
    const status = name === 'NOT_FOUND' ? 404
      : name === 'REMOTE_SCOPE_DENIED' ? 403
        : ['CHECKLIST_INCOMPLETE', 'CONFIRM_REQUIRED', 'TWITCH_DISCONNECTED', 'NOT_EDITABLE'].includes(name) ? 409
          : 400;
    const code = name === 'CHECKLIST_INCOMPLETE' ? 'CHECKLIST_INCOMPLETE'
      : name === 'CONFIRM_REQUIRED' ? 'CONFIRM_REQUIRED'
        : name === 'TWITCH_DISCONNECTED' ? 'TWITCH_DISCONNECTED'
          : name === 'NOT_FOUND' ? 'NOT_FOUND'
            : name === 'NOT_EDITABLE' ? 'NOT_EDITABLE'
              : name === 'REMOTE_SCOPE_DENIED' ? 'REMOTE_SCOPE_DENIED'
                : 'INVALID_REQUEST';
    res.status(status).json({ ok: false, error: { code, message: error instanceof Error ? error.message : 'Erreur interne' } });
  });

  sockets.on('connection', ws => {
    ws.on('close', () => socketDevices.delete(ws));
    ws.send(JSON.stringify({ type: 'server.ready', data: capabilities }));
    ws.send(stateEvent(socketDevices.has(ws)));
  });

  await mkdir(dataDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : requestedPort;
  runtimePort = actualPort;
  const unsubscribeObs = obs.onStateChanged(() => {
    const currentStreaming = obs.state.streaming;
    if (obs.state.connected) {
      if (!obsConnectionObserved) {
        obsConnectionObserved = true;
        observedObsStreaming = currentStreaming;
        const observedAt = Date.now();
        if (currentStreaming) queueStreamTracking(() => startUnplannedLive(observedAt));
        else if (trackedUnplannedLiveId) queueStreamTracking(() => stopUnplannedLive(observedAt));
      } else if (currentStreaming !== observedObsStreaming) {
        observedObsStreaming = currentStreaming;
        const observedAt = Date.now();
        queueStreamTracking(() => currentStreaming ? startUnplannedLive(observedAt) : stopUnplannedLive(observedAt));
      }
    }
    broadcast();
  });
  const validator = setInterval(() => { void validateTwitch().catch(logError); }, 60 * 60_000);
  validator.unref();
  await validateTwitch().catch(logError);
  if (google.connected) await refreshGoogleCalendars().catch(logError);
  void obs.configure(local.settings.obsUrl, currentObsPassword).then(broadcast).catch(error => { logError(error); broadcast(); });
  void Promise.resolve(logger.info(`StreamDashboard ready on ${host}:${actualPort}`)).catch(() => undefined);

  let stopPromise: Promise<void> | undefined;
  scheduleTimerExpiry();
  const stop = () => stopPromise ??= (async () => {
    unsubscribeObs();
    clearInterval(validator);
    if (timerExpiry) clearTimeout(timerExpiry);
    if (remoteActivitySaveTimer) clearTimeout(remoteActivitySaveTimer);
    await streamTrackingQueue.catch(() => undefined);
    await unplannedMetadataQueue.catch(() => undefined);
    await unplannedGoogleQueue.catch(() => undefined);
    twitch.close();
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    await obs.close();
    await save();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  })();
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::1' ? '[::1]' : host;
  return { port: actualPort, url: `http://${urlHost}:${actualPort}`, state: snapshot, server, stop };
}
