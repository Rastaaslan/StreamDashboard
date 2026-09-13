import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emptyCompanionState, reconcileCompanionBatch } from '../apps/server/src/companion-sync.js';
import { parseRemoteCommand, toRemoteDashboardState } from '../apps/server/src/remote-policy.js';
import type { DashboardState } from '../packages/contracts/src/index.js';

const index = readFileSync(new URL('../apps/mobile/index.html', import.meta.url), 'utf8');
const feedback = readFileSync(new URL('../apps/mobile/mobile-live-feedback.js', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../apps/mobile/transport.js', import.meta.url), 'utf8');

const state = {
  at: new Date().toISOString(),
  mode: 'live',
  timer: { running: true, duration: 300, remaining: 120, deadline: Date.now() + 120_000 },
  planning: [{
    id: 'event-1', title: 'FC26', description: 'Clubs', startAtUtc: '2026-09-14T18:00:00.000Z', endAtUtc: '2026-09-14T20:00:00.000Z',
    category: 'live', editable: true, desiredPublication: { local: true, twitch: false, google: false },
  }],
  checklist: [{ id: 'audio', label: 'Tester le micro', done: false }],
  obs: { connected: true, streaming: true, recording: false, scene: 'LIVE', scenes: ['LIVE'], inputs: {}, activeAudioInputs: [], mediaInputs: [], error: null, obsVersion: null, websocketVersion: null },
  nextLive: null,
  health: {},
  settings: { streamerName: 'Dam', accent: 'violet', confirmStop: true, obsUrl: 'ws://127.0.0.1:4455', obsPasswordSet: false, twitchConnected: false, twitchUserName: null, launchObs: false, modeScenes: { live: 'LIVE' }, remoteEnabled: true },
  twitch: { connected: false, userName: null, displayName: null, error: null, syncing: false, lastSyncedAt: null, deviceAuthorization: null },
  runtime: { serverVersion: 'test', nodeVersion: process.version, electronVersion: null, platform: process.platform, port: 47832, logsPath: null },
} as DashboardState;

describe('retours à chaud mobile', () => {
  it('charge le contrôleur correctif après le runtime mobile historique', () => {
    expect(index.indexOf('src="mobile.js"')).toBeGreaterThan(-1);
    expect(index.indexOf('src="mobile-live-feedback.js"')).toBeGreaterThan(index.indexOf('src="mobile.js"'));
  });

  it('Préparer ouvre la prépa et permet de piloter la checklist depuis le remote', () => {
    expect(index).toContain('Checklist pré-live');
    expect(feedback).toContain("transport.command({ type: 'session.prepare' })");
    expect(feedback).toContain("document.querySelector('[data-tab=\"prepare\"]')?.click()");
    expect(parseRemoteCommand({ type: 'checklist.toggle', id: 'audio' }, state)).toEqual({ type: 'checklist.toggle', id: 'audio' });
    expect(parseRemoteCommand({ type: 'checklist.reset' }, state)).toEqual({ type: 'checklist.reset' });
    expect((toRemoteDashboardState(state) as unknown as { checklist: typeof state.checklist }).checklist).toEqual(state.checklist);
  });

  it('arrête le live par HTTP sans dépendre de l’état du WebSocket', () => {
    expect(parseRemoteCommand({ type: 'session.stop' }, state)).toEqual({ type: 'session.stop' });
    expect(feedback).toContain("transport.command({ type: start ? 'session.start' : 'session.stop'");
    expect(feedback).toContain("OBS indique que le live est toujours actif après la commande d’arrêt.");
    expect(feedback).not.toContain('ws.readyState');
  });

  it('rend les notes réellement éditables et synchronisées', () => {
    expect(feedback).toContain("companion.upsertCollection('notes'");
    expect(feedback).toContain("companion.removeCollection('notes'");
    expect(feedback).toContain('await syncCompanionNow()');
  });

  it('ajoute une vraie édition et suppression des événements du planning avec fallback compagnon', () => {
    expect(feedback).toContain('openPlanningEdit(item)');
    expect(feedback).toContain('submitPlanningEdit(event)');
    expect(feedback).toContain('deletePlanningItem(item)');
    expect(transport).toContain('updatePlanning:');
    expect(transport).toContain('deletePlanning:');
    expect(transport).toContain('planningFallback');
    expect(transport).toContain('shouldFallbackPlanning');
  });

  it('seed la checklist desktop dans le cache compagnon avec une révision', () => {
    const desktopChecklist = [{ id: 'audio', label: 'Tester le micro', done: false }];
    const first = reconcileCompanionBatch([], desktopChecklist, emptyCompanionState(), []);
    expect(first.checklist).toEqual(desktopChecklist);
    expect(first.companion.checklist[0]).toMatchObject({ id: 'audio', label: 'Tester le micro', done: false, revision: 1 });

    const second = reconcileCompanionBatch([], [{ ...desktopChecklist[0], done: true }], first.companion, []);
    expect(second.checklist[0].done).toBe(true);
    expect(second.companion.checklist[0].revision).toBe(2);
  });
});
