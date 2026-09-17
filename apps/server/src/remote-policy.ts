import {
  parseCommand,
  type CalendarItem,
  type ChecklistItem,
  type DashboardCommand,
  type DashboardState,
  type RemoteDashboardState,
} from '../../../packages/contracts/src/index.js';

const REMOTE_MODES = new Set(['intro', 'live', 'pause', 'end']);

type RemotePlanningItem = Pick<CalendarItem,
  'id' | 'title' | 'description' | 'startAtUtc' | 'endAtUtc' | 'allDay' | 'category' | 'kind' | 'source' | 'editable' | 'twitchCategoryId' | 'twitchCategoryName' | 'desiredPublication' | 'recurrence' | 'seriesId' | 'occurrenceKey'
>;
type ExtendedRemoteDashboardState = Omit<RemoteDashboardState, 'planning' | 'nextLive'> & {
  planning: RemotePlanningItem[];
  nextLive: RemotePlanningItem | null;
  checklist: ChecklistItem[];
};

/**
 * A paired phone is a deliberately lower-trust client than the desktop renderer.
 * Keep the allowlist here instead of relying on which buttons the current UI renders.
 */
export function parseRemoteCommand(value: unknown, state: DashboardState): DashboardCommand {
  const command = parseCommand(value);
  switch (command.type) {
    case 'session.prepare':
    case 'session.stop':
    case 'timer.start':
    case 'timer.pause':
    case 'timer.reset':
    case 'timer.add':
    case 'checklist.toggle':
      return command;
    case 'session.start':
      // A paired/authenticated remote is already allowed to start the stream. `force`
      // only bypasses the local checklist after an explicit confirmation on the phone.
      // Keeping this flag lets Android mirror the desktop recovery flow instead of
      // leaving the primary Start button permanently blocked by one unchecked item.
      return { type: 'session.start', force: command.force === true };
    case 'mode.set':
      if (!REMOTE_MODES.has(command.mode)) throw denied('Ce mode n’est pas pilotable depuis la télécommande.');
      return command;
    case 'scene.chatting':
      if (!state.settings.chattingScene) throw denied('Aucune scène Chatting configurée.');
      return command;
    case 'obs.mute':
    case 'obs.volumeDb':
      if (!state.obs.activeAudioInputs.includes(command.input)) throw denied('Source audio OBS inactive dans la scène courante.');
      return command;
    case 'obs.media.restart':
      if (!state.obs.mediaInputs.includes(command.input)) throw denied('Source média OBS inconnue.');
      return command;
    default:
      throw denied(`La commande ${command.type} est réservée au PC.`);
  }
}

export function toRemoteDashboardState(state: DashboardState): ExtendedRemoteDashboardState {
  const projectItem = (item: CalendarItem): RemotePlanningItem => ({
    id: item.id,
    title: item.title,
    ...(item.description !== undefined ? { description: item.description } : {}),
    startAtUtc: item.startAtUtc,
    endAtUtc: item.endAtUtc,
    ...(item.allDay !== undefined ? { allDay: item.allDay } : {}),
    ...(item.category !== undefined ? { category: item.category } : {}),
    ...(item.kind !== undefined ? { kind: item.kind } : {}),
    ...(item.source !== undefined ? { source: item.source } : {}),
    ...(item.editable !== undefined ? { editable: item.editable } : {}),
    ...(item.twitchCategoryId !== undefined ? { twitchCategoryId: item.twitchCategoryId } : {}),
    ...(item.twitchCategoryName !== undefined ? { twitchCategoryName: item.twitchCategoryName } : {}),
    ...(item.desiredPublication !== undefined ? { desiredPublication: { ...item.desiredPublication } } : {}),
    ...(item.recurrence !== undefined ? { recurrence: structuredClone(item.recurrence) } : {}),
    ...(item.seriesId !== undefined ? { seriesId: item.seriesId } : {}),
    ...(item.occurrenceKey !== undefined ? { occurrenceKey: item.occurrenceKey } : {}),
  });

  return {
    at: state.at,
    mode: state.mode,
    timer: { ...state.timer },
    planning: state.planning.map(projectItem),
    checklist: state.checklist.map(item => ({ ...item })),
    nextLive: state.nextLive ? projectItem(state.nextLive) : null,
    obs: {
      connected: state.obs.connected,
      streaming: state.obs.streaming,
      scene: state.obs.scene,
      inputs: structuredClone(state.obs.inputs),
      activeAudioInputs: [...state.obs.activeAudioInputs],
      mediaInputs: [...state.obs.mediaInputs],
    },
    settings: { confirmStop: state.settings.confirmStop, streamerName: state.settings.streamerName, modeScenes: { ...state.settings.modeScenes }, chattingScene: state.settings.chattingScene },
    twitch: {
      connected: state.twitch.connected,
      channelTitle: state.twitch.channelTitle,
      gameId: state.twitch.gameId,
      gameName: state.twitch.gameName,
      error: state.twitch.error,
    },
    ...(state.google ? { google: { configured: state.google.configured, connected: state.google.connected } } : {}),
    ...(state.discord ? { discord: structuredClone(state.discord) } : {}),
    ...(state.preflight ? { preflight: { ...state.preflight } } : {}),
    ...(state.controlHub ? { controlHub: structuredClone(state.controlHub) } : {}),
  };
}

function denied(message: string) {
  const error = new Error(message);
  error.name = 'REMOTE_SCOPE_DENIED';
  return error;
}
