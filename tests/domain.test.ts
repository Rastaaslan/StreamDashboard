import { describe, expect, it } from 'vitest';
import { applyDashboardCommand } from '../packages/core/src/dashboard.js';

function domain() {
  return { mode: 'idle' as const, timer: { running: false, duration: 300, remaining: 300, deadline: null }, checklist: [{ id: 'obs', label: 'OBS', done: false }] };
}

describe('module métier du cockpit', () => {
  it('utilise une horloge injectée pour démarrer et mettre en pause le timer', () => {
    const state = domain();
    applyDashboardCommand(state, { type: 'timer.start', seconds: 60 }, 1_000);
    expect(state.timer.deadline).toBe(61_000);
    applyDashboardCommand(state, { type: 'timer.pause' }, 31_000);
    expect(state.timer).toMatchObject({ running: false, remaining: 30, deadline: null });
  });

  it('refuse une entrée de checklist inconnue', () => {
    expect(() => applyDashboardCommand(domain(), { type: 'checklist.toggle', id: 'missing' })).toThrow(/inconnu/);
  });
});
