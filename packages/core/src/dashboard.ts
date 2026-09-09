import type { ChecklistItem, DashboardCommand, RunMode, TimerState } from '../../contracts/src/index.js';

export interface DashboardDomainState {
  mode: RunMode;
  timer: TimerState;
  checklist: ChecklistItem[];
}

/** Applies commands that only affect the dashboard domain and returns whether it handled the command. */
export function applyDashboardCommand(state: DashboardDomainState, command: DashboardCommand, now = Date.now()): boolean {
  const remaining = () => state.timer.running && state.timer.deadline
    ? Math.max(0, Math.ceil((state.timer.deadline - now) / 1000))
    : state.timer.remaining;

  switch (command.type) {
    case 'mode.set': state.mode = command.mode; return true;
    case 'timer.start': {
      const seconds = Math.max(1, Math.floor(command.seconds ?? state.timer.remaining));
      state.timer.duration = seconds; state.timer.remaining = seconds; state.timer.running = true; state.timer.deadline = now + seconds * 1000;
      return true;
    }
    case 'timer.pause': state.timer.remaining = remaining(); state.timer.running = false; state.timer.deadline = null; return true;
    case 'timer.reset': state.timer.running = false; state.timer.remaining = state.timer.duration; state.timer.deadline = null; return true;
    case 'timer.add': {
      state.timer.remaining = Math.max(0, remaining() + Math.floor(command.seconds));
      if (state.timer.running) state.timer.deadline = now + state.timer.remaining * 1000;
      return true;
    }
    case 'checklist.toggle': {
      const item = state.checklist.find(value => value.id === command.id);
      if (!item) throw new Error(`Élément de checklist inconnu : ${command.id}`);
      item.done = !item.done; return true;
    }
    case 'checklist.reset': state.checklist.forEach(item => { item.done = false; }); return true;
    default: return false;
  }
}
