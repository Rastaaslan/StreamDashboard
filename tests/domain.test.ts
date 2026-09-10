import { describe, expect, it } from 'vitest';
import { applyDashboardCommand, MAX_TIMER_SECONDS, startNewSessionTimer } from '../packages/core/src/dashboard.js';

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

  it('conserve la durée de référence lors d’une reprise et reset à la durée complète', () => {
    const state = domain();
    applyDashboardCommand(state, { type: 'timer.start' }, 1_000);
    applyDashboardCommand(state, { type: 'timer.pause' }, 31_000);
    expect(state.timer).toMatchObject({ duration: 300, remaining: 270, running: false });
    applyDashboardCommand(state, { type: 'timer.start' }, 40_000);
    expect(state.timer).toMatchObject({ duration: 300, remaining: 270, running: true, deadline: 310_000 });
    applyDashboardCommand(state, { type: 'timer.reset' }, 45_000);
    expect(state.timer).toMatchObject({ duration: 300, remaining: 300, running: false, deadline: null });
  });

  it('refuse une entrée de checklist inconnue', () => {
    expect(() => applyDashboardCommand(domain(), { type: 'checklist.toggle', id: 'missing' })).toThrow(/inconnu/);
  });

  it('ajoute cinq minutes avant, pendant et après une pause et démarre une nouvelle session complète', () => {
    const state = domain(); applyDashboardCommand(state, { type: 'timer.add', seconds: 300 }, 0); expect(state.timer.remaining).toBe(600);
    applyDashboardCommand(state, { type: 'timer.start' }, 1_000); applyDashboardCommand(state, { type: 'timer.add', seconds: 300 }, 2_000); expect(state.timer.remaining).toBe(899);
    applyDashboardCommand(state, { type: 'timer.pause' }, 3_000); applyDashboardCommand(state, { type: 'timer.add', seconds: 300 }, 3_000); expect(state.timer.remaining).toBe(1198);
    state.timer.duration = 300; startNewSessionTimer(state, 5_000); expect(state.timer).toMatchObject({ running: true, remaining: 300, deadline: 305_000 });
  });

  it('borne aussi le cumul des ajouts pour éviter un timeout Node hors plage', () => {
    const state = domain();
    state.timer.remaining = MAX_TIMER_SECONDS - 10;
    applyDashboardCommand(state, { type: 'timer.add', seconds: 300 }, 0);
    expect(state.timer.remaining).toBe(MAX_TIMER_SECONDS);
    applyDashboardCommand(state, { type: 'timer.start' }, 5_000);
    expect(state.timer.deadline).toBe(5_000 + MAX_TIMER_SECONDS * 1000);
  });
});
