export type RunMode = 'idle' | 'intro' | 'live' | 'pause' | 'end';

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
}

/** Stable command vocabulary intended for every client (desktop today, mobile later). */
export type DashboardCommand =
  | { type: 'mode.set'; mode: RunMode }
  | { type: 'timer.start'; seconds?: number }
  | { type: 'timer.pause' | 'timer.reset' }
  | { type: 'timer.add'; seconds: number }
  | { type: 'obs.scene'; scene: string }
  | { type: 'obs.mute'; input: string; muted: boolean }
  | { type: 'obs.volume'; input: string; volume: number }
  | { type: 'obs.stream'; start: boolean }
  | { type: 'obs.record'; start: boolean }
  | { type: 'checklist.toggle'; id: string }
  | { type: 'checklist.reset' };

export interface DashboardEvent { type: 'state.updated'; data: DashboardState }
