export type RunMode = 'idle' | 'intro' | 'live' | 'pause' | 'end';
export type ApiVersion = 1;
export const protocolVersion: ApiVersion = 1;

export interface TimerState {
  running: boolean;
  duration: number;
  remaining: number;
  deadline: number | null;
}

export interface CalendarItem {
  id: string;
  title: string;
  description?: string;
  startAtUtc: string;
  endAtUtc: string;
  category?: 'live' | 'production' | 'personal';
  source?: 'DAMPLANNER' | 'GOOGLE' | 'TWITCH';
  ownership?: 'LOCAL' | 'EXTERNAL';
  editable?: boolean;
  kind?: 'LIVE' | 'PERSONAL';
  draft?: boolean;
  twitchSegmentId?: string;
  twitchRecurring?: boolean;
  syncError?: string;
  syncedAt?: string;
}
export interface CalendarPayload { rows: unknown[]; warnings: string[]; fetchedAt: number; fromCache: boolean; items: CalendarItem[] }
export interface StreamState { mode: RunMode; running: boolean; startedAt: number | null; deadline: number | null; duration: number; remaining: number; timerVisible: boolean; previousObsScene: string | null; sequence: number; text: string; obs: { connected: boolean; currentScene: string | null; streaming: boolean } }

export interface ChecklistItem { id: string; label: string; done: boolean }

export interface ObsState {
  connected: boolean;
  streaming: boolean;
  recording: boolean;
  scene: string | null;
  scenes: string[];
  inputs: Record<string, { muted: boolean; volume: number }>;
  /** Audio inputs which are audible in the current program scene (plus OBS global devices). */
  activeAudioInputs: string[];
  /** OBS media sources that can be restarted from the Fun Deck. */
  mediaInputs: string[];
  error: string | null;
  obsVersion: string | null;
  websocketVersion: string | null;
}

export interface DashboardSettings {
  streamerName: string;
  accent: 'violet' | 'cyan' | 'rose';
  confirmStop: boolean;
  obsUrl: string;
  obsPasswordSet: boolean;
  twitchConnected: boolean;
  twitchUserName: string | null;
  launchObs: boolean;
  obsExecutablePath?: string;
  modeScenes: Partial<Record<Exclude<RunMode, 'idle'>, string>>;
}

export interface TwitchState {
  connected: boolean;
  userName: string | null;
  displayName: string | null;
  error: string | null;
  syncing: boolean;
  lastSyncedAt: string | null;
  deviceAuthorization: {
    userCode: string;
    verificationUri: string;
    expiresAt: string;
  } | null;
}

export interface DashboardState {
  at: string;
  mode: RunMode;
  timer: TimerState;
  planning: CalendarItem[];
  checklist: ChecklistItem[];
  obs: ObsState;
  nextLive: CalendarItem | null;
  health: Record<string, { ok: boolean; detail: string; reconnects: number }>;
  settings: DashboardSettings;
  twitch: TwitchState;
  runtime: { serverVersion: string; nodeVersion: string; electronVersion: string | null; platform: string; port: number; logsPath: string | null };
}

export type PublicState = DashboardState;
export type Command = DashboardCommand;
export interface CommandResult { ok: true; state: PublicState; commandType: Command['type'] }
export interface ApiError { ok: false; error: { code: string; message: string; details?: Record<string, unknown> } }
export interface ClientCapabilities { protocolVersion: ApiVersion; clientName: string; features: string[] }
export interface ServerCapabilities { protocolVersion: ApiVersion; serverVersion: string; features: string[]; accessMode: 'desktop-local' | 'remote-LAN' }

/** Stable command vocabulary intended for every client (desktop today, mobile later). */
export type DashboardCommand =
  | { type: 'session.prepare' }
  | { type: 'session.start'; force?: boolean }
  | { type: 'session.stop' }
  | { type: 'mode.set'; mode: RunMode }
  | { type: 'timer.start'; seconds?: number }
  | { type: 'timer.pause' | 'timer.reset' }
  | { type: 'timer.add'; seconds: number }
  | { type: 'obs.scene'; scene: string }
  | { type: 'obs.mute'; input: string; muted: boolean }
  | { type: 'obs.volume'; input: string; volume: number }
  | { type: 'obs.stream'; start: boolean }
  | { type: 'obs.record'; start: boolean }
  | { type: 'obs.media.restart'; input: string }
  | { type: 'checklist.toggle'; id: string }
  | { type: 'checklist.reset' };

export interface DashboardEvent { type: 'state.updated'; data: DashboardState }
export type ServerEvent = DashboardEvent | { type: 'server.ready'; data: ServerCapabilities };

const commandTypes = new Set<Command['type']>(['session.prepare', 'session.start', 'session.stop', 'mode.set', 'timer.start', 'timer.pause', 'timer.reset', 'timer.add', 'obs.scene', 'obs.mute', 'obs.volume', 'obs.stream', 'obs.record', 'obs.media.restart', 'checklist.toggle', 'checklist.reset']);
export function parseCommand(value: unknown): Command {
  if (!value || typeof value !== 'object') throw new Error('La commande doit être un objet JSON.');
  const input = value as Record<string, unknown>;
  if (typeof input.type !== 'string' || !commandTypes.has(input.type as Command['type'])) throw new Error('Type de commande inconnu.');
  const allowed: Record<string, string[]> = {
    'session.prepare': ['type'], 'session.start': ['type', 'force'], 'session.stop': ['type'],
    'mode.set': ['type', 'mode'], 'timer.start': ['type', 'seconds'], 'timer.pause': ['type'], 'timer.reset': ['type'], 'timer.add': ['type', 'seconds'],
    'obs.scene': ['type', 'scene'], 'obs.mute': ['type', 'input', 'muted'], 'obs.volume': ['type', 'input', 'volume'], 'obs.stream': ['type', 'start'],
    'obs.record': ['type', 'start'], 'obs.media.restart': ['type', 'input'], 'checklist.toggle': ['type', 'id'], 'checklist.reset': ['type'],
  };
  if (Object.keys(input).some(key => !allowed[input.type as string].includes(key))) throw new Error('La commande contient un champ non autorisé.');
  const text = (key: string) => { if (typeof input[key] !== 'string' || !(input[key] as string).trim() || (input[key] as string).length > 200) throw new Error(`Champ ${key} invalide.`); };
  const bool = (key: string) => { if (typeof input[key] !== 'boolean') throw new Error(`Champ ${key} invalide.`); };
  const number = (key: string, min = -Infinity, max = Infinity) => {
    if (typeof input[key] !== 'number' || !Number.isFinite(input[key]) || (input[key] as number) < min || (input[key] as number) > max) throw new Error(`Champ ${key} invalide.`);
  };
  switch (input.type) {
    case 'session.start': if (input.force !== undefined) bool('force'); break;
    case 'mode.set': if (!['idle', 'intro', 'live', 'pause', 'end'].includes(String(input.mode))) throw new Error('Mode invalide.'); break;
    case 'timer.start': if (input.seconds !== undefined) number('seconds', 1, 86_400); break;
    case 'timer.add': number('seconds', 1, 86_400); break;
    case 'obs.scene': text('scene'); break;
    case 'obs.mute': text('input'); bool('muted'); break;
    case 'obs.volume': text('input'); number('volume', 0, 1.5); break;
    case 'obs.stream': case 'obs.record': bool('start'); break;
    case 'obs.media.restart': text('input'); break;
    case 'checklist.toggle': text('id'); break;
  }
  return input as unknown as Command;
}
