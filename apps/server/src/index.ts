import express from 'express';
import { createServer, type Server } from 'node:http';
import { mkdir, stat, unlink } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { WebSocketServer, type WebSocket } from 'ws';
import { ObsClient } from '../../../integrations/obs/src/client.js';
import { TwitchClient } from '../../../integrations/twitch/src/client.js';
import { TwitchPreflight } from '../../../integrations/twitch/src/preflight.js';
import { TwitchEventSub, type TwitchChatMessage, type TwitchRewardRedemption } from '../../../integrations/twitch/src/eventsub.js';
import { DiscordClient } from '../../../integrations/discord/src/client.js';
import { expandRecurringItems } from '../../../packages/core/src/recurrence.js';
import { EventCore } from '../../../packages/core/src/events.js';
import { integrationState, transitionIntegration } from '../../../packages/core/src/integrations.js';
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
  type DashboardCommand,
  type DiscordSettings,
  type PreflightState,
  type ProviderLink,
  type RunMode,
  type ServerCapabilities,
  type TimerState,
  type ControlHubSnapshot,
  type Sound,
  type StreamerPing,
} from '../../../packages/contracts/src/index.js';
import { DashboardCommandService } from './command-service.js';
import { companionSnapshot, emptyCompanionState, reconcileCompanionBatch, resolveCompanionConflict, type CompanionState, type SyncOperation } from './companion-sync.js';
import { RemoteAuth, type PersistedRemoteDevice } from './remote-auth.js';
import { parseRemoteCommand, toRemoteDashboardState } from './remote-policy.js';
import { isRemoteApiAllowed } from './remote-api-policy.js';
import { SoundboardRuntime, validateSound } from './soundboard-runtime.js';
import { ObsSoundboardPlayback, ObsSoundboardSetup } from './obs-soundboard.js';
import { AutomationRuntime } from './automation-runtime.js';
import type { Automation, Support } from '../../../packages/core/src/live-control-domains.js';
import { SupportRuntime } from './support-runtime.js';
import { StreamlabsAdapter } from '../../../integrations/streamlabs/src/adapter.js';
import type { StreamlabsTransport } from '../../../integrations/streamlabs/src/adapter.js';
import { StreamlabsSocketTransport } from '../../../integrations/streamlabs/src/socket-transport.js';
import { StreamlabsOAuthClient } from '../../../integrations/streamlabs/src/oauth.js';
import { WizeBotAdapter } from '../../../integrations/wizebot/src/adapter.js';
import type { WizeBotTransport } from '../../../integrations/wizebot/src/adapter.js';
import { WizeBotHttpTransport } from '../../../integrations/wizebot/src/http-transport.js';
import { registerLiveControlRoutes } from './live-control-routes.js';
import { ProductProfileStore } from './profile-store.js';
import { validateProductProfile, type ProductProfile } from '../../../packages/core/src/product-profile.js';
import { resolveModules } from '../../../packages/core/src/module-registry.js';
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
  companion: CompanionState;
  discord: DiscordSettings;
  sounds: Sound[];
  automations: Automation[];
  supports: Support[];
  streamerPings: StreamerPing[];
}
export interface DashboardServerOptions {
  port?: number;
  host?: string;
  remoteEnabled?: boolean;
  dataDir?: string;
  profileFile?: string;
  soundLibraryDir?: string;
  webDir?: string;
  mobileDir?: string;
  secretStore?: SecretStore;
  version?: string;
  twitchClientId?: string;
  googleClientId?: string;
  electronVersion?: string;
  logsPath?: string;
  logger?: Pick<Console, 'info' | 'warn' | 'error'>;
  discordFetch?: typeof fetch;
  streamlabsTransport?: StreamlabsTransport;
  streamlabsFetch?: typeof fetch;
  streamlabsRedirectUri?: string;
  wizebotTransport?: WizeBotTransport;
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
const ANDROID_NATIVE_ORIGINS = new Set(['http://localhost', 'http://appassets.androidplatform.net']);

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
  if (object(value.recurrence)) item.recurrence = validateRecurrence(value.recurrence);

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

function validateRecurrence(value: unknown): CalendarItem['recurrence'] {
  if (!object(value) || !['weekly', 'monthly'].includes(String(value.frequency)) || ![1, 2].includes(Number(value.interval))) throw new Error('Récurrence invalide.');
  if (value.frequency === 'monthly' && Number(value.interval) !== 1) throw new Error('Intervalle mensuel invalide.');
  const timeZone = typeof value.timeZone === 'string' ? value.timeZone : '';
  try { new Intl.DateTimeFormat('fr-FR', { timeZone }).format(); } catch { throw new Error('Fuseau horaire invalide.'); }
  const until = value.until == null ? null : String(value.until);
  if (until && !Number.isFinite(Date.parse(until))) throw new Error('Fin de récurrence invalide.');
  const exceptions: NonNullable<CalendarItem['recurrence']>['exceptions'] = {};
  if (value.exceptions !== undefined) {
    if (!object(value.exceptions) || Object.keys(value.exceptions).length > 500) throw new Error('Exceptions de récurrence invalides.');
    for (const [key, exception] of Object.entries(value.exceptions)) {
      if (!/^[A-Za-z0-9._:-]{1,128}:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(key) || !object(exception) || Object.keys(exception).some(field => !['cancelled', 'patch'].includes(field))) throw new Error('Exception de récurrence invalide.');
      const patch = exception.patch;
      if (patch !== undefined && (!object(patch) || Object.keys(patch).length > 11 || Object.keys(patch).some(field => !['title', 'description', 'startAtUtc', 'endAtUtc', 'category', 'kind', 'twitchCategoryId', 'twitchCategoryName', 'desiredPublication'].includes(field)))) throw new Error('Patch de récurrence invalide.');
      exceptions[key] = { ...(exception.cancelled === true ? { cancelled: true } : {}), ...(patch ? { patch: structuredClone(patch) } : {}) };
    }
  }
  return { frequency: value.frequency as 'weekly' | 'monthly', interval: Number(value.interval) as 1 | 2, timeZone, until, exceptions };
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
  const soundLibraryDir = path.resolve(options.soundLibraryDir ?? path.join(dataDir, 'soundboard'));
  const profileFile = path.resolve(options.profileFile ?? path.join(dataDir, 'streamdashboard.yaml'));
  const profileExisted = await stat(profileFile).then(() => true).catch(() => false);
  const profileStore = new ProductProfileStore(profileFile);
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
      chattingScene: undefined,
      startMode: 'intro',
      remoteEnabled: false,
      streamerPingRewardIds: [],
    },
    twitch: { broadcasterId: '', userName: '', displayName: '' },
    twitchLastSyncedAt: null,
    google: { targetCalendarId: null, lastSyncedAt: null },
    remoteDevices: [],
    companion: emptyCompanionState(),
    discord: { guildId: null, channelId: null, defaultMessage: '' },
    sounds: [],
    automations: [],
    supports: [],
    streamerPings: [],
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
  local.companion = object(local.companion)
    ? { ...emptyCompanionState(), ...local.companion } as CompanionState
    : emptyCompanionState();
  const rawDiscord: Record<string, unknown> = object(local.discord) ? local.discord : {};
  local.discord = {
    guildId: typeof rawDiscord.guildId === 'string' && /^\d{1,24}$/.test(rawDiscord.guildId) ? rawDiscord.guildId : null,
    channelId: typeof rawDiscord.channelId === 'string' && /^\d{1,24}$/.test(rawDiscord.channelId) ? rawDiscord.channelId : null,
    defaultMessage: typeof rawDiscord.defaultMessage === 'string' ? rawDiscord.defaultMessage.slice(0, 2000) : '',
  };
  local.sounds = Array.isArray(local.sounds) ? local.sounds.flatMap(value => { try { return [validateSound(value)]; } catch { return []; } }) : [];
  local.automations = Array.isArray(local.automations) ? local.automations : [];
  local.supports = Array.isArray(local.supports) ? local.supports : [];
  local.streamerPings = Array.isArray(local.streamerPings) ? local.streamerPings.filter(value => object(value) && typeof value.id === 'string' && typeof value.rewardId === 'string' && typeof value.rewardTitle === 'string').slice(-50) as StreamerPing[] : [];
  local.settings.streamerPingRewardIds = Array.isArray(local.settings.streamerPingRewardIds) ? [...new Set(local.settings.streamerPingRewardIds.filter(value => typeof value === 'string' && value.length <= 100))].slice(0, 50) : [];
  if (!Array.isArray(local.checklist)) local.checklist = structuredClone(defaults.checklist);
  else {
    const seen = new Set<string>();
    local.checklist = local.checklist
      .filter(item => object(item) && typeof item.id === 'string' && item.id && typeof item.label === 'string' && item.label.trim())
      .map(item => ({ id: String(item.id), label: String(item.label).slice(0, 200), done: item.done === true }))
      .filter(item => { if (seen.has(item.id)) return false; seen.add(item.id); return true; });
    if (!local.checklist.length) local.checklist = structuredClone(defaults.checklist);
  }
  {
    const baseline = reconcileCompanionBatch(local.planning, local.checklist, local.companion, []);
    local.planning = baseline.planning;
    local.checklist = baseline.checklist;
    local.companion = baseline.companion;
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
    chattingScene: typeof rawSettings.chattingScene === 'string' && rawSettings.chattingScene.trim().length <= 200
      ? rawSettings.chattingScene.trim() || undefined : undefined,
    startMode: rawSettings.startMode === 'live' ? 'live' : 'intro',
    timerBrowserSource: typeof rawSettings.timerBrowserSource === 'string' && rawSettings.timerBrowserSource.trim().length <= 200
      ? rawSettings.timerBrowserSource.trim() || undefined : undefined,
    primaryMicInput: typeof rawSettings.primaryMicInput === 'string' && rawSettings.primaryMicInput.trim().length <= 200
      ? rawSettings.primaryMicInput.trim() || undefined : undefined,
    requireTimerOverlayOnStart: rawSettings.requireTimerOverlayOnStart === true,
    remoteEnabled: rawSettings.remoteEnabled === true,
    streamerPingRewardIds: Array.isArray(rawSettings.streamerPingRewardIds)
      ? [...new Set(rawSettings.streamerPingRewardIds.filter(value => typeof value === 'string' && value.length <= 100))].slice(0, 50)
      : [],
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

  let productProfile: ProductProfile = await profileStore.load();
  if (!profileExisted) {
    productProfile.profile.displayName = local.settings.streamerName;
    productProfile.profile.channelName = local.twitch.displayName || local.twitch.userName;
    productProfile.modules.googleCalendar = Boolean(options.googleClientId ?? process.env.GOOGLE_CLIENT_ID);
    productProfile.modules.discord = Boolean(await secrets.getDiscordToken() || process.env.DISCORD_BOT_TOKEN);
    productProfile.modules.streamlabs = Boolean(await secrets.getStreamlabsToken?.() || await secrets.getStreamlabsOAuth?.());
    productProfile.modules.wizebot = Boolean(await secrets.getWizeBotConfiguration?.());
    await profileStore.save(productProfile);
  }

  let errors: Array<{ at: string; message: string }> = [];
  const logError = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    errors = [{ at: new Date().toISOString(), message }, ...errors].slice(0, 30);
    void Promise.resolve(logger.error(message)).catch(() => undefined);
  };

  let currentObsPassword = await secrets.getObsPassword() || local.settings.obsPassword || '';
  let discordToken = await secrets.getDiscordToken() || process.env.DISCORD_BOT_TOKEN || '';
  let discordPublic = { configured: Boolean(discordToken), connected: false, guildName: null as string | null, channelName: null as string | null, error: null as string | null };
  const discordClient = () => new DiscordClient(discordToken, options.discordFetch ?? fetch);
  const obs = new ObsClient(local.settings.obsUrl, currentObsPassword, { logger });
  const savedTokens = await secrets.getTwitchTokens() ?? {};
  const twitchClientId = options.twitchClientId ?? process.env.TWITCH_CLIENT_ID ?? '';
  const twitch = new TwitchClient({
    clientId: twitchClientId,
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
  let twitchChannel: { title: string; gameId: string; gameName: string } = { title: '', gameId: '', gameName: '' };
  let twitchLive: Awaited<ReturnType<TwitchClient['getLiveState']>> = { isLive: false, title: null, category: null, categoryId: null, startedAt: null, viewerCount: null, thumbnailUrl: null };
  let twitchChatters: Awaited<ReturnType<TwitchClient['chatters']>> = { items: [], total: 0, cursor: null };
  let chatMessages: TwitchChatMessage[] = [];
  let chatStatus: 'CONNECTING' | 'CONNECTED' | 'DEGRADED' | 'DISCONNECTED' = 'DISCONNECTED';
  let twitchEventSubStarted = false;
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
  const twitchEventSub = new TwitchEventSub(
    sessionId => twitch.subscribeEventSub(sessionId),
    message => {
      if (chatMessages.some(item => item.id === message.id)) return;
      chatMessages = [...chatMessages.slice(-199), message];
      eventCore.publish({ type: 'chat.message.received', source: 'twitch', occurredAt: message.receivedAt, payload: message });
      broadcast();
    },
    (status, error) => {
      chatStatus = status;
      eventCore.publish({ type: status === 'CONNECTED' ? 'integration.connected' : status === 'DISCONNECTED' ? 'integration.disconnected' : 'integration.degraded', source: 'twitch-chat', payload: { integration: 'twitch-chat', status, ...(error ? { error } : {}) } });
      broadcast();
    },
    undefined,
    (redemption: TwitchRewardRedemption) => {
      eventCore.publish({ type: 'twitch.reward.redeemed', source: 'twitch', occurredAt: redemption.redeemedAt, correlationId: redemption.id, payload: redemption });
      if (!(local.settings.streamerPingRewardIds ?? []).includes(redemption.reward.id)) return;
      if (local.streamerPings.some(ping => ping.id === redemption.id)) return;
      const ping: StreamerPing = {
        id: redemption.id,
        source: 'twitch-reward',
        rewardId: redemption.reward.id,
        rewardTitle: redemption.reward.title,
        rewardCost: redemption.reward.cost,
        userId: redemption.user.id,
        userName: redemption.user.displayName || redemption.user.login,
        userInput: redemption.userInput,
        createdAt: redemption.redeemedAt,
        acknowledgedAt: null,
      };
      local.streamerPings = [...local.streamerPings.filter(value => value.id !== ping.id), ping].slice(-50);
      eventCore.publish({ type: 'streamer.ping.received', source: 'twitch', occurredAt: ping.createdAt, correlationId: ping.id, payload: ping });
      void save().catch(logError);
      broadcast();
    },
  );

  const app = express();
  const remoteAuth = new RemoteAuth(Date.now, local.remoteDevices);
  const server = createServer(app);
  const sockets = new WebSocketServer({ noServer: true });
  const socketDevices = new Map<WebSocket, string>();
  const eventCore = new EventCore(250);
  local.sounds = local.sounds.map(sound => ({ ...sound, outputId: 'obs', monitoringMode: sound.monitoringMode ?? 'stream' }));
  const obsSoundboardSetup = new ObsSoundboardSetup(obs);
  const soundboard = new SoundboardRuntime(local.sounds, new ObsSoundboardPlayback(obs), () => Date.now(), event => {
    eventCore.publish({ type: event.type, source: 'soundboard', correlationId: event.correlationId, payload: event.payload });
  });
  let executeAutomationCommand: (command: DashboardCommand) => Promise<void> = async () => { throw new Error('Runtime de commandes indisponible.'); };
  const automation = new AutomationRuntime(local.automations, async (action, context) => {
    if (action.type === 'soundboard.play' && typeof action.payload.soundId === 'string') {
      const ack = await soundboard.play({ commandId: `${context.correlationId}:${context.automationId}:${context.actionIndex}`, correlationId: context.correlationId, type: 'soundboard.play', origin: 'automation', issuedAt: new Date().toISOString(), payload: { soundId: action.payload.soundId, ...(typeof action.payload.volume === 'number' ? { volume: action.payload.volume } : {}) } });
      if (ack.status !== 'succeeded') { const error = new Error(ack.message ?? 'Lecture soundboard échouée.'); error.name = ack.errorCode ?? 'SOUNDBOARD_FAILED'; throw error; }
      return;
    }
    if (action.type === 'obs.scene' && typeof action.payload.scene === 'string') return executeAutomationCommand({ type: 'obs.scene', scene: action.payload.scene });
    if (action.type === 'obs.media.restart' && typeof action.payload.input === 'string') return executeAutomationCommand({ type: 'obs.media.restart', input: action.payload.input });
    if (action.type === 'timer.add' && typeof action.payload.seconds === 'number') return executeAutomationCommand({ type: 'timer.add', seconds: action.payload.seconds });
    if (action.type === 'timer.start') return executeAutomationCommand({ type: 'timer.start', ...(typeof action.payload.seconds === 'number' ? { seconds: action.payload.seconds } : {}) });
    if (action.type === 'timer.pause') return executeAutomationCommand({ type: 'timer.pause' });
    throw new Error(`Action ${action.type} non supportée.`);
  }, async values => { local.automations = values; await save(); });
  const support = new SupportRuntime(local.supports, async values => { local.supports = values; await save(); }, value => { eventCore.publish({ type: 'support.received', source: value.provider, occurredAt: value.receivedAt, correlationId: `${value.provider}:${value.externalId}`, payload: value }); });
  const streamlabsOAuth = new StreamlabsOAuthClient(options.streamlabsFetch ?? fetch);
  const streamlabsRedirectUri = String(options.streamlabsRedirectUri ?? process.env.STREAMLABS_REDIRECT_URI ?? 'http://127.0.0.1:47832/api/v1/streamlabs/oauth/callback').trim();
  {
    let redirect: URL;
    try { redirect = new URL(streamlabsRedirectUri); } catch { throw new Error('URL de redirection Streamlabs invalide.'); }
    if (redirect.protocol !== 'http:' || !['127.0.0.1', 'localhost'].includes(redirect.hostname) || redirect.username || redirect.password) throw new Error('La redirection Streamlabs doit rester sur le loopback HTTP local.');
  }
  let streamlabsSocketToken = await secrets.getStreamlabsToken?.() ?? process.env.STREAMLABS_SOCKET_TOKEN ?? '';
  const streamlabsOAuthSecrets = await secrets.getStreamlabsOAuth?.() ?? null;
  if (!streamlabsSocketToken && streamlabsOAuthSecrets?.accessToken) {
    try {
      streamlabsSocketToken = await streamlabsOAuth.socketToken(streamlabsOAuthSecrets.accessToken);
      await secrets.setStreamlabsToken?.(streamlabsSocketToken);
    } catch (error) {
      void Promise.resolve(logger.warn('Impossible de restaurer le Socket Token Streamlabs depuis OAuth.', error)).catch(() => undefined);
    }
  }
  const streamlabs = new StreamlabsAdapter(streamlabsSocketToken, value => support.record(value).then(() => undefined), options.streamlabsTransport ?? new StreamlabsSocketTransport({ logger }), logger);
  const storedWizeBot = await secrets.getWizeBotConfiguration?.() ?? null;
  const environmentWizeBot = process.env.WIZEBOT_API_URL && process.env.WIZEBOT_TOKEN ? { apiBaseUrl: process.env.WIZEBOT_API_URL, token: process.env.WIZEBOT_TOKEN } : null;
  const wizebot = new WizeBotAdapter(storedWizeBot ?? environmentWizeBot, options.wizebotTransport ?? new WizeBotHttpTransport(), logger);

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
      try { return ANDROID_NATIVE_ORIGINS.has(origin) || (Boolean(requestHost) && new URL(origin).host === requestHost); }
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
  app.use('/api/v1/discord/planning', express.json({ limit: '14mb' }));
  app.use(express.json({ limit: '32kb' }));
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (!origin) { next(); return; }
    if (ANDROID_NATIVE_ORIGINS.has(origin)) {
      res.set({
        'Access-Control-Allow-Origin': origin,
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        Vary: 'Origin',
      });
      if (req.method === 'OPTIONS') { res.sendStatus(204); return; }
      next();
      return;
    }
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
  app.use('/packages', express.static(path.resolve('packages')));
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
    chattingScene: local.settings.chattingScene,
    startMode: local.settings.startMode ?? 'intro',
    timerBrowserSource: local.settings.timerBrowserSource,
    primaryMicInput: local.settings.primaryMicInput,
    requireTimerOverlayOnStart: local.settings.requireTimerOverlayOnStart === true,
    remoteEnabled: local.settings.remoteEnabled === true,
    streamerPingRewardIds: [...(local.settings.streamerPingRewardIds ?? [])],
  });
  const features = ['obs', 'twitch', 'preflight', 'timer', 'planning', 'planning-recurrence', 'discord-planning', 'checklist', 'deck', 'mobile-remote', 'unplanned-live-tracking', 'streamer-pings'];
  if (googleClientId) features.push('google-calendar', 'unplanned-live-google-sync');
  const capabilities: ServerCapabilities = {
    protocolVersion,
    serverVersion: options.version ?? '1.1.0',
    features,
    accessMode: remoteRuntimeEnabled ? 'remote-LAN' : 'desktop-local',
  };
  let runtimePort = requestedPort;
  let stateRevision = 0;
  const temporalPlanning = (from = Date.now() - DAY_MS, to = Date.now() + 730 * DAY_MS) => expandRecurringItems(local.planning, { from, to });
  const nextLive = () => temporalPlanning()
    .filter(item => !item.allDay && (item.category === 'live' || item.kind === 'LIVE') && Date.parse(item.endAtUtc) > Date.now())
    .sort((left, right) => Date.parse(left.startAtUtc) - Date.parse(right.startAtUtc))[0] ?? null;
  const snapshot = (): DashboardState => {
    const currentRemaining = remaining();
    const timer: TimerState = { ...local.timer, remaining: currentRemaining };
    if (timer.running && currentRemaining <= 0) { timer.running = false; timer.deadline = null; }
    const connectedState = (connected: boolean, configured = true, error?: string | null) => {
      if (!configured) return integrationState('NOT_CONFIGURED');
      if (connected) return transitionIntegration(integrationState(), 'CONNECTED', { at: new Date().toISOString() });
      return error ? transitionIntegration(integrationState(), 'DEGRADED', { error: { code: 'PROVIDER_UNAVAILABLE', message: error, retryable: true, details: null } }) : integrationState('DISCONNECTED');
    };
    const controlHub: ControlHubSnapshot = {
      live: { isLive: twitchLive.isLive, title: twitchLive.title ?? (twitchChannel.title || null), category: twitchLive.category ?? (twitchChannel.gameName || null), startedAt: twitchLive.startedAt, durationSeconds: twitchLive.startedAt ? Math.max(0, Math.floor((Date.now() - Date.parse(twitchLive.startedAt)) / 1_000)) : null, viewerCount: twitchLive.viewerCount },
      audience: { viewerCount: twitchLive.viewerCount, chatters: twitchChatters.items.map(user => { const badges = chatMessages.find(message => message.chatter.id === user.id)?.chatter.badges.map(badge => badge.setId) ?? []; return { id: user.id, displayName: user.displayName, role: user.id === local.twitch.broadcasterId ? 'broadcaster' as const : badges.includes('moderator') ? 'moderator' as const : badges.includes('vip') ? 'vip' as const : 'viewer' as const }; }) },
      activity: eventCore.recent({ limit: 20 }),
      chat: { messages: chatMessages, connected: chatStatus === 'CONNECTED' },
      integrations: {
        runtime: transitionIntegration(integrationState(), 'CONNECTED'),
        obs: connectedState(obs.state.connected, true, obs.state.error),
        twitch: connectedState(twitch.state.connected, Boolean(options.twitchClientId ?? process.env.TWITCH_CLIENT_ID), twitch.state.error),
        discord: connectedState(discordPublic.connected, discordPublic.configured, discordPublic.error),
        streamlabs: streamlabs.state(),
        wizebot: wizebot.state(),
      },
      availability: { chat: twitch.state.connected ? 'AVAILABLE' : 'NOT_CONFIGURED', support: streamlabs.state().status === 'NOT_SUPPORTED' ? 'NOT_SUPPORTED' : streamlabs.state().status === 'NOT_CONFIGURED' ? 'NOT_CONFIGURED' : 'AVAILABLE', vod: twitch.state.connected ? 'AVAILABLE' : 'NOT_CONFIGURED', clips: twitch.state.connected ? 'AVAILABLE' : 'NOT_CONFIGURED', soundboard: 'AVAILABLE', automation: 'AVAILABLE' },
    };
    return {
      at: new Date().toISOString(),
      stateRevision,
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
      twitch: { ...twitch.state, lastSyncedAt: local.twitchLastSyncedAt, channelTitle: twitchChannel.title || null, gameId: twitchChannel.gameId || null, gameName: twitchChannel.gameName || null },
      nextLive: nextLive(),
      google: {
        configured: Boolean(googleClientId),
        connected: google.connected,
        targetCalendarId: local.google.targetCalendarId,
        calendars: googleCalendars,
        error: googleError,
        lastSyncedAt: local.google.lastSyncedAt,
      },
      discord: { ...discordPublic, guildId: local.discord.guildId, channelId: local.discord.channelId },
      preflight: preflightState,
      remote: {
        supported: true,
        enabled: remoteRuntimeEnabled,
        devices: remoteAuth.list(),
        urls: remoteRuntimeEnabled ? lanUrls(runtimePort) : [],
      },
      streamerPings: local.streamerPings.filter(ping => !ping.acknowledgedAt).slice(-20),
      controlHub,
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
    stateRevision += 1;
    for (const ws of sockets.clients) {
      if (ws.readyState !== ws.OPEN) continue;
      ws.send(stateEvent(socketDevices.has(ws)));
    }
  };
  eventCore.subscribe(event => {
    const message = JSON.stringify({ type: 'event.received', data: event });
    for (const ws of sockets.clients) if (ws.readyState === ws.OPEN) ws.send(message);
    if (event.source !== 'automation') void automation.consume(event).then(results => { for (const result of results) eventCore.publish({ type: result.status === 'succeeded' ? 'automation.triggered' : 'automation.failed', source: 'automation', correlationId: result.correlationId, payload: result }); }).catch(logError);
  });
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
    eventCore.publish({ type: 'dashboard.state.updated', source: 'runtime', payload: { mode: local.mode, streaming: obs.state.streaming } });
    broadcast();
    return snapshot();
  };
  type CompanionCollectionKind = 'notes' | 'checklist' | 'templates';
  const companionKinds = new Set<CompanionCollectionKind>(['notes', 'checklist', 'templates']);
  const mutateCompanionCollection = async (kind: CompanionCollectionKind, action: 'upsert' | 'delete', id: string | undefined, patch: Record<string, unknown> = {}) => plan(async () => {
    const list = local.companion[kind];
    const current = id ? list.find(item => item.id === id) : undefined;
    if (action === 'delete' && !current) { const error = new Error('Élément compagnon introuvable.'); error.name = 'NOT_FOUND'; throw error; }
    const entityId = id ?? `${kind.slice(0, -1)}-${randomUUID()}`;
    const reconciled = reconcileCompanionBatch(local.planning, local.checklist, local.companion, [{
      operationId: `desktop-${randomUUID()}`,
      type: `${kind}.${action}`,
      entityId,
      baseRevision: current?.revision ?? 0,
      timestamp: new Date().toISOString(),
      patch,
    }]);
    if (reconciled.conflicts.length) throw new Error('Conflit compagnon détecté. Rechargez les données avant de réessayer.');
    local.planning = reconciled.planning;
    local.checklist = reconciled.checklist;
    local.companion = reconciled.companion;
    await save();
    broadcast();
    return companionSnapshot(local.planning, local.companion);
  });
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
  const commandJournal = new Map<string, { fingerprint: string; operation: Promise<{ command: DashboardCommand; state: DashboardState }> }>();
  const executeCommand = async (body: unknown, remote = false) => {
    const envelope = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const commandId = envelope.commandId;
    const correlationId = envelope.correlationId;
    for (const [name, value] of [['commandId', commandId], ['correlationId', correlationId]] as const) {
      if (value !== undefined && (typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,100}$/.test(value))) throw new Error(`${name} invalide.`);
    }
    const commandBody = Object.fromEntries(Object.entries(envelope).filter(([key]) => key !== 'commandId' && key !== 'correlationId'));
    const command = remote ? parseRemoteCommand(commandBody, snapshot()) : parseCommand(commandBody);
    const fingerprint = JSON.stringify(command);
    if (typeof commandId === 'string') {
      const existing = commandJournal.get(commandId);
      if (existing) {
        if (existing.fingerprint !== fingerprint) throw new Error('commandId déjà utilisé pour une autre commande.');
        return existing.operation;
      }
    }
    const operation = (async () => {
      const state = await commands.execute(command);
      if (command.type === 'session.prepare') return { command, state: await runPreflight() };
      return { command, state };
    })();
    if (typeof commandId === 'string') {
      commandJournal.set(commandId, { fingerprint, operation });
      while (commandJournal.size > 500) commandJournal.delete(commandJournal.keys().next().value!);
    }
    return operation;
  };
  executeAutomationCommand = async command => { await executeCommand({ ...command, commandId: `auto_${randomUUID()}`, correlationId: `auto_${randomUUID()}` }); };
  const validateTwitch = async () => {
    if (!twitch.state.connected) return;
    if (!await twitch.validateSession()) {
      local.twitch = { broadcasterId: '', userName: '', displayName: '' };
      await save();
    } else {
      const metadata = await twitch.getChannelMetadata();
      twitchChannel = { title: metadata.title, gameId: metadata.gameId, gameName: metadata.gameName };
      [twitchLive, twitchChatters] = await Promise.all([twitch.getLiveState(), twitch.chatters()]);
      if (!twitchEventSubStarted) { twitchEventSubStarted = true; twitchEventSub.start(); }
    }
    broadcast();
  };
  const refreshTwitchLive = async () => {
    if (!twitch.state.connected) return;
    try {
      const [live, chatters] = await Promise.all([twitch.getLiveState(), twitch.chatters()]);
      const liveChanged = live.isLive !== twitchLive.isLive;
      twitchLive = live;
      twitchChatters = chatters;
      eventCore.publish({ type: 'audience.viewerCount.updated', source: 'twitch', payload: { viewerCount: live.viewerCount } });
      if (liveChanged) eventCore.publish({ type: live.isLive ? 'stream.started' : 'stream.stopped', source: 'twitch', occurredAt: live.startedAt ?? undefined, payload: live });
      broadcast();
    } catch (error) {
      eventCore.publish({ type: 'integration.degraded', source: 'twitch', payload: { error: error instanceof Error ? error.message : String(error) } });
      logError(error);
    }
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
      if (findScheduledLiveForStart(temporalPlanning(observedAt - DAY_MS, observedAt + DAY_MS), observedAt)) {
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
        androidLinks: urls.map(url => {
          const serverUrl = new URL(url);
          return `streamdashboard://pair?v=1&server=${encodeURIComponent(serverUrl.origin)}&id=${encodeURIComponent(pairing.id)}&code=${encodeURIComponent(pairing.code)}`;
        }),
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
    if (!isRemoteApiAllowed(req.method, pathName)) {
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
  app.get('/api/v1/profile', (_req, res) => res.json({ profile: productProfile, modules: resolveModules(productProfile) }));
  app.put('/api/v1/profile/presentation', async (req, res, next) => {
    try {
      if (!object(req.body) || Object.keys(req.body).some(key => !['profile','appearance'].includes(key))) throw new Error('Présentation du profil invalide.');
      const nextProfile = structuredClone(productProfile);
      if (object(req.body.profile)) {
        if (Object.keys(req.body.profile).some(key => !['displayName','channelName','language'].includes(key))) throw new Error('Profil visible invalide.');
        nextProfile.profile = { ...nextProfile.profile, ...req.body.profile };
      }
      if (object(req.body.appearance)) {
        if (Object.keys(req.body.appearance).some(key => !['theme','preset','accent','density','radius','textScale'].includes(key))) throw new Error('Apparence invalide.');
        nextProfile.appearance = { ...nextProfile.appearance, ...req.body.appearance };
      }
      const validated = validateProductProfile(nextProfile);
      await profileStore.save(validated);
      productProfile = validated;
      broadcast();
      res.json({ profile: productProfile, modules: resolveModules(productProfile) });
    } catch (error) { next(error); }
  });
  app.put('/api/v1/settings/live-control', async (req, res, next) => {
    try {
      if (!object(req.body) || Object.keys(req.body).some(key => !['primaryMicInput','mode','scene'].includes(key))) throw new Error('Réglage Live invalide.');
      const next = await configure(async () => {
        if (req.body.primaryMicInput !== undefined) {
          if (typeof req.body.primaryMicInput !== 'string' || req.body.primaryMicInput.length > 200) throw new Error('Micro principal OBS invalide.');
          const input = req.body.primaryMicInput.trim();
          if (input && obs.state.connected && !Object.prototype.hasOwnProperty.call(obs.state.inputs, input)) throw new Error('Choisissez une source audio OBS disponible.');
          local.settings.primaryMicInput = input || undefined;
        }
        if (req.body.mode !== undefined || req.body.scene !== undefined) {
          const mode = String(req.body.mode ?? '');
          const scene = String(req.body.scene ?? '').trim();
          if (!['intro','live','chatting','pause','end'].includes(mode) || scene.length > 200) throw new Error('Mapping de scène invalide.');
          if (scene && obs.state.connected && !obs.state.scenes.includes(scene)) throw new Error('Choisissez une scène OBS disponible.');
          if (mode === 'chatting') local.settings.chattingScene = scene || undefined;
          else {
            const mapped = { ...local.settings.modeScenes };
            if (scene) mapped[mode as keyof typeof mapped] = scene;
            else delete mapped[mode as keyof typeof mapped];
            local.settings.modeScenes = mapped;
          }
        }
        await save();
        broadcast();
        return snapshot();
      });
      res.json(isRemoteRequest(req) ? toRemoteDashboardState(next) : next);
    } catch (error) { next(error); }
  });
  app.put('/api/v1/profile', async (req, res, next) => { try { if (!requireLocal(req, res)) return; const nextProfile = validateProductProfile(req.body); await profileStore.save(nextProfile); productProfile = nextProfile; broadcast(); res.json({ profile: productProfile, modules: resolveModules(productProfile) }); } catch (error) { next(error); } });
  app.get('/api/v1/profile/export', async (req, res, next) => { try { if (!requireLocal(req, res)) return; res.attachment('streamdashboard.streamdashboard.yaml'); res.setHeader('Content-Type', 'application/yaml; charset=utf-8'); res.send(await profileStore.export()); } catch (error) { next(error); } });
  app.post('/api/v1/profile/import', async (req, res, next) => { try { if (!requireLocal(req, res)) return; const content = String(req.body?.content ?? ''); if (!content || content.length > 256_000) throw new Error('Fichier profil invalide.'); const imported = await profileStore.import(content); productProfile = imported.profile; broadcast(); res.json({ profile: productProfile, modules: resolveModules(productProfile), backup: imported.backup ? path.basename(imported.backup) : null }); } catch (error) { next(error); } });
  app.get('/api/v1/connections', async (_req, res) => {
    const status = (connected: boolean, available = true, error?: string | null) => !available ? 'unavailable' : error ? 'error' : connected ? 'connected' : 'disconnected';
    const integrationStatus = (value: string) => ({ CONNECTED: 'connected', CONNECTING: 'connecting', DISCONNECTED: 'disconnected', NOT_CONFIGURED: 'disconnected', NOT_SUPPORTED: 'unavailable', DEGRADED: 'error', ERROR: 'error' })[value] ?? 'unavailable';
    res.json({ items: [
      { id: 'obs', label: 'OBS', status: status(obs.state.connected), mode: 'custom', requiresReauth: false, capabilities: ['test','configure','scenes','audio'] },
      { id: 'twitch', label: 'Twitch', status: status(twitch.state.connected, Boolean(twitchClientId), twitch.state.error), mode: productProfile.providers.twitch.mode, requiresReauth: false, capabilities: twitchClientId ? ['connect','disconnect','test','chat','audience','clips'] : [], ...(!twitchClientId ? { message: 'Configuration mainteneur requise' } : {}) },
      { id: 'google', label: 'Google Calendar', status: status(google.connected, Boolean(googleClientId), googleError), mode: productProfile.providers.google.mode, requiresReauth: false, capabilities: googleClientId ? ['connect','disconnect','test','calendar'] : [], ...(!googleClientId ? { message: 'Configuration mainteneur requise' } : {}) },
      { id: 'discord', label: 'Discord', status: productProfile.providers.discord.mode === 'official' ? 'unavailable' : status(discordPublic.connected, true, discordPublic.error), mode: productProfile.providers.discord.mode, requiresReauth: false, capabilities: productProfile.providers.discord.mode === 'custom' ? ['configure','disconnect','test','publish'] : [], ...(productProfile.providers.discord.mode === 'official' ? { message: 'Service officiel non encore déployé' } : {}) },
      { id: 'streamlabs', label: 'Streamlabs', status: productProfile.providers.streamlabs.mode === 'custom' ? integrationStatus(streamlabs.state().status) : 'unavailable', mode: productProfile.providers.streamlabs.mode, requiresReauth: false, capabilities: productProfile.providers.streamlabs.mode === 'custom' ? ['configure','disconnect','test','donations'] : [], ...(productProfile.providers.streamlabs.mode !== 'custom' ? { message: 'Mode officiel non implémenté' } : {}) },
      { id: 'wizebot', label: 'WizeBot', status: productProfile.providers.wizebot.mode === 'custom' ? integrationStatus(wizebot.state().status) : 'unavailable', mode: productProfile.providers.wizebot.mode, requiresReauth: false, capabilities: productProfile.providers.wizebot.mode === 'custom' ? ['configure','disconnect','test','events'] : [], ...(productProfile.providers.wizebot.mode !== 'custom' ? { message: 'Mode officiel non implémenté' } : {}) },
    ] });
  });
  app.get('/api/v1/control-hub', (_req, res) => res.json(snapshot().controlHub));
  app.get('/api/v1/twitch/rewards', async (_req, res, next) => { try { res.json({ items: await twitch.customRewards(), available: twitch.state.redemptionsAvailable === true }); } catch (error) { next(error); } });
  app.post('/api/v1/streamer-pings/:id/ack', async (req, res, next) => {
    try {
      const id = String(req.params.id);
      const ping = local.streamerPings.find(value => value.id === id);
      if (!ping) { res.status(404).json({ ok: false, error: { code: 'NOT_FOUND', message: 'Streamer Ping introuvable.' } }); return; }
      if (!ping.acknowledgedAt) ping.acknowledgedAt = new Date().toISOString();
      eventCore.publish({ type: 'streamer.ping.acknowledged', source: isRemoteRequest(req) ? 'android' : 'desktop', correlationId: ping.id, payload: { id: ping.id, acknowledgedAt: ping.acknowledgedAt } });
      await save(); broadcast(); res.json(isRemoteRequest(req) ? toRemoteDashboardState(snapshot()) : snapshot());
    } catch (error) { next(error); }
  });
  app.get('/api/v1/streamer-pings', (req, res) => {
    if (!requireLocal(req, res)) return;
    const includeAcknowledged = req.query.all === '1';
    res.json({ items: local.streamerPings.filter(value => includeAcknowledged || !value.acknowledgedAt).slice(-50).reverse() });
  });
  app.post('/api/v1/streamer-pings/ack-all', async (req, res, next) => {
    try {
      const acknowledgedAt = new Date().toISOString();
      const pending = local.streamerPings.filter(value => !value.acknowledgedAt);
      for (const ping of pending) ping.acknowledgedAt = acknowledgedAt;
      if (pending.length) eventCore.publish({ type: 'streamer.ping.acknowledged', source: isRemoteRequest(req) ? 'android' : 'desktop', payload: { ids: pending.map(value => value.id), acknowledgedAt } });
      await save(); broadcast(); res.json(isRemoteRequest(req) ? toRemoteDashboardState(snapshot()) : snapshot());
    } catch (error) { next(error); }
  });
  app.delete('/api/v1/streamer-pings/history', async (req, res, next) => {
    try {
      if (!requireLocal(req, res)) return;
      local.streamerPings = local.streamerPings.filter(value => !value.acknowledgedAt);
      await save(); broadcast(); res.sendStatus(204);
    } catch (error) { next(error); }
  });
  const soundboardTargetScenes = () => [...new Set([
    local.settings.modeScenes?.intro, local.settings.modeScenes?.live, local.settings.chattingScene,
    local.settings.modeScenes?.pause, local.settings.modeScenes?.end,
    ...productProfile.obs.scenes.map(item => item.scene),
  ].filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
  const resolveSoundLibraryFile = async (libraryId: string) => {
    if (!/^[A-Za-z0-9._-]{1,220}$/.test(libraryId) || path.basename(libraryId) !== libraryId) throw new Error('Fichier Soundboard invalide.');
    const resolved = path.resolve(soundLibraryDir, libraryId);
    const relative = path.relative(soundLibraryDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Fichier Soundboard hors bibliothèque.');
    const info = await stat(resolved);
    if (!info.isFile() || info.size > 100 * 1024 * 1024) throw new Error('Fichier Soundboard invalide.');
    return resolved;
  };
  const removeSoundLibraryFile = async (source: string) => {
    const resolved = path.resolve(source);
    const relative = path.relative(soundLibraryDir, resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return;
    if (local.sounds.some(sound => path.resolve(sound.source) === resolved)) return;
    await unlink(resolved).catch(() => undefined);
  };
  registerLiveControlRoutes({
    app, soundboard, automation, support, streamlabs, streamlabsOAuth, streamlabsRedirectUri, wizebot, eventCore, secrets, requireLocal, isRemote: isRemoteRequest, save, broadcast,
    sounds: () => local.sounds, setSounds: value => { local.sounds = value; }, sessionStartedAt: () => twitchLive.startedAt,
    resolveSoundLibraryFile, removeSoundLibraryFile,
    soundboardObsStatus: () => obsSoundboardSetup.status(soundboardTargetScenes()),
    setupSoundboardObs: () => obsSoundboardSetup.ensure(soundboardTargetScenes()),
  });
  app.get('/api/v1/twitch/videos', async (req, res, next) => { try { res.json(await twitch.videos(String(req.query.after ?? ''), Number(req.query.first) || 20)); } catch (error) { next(error); } });
  app.delete('/api/v1/twitch/videos/:id', async (req, res, next) => { try { const id = String(req.params.id); if (req.body?.confirmation !== `DELETE ${id}`) { res.status(409).json({ ok: false, error: { code: 'CONFIRM_REQUIRED', message: `Confirmez avec DELETE ${id}.` } }); return; } await twitch.deleteVideo(id); res.sendStatus(204); } catch (error) { next(error); } });
  app.get('/api/v1/twitch/clips', async (req, res, next) => { try { res.json(await twitch.clips(String(req.query.after ?? ''), Number(req.query.first) || 20)); } catch (error) { next(error); } });
  app.post('/api/v1/twitch/clips', async (_req, res, next) => { try { res.status(202).json(await twitch.createClip()); } catch (error) { next(error); } });
  app.get('/api/v1/twitch/chatters', async (req, res, next) => { try { res.json(await twitch.chatters(String(req.query.after ?? ''), Number(req.query.first) || 100)); } catch (error) { next(error); } });
  app.post('/api/v1/twitch/chat/messages', async (req, res, next) => { try { res.status(201).json(await twitch.sendChatMessage(String(req.body?.message ?? ''), typeof req.body?.replyParentMessageId === 'string' ? req.body.replyParentMessageId : undefined)); } catch (error) { next(error); } });
  app.get('/api/v1/twitch/moderation/capabilities', (_req, res) => res.json(twitch.moderationCapabilities()));
  app.delete('/api/v1/twitch/moderation/messages/:id', async (req, res, next) => { try { await twitch.deleteChatMessage(String(req.params.id)); res.status(204).end(); } catch (error) { next(error); } });
  app.post('/api/v1/twitch/moderation/bans', async (req, res, next) => { try { await twitch.banUser(String(req.body?.userId ?? ''), { ...(req.body?.duration !== undefined ? { duration: Number(req.body.duration) } : {}), ...(typeof req.body?.reason === 'string' ? { reason: req.body.reason } : {}) }); res.status(204).end(); } catch (error) { next(error); } });
  app.delete('/api/v1/twitch/moderation/bans/:userId', async (req, res, next) => { try { await twitch.unbanUser(String(req.params.userId)); res.status(204).end(); } catch (error) { next(error); } });
  app.get('/api/v1/capabilities', (_req, res) => res.json(capabilities));
  const refreshDiscord = async () => {
    if (!discordToken) { discordPublic = { configured: false, connected: false, guildName: null, channelName: null, error: null }; return; }
    try {
      const client = discordClient(); await client.verify();
      const guild = local.discord.guildId ? (await client.guilds()).find(value => value.id === local.discord.guildId) : undefined;
      const channel = guild && local.discord.channelId ? (await client.channels(guild.id)).find(value => value.id === local.discord.channelId) : undefined;
      discordPublic = { configured: true, connected: true, guildName: guild?.name ?? null, channelName: channel?.name ?? null, error: null };
    } catch (error) { discordPublic = { configured: true, connected: false, guildName: null, channelName: null, error: error instanceof Error ? error.message : String(error) }; }
  };
  app.get('/api/v1/discord/status', async (_req, res) => { await refreshDiscord(); res.json(snapshot().discord); });
  app.get('/api/v1/discord/guilds', async (_req, res, next) => { try { res.json(await discordClient().guilds()); } catch (error) { next(error); } });
  app.get('/api/v1/discord/guilds/:guildId/channels', async (req, res, next) => { try { const id = String(req.params.guildId); if (!/^\d{1,24}$/.test(id)) throw new Error('Serveur Discord invalide.'); res.json(await discordClient().channels(id)); } catch (error) { next(error); } });
  app.put('/api/v1/discord/settings', async (req, res, next) => {
    try {
      if (!object(req.body) || Object.keys(req.body).some(key => !['guildId', 'channelId', 'defaultMessage'].includes(key))) throw new Error('Réglages Discord invalides.');
      const guildId = req.body.guildId == null ? null : String(req.body.guildId); const channelId = req.body.channelId == null ? null : String(req.body.channelId); const defaultMessage = String(req.body.defaultMessage ?? '');
      if ((guildId && !/^\d{1,24}$/.test(guildId)) || (channelId && !/^\d{1,24}$/.test(channelId)) || defaultMessage.length > 2000) throw new Error('Réglages Discord invalides.');
      if (channelId && (!guildId || !(await discordClient().ensureChannel(guildId, channelId)))) throw new Error('Salon Discord invalide.');
      local.discord = { guildId, channelId, defaultMessage }; await save(); await refreshDiscord(); broadcast(); res.json(snapshot().discord);
    } catch (error) { next(error); }
  });
  app.put('/api/v1/discord/token', async (req, res, next) => { try { if (!requireLocal(req, res)) return; const token = String(req.body?.token ?? '').trim(); if (!token || token.length > 300) throw new Error('Token Discord invalide.'); await new DiscordClient(token, options.discordFetch ?? fetch).verify(); await secrets.setDiscordToken(token); discordToken = token; await refreshDiscord(); broadcast(); res.json(snapshot().discord); } catch (error) { next(error); } });
  app.delete('/api/v1/discord/token', async (req, res, next) => { try { if (!requireLocal(req, res)) return; await secrets.clearDiscordToken(); discordToken = ''; await refreshDiscord(); broadcast(); res.json(snapshot().discord); } catch (error) { next(error); } });
  const discordPosts = new Map<string, Promise<{ id: string; channelId: string }>>();
  app.post('/api/v1/discord/planning', async (req, res, next) => {
    try {
      if (!object(req.body) || 'imageUrl' in req.body) throw new Error('Payload Discord invalide.');
      const imageBase64 = String(req.body.imageBase64 ?? ''); const filenameInput = String(req.body.filename ?? 'planning.png'); const message = req.body.message == null ? local.discord.defaultMessage : String(req.body.message); const channelId = req.body.channelId == null ? local.discord.channelId : String(req.body.channelId);
      if (!channelId || !/^\d{1,24}$/.test(channelId) || !local.discord.guildId || message.length > 2000 || imageBase64.length > 14_000_000) throw new Error('Publication Discord invalide.');
      const png = Buffer.from(imageBase64, 'base64'); if (!png.length || png.length > 10 * 1024 * 1024 || !png.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) throw new Error('Image PNG invalide ou trop volumineuse.');
      const filename = path.basename(filenameInput).replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 100); if (!filename.toLowerCase().endsWith('.png')) throw new Error('Nom de fichier PNG invalide.');
      const client = discordClient(); await client.ensureChannel(local.discord.guildId, channelId);
      const key = createHash('sha256').update(png).update(channelId).update(message).digest('hex');
      let flight = discordPosts.get(key); if (!flight) { flight = client.postPlanning(channelId, png, filename, message); discordPosts.set(key, flight); setTimeout(() => discordPosts.delete(key), 15_000).unref(); }
      const result = await flight; await refreshDiscord(); res.status(201).json({ ok: true, ...result, channelName: discordPublic.channelName });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/companion/snapshot', (req, res) => {
    if (!requireLocal(req, res)) return;
    res.json(companionSnapshot(local.planning, local.companion));
  });
  for (const kind of companionKinds) {
    app.post(`/api/v1/companion/${kind}`, async (req, res, next) => {
      try {
        if (!requireLocal(req, res)) return;
        if (!object(req.body)) throw new Error('Collection compagnon invalide.');
        const { id: _id, revision: _revision, updatedAt: _updatedAt, ...patch } = req.body;
        res.status(201).json(await mutateCompanionCollection(kind, 'upsert', undefined, patch));
      } catch (error) { next(error); }
    });
    app.put(`/api/v1/companion/${kind}/:id`, async (req, res, next) => {
      try {
        if (!requireLocal(req, res)) return;
        if (!object(req.body)) throw new Error('Collection compagnon invalide.');
        const { id: _id, revision: _revision, updatedAt: _updatedAt, ...patch } = req.body;
        res.json(await mutateCompanionCollection(kind, 'upsert', String(req.params.id), patch));
      } catch (error) { next(error); }
    });
    app.delete(`/api/v1/companion/${kind}/:id`, async (req, res, next) => {
      try {
        if (!requireLocal(req, res)) return;
        res.json(await mutateCompanionCollection(kind, 'delete', String(req.params.id)));
      } catch (error) { next(error); }
    });
  }

  app.post('/api/v1/companion/sync', async (req, res, next) => {
    try {
      // Unlike ordinary desktop API calls, sync always requires a paired credential:
      // accidental localhost access must not expose the durable companion journal.
      const credential = req.headers.authorization?.match(/^Device (\S+)$/)?.[1] ?? '';
      const deviceId = remoteAuth.authenticate(credential);
      if (!deviceId) { res.status(401).json({ ok: false, error: { code: 'DEVICE_AUTH_REQUIRED', message: 'Compagnon non autorisé.' } }); return; }
      if (req.body?.schemaVersion !== 3) { res.status(409).json({ ok: false, error: { code: 'COMPANION_SCHEMA_INCOMPATIBLE', message: 'Version du cache compagnon incompatible. Les opérations locales sont conservées.' } }); return; }
      if (req.body?.deviceId !== deviceId) { res.status(400).json({ ok: false, error: { code: 'COMPANION_PAYLOAD_INVALID', message: 'Identité compagnon invalide.' } }); return; }
      const result = await plan(async () => {
        const reconciled = reconcileCompanionBatch(local.planning, local.checklist, local.companion, req.body.operations as SyncOperation[]);
        local.planning = reconciled.planning; local.checklist = reconciled.checklist; local.companion = reconciled.companion;
        // Persistence is the transaction boundary: ACKs are emitted only after this resolves.
        await save(); broadcast();
        return { acknowledged: reconciled.acknowledged, conflicts: reconciled.conflicts, snapshot: companionSnapshot(local.planning, local.companion) };
      });
      res.json({ ok: true, ...result });
    } catch (error) { next(error); }
  });
  app.post('/api/v1/companion/conflicts/:operationId/resolve', async (req, res, next) => {
    try {
      const credential = req.headers.authorization?.match(/^Device (\S+)$/)?.[1] ?? '';
      if (!remoteAuth.authenticate(credential)) { res.status(401).json({ ok: false, error: { code: 'DEVICE_AUTH_REQUIRED', message: 'Compagnon non autorisé.' } }); return; }
      const strategy = req.body?.strategy;
      if (!['pc', 'android'].includes(strategy)) { res.status(400).json({ ok: false, error: { code: 'COMPANION_PAYLOAD_INVALID', message: 'Résolution invalide.' } }); return; }
      const result = await plan(async () => { const resolved = resolveCompanionConflict(local.planning, local.companion, req.params.operationId, strategy); local.planning = resolved.planning; local.companion = resolved.companion; await save(); broadcast(); return resolved; });
      res.json({ ok: true, acknowledged: result.acknowledged, snapshot: companionSnapshot(local.planning, local.companion), conflicts: Object.values(local.companion.conflicts) });
    } catch (error) { next(error); }
  });
  app.get('/api/v1/twitch/categories', async (req, res, next) => {
    try {
      const query = String(req.query.q ?? '').trim();
      if (!query || query.length > 80) { res.json([]); return; }
      res.json(await twitch.searchGames(query));
    } catch (error) { next(error); }
  });
  app.post('/api/v1/twitch/channel', async (req, res, next) => {
    try {
      if (!twitch.state.connected) throw new Error('Twitch non connecté.');
      const title = String(req.body.title ?? twitchChannel.title).trim();
      const gameId = String(req.body.gameId ?? twitchChannel.gameId).trim();
      const gameName = String(req.body.gameName ?? twitchChannel.gameName).trim();
      if (!title || title.length > 140) throw new Error('Le titre Twitch doit contenir entre 1 et 140 caractères.');
      if (!/^\d{1,30}$/.test(gameId) || !gameName || gameName.length > 140) throw new Error('Sélectionnez une catégorie Twitch valide.');
      await twitch.updateChannelMetadata({ title, gameId });
      twitchChannel = { title, gameId, gameName };
      broadcast();
      res.json(isRemoteRequest(req) ? toRemoteDashboardState(snapshot()) : snapshot());
    } catch (error) { next(error); }
  });
  app.post('/api/v1/commands', async (req, res, next) => {
    try {
      const remote = isRemoteRequest(req);
      const result = await executeCommand(req.body, remote);
      res.json({
        ok: true,
        state: remote ? toRemoteDashboardState(result.state) : result.state,
        commandType: result.command.type,
        ...(typeof req.body?.commandId === 'string' ? { commandId: req.body.commandId } : {}),
        ...(typeof req.body?.correlationId === 'string' ? { correlationId: req.body.correlationId } : {}),
        stateRevision: result.state.stateRevision,
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
      const beforeIds = new Set(local.planning.map(item => item.id));
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
        recurrence: input.recurrence ? validateRecurrence(input.recurrence) : undefined,
      }));
      for (const created of local.planning.filter(item => !beforeIds.has(item.id))) {
        local.companion.eventRevisions[created.id] = 1;
        local.companion.eventHistory[created.id] = structuredClone(created) as unknown as Record<string, unknown>;
        local.companion.serverRevision++;
      }
      invalidatePreflight();
      const next = await changed();
      res.status(201).json(isRemoteRequest(req) ? toRemoteDashboardState(next) : next);
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
      local.companion.eventHistory[id] = structuredClone(item) as unknown as Record<string, unknown>;
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
        recurrence: req.body.recurrence === null ? undefined : req.body.recurrence !== undefined ? validateRecurrence(req.body.recurrence) : item.recurrence,
      }, {
        desiredPublication,
        confirmRecurring: req.body.confirmRecurring === true,
      }));
      local.companion.eventRevisions[id] = (local.companion.eventRevisions[id] ?? 1) + 1;
      local.companion.serverRevision++;
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
      const oldRevision = local.companion.eventRevisions[id] ?? 1;
      await plan(async () => planning().remove(id, destinations));
      local.companion.eventRevisions[id] = oldRevision + 1;
      local.companion.tombstones[id] = { id, revision: oldRevision + 1, updatedAt: new Date().toISOString() };
      delete local.companion.eventHistory[id]; local.companion.serverRevision++;
      invalidatePreflight();
      res.json(await changed());
    } catch (error) { next(error); }
  };

  const recurrenceException: express.RequestHandler = async (req, res, next) => {
    try {
      const series = local.planning.find(value => value.id === String(req.params.id));
      if (!series?.recurrence) throw Object.assign(new Error('Série récurrente introuvable.'), { name: 'NOT_FOUND' });
      const occurrenceKey = String(req.body?.occurrenceKey ?? '');
      if (!occurrenceKey.startsWith(`${series.localId || series.id}:`) || occurrenceKey.length > 180) throw new Error('Occurrence invalide.');
      const recurrence = structuredClone(series.recurrence); recurrence.exceptions ??= {};
      if (req.method === 'DELETE') recurrence.exceptions[occurrenceKey] = { cancelled: true };
      else {
        const patch = object(req.body?.patch) ? req.body.patch : {};
        const validated = validateRecurrence({ ...recurrence, exceptions: { [occurrenceKey]: { patch } } });
        if (!validated?.exceptions?.[occurrenceKey]) throw new Error('Patch d’occurrence invalide.');
        recurrence.exceptions[occurrenceKey] = validated.exceptions[occurrenceKey];
      }
      await plan(async () => planning().update(series.id, { title: series.title, description: series.description, startAtUtc: series.startAtUtc, endAtUtc: series.endAtUtc, allDay: series.allDay, category: series.category, kind: series.kind, twitchCategoryId: series.twitchCategoryId, twitchCategoryName: series.twitchCategoryName, recurrence }));
      local.companion.eventRevisions[series.id] = (local.companion.eventRevisions[series.id] ?? 1) + 1; local.companion.serverRevision++;
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
        if (input.streamerPingRewardIds !== undefined) {
          if (!Array.isArray(input.streamerPingRewardIds) || input.streamerPingRewardIds.length > 50 || input.streamerPingRewardIds.some(value => typeof value !== 'string' || !value || value.length > 100)) throw new Error('Récompenses Streamer Ping invalides.');
          local.settings.streamerPingRewardIds = [...new Set(input.streamerPingRewardIds)];
        }
        if (input.timerBrowserSource !== undefined) {
          if (typeof input.timerBrowserSource !== 'string' || input.timerBrowserSource.length > 200) throw new Error('Source timer OBS invalide.');
          local.settings.timerBrowserSource = input.timerBrowserSource.trim() || undefined;
        }
        if (input.primaryMicInput !== undefined) {
          if (typeof input.primaryMicInput !== 'string' || input.primaryMicInput.length > 200) throw new Error('Micro principal OBS invalide.');
          local.settings.primaryMicInput = input.primaryMicInput.trim() || undefined;
        }
        if (input.requireTimerOverlayOnStart !== undefined) {
          if (typeof input.requireTimerOverlayOnStart !== 'boolean') throw new Error('Politique timer OBS invalide.');
          local.settings.requireTimerOverlayOnStart = input.requireTimerOverlayOnStart;
        }
        if (input.obsExecutablePath !== undefined) {
          if (typeof input.obsExecutablePath !== 'string' || input.obsExecutablePath.length > 500) throw new Error('Chemin OBS invalide.');
          local.settings.obsExecutablePath = input.obsExecutablePath.trim() || undefined;
        }
        if (input.modeScenes !== undefined) local.settings.modeScenes = modeScenes(input.modeScenes);
        if (input.chattingScene !== undefined) {
          if (typeof input.chattingScene !== 'string' || input.chattingScene.length > 200) throw new Error('Scène Chatting invalide.');
          const scene = input.chattingScene.trim();
          if (scene && obs.state.connected && !obs.state.scenes.includes(scene)) throw new Error('La scène Chatting doit être sélectionnée parmi les scènes OBS disponibles.');
          local.settings.chattingScene = scene || undefined;
        }
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
    app.put(`${prefix}/planning/:id/occurrence`, recurrenceException);
    app.delete(`${prefix}/planning/:id/occurrence`, recurrenceException);
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
          twitchEventSub.stop();
          twitchEventSubStarted = false;
          await validateTwitch();
        }).catch(error => { logError(error); broadcast(); });
      }
    } catch (error) { next(error); }
  });
  app.post(['/api/twitch/disconnect', '/api/v1/twitch/disconnect'], async (_req, res, next) => {
    try {
      await twitch.disconnect();
      local.twitch = { broadcasterId: '', userName: '', displayName: '' };
      local.twitchLastSyncedAt = null;
      twitchEventSub.stop(); twitchEventSubStarted = false; chatMessages = []; chatStatus = 'DISCONNECTED'; twitchChatters = { items: [], total: 0, cursor: null };
      twitchLive = { isLive: false, title: null, category: null, categoryId: null, startedAt: null, viewerCount: null, thumbnailUrl: null };
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
  app.post('/api/v1/google/disconnect', async (_req, res, next) => {
    try {
      googleOAuthAttempt = null;
      await google.disconnect();
      googleCalendars = [];
      googleError = null;
      local.google = { targetCalendarId: null, lastSyncedAt: null };
      res.json(await changed());
    } catch (error) { next(error); }
  });
  app.post('/api/v1/google/sync', async (_req, res, next) => {
    try {
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
      : ['REMOTE_SCOPE_DENIED', 'TWITCH_NOT_AUTHORIZED'].includes(name) ? 403
        : ['CHECKLIST_INCOMPLETE', 'CONFIRM_REQUIRED', 'TWITCH_DISCONNECTED', 'NOT_EDITABLE'].includes(name) ? 409
          : 400;
    const code = name === 'CHECKLIST_INCOMPLETE' ? 'CHECKLIST_INCOMPLETE'
      : name === 'CONFIRM_REQUIRED' ? 'CONFIRM_REQUIRED'
        : name === 'TWITCH_DISCONNECTED' ? 'TWITCH_DISCONNECTED'
          : name === 'NOT_FOUND' ? 'NOT_FOUND'
            : name === 'NOT_EDITABLE' ? 'NOT_EDITABLE'
              : name === 'REMOTE_SCOPE_DENIED' ? 'REMOTE_SCOPE_DENIED'
                : name === 'TWITCH_NOT_AUTHORIZED' ? 'TWITCH_NOT_AUTHORIZED'
                : 'INVALID_REQUEST';
    res.status(status).json({ ok: false, error: { code, message: error instanceof Error ? error.message : 'Erreur interne', retryable: false, ...((error as Error & { requiredScope?: string })?.requiredScope ? { details: { requiredScope: (error as Error & { requiredScope: string }).requiredScope } } : {}) } });
  });

  sockets.on('connection', ws => {
    ws.on('close', () => socketDevices.delete(ws));
    ws.send(JSON.stringify({ type: 'server.ready', data: capabilities }));
    ws.send(stateEvent(socketDevices.has(ws)));
  });

  await Promise.all([mkdir(dataDir, { recursive: true }), mkdir(soundLibraryDir, { recursive: true })]);
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, host, () => { server.off('error', reject); resolve(); });
  });
  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : requestedPort;
  runtimePort = actualPort;
  const unsubscribeObs = obs.onStateChanged(() => {
    const obsPayload = { connected: obs.state.connected, streaming: obs.state.streaming, streamingKnown: obs.state.streamingKnown !== false, scene: obs.state.scene };
    eventCore.publish({ type: 'obs.state.changed', source: 'obs', payload: obsPayload });
    if (!obs.state.connected) eventCore.publish({ type: 'obs.disconnected', source: 'obs', payload: obsPayload });
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
  const twitchLivePoller = setInterval(() => { void refreshTwitchLive(); }, 30_000);
  twitchLivePoller.unref();
  await validateTwitch().catch(logError);
  await streamlabs.connect();
  await wizebot.refresh();
  if (google.connected) await refreshGoogleCalendars().catch(logError);
  void obs.configure(local.settings.obsUrl, currentObsPassword).then(broadcast).catch(error => { logError(error); broadcast(); });
  void Promise.resolve(logger.info(`StreamDashboard ready on ${host}:${actualPort}`)).catch(() => undefined);

  let stopPromise: Promise<void> | undefined;
  scheduleTimerExpiry();
  const stop = () => stopPromise ??= (async () => {
    unsubscribeObs();
    clearInterval(validator);
    clearInterval(twitchLivePoller);
    if (timerExpiry) clearTimeout(timerExpiry);
    if (remoteActivitySaveTimer) clearTimeout(remoteActivitySaveTimer);
    await streamTrackingQueue.catch(() => undefined);
    await unplannedMetadataQueue.catch(() => undefined);
    await unplannedGoogleQueue.catch(() => undefined);
    twitch.close();
    twitchEventSub.stop();
    await streamlabs.disconnect();
    for (const ws of sockets.clients) ws.terminate();
    sockets.close();
    await obs.close();
    await save();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  })();
  const urlHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::1' ? '[::1]' : host;
  return { port: actualPort, url: `http://${urlHost}:${actualPort}`, state: snapshot, server, stop };
}
