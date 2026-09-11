import {
  parseCommand,
  type CalendarItem,
  type DashboardCommand,
  type DashboardState,
  type RemoteDashboardState,
} from '../../../packages/contracts/src/index.js';

const REMOTE_MODES = new Set(['intro', 'live', 'pause', 'end']);

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
      return command;
    case 'session.start':
      if (command.force === true) throw denied('Le contournement de checklist est réservé au PC.');
      return { type: 'session.start', force: false };
    case 'mode.set':
      if (!REMOTE_MODES.has(command.mode)) throw denied('Ce mode n’est pas pilotable depuis la télécommande.');
      return command;
    case 'obs.mute':
    case 'obs.volumeDb':
      if (!Object.prototype.hasOwnProperty.call(state.obs.inputs, command.input)) throw denied('Source audio OBS inconnue.');
      return command;
    case 'obs.media.restart':
      if (!state.obs.mediaInputs.includes(command.input)) throw denied('Source média OBS inconnue.');
      return command;
    default:
      throw denied(`La commande ${command.type} est réservée au PC.`);
  }
}

export function toRemoteDashboardState(state: DashboardState): RemoteDashboardState {
  const projectItem = (item: CalendarItem): RemoteDashboardState['planning'][number] => ({
    id: item.id,
    title: item.title,
    startAtUtc: item.startAtUtc,
    endAtUtc: item.endAtUtc,
    ...(item.allDay !== undefined ? { allDay: item.allDay } : {}),
    ...(item.category !== undefined ? { category: item.category } : {}),
    ...(item.kind !== undefined ? { kind: item.kind } : {}),
  });

  return {
    at: state.at,
    mode: state.mode,
    timer: { ...state.timer },
    planning: state.planning.map(projectItem),
    nextLive: state.nextLive ? projectItem(state.nextLive) : null,
    obs: {
      connected: state.obs.connected,
      streaming: state.obs.streaming,
      scene: state.obs.scene,
      inputs: structuredClone(state.obs.inputs),
      activeAudioInputs: [...state.obs.activeAudioInputs],
      mediaInputs: [...state.obs.mediaInputs],
    },
    settings: { confirmStop: state.settings.confirmStop, streamerName: state.settings.streamerName },
    ...(state.preflight ? { preflight: { ...state.preflight } } : {}),
  };
}

function denied(message: string) {
  const error = new Error(message);
  error.name = 'REMOTE_SCOPE_DENIED';
  return error;
}
